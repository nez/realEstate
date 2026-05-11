import type { Db } from 'mongodb'
import logger from './logger'

// Idempotent index creation. Safe to call on every entrypoint;
// Mongo no-ops when an index already exists with the same spec.
export const ensureIndexes = async (db: Db, collectionNames: {
  listings: string
  details: string
  changeEvents: string
  parseErrors: string
}): Promise<void> => {
  const tasks: Array<Promise<unknown>> = []

  const listings = db.collection(collectionNames.listings)
  tasks.push(listings.createIndex({ salePriceYen: 1 }, { name: 'salePriceYen_1', sparse: true }))
  tasks.push(listings.createIndex({ rentPriceYen: 1 }, { name: 'rentPriceYen_1', sparse: true }))
  tasks.push(listings.createIndex({ sizeM2: 1 }, { name: 'sizeM2_1', sparse: true }))
  tasks.push(listings.createIndex({ status: 1 }, { name: 'status_1' }))
  tasks.push(listings.createIndex({ lastSeenAt: -1 }, { name: 'lastSeenAt_-1' }))
  tasks.push(listings.createIndex({ scraped: 1 }, { name: 'scraped_1' })) // legacy field
  tasks.push(listings.createIndex({ nextAttemptAt: 1 }, { name: 'nextAttemptAt_1', sparse: true }))

  const details = db.collection(collectionNames.details)
  // Not unique — the detail collection may have legacy duplicates from earlier
  // runs. Uniqueness is enforced by the listing status, not the index.
  tasks.push(details.createIndex({ listingId: 1 }, { name: 'listingId_1', sparse: true }))

  const changes = db.collection(collectionNames.changeEvents)
  tasks.push(changes.createIndex({ kind: 1, observedAt: -1 }, { name: 'kind_observedAt' }))
  tasks.push(changes.createIndex({ listingId: 1, observedAt: -1 }, { name: 'listingId_observedAt' }))

  const parseErrors = db.collection(collectionNames.parseErrors)
  tasks.push(parseErrors.createIndex({ collection: 1, observedAt: -1 }, { name: 'collection_observedAt' }))

  const results = await Promise.allSettled(tasks)
  const failed = results.filter(r => r.status === 'rejected')
  if (failed.length > 0) {
    for (const r of failed) {
      if (r.status === 'rejected') logger.warn(`ensureIndexes: ${String(r.reason)}`)
    }
  }
}
