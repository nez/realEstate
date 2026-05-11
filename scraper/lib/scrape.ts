import { JSDOM } from 'jsdom'
import getDetails from './details'
import logger from './logger'
import { fetchHtml } from './http'

const scrapePage = async (url: string): Promise<any[]> => {
  try {
    const { body } = await fetchHtml(url)
    const dom = new JSDOM(body)
    const document = dom.window.document

    const items = Array.from(document.querySelectorAll('.cassette.js-bukkenCassette'))
    logger.info(`Found ${items.length} properties on page.`)
    return items.map(item => getDetails(item))
  } catch (error) {
    logger.error(`Error scraping ${url}: ${error}`)
    return []
  }
}

export default scrapePage
