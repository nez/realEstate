import { describe, expect, test, beforeAll } from 'bun:test'
import { JSDOM } from 'jsdom'
import { promises as fs } from 'fs'
import path from 'path'
import getItemDetails from '../lib/details'

let listingItems: Element[]

beforeAll(async () => {
  const html = await fs.readFile(
    path.join(import.meta.dir, 'fixtures', 'listing-page.html'),
    'utf-8'
  )
  const dom = new JSDOM(html)
  listingItems = Array.from(dom.window.document.querySelectorAll('.cassette.js-bukkenCassette'))
})

describe('getItemDetails (listing parser)', () => {
  test('finds both listings in the fixture page', () => {
    expect(listingItems.length).toBe(2)
  })

  test('extracts the nc_<id> as _id for a sale listing', () => {
    const item = getItemDetails(listingItems[0])
    expect(item._id).toBe('12345678')
    expect(item.url).toContain('/ms/chuko/tokyo/sc_chiyoda/nc_12345678/')
  })

  test('captures category, name, address, station, and image', () => {
    const item = getItemDetails(listingItems[0])
    expect(item.category).toBe('中古マンション')
    expect(item.name).toBe('パークコート千代田')
    expect(item.address).toBe('東京都千代田区一番町')
    expect(item.station).toContain('半蔵門駅')
    expect(item.image).toBe('https://img01.suumo.com/12345678.jpg')
  })

  test('derives numeric salePriceYen and sizeM2 from the raw text', () => {
    const item = getItemDetails(listingItems[0])
    expect(item.salePriceYen).toBe(71_000_000)
    expect(item.sizeM2).toBe(75.5)
  })

  test('handles 億+万 composite prices', () => {
    const item = getItemDetails(listingItems[1])
    expect(item.salePriceYen).toBe(150_000_000)
    expect(item.sizeM2).toBe(110.25)
  })
})
