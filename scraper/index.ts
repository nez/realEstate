import logger from './lib/logger'
import crawler from './cron/crawler'

const main = async (): Promise<void> => {
  await crawler()
  logger.info('Scraping task finished. Exiting.')
}

main().catch(error => {
  logger.error(`An unhandled error occurred: ${error}`)
  process.exit(1)
})
