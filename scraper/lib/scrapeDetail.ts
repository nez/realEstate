import { JSDOM } from 'jsdom'
import got from 'got'
import logger from './logger'
import { extractPrice, parseSquareMeters } from './parserUtils'
import { classifyError } from './status'

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
]

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
// Pulled out of scrapeDetailPage so it's testable without a real HTTP fetch.
export const parseDetailHtml = (html: string, url: string): ScrapeResult => {
  if (!html || html.length < 1000) {
    return { kind: 'transient', reason: `response too small (${html?.length ?? 0} bytes)` }
  }
  if (!html.includes('html') && !html.includes('HTML')) {
    return { kind: 'transient', reason: 'response not HTML' }
  }

  const dom = new JSDOM(html)
  const document = dom.window.document
  const details: Record<string, any> = {}

  const tables = document.querySelectorAll('table.bdclps')
  let totalFieldsExtracted = 0
  tables.forEach((table: any) => {
    const rows = table.querySelectorAll('tr')
    rows.forEach((row: any) => {
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
  document.querySelectorAll('img').forEach((img: any) => {
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

  const featuresSection = Array.from(document.querySelectorAll('h3')).find((h3: any) =>
    h3.textContent?.includes('特徴ピックアップ')
  )
  if (featuresSection?.nextElementSibling?.textContent) {
    details.features = featuresSection.nextElementSibling.textContent.trim()
      .split(/\s*\/\s*/).filter((f: string) => f.length > 0)
  }

  const sellerCommentSection = Array.from(document.querySelectorAll('h3')).find((h3: any) =>
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

  if (process.env.STORE_HTML !== 'false') {
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
  const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)]

  logger.info(`[DETAIL-START] Fetching: ${url}`)

  const abortController = new AbortController()
  const TOTAL_TIMEOUT = 25000

  const timeoutId = setTimeout(() => {
    logger.warn(`[DETAIL-TIMEOUT] Force aborting request after ${TOTAL_TIMEOUT}ms`)
    abortController.abort()
  }, TOTAL_TIMEOUT)

  let responseBody: string
  try {
    const response = await got(url, {
      signal: abortController.signal,
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        DNT: '1',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: {
        request: 20000,
        response: 10000,
        connect: 5000,
        lookup: 3000
      },
      retry: {
        limit: 2,
        methods: ['GET'],
        statusCodes: [408, 413, 429, 500, 502, 503, 504, 521, 522, 524]
      }
    })
    clearTimeout(timeoutId)
    responseBody = response.body
    logger.info(`[DETAIL-HTTP] ${response.statusCode} (${response.body.length}B, ${Date.now() - startTime}ms)`)
  } catch (error: any) {
    clearTimeout(timeoutId)
    const kind = classifyError(error)
    const reason = `${error.constructor?.name ?? 'Error'}: ${error.message ?? String(error)}` +
      (error.response?.statusCode ? ` [HTTP ${error.response.statusCode}]` : '')
    logger.error(`[DETAIL-${kind.toUpperCase()}] ${reason}`)
    return { kind, reason }
  }

  const result = parseDetailHtml(responseBody, url)
  if (result.kind === 'success') {
    logger.info(`[DETAIL-SUCCESS] ${Object.keys(result.data).length} fields in ${Date.now() - startTime}ms`)
  } else {
    logger.warn(`[DETAIL-${result.kind.toUpperCase()}] ${result.reason}`)
  }
  return result
}

export default scrapeDetailPage
