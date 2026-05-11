import { createHash } from 'crypto'
import type { AnyBulkWriteOperation, Collection } from 'mongodb'
import scrapePage from '../lib/scrape'
import { getNumbers } from '../lib/number'
import client from '../lib/client'
import logger from '../lib/logger'
import { ListingSchema, type Listing, validate } from '../lib/schemas'
import {
  type ChangeEvent,
  type ListingPriceState,
  diffListing,
  priceHistoryEntriesFromEvents
} from '../lib/changes'
import { ensureIndexes } from '../lib/indexes'
import { config } from '../lib/config'

// Crash-resume window. If the prior run's state is older than this we treat it
// as abandoned and start fresh at page 1. Each successful nightly run completes
// in well under this window.
const RESUME_WINDOW_MS = 6 * 60 * 60 * 1000

// Short, stable id used to namespace each path's resume state. Two different
// URLs (e.g. one per Japanese region) get independent lastPage cursors so they
// don't trample each other.
const pathStateId = (url: string): string =>
  `crawler:${createHash('sha256').update(url).digest('hex').slice(0, 10)}`

const buildOperationsForBatch = (
  valid: Listing[],
  existingById: Map<string, any>,
  now: Date
): { ops: Array<AnyBulkWriteOperation<any>>, events: ChangeEvent[] } => {
  const ops: Array<AnyBulkWriteOperation<any>> = []
  const events: ChangeEvent[] = []

  for (const item of valid) {
    const existing = existingById.get(item._id) ?? null
    const next: ListingPriceState = {
      _id: item._id,
      url: item.url,
      salePriceYen: item.salePriceYen,
      rentPriceYen: item.rentPriceYen
    }
    const prev: ListingPriceState | null = existing
      ? {
          _id: existing._id,
          url: existing.url ?? item.url,
          salePriceYen: existing.salePriceYen ?? null,
          rentPriceYen: existing.rentPriceYen ?? null
        }
      : null
    const itemEvents = diffListing(prev, next, now)
    events.push(...itemEvents)

    if (existing === null) {
      const initialHistory: Array<{ kind: 'sale' | 'rent', priceYen: number, observedAt: Date }> = []
      if (item.salePriceYen !== null) {
        initialHistory.push({ kind: 'sale', priceYen: item.salePriceYen, observedAt: now })
      }
      if (item.rentPriceYen !== null) {
        initialHistory.push({ kind: 'rent', priceYen: item.rentPriceYen, observedAt: now })
      }
      ops.push({
        insertOne: {
          document: {
            ...item,
            firstSeenAt: now,
            lastSeenAt: now,
            priceHistory: initialHistory
          }
        }
      })
      continue
    }

    const historyEntries = priceHistoryEntriesFromEvents(itemEvents)
    const set: Record<string, unknown> = { lastSeenAt: now }
    if (historyEntries.length > 0) {
      set.salePriceYen = item.salePriceYen
      set.rentPriceYen = item.rentPriceYen
    }
    if (!existing.firstSeenAt) set.firstSeenAt = now

    const update: Record<string, unknown> = { $set: set }
    if (historyEntries.length > 0) {
      update.$push = { priceHistory: { $each: historyEntries } }
    }
    ops.push({ updateOne: { filter: { _id: item._id as any }, update } })
  }

  return { ops, events }
}

interface PathStats { newListings: number, priceChanges: number, pagesCrawled: number }

