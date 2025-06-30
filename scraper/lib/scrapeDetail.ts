import { JSDOM } from 'jsdom'
import got from 'got'
import logger from './logger'

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

    // 1. Scrape the main property table
    try {
        const propertyTable = document.querySelector('.property_view_table')
        if (propertyTable) {
            const rows = propertyTable.querySelectorAll('tr');
            rows.forEach((row: Element) => {
                const th = row.querySelector('th')
                const td = row.querySelector('td')
                if (th?.textContent && td?.textContent) {
                    const key = th.textContent.trim().replace(/\s+/g, ' ')
                    const value = td.textContent.trim().replace(/\s+/g, ' ')
                    details[key] = value
                }
            })
        }
    } catch(e) { logger.error(`Failed to parse property table on ${url}`, e) }

    // 2. Scrape Description
    try {
        const descriptionHeading = Array.from(document.querySelectorAll('h2')).find(h => h.textContent?.includes('物件の特徴'))
        if (descriptionHeading?.nextElementSibling) {
          details.description = descriptionHeading.nextElementSibling.textContent?.trim().replace(/\s+/g, ' ')
        }
    } catch(e) { logger.error(`Failed to parse description on ${url}`, e) }

    // 3. Scrape Feature List
    try {
        const featuresHeading = Array.from(document.querySelectorAll('h3')).find(h3 => h3.textContent?.includes('特徴ピックアップ'))
        if (featuresHeading?.nextElementSibling) {
          const featuresText = featuresHeading.nextElementSibling.textContent ?? ''
          details.features = featuresText.trim().split(/\s*\/\s*/)
        }
    } catch(e) { logger.error(`Failed to parse features on ${url}`, e) }

    // 4. Scrape all images
    try {
        const imageContainer = document.getElementById('main') ?? document.body
        const images: string[] = []
        imageContainer.querySelectorAll('img').forEach((img: HTMLImageElement) => {
          const imgSrc = img.getAttribute('rel') || img.src
          if (imgSrc && !imgSrc.startsWith('data:image/gif') && !imgSrc.includes('logo')) {
            images.push(imgSrc)
          }
        })
        details.images = images
    } catch(e) { logger.error(`Failed to parse images on ${url}`, e) }

    // 5. Attempt to find Map Coordinates
    try {
        const scripts = Array.from(document.querySelectorAll('script'))
        const mapScript = scripts.find(script => script.textContent?.includes('google.maps.LatLng') || script.textContent?.includes('longitude'))
        if (mapScript?.textContent) {
          const lonMatch = mapScript.textContent.match(/longitude["']?\s*:\s*(\d+\.\d+)/)
          const latMatch = mapScript.textContent.match(/latitude["']?\s*:\s*(\d+\.\d+)/)
          if (lonMatch?.[1] && latMatch?.[1]) {
            details.mapCoordinates = {
              lat: parseFloat(latMatch[1]),
              lng: parseFloat(lonMatch[1])
            }
          }
        }
    } catch(e) { logger.error(`Failed to parse map coordinates on ${url}`, e) }

    details.scrapedAt = new Date()
    details.url = url
    return details
  } catch (error) {
    logger.error(`Error scraping detail page ${url}: ${error}`)
    return null
  }
}

export default scrapeDetailPage