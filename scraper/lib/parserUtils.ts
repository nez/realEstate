import logger from './logger'

/**
 * Converts a Japanese number string containing 億 and/or 万 into a number.
 * Correctly handles composite numbers like "1億5000万".
 */
const toYen = (raw: string): number | null => {
  if (!raw) return null;
  try {
    let yen = 0;
    let remainingStr = raw.replace(/[,円]/g, '');

    const okuIndex = remainingStr.indexOf('億');
    if (okuIndex !== -1) {
      const okuPart = remainingStr.substring(0, okuIndex);
      yen += parseFloat(okuPart) * 100000000;
      remainingStr = remainingStr.substring(okuIndex + 1);
    }

    const manIndex = remainingStr.indexOf('万');
    if (manIndex !== -1) {
      const manPart = remainingStr.substring(0, manIndex);
      yen += parseFloat(manPart) * 10000;
      remainingStr = remainingStr.substring(manIndex + 1);
    }

    // If there were no kanji, parse the whole string
    if (okuIndex === -1 && manIndex === -1) {
      const plainVal = parseFloat(remainingStr);
      if (!isNaN(plainVal)) yen = plainVal;
    }

    return yen > 0 ? Math.round(yen) : null;
  } catch (e) {
    logger.warn(`Could not parse number from: "${raw}"`, e)
    return null
  }
};

/**
 * Extracts sale and/or rent price from a complex string.
 * Looks for specific keywords to identify the price type.
 */
export const extractPrice = (priceStr: string): { salePriceYen: number | null, rentPriceYen: number | null } => {
  const result: { salePriceYen: number | null, rentPriceYen: number | null } = { salePriceYen: null, rentPriceYen: null };
  if (!priceStr) return result;

  try {
    // Find all labeled price patterns
    // e.g. "購入価格： 7100万円 月々支払額： 16.94万円"
    const pricePattern = /(購入価格|価格|賃料|月々支払額)[:：]?\s*([\d\.]+(?:億)?[\d\.]*万?円?)/g;
    let match;
    let foundAny = false;
    while ((match = pricePattern.exec(priceStr)) !== null) {
      const label = match[1];
      const value = match[2];
      if (/購入価格|価格/.test(label)) {
        result.salePriceYen = toYen(value);
        foundAny = true;
      } else if (/賃料|月々支払額/.test(label)) {
        result.rentPriceYen = toYen(value);
        foundAny = true;
      }
    }
    // If nothing matched, try to extract the first price-like value as sale price
    if (!foundAny) {
      const generalPriceMatch = priceStr.match(/([\d\.]+(?:億)?[\d\.]*万?円?)/);
      if (generalPriceMatch && generalPriceMatch[1]) {
        result.salePriceYen = toYen(generalPriceMatch[1]);
      }
    }
  } catch (error) {
    logger.warn(`extractPrice failed for: "${priceStr}"`, error);
  }

  return result;
}

export const parseSquareMeters = (sizeStr: string): number | null => {
  try {
    if (!sizeStr) return null

    const match = sizeStr.match(/(\d+(\.\d+)?)\s*m2/i)
    if (match && match[1]) {
      return parseFloat(match[1])
    }
    return null
  } catch (error) {
    logger.warn(`Could not parse square meters: ${sizeStr}`)
    return null
  }
}