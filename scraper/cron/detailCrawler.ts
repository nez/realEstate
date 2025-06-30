import client from '../lib/client'
import logger from '../lib/logger'
import scrapeDetailPage from '../lib/scrapeDetail'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const detailCrawler = async (): Promise<void> => {
  const startTime = Date.now()
  logger.info('='.repeat(50))
  logger.info('🚀 DETAIL CRAWLER STARTING')
  logger.info('='.repeat(50))

  try {
    const dbName = process.env.MONGO_DB_NAME ?? 'suumo'
    const listingsCollectionName = process.env.MONGO_COLLECTION_NAME ?? 'listings'
    const detailsCollectionName = process.env.MONGO_COLLECTION_DETAILS ?? 'details'

    logger.info(`📊 Configuration:`)
    logger.info(`   Database: '${dbName}'`)
    logger.info(`   Source Collection: '${listingsCollectionName}'`)
    logger.info(`   Target Collection: '${detailsCollectionName}'`)

    const database = client.db(dbName)
    const listingsCollection = database.collection(listingsCollectionName)
    const detailsCollection = database.collection(detailsCollectionName)

    // Get counts for progress tracking
    const unscrapedCursor = listingsCollection.find({ scraped: { $ne: true } })
    const totalCount = await listingsCollection.countDocuments({ scraped: { $ne: true } })
    const scrapedCount = await listingsCollection.countDocuments({ scraped: true })
    const totalListings = await listingsCollection.countDocuments({})

    logger.info(`📈 Progress Status:`)
    logger.info(`   Total listings: ${totalListings}`)
    logger.info(`   Already scraped: ${scrapedCount}`)
    logger.info(`   Remaining to scrape: ${totalCount}`)
    logger.info(`   Progress: ${((scrapedCount / totalListings) * 100).toFixed(1)}%`)

    if (totalCount === 0) {
      logger.info('✅ No unscraped documents found. Detail crawler has nothing to do.')
      return
    }

    let processedCount = 0
    let successCount = 0
    let errorCount = 0
    let currentDocument: any = null

    for await (const doc of unscrapedCursor) {
      processedCount++
      currentDocument = doc

      const progress = ((processedCount / totalCount) * 100).toFixed(1)
      const elapsed = Date.now() - startTime
      const avgTimePerDoc = elapsed / processedCount
      const estimatedRemaining = Math.round((totalCount - processedCount) * avgTimePerDoc / 1000 / 60)

      logger.info(`\n📍 [${processedCount}/${totalCount}] (${progress}%) Processing document...`)
      logger.info(`   ID: ${doc._id}`)
      logger.info(`   Name: ${doc.name || 'Unknown'}`)
      logger.info(`   Estimated time remaining: ${estimatedRemaining} minutes`)

      if (!doc.url) {
        logger.warn(`⚠️  Document with _id: ${doc._id} has no URL. Skipping.`)
        errorCount++
        continue
      }

      logger.info(`🌐 Starting scrape for: ${doc.url}`)
      const scrapeStartTime = Date.now()

      try {
        const detailData = await scrapeDetailPage(doc.url)
        const scrapeTime = Date.now() - scrapeStartTime

        if (detailData) {
          detailData.listingId = doc._id

          logger.info(`💾 Saving scraped data... (scraped in ${scrapeTime}ms)`)
          await detailsCollection.insertOne(detailData)
          await listingsCollection.updateOne({ _id: doc._id }, { $set: { scraped: true } })

          logger.info(`✅ Successfully saved details and marked as scraped`)
          logger.info(`   Fields extracted: ${Object.keys(detailData).length}`)
          logger.info(`   Images found: ${detailData.images?.length || 0}`)
          successCount++
        } else {
          logger.error(`❌ Failed to scrape details for: ${doc.name} (${doc.url})`)
          logger.error(`   Scraping returned null after ${scrapeTime}ms`)
          errorCount++
        }
      } catch (error: any) {
        const scrapeTime = Date.now() - scrapeStartTime
        logger.error(`💥 Exception while scraping: ${doc.name} (${doc.url})`)
        logger.error(`   Error after ${scrapeTime}ms: ${error.message}`)
        logger.error(`   Error type: ${error.constructor.name}`)
        errorCount++
      }

      // Sleep between requests with progress info
      const sleepTime = Math.floor(Math.random() * 1000) + 2000
      logger.info(`😴 Sleeping for ${sleepTime}ms before next request...`)
      await sleep(sleepTime)
    }

    const totalTime = Date.now() - startTime
    const totalMinutes = Math.round(totalTime / 1000 / 60)

    logger.info('\n' + '='.repeat(50))
    logger.info('🏁 DETAIL CRAWLER FINISHED')
    logger.info('='.repeat(50))
    logger.info(`📊 Final Statistics:`)
    logger.info(`   Total processed: ${processedCount}`)
    logger.info(`   Successful: ${successCount}`)
    logger.info(`   Errors: ${errorCount}`)
    logger.info(`   Success rate: ${processedCount > 0 ? ((successCount / processedCount) * 100).toFixed(1) : 0}%`)
    logger.info(`   Total time: ${totalMinutes} minutes`)
    logger.info(`   Average time per listing: ${processedCount > 0 ? Math.round(totalTime / processedCount / 1000) : 0} seconds`)

  } catch (error: any) {
    const totalTime = Date.now() - startTime
    logger.error('\n' + '='.repeat(50))
    logger.error('💥 DETAIL CRAWLER FATAL ERROR')
    logger.error('='.repeat(50))
    logger.error(`Error after ${Math.round(totalTime / 1000 / 60)} minutes: ${error.message}`)
    logger.error(`Error type: ${error.constructor.name}`)
    logger.error(`Full error: ${error}`)
    logger.error(`Stack trace: ${error.stack}`)
  }
}

export default detailCrawler