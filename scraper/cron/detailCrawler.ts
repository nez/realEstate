import client from '../lib/client'
import logger from '../lib/logger'
import scrapeDetailPage from '../lib/scrapeDetail'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const detailCrawler = async (): Promise<void> => {
  const startTime = Date.now()
  logger.info('='.repeat(50))
  logger.info('🚀 DETAIL CRAWLER STARTING')
  logger.info('='.repeat(50))

  let processedCount = 0
  let successCount = 0
  let errorCount = 0
  let batchNumber = 0
  const BATCH_SIZE = 20 // Process 20 documents at a time to avoid cursor timeout

  try {
    const dbName = process.env.MONGO_DB_NAME ?? 'suumo'
    const listingsCollectionName = process.env.MONGO_COLLECTION_NAME ?? 'listings'
    const detailsCollectionName = process.env.MONGO_COLLECTION_DETAILS ?? 'details'

    logger.info(`📊 Configuration:`)
    logger.info(`   Database: '${dbName}'`)
    logger.info(`   Source Collection: '${listingsCollectionName}'`)
    logger.info(`   Target Collection: '${detailsCollectionName}'`)
    logger.info(`   Batch Size: ${BATCH_SIZE} documents`)

    const database = client.db(dbName)
    const listingsCollection = database.collection(listingsCollectionName)
    const detailsCollection = database.collection(detailsCollectionName)

    // Get initial counts for progress tracking
    let totalCount = await listingsCollection.countDocuments({ scraped: { $ne: true } })
    const scrapedCount = await listingsCollection.countDocuments({ scraped: true })
    const totalListings = await listingsCollection.countDocuments({})

    logger.info(`📈 Initial Progress Status:`)
    logger.info(`   Total listings: ${totalListings}`)
    logger.info(`   Already scraped: ${scrapedCount}`)
    logger.info(`   Remaining to scrape: ${totalCount}`)
    logger.info(`   Progress: ${((scrapedCount / totalListings) * 100).toFixed(1)}%`)

    if (totalCount === 0) {
      logger.info('✅ No unscraped documents found. Detail crawler has nothing to do.')
      return
    }

    // Process documents in batches to avoid cursor timeout
    while (totalCount > 0) {
      batchNumber++
      logger.info(`\n🔄 Starting Batch ${batchNumber} (${BATCH_SIZE} documents max)`)

      let batch: any[] = []

      try {
        // Get a fresh batch of unscraped documents
        batch = await listingsCollection
          .find({ scraped: { $ne: true } })
          .limit(BATCH_SIZE)
          .toArray()

        logger.info(`📦 Batch ${batchNumber}: Retrieved ${batch.length} documents`)

        if (batch.length === 0) {
          logger.info('✅ No more unscraped documents found. Batch processing complete.')
          break
        }

      } catch (batchError: any) {
        logger.error(`❌ Error retrieving batch ${batchNumber}: ${batchError.message}`)
        logger.error(`   Will retry next batch in 10 seconds...`)
        await sleep(10000)
        continue
      }

      // Process each document in the current batch
      for (let i = 0; i < batch.length; i++) {
        const doc = batch[i]
        processedCount++

        const progress = ((processedCount / totalCount) * 100).toFixed(1)
        const elapsed = Date.now() - startTime
        const avgTimePerDoc = elapsed / processedCount
        const estimatedRemaining = Math.round((totalCount - processedCount) * avgTimePerDoc / 1000 / 60)

        logger.info(`\n📍 [Batch ${batchNumber}] [${i + 1}/${batch.length}] [Total: ${processedCount}] Processing...`)
        logger.info(`   ID: ${doc._id}`)
        logger.info(`   Name: ${doc.name || 'Unknown'}`)
        logger.info(`   Overall Progress: ${progress}%`)
        logger.info(`   Estimated time remaining: ${estimatedRemaining} minutes`)

        // Skip documents without URL
        if (!doc.url) {
          logger.warn(`⚠️  Document with _id: ${doc._id} has no URL. Skipping.`)
          errorCount++

          try {
            // Mark as scraped even though it failed, so we don't keep retrying
            await listingsCollection.updateOne(
              { _id: doc._id },
              { $set: { scraped: true, scrapedAt: new Date(), error: 'No URL found' } }
            )
            logger.info(`   Marked document as scraped (with error) to avoid reprocessing`)
          } catch (updateError: any) {
            logger.error(`   Failed to mark document as scraped: ${updateError.message}`)
          }

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

            try {
              await detailsCollection.insertOne(detailData)
              await listingsCollection.updateOne(
                { _id: doc._id },
                { $set: { scraped: true, scrapedAt: new Date() } }
              )

              logger.info(`✅ Successfully saved details and marked as scraped`)
              logger.info(`   Fields extracted: ${Object.keys(detailData).length}`)
              logger.info(`   Images found: ${detailData.images?.length || 0}`)
              successCount++

            } catch (saveError: any) {
              logger.error(`❌ Failed to save scraped data: ${saveError.message}`)
              logger.error(`   Will continue with next document...`)
              errorCount++
            }

          } else {
            logger.error(`❌ Failed to scrape details for: ${doc.name} (${doc.url})`)
            logger.error(`   Scraping returned null after ${scrapeTime}ms`)
            errorCount++

            try {
              // Mark as scraped with error to avoid infinite retries
              await listingsCollection.updateOne(
                { _id: doc._id },
                { $set: { scraped: true, scrapedAt: new Date(), error: 'Scraping returned null' } }
              )
              logger.info(`   Marked as scraped (with error) to avoid reprocessing`)
            } catch (updateError: any) {
              logger.error(`   Failed to mark document as scraped: ${updateError.message}`)
            }
          }

        } catch (scrapeError: any) {
          const scrapeTime = Date.now() - scrapeStartTime
          logger.error(`💥 Exception while scraping: ${doc.name} (${doc.url})`)
          logger.error(`   Error after ${scrapeTime}ms: ${scrapeError.message}`)
          logger.error(`   Error type: ${scrapeError.constructor.name}`)
          errorCount++

          try {
            // Mark as scraped with error to avoid infinite retries
            await listingsCollection.updateOne(
              { _id: doc._id },
              { $set: { scraped: true, scrapedAt: new Date(), error: scrapeError.message } }
            )
            logger.info(`   Marked as scraped (with error) to avoid reprocessing`)
          } catch (updateError: any) {
            logger.error(`   Failed to mark document as scraped: ${updateError.message}`)
          }
        }

        // Respect rate limiting - sleep 2-3 seconds between requests
        if (i < batch.length - 1) { // Don't sleep after the last item in batch
          const sleepTime = Math.floor(Math.random() * 1000) + 2000 // 2-3 seconds
          logger.info(`😴 Sleeping for ${sleepTime}ms before next request...`)
          await sleep(sleepTime)
        }
      }

      // Update count for next batch
      try {
        const newCount = await listingsCollection.countDocuments({ scraped: { $ne: true } })
        logger.info(`📊 Batch ${batchNumber} completed. Remaining documents: ${newCount}`)
        totalCount = newCount

        if (totalCount > 0) {
          logger.info(`⏸️  Brief pause between batches...`)
          await sleep(2000) // Brief pause between batches
        }

      } catch (countError: any) {
        logger.error(`❌ Error getting updated count: ${countError.message}`)
        logger.error(`   Will continue with next batch anyway...`)
        await sleep(5000)
      }
    }

    const totalTime = Date.now() - startTime
    const totalMinutes = Math.round(totalTime / 1000 / 60)

    logger.info('\n' + '='.repeat(50))
    logger.info('🏁 DETAIL CRAWLER FINISHED')
    logger.info('='.repeat(50))
    logger.info(`📊 Final Statistics:`)
    logger.info(`   Batches processed: ${batchNumber}`)
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
    logger.error(`Processed so far: ${processedCount} (${successCount} successful, ${errorCount} errors)`)
    logger.error(`Full error: ${error}`)
    logger.error(`Stack trace: ${error.stack}`)

    // Don't throw - let it exit gracefully with the statistics we have
    logger.error(`🛑 Exiting gracefully despite fatal error`)
  }
}

export default detailCrawler