import { JSDOM } from 'jsdom'
import got from 'got'
import logger from './logger'
import { extractPrice, parseSquareMeters } from './parserUtils'

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
]

const scrapeDetailPage = async (url: string): Promise<Record<string, any> | null> => {
  const startTime = Date.now()
  const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)]

  logger.info(`[DETAIL-START] Fetching: ${url}`)
  logger.info(`[DETAIL-CONFIG] User-Agent: ${userAgent.substring(0, 50)}...`)

  try {
    // Step 1: HTTP Request with timeout and detailed logging
    logger.info(`[DETAIL-HTTP] Starting HTTP request...`)
    const response = await got(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: {
        request: 30000, // 30 second total timeout
        response: 15000 // 15 second response timeout
      },
      retry: {
        limit: 2,
        methods: ['GET'],
        statusCodes: [408, 413, 429, 500, 502, 503, 504, 521, 522, 524]
      },
      hooks: {
        beforeRequest: [
          (options) => {
            logger.info(`[DETAIL-HTTP] Request starting to: ${options.url}`)
          }
        ],
        afterResponse: [
          (response) => {
            const responseTime = Date.now() - startTime
            logger.info(`[DETAIL-HTTP] Response received: ${response.statusCode} (${responseTime}ms)`)
            logger.info(`[DETAIL-HTTP] Response size: ${(response.body as string).length} bytes`)
            logger.info(`[DETAIL-HTTP] Content-Type: ${response.headers['content-type']}`)
            return response
          }
        ]
      }
    })

    // Step 2: Response validation
    logger.info(`[DETAIL-VALIDATE] Validating response...`)
    const responseBody = response.body as string
    if (!responseBody || responseBody.length < 1000) {
      logger.warn(`[DETAIL-VALIDATE] Response too small: ${responseBody.length} bytes`)
      return null
    }

    if (!responseBody.includes('html') && !responseBody.includes('HTML')) {
      logger.warn(`[DETAIL-VALIDATE] Response doesn't appear to be HTML`)
      logger.info(`[DETAIL-VALIDATE] First 200 chars: ${responseBody.substring(0, 200)}`)
      return null
    }

    // Step 3: DOM parsing
    logger.info(`[DETAIL-DOM] Parsing HTML with JSDOM...`)
    const dom = new JSDOM(responseBody)
    const document = dom.window.document
    logger.info(`[DETAIL-DOM] DOM parsed successfully`)

    const details: Record<string, any> = {}

    // Helper function to clean extracted values
    const cleanValue = (value: string): string => {
      // Remove common extra text patterns
      return value
        .replace(/\[\s*[□■]\s*[^\]]+\]/g, '') // Remove [ □支払シミュレーション ] type patterns
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    }

    // Step 4: Extract data from property tables
    logger.info(`[DETAIL-EXTRACT] Looking for property tables...`)
    const tables = document.querySelectorAll('table.bdclps');
    logger.info(`[DETAIL-EXTRACT] Found ${tables.length} property tables`)

    let totalFieldsExtracted = 0
    tables.forEach((table: any, tableIndex: number) => {
      logger.info(`[DETAIL-EXTRACT] Processing table ${tableIndex + 1}/${tables.length}`)
      const rows = table.querySelectorAll('tr');
      logger.info(`[DETAIL-EXTRACT] Table ${tableIndex + 1} has ${rows.length} rows`)

      rows.forEach((row: any, rowIndex: number) => {
        // Get all th and td elements in the row
        const headers = row.querySelectorAll('th');
        const cells = row.querySelectorAll('td');

        // Process each th/td pair
        for (let i = 0; i < headers.length; i++) {
          const th = headers[i];
          const td = cells[i];

          if (th && td && th.textContent && td.textContent) {
            // Clean the key - remove hints and extra whitespace
            let key = th.textContent.trim();
            // Remove the hint text if present
            key = key.replace(/ヒント/g, '').trim();

            // Clean the value
            let value = td.textContent.trim();
            value = cleanValue(value);

            // Only add if key is not empty and we don't already have this key
            if (key && key.length > 0 && !details[key]) {
              details[key] = value;
              totalFieldsExtracted++
              if (totalFieldsExtracted <= 5) { // Log first 5 fields for debugging
                logger.info(`[DETAIL-EXTRACT] Field: "${key}" = "${value.substring(0, 50)}${value.length > 50 ? '...' : ''}"`)
              }
            }
          }
        }
      });
    });

    logger.info(`[DETAIL-EXTRACT] Extracted ${totalFieldsExtracted} fields from tables`)

    // Step 5: Extract images
    logger.info(`[DETAIL-IMAGES] Extracting images...`)
    const images: string[] = [];
    const imgElements = document.querySelectorAll('img');
    logger.info(`[DETAIL-IMAGES] Found ${imgElements.length} img elements`)

    imgElements.forEach((img: any) => {
      // Look for the 'rel' attribute first (high quality images), then 'src'
      const imgUrl = img.getAttribute('rel') || img.getAttribute('src');
      if (imgUrl &&
          !imgUrl.includes('spacer.gif') &&
          !imgUrl.includes('logo') &&
          !imgUrl.includes('btn.gif') &&
          imgUrl.startsWith('http')) {
        // Avoid duplicates
        if (!images.includes(imgUrl)) {
          images.push(imgUrl);
        }
      }
    });
    details.images = images;
    logger.info(`[DETAIL-IMAGES] Extracted ${images.length} valid images`)

    // Step 6: Extract features
    logger.info(`[DETAIL-FEATURES] Looking for features section...`)
    const featuresSection = Array.from(document.querySelectorAll('h3')).find((h3: any) =>
      h3.textContent && h3.textContent.includes('特徴ピックアップ')
    );
    if (featuresSection) {
      const nextEl = featuresSection.nextElementSibling;
      if (nextEl && nextEl.textContent) {
        const featuresText = nextEl.textContent.trim();
        details.features = featuresText.split(/\s*\/\s*/).filter((f: string) => f.length > 0);
        logger.info(`[DETAIL-FEATURES] Extracted ${details.features.length} features`)
      }
    } else {
      logger.info(`[DETAIL-FEATURES] No features section found`)
    }

    // Step 7: Extract seller's comment
    logger.info(`[DETAIL-DESCRIPTION] Looking for seller's comment...`)
    const sellerCommentSection = Array.from(document.querySelectorAll('h3')).find((h3: any) =>
      h3.textContent && h3.textContent.includes('売主コメント')
    );
    if (sellerCommentSection) {
      // Look for the comment text in the following structure
      const parent = sellerCommentSection.parentElement;
      if (parent) {
        const commentDiv = parent.nextElementSibling;
        if (commentDiv) {
          const bwDiv = commentDiv.querySelector('.bw');
          if (bwDiv && bwDiv.textContent) {
            details.description = bwDiv.textContent.trim();
            logger.info(`[DETAIL-DESCRIPTION] Extracted description: ${details.description.substring(0, 100)}...`)
          }
        }
      }
    } else {
      logger.info(`[DETAIL-DESCRIPTION] No seller's comment found`)
    }

    // Step 8: Add computed fields
    logger.info(`[DETAIL-COMPUTE] Adding computed fields...`)
    if (details['価格']) {
      const { salePriceYen, rentPriceYen } = extractPrice(details['価格']);
      details.salePriceYen = salePriceYen;
      details.rentPriceYen = rentPriceYen;
      logger.info(`[DETAIL-COMPUTE] Price computed - Sale: ${salePriceYen}, Rent: ${rentPriceYen}`)
    }

    if (details['専有面積']) {
      details.sizeM2 = parseSquareMeters(details['専有面積']);
      logger.info(`[DETAIL-COMPUTE] Size computed: ${details.sizeM2}m²`)
    }

    // Step 9: Add metadata
    details.scrapedAt = new Date();
    details.url = url;

    // Add the full HTML for debugging/further processing
    details.html = responseBody;

    // Extract listing ID from URL
    const urlMatch = url.match(/nc_(\d+)/);
    if (urlMatch) {
      details.listingId = urlMatch[1];
      logger.info(`[DETAIL-METADATA] Extracted listing ID: ${details.listingId}`)
    }

    const totalTime = Date.now() - startTime
    logger.info(`[DETAIL-SUCCESS] Completed successfully in ${totalTime}ms`)
    logger.info(`[DETAIL-SUCCESS] Total fields extracted: ${Object.keys(details).length}`)

    return details;
  } catch (error: any) {
    const totalTime = Date.now() - startTime
    logger.error(`[DETAIL-ERROR] Failed after ${totalTime}ms for URL: ${url}`)
    logger.error(`[DETAIL-ERROR] Error type: ${error.constructor.name}`)
    logger.error(`[DETAIL-ERROR] Error message: ${error.message}`)

    if (error.code) {
      logger.error(`[DETAIL-ERROR] Error code: ${error.code}`)
    }

    if (error.response) {
      logger.error(`[DETAIL-ERROR] HTTP status: ${error.response.statusCode}`)
      logger.error(`[DETAIL-ERROR] Response headers: ${JSON.stringify(error.response.headers)}`)
    }

    if (error.name === 'TimeoutError') {
      logger.error(`[DETAIL-ERROR] Request timed out - this may indicate network issues or rate limiting`)
    }

    logger.error(`[DETAIL-ERROR] Full error: ${error}`)
    return null
  }
}

export default scrapeDetailPage