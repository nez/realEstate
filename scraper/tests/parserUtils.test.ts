import { describe, expect, test } from 'bun:test'
import { extractPrice, parseSquareMeters } from '../lib/parserUtils'

describe('extractPrice', () => {
  test('parses a plain 万円 sale price', () => {
    expect(extractPrice('7100万円')).toEqual({ salePriceYen: 71_000_000, rentPriceYen: null })
  })

  test('parses 億 + 万 composites', () => {
    expect(extractPrice('1億5000万円')).toEqual({ salePriceYen: 150_000_000, rentPriceYen: null })
  })

  test('picks the sale price when the string has both 購入価格 and 月々支払額', () => {
    const result = extractPrice('購入価格: 7100万円 月々支払額: 16.94万円')
    expect(result.salePriceYen).toBe(71_000_000)
    expect(result.rentPriceYen).toBe(169_400)
  })

  test('returns nulls on garbage input', () => {
    expect(extractPrice('価格応相談')).toEqual({ salePriceYen: null, rentPriceYen: null })
  })

  test('handles empty string without throwing', () => {
    expect(extractPrice('')).toEqual({ salePriceYen: null, rentPriceYen: null })
  })
})

describe('parseSquareMeters', () => {
  test('extracts decimal square meters', () => {
    expect(parseSquareMeters('75.50m2(壁芯)')).toBe(75.5)
  })

  test('returns null when no m2 value present', () => {
    expect(parseSquareMeters('未定')).toBeNull()
  })

  test('handles empty input', () => {
    expect(parseSquareMeters('')).toBeNull()
  })
})
