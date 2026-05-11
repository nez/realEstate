import { describe, expect, test } from 'bun:test'
import { extractHydration } from '../lib/hydration'

describe('extractHydration — single fields', () => {
  test('returns an empty object when the detail has no useful fields', () => {
    expect(extractHydration({})).toEqual({})
  })

  test('captures layout from 間取り', () => {
    expect(extractHydration({ 間取り: '2LDK' }).layout).toBe('2LDK')
  })

  test('strips whitespace and dashes from string fields', () => {
    expect(extractHydration({ 間取り: '  2LDK  ' }).layout).toBe('2LDK')
    expect(extractHydration({ 間取り: '-' }).layout).toBeUndefined()
    expect(extractHydration({ 間取り: '' }).layout).toBeUndefined()
  })
})

describe('extractHydration — build year', () => {
  test('parses year+month from 完成時期', () => {
    const h = extractHydration({ 完成時期: '1978年7月' })
    expect(h.builtYear).toBe(1978)
    expect(h.builtMonth).toBe(7)
  })

  test('handles 完成時期（築年月） key variant', () => {
    const h = extractHydration({ '完成時期（築年月）': '2013年4月' })
    expect(h.builtYear).toBe(2013)
    expect(h.builtMonth).toBe(4)
  })

  test('falls back to year-only when month is missing', () => {
    const h = extractHydration({ 築年月: '1988年' })
    expect(h.builtYear).toBe(1988)
    expect(h.builtMonth).toBeUndefined()
  })
})

describe('extractHydration — floor and orientation', () => {
  test('parses floor number from 所在階', () => {
    expect(extractHydration({ 所在階: '6階' }).floor).toBe(6)
    expect(extractHydration({ 所在階: '12階 / 15階建' }).floor).toBe(12)
  })

  test('captures orientation', () => {
    expect(extractHydration({ 向き: '北東' }).orientation).toBe('北東')
    expect(extractHydration({ 向き: '-' }).orientation).toBeUndefined()
  })
})

describe('extractHydration — structure / district', () => {
  test('captures building structure from either of two keys', () => {
    expect(extractHydration({ '構造・階建て': 'SRC11階地下1階建' }).buildingStructure).toBe('SRC11階地下1階建')
    expect(extractHydration({ '所在階/構造・階建': '6階/SRC11階地下1階建' }).buildingStructure).toBe('6階/SRC11階地下1階建')
  })

  test('captures use district', () => {
    expect(extractHydration({ 用途地域: '商業' }).useDistrict).toBe('商業')
  })
})

describe('extractHydration — booleans', () => {
  test('parkingAvailable false for 無 / なし', () => {
    expect(extractHydration({ 駐車場: '無' }).parkingAvailable).toBe(false)
    expect(extractHydration({ 駐車場: 'なし' }).parkingAvailable).toBe(false)
    expect(extractHydration({ 駐車場: '無し' }).parkingAvailable).toBe(false)
  })

  test('parkingAvailable true for anything else descriptive', () => {
    expect(extractHydration({ 駐車場: '空有 1万円／月' }).parkingAvailable).toBe(true)
  })

  test('isLeasehold detects 借地 / 地上権', () => {
    expect(extractHydration({ 敷地の権利形態: '地上権（旧）、借地期間残存60年' }).isLeasehold).toBe(true)
    expect(extractHydration({ 敷地の権利形態: '所有権' }).isLeasehold).toBe(false)
  })
})

describe('extractHydration — fees', () => {
  test('parses plain yen amounts', () => {
    expect(extractHydration({ 管理費: '8500円／月（自主管理）' }).managementFeeYen).toBe(8500)
  })

  test('parses 万 + tail yen amounts (regression for the 1万1000円 bug)', () => {
    expect(extractHydration({ 修繕積立金: '1万1000円／月' }).repairFundYen).toBe(11000)
  })

  test('computes monthlyFeesYen as sum of management + repair', () => {
    const h = extractHydration({ 管理費: '8500円', 修繕積立金: '1万1000円' })
    expect(h.monthlyFeesYen).toBe(19500)
  })

  test('monthlyFeesYen falls back when only one component is present', () => {
    const h = extractHydration({ 管理費: '8500円' })
    expect(h.monthlyFeesYen).toBe(8500)
    expect(h.repairFundYen).toBeUndefined()
  })
})

describe('extractHydration — end-to-end on the 大塚ビル shape', () => {
  // Matches the real detail payload we saw live.
  const ohtsuka: Record<string, any> = {
    間取り: '2LDK',
    専有面積: '61.97m2（登記）',
    '所在階/構造・階建': '6階/SRC11階地下1階建',
    '完成時期（築年月）': '1978年7月',
    所在階: '6階',
    向き: '北東',
    '構造・階建て': 'SRC11階地下1階建',
    用途地域: '商業',
    駐車場: '無',
    敷地の権利形態: '地上権（旧）、借地期間残存60年',
    管理費: '8500円／月（自主管理(管理員なし)）',
    修繕積立金: '1万1000円／月'
  }

  test('produces the full set of expected hydration fields', () => {
    const h = extractHydration(ohtsuka)
    expect(h).toEqual({
      layout: '2LDK',
      builtYear: 1978,
      builtMonth: 7,
      floor: 6,
      orientation: '北東',
      buildingStructure: 'SRC11階地下1階建',
      useDistrict: '商業',
      parkingAvailable: false,
      isLeasehold: true,
      managementFeeYen: 8500,
      repairFundYen: 11000,
      monthlyFeesYen: 19500
    })
  })
})
