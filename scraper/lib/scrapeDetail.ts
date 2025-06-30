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
  try {
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)]
    const response = await got(url, {
      headers: {
        'User-Agent': randomUserAgent
      }
    })
    const dom = new JSDOM(response.body)
    const document = dom.window.document

    const details: Record<string, any> = {}

    // Helper function to clean extracted values
    const cleanValue = (value: string): string => {
      // Remove common extra text patterns
      return value
        .replace(/\[\s*[□■]\s*[^\]]+\]/g, '') // Remove [ □支払シミュレーション ] type patterns
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    }

    // 1. Extract all data from property tables - much simpler approach
    // Look for tables with class containing "bdclps" which are the property data tables
    const tables = document.querySelectorAll('table.bdclps');

    tables.forEach((table: any) => {
      const rows = table.querySelectorAll('tr');
      rows.forEach((row: any) => {
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
            }
          }
        }
      });
    });

    // 2. Get images - simplified approach
    const images: string[] = [];
    const imgElements = document.querySelectorAll('img');
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

    // 3. Extract features if available
    const featuresSection = Array.from(document.querySelectorAll('h3')).find((h3: any) =>
      h3.textContent && h3.textContent.includes('特徴ピックアップ')
    );
    if (featuresSection) {
      const nextEl = featuresSection.nextElementSibling;
      if (nextEl && nextEl.textContent) {
        const featuresText = nextEl.textContent.trim();
        details.features = featuresText.split(/\s*\/\s*/).filter((f: string) => f.length > 0);
      }
    }

    // 4. Try to extract a clean description from seller's comment
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
          }
        }
      }
    }

    // 5. Add computed fields based on extracted data
    if (details['価格']) {
      const { salePriceYen, rentPriceYen } = extractPrice(details['価格']);
      details.salePriceYen = salePriceYen;
      details.rentPriceYen = rentPriceYen;
    }

    if (details['専有面積']) {
      details.sizeM2 = parseSquareMeters(details['専有面積']);
    }

    // 6. Add metadata
    details.scrapedAt = new Date();
    details.url = url;

    // Add the full HTML for debugging/further processing
    details.html = response.body;

    // Extract listing ID from URL
    const urlMatch = url.match(/nc_(\d+)/);
    if (urlMatch) {
      details.listingId = urlMatch[1];
    }

    return details;
  } catch (error) {
    logger.error(`Error scraping detail page ${url}: ${error}`)
    return null
  }
}

export default scrapeDetailPage