import logger from './logger'

/**
 * Converts a Japanese number string containing 億 and/or 万 into a number.
 * Correctly handles composites like "1億5000万", "1万1000円", or plain "8500円".
 */
export const toYen = (raw: string): number | null => {
  if (!raw) return null
  try {
    let yen = 0
    let remainingStr = raw.replace(/[,円]/g, '')

    const okuIndex = remainingStr.indexOf('億')
    if (okuIndex !== -1) {
      yen += parseFloat(remainingStr.substring(0, okuIndex)) * 100_000_000
      remainingStr = remainingStr.substring(okuIndex + 1)
    }

    const manIndex = remainingStr.indexOf('万')
    if (manIndex !== -1) {
      yen += parseFloat(remainingStr.substring(0, manIndex)) * 10_000
      remainingStr = remainingStr.substring(manIndex + 1)
    }

    // Any digits left over after stripping kanji are plain yen — handles
    // both "1万1000円" (remainder=1000) and "8500円" (no kanji at all).
    const tailMatch = remainingStr.match(/\d+(\.\d+)?/)
    if (tailMatch) {
      const tail = parseFloat(tailMatch[0])
      if (!isNaN(tail)) yen += tail
    }

    return yen > 0 ? Math.round(yen) : null
  } catch (e) {
    logger.warn(`Could not parse number from: "${raw}"`, e)
    return null
  }
}

/**
 * Extracts sale and/or rent price from a complex string.
 * Looks for specific keywords to identify the price type.
 */
export const extractPrice = (priceStr: string): { salePriceYen: number | null, rentPriceYen: number | null } => {
  const result: { salePriceYen: number | null, rentPriceYen: number | null } = { salePriceYen: null, rentPriceYen: null }
  if (!priceStr) return result

  try {
    // Find all labeled price patterns
    // e.g. "購入価格： 7100万円 月々支払額： 16.94万円"
    const pricePattern = /(購入価格|価格|賃料|月々支払額)[:：]?\s*([\d\.]+(?:億)?[\d\.]*万?円?)/g
    let match
    let foundAny = false
    while ((match = pricePattern.exec(priceStr)) !== null) {
      const label = match[1]
      const value = match[2]
      if (/購入価格|価格/.test(label)) {
        result.salePriceYen = toYen(value)
        foundAny = true
      } else if (/賃料|月々支払額/.test(label)) {
        result.rentPriceYen = toYen(value)
        foundAny = true
      }
    }
    // If nothing matched, try to extract the first price-like value as sale price
    if (!foundAny) {
      const generalPriceMatch = priceStr.match(/([\d\.]+(?:億)?[\d\.]*万?円?)/)
      if (generalPriceMatch && generalPriceMatch[1]) {
        result.salePriceYen = toYen(generalPriceMatch[1])
      }
    }
  } catch (error) {
    logger.warn(`extractPrice failed for: "${priceStr}"`, error)
  }

  return result
}

// Plausible residential unit floor area for a Suumo listing. Anything outside
// this range is almost certainly a data error on the broker's side (we have
// observed e.g. a 1LDK published with 専有面積=818.79m², which is internally
// inconsistent — the building total leaked into the unit field). Returning
// null in those cases keeps the listing in the dataset but excludes it from
// ¥/m² ranking and from any --min-size / --max-pp-m2 query filter.
const MIN_PLAUSIBLE_M2 = 5
const MAX_PLAUSIBLE_M2 = 500

export const parseSquareMeters = (sizeStr: string): number | null => {
  try {
    if (!sizeStr) return null

    const match = sizeStr.match(/(\d+(\.\d+)?)\s*m2/i)
    if (!match?.[1]) return null

    const value = parseFloat(match[1])
    if (!Number.isFinite(value)) return null
    if (value < MIN_PLAUSIBLE_M2 || value > MAX_PLAUSIBLE_M2) {
      logger.warn(`Implausible 専有面積 in listing (${value}m²); dropping. Raw: ${sizeStr.slice(0, 100)}`)
      return null
    }
    return value
  } catch (error) {
    logger.warn(`Could not parse square meters: ${sizeStr}`)
    return null
  }
}
