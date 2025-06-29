import { JSDOM } from 'jsdom'
import got from 'got'
import getDetails from './details'
import logger from './logger'

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.2 Safari/605.1.15'
]

const scrapePage = async (url: string): Promise<any[]> => {
  try {
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)]
    const response = await got(url, {
      headers: {
        'User-Agent': randomUserAgent
      }
    })
    const dom = new JSDOM(response.body)
    const document = dom.window.document

    const items = Array.from(document.querySelectorAll('.cassette.js-bukkenCassette'))
    logger.info(`Found ${items.length} properties on page.`)
    const result = items.map(item => getDetails(item as Element))

    return result
  } catch (error) {
    logger.error(`Error scraping ${url}: ${error}`)
    return []
  }
}

export default scrapePage
