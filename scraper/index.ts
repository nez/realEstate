import logger from './lib/logger'
import { config } from './lib/config'
import crawler from './cron/crawler'
import detailCrawler from './cron/detailCrawler'

const main = async (): Promise<void> => {
  const { mode } = config().scraper
  logger.info(`Starting scraper in ${mode} mode.`)

  if (mode === 'DETAIL') {
    await detailCrawler()
  } else {
    await crawler()
  }

  logger.info('Scraping task finished. Exiting.')
}

main().catch(error => {
  logger.error(`An unhandled error occurred: ${error}`)
  process.exit(1)
})
