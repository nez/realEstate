import { describe, expect, test, beforeAll } from 'bun:test'
import { promises as fs } from 'fs'
import path from 'path'
import { parseDetailHtml } from '../lib/scrapeDetail'
import { DetailSchema, validate } from '../lib/schemas'

let detailHtml: string
const detailUrl = 'https://suumo.jp/ms/chuko/tokyo/sc_chiyoda/nc_12345678/'

beforeAll(async () => {
  detailHtml = await fs.readFile(
    path.join(import.meta.dir, 'fixtures', 'detail-page.html'),
    'utf-8'
  )
})

describe('parseDetailHtml (detail parser)', () => {
  test('classifies a too-small body as transient', () => {
    const result = parseDetailHtml('<html>tiny</html>', detailUrl)
    expect(result.kind).toBe('transient')
  })

  test('classifies an HTML body with zero tables as transient (block-page heuristic)', () => {
    const big = '<html><body>' + 'x'.repeat(2000) + '</body></html>'
    const result = parseDetailHtml(big, detailUrl)
    expect(result.kind).toBe('transient')
  })

  test('successfully extracts a property detail from the fixture', () => {
    const result = parseDetailHtml(detailHtml, detailUrl)
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return

    const d = result.data
    expect(d['価格']).toContain('7100万円')
    expect(d['所在地']).toBe('東京都千代田区一番町')
    expect(d['専有面積']).toContain('75.50m2')
    expect(d['間取り']).toBe('2LDK')
    expect(d['築年月']).toBe('2013年4月')
  })

  test('strips the [□支払シミュレーション] noise from values', () => {
    const result = parseDetailHtml(detailHtml, detailUrl)
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.data['価格']).not.toContain('シミュレーション')
  })

  test('derives salePriceYen and sizeM2 from the Japanese strings', () => {
    const result = parseDetailHtml(detailHtml, detailUrl)
    if (result.kind !== 'success') throw new Error('expected success')
    expect(result.data.salePriceYen).toBe(71_000_000)
    expect(result.data.sizeM2).toBe(75.5)
  })

  test('captures images while filtering out logo/spacer/btn assets', () => {
    const result = parseDetailHtml(detailHtml, detailUrl)
    if (result.kind !== 'success') throw new Error('expected success')
    const imgs = result.data.images as string[]
    expect(imgs).toContain('https://img01.suumo.com/property/hero-large.jpg')
    expect(imgs).toContain('https://img02.suumo.com/property/floor.jpg')
    expect(imgs.every(u => !u.includes('logo') && !u.includes('spacer') && !u.includes('btn'))).toBe(true)
  })

  test('extracts features list from 特徴ピックアップ section', () => {
    const result = parseDetailHtml(detailHtml, detailUrl)
    if (result.kind !== 'success') throw new Error('expected success')
    expect(result.data.features).toEqual(['南向き', '駅徒歩5分以内', 'リフォーム済'])
  })

  test('extracts seller description from 売主コメント section', () => {
    const result = parseDetailHtml(detailHtml, detailUrl)
    if (result.kind !== 'success') throw new Error('expected success')
    expect(result.data.description).toContain('リノベーション済み')
  })

  test('captures listingId from the URL', () => {
    const result = parseDetailHtml(detailHtml, detailUrl)
    if (result.kind !== 'success') throw new Error('expected success')
    expect(result.data.listingId).toBe('12345678')
  })

  test('parsed payload satisfies DetailSchema', () => {
    const result = parseDetailHtml(detailHtml, detailUrl)
    if (result.kind !== 'success') throw new Error('expected success')
    const validation = validate(DetailSchema, result.data)
    expect(validation.ok).toBe(true)
  })
})
