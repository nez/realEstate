/// <reference lib="dom" />
import scrapePage from '../lib/scrape'
import { getNumbers } from '../lib/number'
import client from '../lib/client'
import logger from '../lib/logger'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const crawler = async (): Promise<void> => {
  logger.info('Start: Crawler is scraping and saving to the database...')
  try {
    const { totalItems, maxPageNumber } = await getNumbers()

    logger.info(`Processing: total items: ${totalItems}, and max page number: ${maxPageNumber}`)

    const database = client.db(process.env.MONGO_DB_NAME ?? '')
    const collection = database.collection(process.env.MONGO_COLLECTION_NAME ?? '')

    for (let i = 1; i <= maxPageNumber; i++) {
      try {
        logger.info(`Scraping page ${i} of ${maxPageNumber}...`)
        const data = await scrapePage(process.env.START_PATH + `&pn=${i}`)
        if (data && data.length > 0) {
          await collection.insertMany(data)
          logger.info(`Saved ${data.length} items from page ${i}.`)
        }
        await sleep(Math.floor(Math.random() * 1000) + 2000) // 2-3 second random delay
      } catch (error) {
        logger.error(`Error processing page ${i}: ${error}`)
      }
    }
  } catch (error) {
    logger.error(`Error: Error scraping and saving to the database: ${error}`)
  }
  logger.info('Finished: Crawler has finished scraping and saved to the database.')
}

export default crawler