const crawlSinglePath = async (
  startPath: string,
  collections: {
    listings: Collection
    state: Collection
    parseErrors: Collection
    changeEvents: Collection
  }
): Promise<PathStats> => {
  const stateId = pathStateId(startPath)
  const stats: PathStats = { newListings: 0, priceChanges: 0, pagesCrawled: 0 }

  const now = new Date()
  let runStartedAt = now
  let startPage = 1
  const state = await collections.state.findOne({ stateId })
  if (state?.runStartedAt && state?.lastPage && state.lastPage > 0 &&
      now.getTime() - new Date(state.runStartedAt).getTime() < RESUME_WINDOW_MS) {
    runStartedAt = new Date(state.runStartedAt)
    startPage = state.lastPage + 1
    logger.info(`[${stateId}] Resuming from page ${startPage}`)
  } else {
    await collections.state.updateOne(
      { stateId },
      { $set: { stateId, startPath, runStartedAt, lastPage: 0 } },
      { upsert: true }
    )
    logger.info(`[${stateId}] Fresh crawl from page 1 of ${startPath.substring(0, 90)}...`)
  }

  try {
    const { totalItems, maxPageNumber } = await getNumbers(startPath)
    logger.info(`[${stateId}] total items: ${totalItems}, max page: ${maxPageNumber}`)

    for (let i = startPage; i <= maxPageNumber; i++) {
      try {
        const data = await scrapePage(startPath + `&pn=${i}`)
        if (!data || data.length === 0) {
          await collections.state.updateOne({ stateId }, { $set: { lastPage: i } })
          continue
        }

        const valid: Listing[] = []
        const invalid: Array<{ rawDoc: unknown, issues: unknown }> = []
        for (const item of data) {
          const result = validate(ListingSchema, item)
          if (result.ok) valid.push(result.data)
          else invalid.push({ rawDoc: item, issues: result.issues })
        }

        if (invalid.length > 0) {
          logger.warn(`[${stateId}] p${i}: ${invalid.length}/${data.length} failed schema validation`)
          try {
            await collections.parseErrors.insertMany(
              invalid.map(e => ({
                ...e,
                sourceUrl: (e.rawDoc as any)?.url ?? null,
                collection: 'listings',
                observedAt: new Date()
              })),
              { ordered: false }
            )
          } catch (err: any) {
            logger.error(`[${stateId}] p${i}: parse-error store failed: ${err.message}`)
          }
        }

        if (valid.length > 0) {
          const ids = valid.map(v => v._id)
          const existingDocs = await collections.listings
            .find(
              { _id: { $in: ids as any } },
              { projection: { _id: 1, url: 1, salePriceYen: 1, rentPriceYen: 1, firstSeenAt: 1 } }
            )
            .toArray()
          const existingById = new Map<string, any>(existingDocs.map(d => [String(d._id), d]))

          const observedAt = new Date()
          const { ops, events } = buildOperationsForBatch(valid, existingById, observedAt)

          if (ops.length > 0) {
            try {
              await collections.listings.bulkWrite(ops, { ordered: false })
            } catch (err: any) {
              if (err.code === 11000 || err.writeErrors) {
                logger.warn(`[${stateId}] p${i}: bulkWrite reported ${err.writeErrors?.length ?? 1} write errors (continuing)`)
              } else {
                throw err
              }
            }
          }

          if (events.length > 0) {
            const newOnes = events.filter(e => e.kind === 'new_listing').length
            stats.newListings += newOnes
            stats.priceChanges += events.length - newOnes
            try {
              await collections.changeEvents.insertMany(events, { ordered: false })
            } catch (err: any) {
              logger.error(`[${stateId}] p${i}: change-events store failed: ${err.message}`)
            }
          }

          stats.pagesCrawled++
          logger.info(`[${stateId}] p${i}/${maxPageNumber}: ${valid.length} listings (${events.filter(e => e.kind === 'new_listing').length} new)`)
        }

        await collections.state.updateOne({ stateId }, { $set: { lastPage: i } })
      } catch (error: any) {
        logger.error(`[${stateId}] error on page ${i}: ${error.message}`)
        if (error.code === 'ECONNREFUSED') {
          logger.error(`[${stateId}] connection refused — stopping this path to avoid IP block`)
          break
        }
      }
    }

    // Completed end-to-end: clear the resume marker so the next run starts fresh.
    await collections.state.updateOne(
      { stateId },
      { $set: { lastFullCrawlAt: new Date() }, $unset: { lastPage: '', runStartedAt: '' } }
    )
  } catch (error) {
    logger.error(`[${stateId}] fatal: ${error}`)
  }

  return stats
}

const crawler = async (): Promise<void> => {
  const { mongo, scraper } = config()

  if (scraper.startPaths.length === 0) {
    logger.error('No START_PATH / START_PATHS configured. Exiting.')
    return
  }

  logger.info(`Crawler starting against ${scraper.startPaths.length} URL${scraper.startPaths.length === 1 ? '' : 's'}`)

  const database = client.db(mongo.dbName)
  const collections = {
    listings: database.collection(mongo.collections.listings),
    state: database.collection(mongo.collections.state),
    parseErrors: database.collection(mongo.collections.parseErrors),
    changeEvents: database.collection(mongo.collections.changeEvents)
  }

  await ensureIndexes(database, {
    listings: mongo.collections.listings,
    details: mongo.collections.details,
    changeEvents: mongo.collections.changeEvents,
    parseErrors: mongo.collections.parseErrors
  })

  let grandNew = 0
  let grandChanges = 0
  let grandPages = 0
  for (const [idx, startPath] of scraper.startPaths.entries()) {
    logger.info(`=== Path ${idx + 1}/${scraper.startPaths.length} ===`)
    const stats = await crawlSinglePath(startPath, collections)
    grandNew += stats.newListings
    grandChanges += stats.priceChanges
    grandPages += stats.pagesCrawled
  }

  logger.info(`Finished: ${grandPages} pages, ${grandNew} new listings, ${grandChanges} price changes across ${scraper.startPaths.length} URL(s)`)
}

export default crawler
