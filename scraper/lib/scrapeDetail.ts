import { JSDOM } from 'jsdom'
import logger from './logger'
import { extractPrice, parseSquareMeters } from './parserUtils'
import { classifyError } from './status'
import { detectBlockPage, fetchHtml } from './http'
import { config } from './config'

export type ScrapeResult =
  | { kind: 'success', data: Record<string, any> }
  | { kind: 'transient', reason: string }
  | { kind: 'permanent', reason: string }

const cleanValue = (value: string): string =>
  value
    .replace(/\[\s*[□■]\s*[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// Pure parser: takes a fetched HTML body and the source URL, returns a ScrapeResult.
// Separated from the HTTP layer so it's testable without a real network fetch.
export const parseDetailHtml = (html: string, url: string): ScrapeResult => {
  const block = detectBlockPage(html)
  if (block.blocked) {
    return { kind: 'transient', reason: block.reason ?? 'block page detected' }
  }

  const dom = new JSDOM(html)
  const document = dom.window.document
  const details: Record<string, any> = {}

  const tables = document.querySelectorAll('table.bdclps')
  let totalFieldsExtracted = 0
  tables.forEach((table: Element) => {
    // Suumo's contact / inquiry form uses table.bdclps too — its rows have
    // `<th>お名前</th><td>...</td>` etc. and would leak into the detail doc
    // as bogus fields. Anything inside a <form> is not property data.
    if (table.closest('form') !== null) return
    table.querySelectorAll('tr').forEach((row: Element) => {
      const headers = row.querySelectorAll('th')
      const cells = row.querySelectorAll('td')
      for (let i = 0; i < headers.length; i++) {
        const th = headers[i]
        const td = cells[i]
        if (th?.textContent && td?.textContent) {
          const key = th.textContent.trim().replace(/ヒント/g, '').trim()
          const value = cleanValue(td.textContent.trim())
          if (key.length > 0 && !details[key]) {
            details[key] = value
            totalFieldsExtracted++
          }
        }
      }
    })
  })

  // Zero tables on a non-trivial HTML page almost always means we hit a block page.
  if (totalFieldsExtracted === 0) {
    return { kind: 'transient', reason: 'parser extracted 0 fields (possible block page)' }
  }

  const images: string[] = []
  document.querySelectorAll('img').forEach((img: HTMLImageElement) => {
    // Suumo uses a non-standard `rel` attribute for the high-resolution
    // URL; fall back to `src` for older listing markup.
    const imgUrl = img.getAttribute('rel') ?? img.getAttribute('src')
    if (
      imgUrl &&
      !imgUrl.includes('spacer.gif') &&
      !imgUrl.includes('logo') &&
      !imgUrl.includes('btn.gif') &&
      imgUrl.startsWith('http') &&
      !images.includes(imgUrl)
    ) {
      images.push(imgUrl)
    }
  })
  details.images = images

  const featuresSection = Array.from(document.querySelectorAll('h3')).find((h3: Element) =>
    h3.textContent?.includes('特徴ピックアップ')
  )
  if (featuresSection?.nextElementSibling?.textContent) {
    details.features = featuresSection.nextElementSibling.textContent.trim()
      .split(/\s*\/\s*/).filter((f: string) => f.length > 0)
  }

  const sellerCommentSection = Array.from(document.querySelectorAll('h3')).find((h3: Element) =>
    h3.textContent?.includes('売主コメント')
  )
  const commentBw = sellerCommentSection?.parentElement?.nextElementSibling?.querySelector('.bw')
  if (commentBw?.textContent) {
    details.description = commentBw.textContent.trim()
  }

  if (details['価格']) {
    const { salePriceYen, rentPriceYen } = extractPrice(details['価格'])
    details.salePriceYen = salePriceYen
    details.rentPriceYen = rentPriceYen
  }
  if (details['専有面積']) {
    details.sizeM2 = parseSquareMeters(details['専有面積'])
  }

  details.scrapedAt = new Date()
  details.url = url

  if (config().scraper.storeHtml) {
    details.html = html
  }

  const urlMatch = url.match(/nc_(\d+)/)
  if (urlMatch) {
    details.listingId = urlMatch[1]
  }

  return { kind: 'success', data: details }
}

const scrapeDetailPage = async (url: string): Promise<ScrapeResult> => {
  const startTime = Date.now()
  let body: string
  try {
    const result = await fetchHtml(url)
    body = result.body
  } catch (error: any) {
    const kind = classifyError(error)
    const reason = `${error.constructor?.name ?? 'Error'}: ${error.message ?? String(error)}` +
      (error.response?.statusCode ? ` [HTTP ${error.response.statusCode}]` : '')
    logger.error(`[DETAIL-${kind.toUpperCase()}] ${url}: ${reason}`)
    return { kind, reason }
  }

  const result = parseDetailHtml(body, url)
  if (result.kind === 'success') {
    logger.info(`[DETAIL-SUCCESS] ${Object.keys(result.data).length} fields in ${Date.now() - startTime}ms`)
  } else {
    logger.warn(`[DETAIL-${result.kind.toUpperCase()}] ${url}: ${result.reason}`)
  }
  return result
}

export default scrapeDetailPage
