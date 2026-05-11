import { JSDOM } from 'jsdom'
import logger from './logger'
import { fetchHtml } from './http'
import { config } from './config'

const getItemNumber = (document: Document): number => {
  const totalItemsElement = document.querySelector('.pagination_set-hit')
  const totalItemsText = totalItemsElement?.textContent?.trim() ?? ''
  const totalItemsMatch = totalItemsText.match(/\d+/)
  return totalItemsMatch !== null ? parseInt(totalItemsMatch[0], 10) : 0
}

const getMaxPageNumber = (document: Document): number => {
  const maxPageLinkElement = document.querySelector('.pagination-parts li:last-child a')
  const maxPageLinkHref = maxPageLinkElement?.getAttribute('href') ?? ''
  const maxPageNumberMatch = maxPageLinkHref.match(/pn=(\d+)/)
  return maxPageNumberMatch !== null ? parseInt(maxPageNumberMatch[1], 10) : 0
}

const getNumbers = async (): Promise<{ totalItems: number, maxPageNumber: number }> => {
  const { startPath } = config().scraper
  if (!startPath) throw new Error('START_PATH env var is not set')
  const { body } = await fetchHtml(startPath)

  const dom = new JSDOM(body)
  const document = dom.window.document

  const totalItems = getItemNumber(document)
  const maxPageNumber = getMaxPageNumber(document)

  logger.info(`Index page parsed: totalItems=${totalItems}, maxPageNumber=${maxPageNumber}`)
  return { totalItems, maxPageNumber }
}

export { getItemNumber, getMaxPageNumber, getNumbers }
