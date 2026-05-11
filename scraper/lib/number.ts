import got from 'got'
import { JSDOM } from 'jsdom'

const getItemNumber = (document: any): number => {
  let totalItems = 0

  const totalItemsElement = document.querySelector('.pagination_set-hit') as Element
  const totalItemsText = totalItemsElement?.textContent?.trim() ?? ''
  const totalItemsMatch = totalItemsText.match(/\d+/)
  if (totalItemsMatch !== null) {
    totalItems = parseInt(totalItemsMatch[0])
  }

  return totalItems
}

const getMaxPageNumber = (document: any): number => {
  const maxPageLinkElement = document.querySelector('.pagination-parts li:last-child a')
  const maxPageLinkHref = maxPageLinkElement?.getAttribute('href') ?? ''
  const maxPageNumberMatch = maxPageLinkHref.match(/pn=(\d+)/)
  if (maxPageNumberMatch === null) return 0
  return parseInt(maxPageNumberMatch[1], 10)
}

const getNumbers = async (): Promise<{ totalItems: number, maxPageNumber: number }> => {
  const startPath = process.env.START_PATH ?? ''
  if (!startPath) throw new Error('START_PATH env var is not set')
  const response = await got(startPath)
  const htmlContent = response.body

  const dom = new JSDOM(htmlContent)
  const document = dom.window.document

  const totalItems = getItemNumber(document)
  const maxPageNumber = getMaxPageNumber(document)

  return { totalItems, maxPageNumber }
}

export { getItemNumber, getMaxPageNumber, getNumbers }
