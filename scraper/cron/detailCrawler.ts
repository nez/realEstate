import client from '../lib/client'
import logger from '../lib/logger'
import scrapeDetailPage from '../lib/scrapeDetail'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const detailCrawler = async (): Promise<void> => {
  logger.info('Start: Detail Crawler is scraping and updating the database...')
  try {
    const dbName = process.env.MONGO_DB_NAME ?? 'suumo'
    const listingsCollectionName = process.env.MONGO_COLLECTION_NAME ?? 'listings'
    const detailsCollectionName = process.env.MONGO_COLLECTION_DETAILS ?? 'details'

    const database = client.db(dbName)
    const listingsCollection = database.collection(listingsCollectionName)
    const detailsCollection = database.collection(detailsCollectionName)

    const unscrapedCursor = listingsCollection.find({ scraped: { $ne: true } })

    for await (const doc of unscrapedCursor) {
      if (!doc.url) {
        logger.warn(`Document with _id: ${doc._id} has no URL. Skipping.`)
        continue
      }

      logger.info(`Scraping details for: ${doc.name} (${doc.url})`)
      const detailData = await scrapeDetailPage(doc.url)

      if (detailData) {
        detailData.listingId = doc._id // Link back to the original listing
        await detailsCollection.insertOne(detailData)
        await listingsCollection.updateOne({ _id: doc._id }, { $set: { scraped: true } })
        logger.info(`Successfully saved details for: ${doc.name}`)
      }

      await sleep(Math.floor(Math.random() * 1000) + 2000) // 2-3 second random delay
    }
  } catch (error) {
    logger.error(`Error in Detail Crawler: ${error}`)
  }
  logger.info('Finished: Detail Crawler has finished.')
}

export default detailCrawler