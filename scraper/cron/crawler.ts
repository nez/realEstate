/// <reference lib="dom" />
import scrapePage from '../lib/scrape'
import { getNumbers } from '../lib/number'
import client from '../lib/client'
import logger from '../lib/logger'
import { promises as fs } from 'fs'
import path from 'path'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const crawler = async (): Promise<void> => {
  logger.info('Start: Crawler is scraping and saving to the database...')

  const dbName = process.env.MONGO_DB_NAME ?? 'suumo'
  const listingsCollectionName = process.env.MONGO_COLLECTION_NAME ?? 'listings'
  const stateCollectionName = process.env.MONGO_COLLECTION_STATE ?? 'scraper_state'

  const database = client.db(dbName)
  const listingsCollection = database.collection(listingsCollectionName)
  const stateCollection = database.collection(stateCollectionName)

  let startPage = 1
  const state = await stateCollection.findOne({ stateId: 'crawler' })
  if (state?.lastPage) {
    startPage = state.lastPage + 1
    logger.info(`Resuming from page ${startPage}.`)
  }

  try {
    const { totalItems, maxPageNumber } = await getNumbers()

    logger.info(`Processing: total items: ${totalItems}, and max page number: ${maxPageNumber}`)

    for (let i = startPage; i <= maxPageNumber; i++) {
      try {
        logger.info(`Scraping page ${i} of ${maxPageNumber}...`)
        const data = await scrapePage(process.env.START_PATH + `&pn=${i}`)
        if (data && data.length > 0) {
          try {
            await listingsCollection.insertMany(data, { ordered: false })
            logger.info(`Saved or skipped ${data.length} items from page ${i}.`)
          } catch (error: any) {
            if (error.code === 11000) {
              logger.warn(`Duplicate key error on page ${i}. Items likely already exist.`)
            } else {
              throw error
            }
          }
          await stateCollection.updateOne(
            { stateId: 'crawler' },
            { $set: { lastPage: i } },
            { upsert: true }
          )
        }
        await sleep(Math.floor(Math.random() * 1000) + 2000) // 2-3 second random delay
      } catch (error: any) {
        logger.error(`Error processing page ${i}: ${error.message}`)
        if (error.code === 'ECONNREFUSED') {
          logger.error('Connection refused by server. Stopping crawler to prevent IP block.')
          break
        }
      }
    }
  } catch (error) {
    logger.error(`Error: Error scraping and saving to the database: ${error}`)
  }
  logger.info('Finished: Crawler has finished scraping and saved to the database.')
}

export default crawler
