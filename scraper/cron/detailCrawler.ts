import type { Collection } from 'mongodb'
import client from '../lib/client'
import logger from '../lib/logger'
import scrapeDetailPage, { type ScrapeResult } from '../lib/scrapeDetail'
import { DetailSchema, validate } from '../lib/schemas'
import {
  type OutcomePatch,
  eligibleForDetailScrape,
  permanentErrorPatch,
  successPatch,
  transientErrorPatch
} from '../lib/status'

const sleep = async (ms: number) => await new Promise(resolve => setTimeout(resolve, ms))

const BATCH_SIZE = 20
const REQUEST_DELAY_RANGE_MS = [2000, 3000] as const

const applyOutcome = async (
  listingsCollection: Collection,
  listingId: unknown,
  patch: OutcomePatch
): Promise<void> => {
  await listingsCollection.updateOne({ _id: listingId as any }, patch as any)
}

const recordParseError = async (
  parseErrorsCollection: Collection,
  payload: {
    listingId: unknown
    sourceUrl: string
    rawDoc: unknown
    issues: unknown
    collection: 'listings' | 'details'
  }
): Promise<void> => {
  try {
    await parseErrorsCollection.insertOne({ ...payload, observedAt: new Date() })
  } catch (err: any) {
    logger.error(`[PARSE-ERROR-STORE] failed to record parse error: ${err.message}`)
  }
}

const handleResult = async (
  result: ScrapeResult,
  doc: any,
  collections: {
    listings: Collection
    details: Collection
    parseErrors: Collection
  }
): Promise<'success' | 'error'> => {
  if (result.kind === 'transient') {
    await applyOutcome(collections.listings, doc._id, transientErrorPatch(result.reason, doc.attempts ?? 0))
    return 'error'
  }

  if (result.kind === 'permanent') {
    await applyOutcome(collections.listings, doc._id, permanentErrorPatch(result.reason))
    return 'error'
  }

  const validated = validate(DetailSchema, result.data)
  if (!validated.ok) {
    logger.warn(`[VALIDATE] detail for ${doc.url} failed schema (${validated.issues.length} issues)`)
    await recordParseError(collections.parseErrors, {
      listingId: doc._id,
      sourceUrl: doc.url,
      rawDoc: result.data,
      issues: validated.issues,
      collection: 'details'
    })
    await applyOutcome(collections.listings, doc._id, permanentErrorPatch('detail schema validation failed'))
    return 'error'
  }

  try {
    await collections.details.insertOne(validated.data as any)
    await applyOutcome(collections.listings, doc._id, successPatch())
    return 'success'
  } catch (err: any) {
    // A duplicate detail row (e.g. re-scrape of an already-saved listing) is harmless;
    // mark the listing successful so we don't retry forever.
    if (err.code === 11000) {
      await applyOutcome(collections.listings, doc._id, successPatch())
      return 'success'
    }
    logger.error(`[SAVE] failed to insert detail for ${doc.url}: ${err.message}`)
    await applyOutcome(
      collections.listings,
      doc._id,
      transientErrorPatch(`mongo insert failed: ${err.message}`, doc.attempts ?? 0)
    )
    return 'error'
  }
}

const detailCrawler = async (): Promise<void> => {
  const startTime = Date.now()
  logger.info('='.repeat(50))
  logger.info('DETAIL CRAWLER STARTING')
  logger.info('='.repeat(50))

  const dbName = process.env.MONGO_DB_NAME ?? 'suumo'
  const listingsCollectionName = process.env.MONGO_COLLECTION_NAME ?? 'listings'
  const detailsCollectionName = process.env.MONGO_COLLECTION_DETAILS ?? 'details'
  const parseErrorsCollectionName = process.env.MONGO_COLLECTION_PARSE_ERRORS ?? 'parse_errors'

  const database = client.db(dbName)
  const collections = {
    listings: database.collection(listingsCollectionName),
    details: database.collection(detailsCollectionName),
    parseErrors: database.collection(parseErrorsCollectionName)
  }

  let processedCount = 0
  let successCount = 0
  let errorCount = 0
  let batchNumber = 0

  try {
    let pending = await collections.listings.countDocuments(eligibleForDetailScrape())
    const totalListings = await collections.listings.countDocuments({})
    logger.info(`[PROGRESS] eligible=${pending} total=${totalListings}`)
    if (pending === 0) {
      logger.info('No eligible listings. Exiting.')
      return
    }

    while (pending > 0) {
      batchNumber++
      const batch = await collections.listings
        .find(eligibleForDetailScrape())
        .sort({ attempts: 1, _id: 1 })
        .limit(BATCH_SIZE)
        .toArray()

      if (batch.length === 0) break
      logger.info(`[BATCH ${batchNumber}] picked up ${batch.length} listings`)

      for (let i = 0; i < batch.length; i++) {
        const doc = batch[i]
        processedCount++

        if (!doc.url) {
          await applyOutcome(collections.listings, doc._id, permanentErrorPatch('No URL on listing'))
          errorCount++
          continue
        }

        logger.info(`[${processedCount}] scraping ${doc.url}`)
        let result: ScrapeResult
        try {
          result = await scrapeDetailPage(doc.url)
        } catch (err: any) {
          // scrapeDetailPage shouldn't throw post-refactor, but belt-and-braces.
          logger.error(`[UNEXPECTED] scrapeDetailPage threw: ${err.message}`)
          await applyOutcome(
            collections.listings,
            doc._id,
            transientErrorPatch(`unexpected error: ${err.message}`, doc.attempts ?? 0)
          )
          errorCount++
          continue
        }

        const outcome = await handleResult(result, doc, collections)
        if (outcome === 'success') successCount++
        else errorCount++

        if (i < batch.length - 1) {
          const [lo, hi] = REQUEST_DELAY_RANGE_MS
          await sleep(Math.floor(Math.random() * (hi - lo)) + lo)
        }
      }

      pending = await collections.listings.countDocuments(eligibleForDetailScrape())
      if (pending > 0) await sleep(2000)
    }

    const totalMin = Math.round((Date.now() - startTime) / 60_000)
    logger.info('='.repeat(50))
    logger.info(`DETAIL CRAWLER FINISHED: batches=${batchNumber} processed=${processedCount} success=${successCount} errors=${errorCount} duration=${totalMin}m`)
    logger.info('='.repeat(50))
  } catch (error: any) {
    logger.error(`[FATAL] ${error.constructor.name}: ${error.message}`)
    logger.error(`processed=${processedCount} success=${successCount} errors=${errorCount}`)
  }
}

export default detailCrawler
