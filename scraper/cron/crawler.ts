import type { AnyBulkWriteOperation } from 'mongodb'
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
    // Backfill firstSeenAt on legacy rows that pre-date M2.
    if (!existing.firstSeenAt) set.firstSeenAt = now

    const update: Record<string, unknown> = { $set: set }
    if (historyEntries.length > 0) {
      update.$push = { priceHistory: { $each: historyEntries } }
    }
    ops.push({ updateOne: { filter: { _id: item._id as any }, update } })
  }

  return { ops, events }
}

const crawler = async (): Promise<void> => {
  logger.info('Start: Crawler is scraping and saving to the database...')

  const { mongo, scraper } = config()
  const database = client.db(mongo.dbName)
  const listingsCollection = database.collection(mongo.collections.listings)
  const stateCollection = database.collection(mongo.collections.state)
  const parseErrorsCollection = database.collection(mongo.collections.parseErrors)
  const changeEventsCollection = database.collection(mongo.collections.changeEvents)

  await ensureIndexes(database, {
    listings: mongo.collections.listings,
    details: mongo.collections.details,
    changeEvents: mongo.collections.changeEvents,
    parseErrors: mongo.collections.parseErrors
  })

  // Resume mid-run if the previous run was abandoned within the resume window;
  // otherwise start a fresh full pass from page 1.
  const now = new Date()
  let runStartedAt = now
  let startPage = 1
  const state = await stateCollection.findOne({ stateId: 'crawler' })
  if (state?.runStartedAt && state?.lastPage && state.lastPage > 0 &&
      now.getTime() - new Date(state.runStartedAt).getTime() < RESUME_WINDOW_MS) {
    runStartedAt = new Date(state.runStartedAt)
    startPage = state.lastPage + 1
    logger.info(`Resuming run started ${runStartedAt.toISOString()} from page ${startPage}`)
  } else {
    await stateCollection.updateOne(
      { stateId: 'crawler' },
      { $set: { runStartedAt, lastPage: 0 } },
      { upsert: true }
    )
    logger.info('Starting a fresh listing crawl from page 1')
  }

  let totalNewListings = 0
  let totalPriceChanges = 0

  try {
    const { totalItems, maxPageNumber } = await getNumbers()
    logger.info(`Processing: total items: ${totalItems}, max page: ${maxPageNumber}`)

    for (let i = startPage; i <= maxPageNumber; i++) {
      try {
        logger.info(`Scraping page ${i} of ${maxPageNumber}...`)
        const data = await scrapePage(scraper.startPath + `&pn=${i}`)
        if (!data || data.length === 0) {
          await stateCollection.updateOne(
            { stateId: 'crawler' },
            { $set: { lastPage: i } }
          )
          continue
        }

        // Validate every scraped row, splitting good from bad.
        const valid: Listing[] = []
        const invalid: Array<{ rawDoc: unknown, issues: unknown }> = []
        for (const item of data) {
          const result = validate(ListingSchema, item)
          if (result.ok) valid.push(result.data)
          else invalid.push({ rawDoc: item, issues: result.issues })
        }

        if (invalid.length > 0) {
          logger.warn(`Page ${i}: ${invalid.length}/${data.length} listings failed schema validation`)
          try {
            await parseErrorsCollection.insertMany(
              invalid.map(e => ({
                ...e,
                sourceUrl: (e.rawDoc as any)?.url ?? null,
                collection: 'listings',
                observedAt: new Date()
              })),
              { ordered: false }
            )
          } catch (err: any) {
            logger.error(`Page ${i}: failed to record parse errors: ${err.message}`)
          }
        }

        if (valid.length > 0) {
          // Bulk-fetch existing rows for diffing in one round-trip.
          const ids = valid.map(v => v._id)
          const existingDocs = await listingsCollection
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
              await listingsCollection.bulkWrite(ops, { ordered: false })
            } catch (err: any) {
              // A surprise dup-key on an insertOne (race / parser quirk) is non-fatal here.
              if (err.code === 11000 || err.writeErrors) {
                logger.warn(`Page ${i}: bulkWrite reported ${err.writeErrors?.length ?? 1} write errors (continuing)`)
              } else {
                throw err
              }
            }
          }

          if (events.length > 0) {
            const newOnes = events.filter(e => e.kind === 'new_listing').length
            const priceChanges = events.length - newOnes
            totalNewListings += newOnes
            totalPriceChanges += priceChanges
            try {
              await changeEventsCollection.insertMany(events, { ordered: false })
            } catch (err: any) {
              logger.error(`Page ${i}: failed to record change events: ${err.message}`)
            }
          }

          logger.info(`Page ${i}: processed ${valid.length} listings (${events.filter(e => e.kind === 'new_listing').length} new, ${events.length - events.filter(e => e.kind === 'new_listing').length} price changes)`)
        }

        await stateCollection.updateOne(
          { stateId: 'crawler' },
          { $set: { lastPage: i } }
        )
      } catch (error: any) {
        logger.error(`Error processing page ${i}: ${error.message}`)
        if (error.code === 'ECONNREFUSED') {
          logger.error('Connection refused by server. Stopping crawler to prevent IP block.')
          break
        }
      }
    }

    // Crawl completed end-to-end: clear the resume marker so the next scheduled
    // run starts fresh at page 1.
    await stateCollection.updateOne(
      { stateId: 'crawler' },
      { $set: { lastFullCrawlAt: new Date() }, $unset: { lastPage: '', runStartedAt: '' } }
    )
  } catch (error) {
    logger.error(`Error: Error scraping and saving to the database: ${error}`)
  }

  logger.info(`Finished: ${totalNewListings} new listings, ${totalPriceChanges} price changes`)
}

export default crawler
