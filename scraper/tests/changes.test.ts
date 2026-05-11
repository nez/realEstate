import { describe, expect, test } from 'bun:test'
import {
  type ListingPriceState,
  diffListing,
  priceHistoryEntriesFromEvents
} from '../lib/changes'

const at = new Date('2026-01-15T12:00:00Z')
const sale = (id: string, yen: number | null, rentYen: number | null = null): ListingPriceState => ({
  _id: id,
  url: `https://suumo.jp/nc_${id}/`,
  salePriceYen: yen,
  rentPriceYen: rentYen
})

describe('diffListing — new listings', () => {
  test('emits a single new_listing event when prev is null', () => {
    const events = diffListing(null, sale('1', 50_000_000), at)
    expect(events.length).toBe(1)
    expect(events[0].kind).toBe('new_listing')
    expect(events[0].newPriceYen).toBe(50_000_000)
    expect(events[0].priceKind).toBe('sale')
    expect(events[0].listingId).toBe('1')
    expect(events[0].observedAt).toEqual(at)
  })

  test('new_listing for a rent-only listing tags priceKind=rent', () => {
    const events = diffListing(null, sale('2', null, 95_000), at)
    expect(events[0].priceKind).toBe('rent')
    expect(events[0].newPriceYen).toBe(95_000)
  })

  test('new_listing for a price-less listing emits the event without a priceKind', () => {
    const events = diffListing(null, sale('3', null, null), at)
    expect(events.length).toBe(1)
    expect(events[0].priceKind).toBeUndefined()
    expect(events[0].newPriceYen).toBeNull()
  })
})

describe('diffListing — existing listings', () => {
  test('no events when nothing changed', () => {
    const prev = sale('1', 50_000_000)
    const next = sale('1', 50_000_000)
    expect(diffListing(prev, next, at)).toEqual([])
  })

  test('price drop produces a price_drop event with negative pct', () => {
    const prev = sale('1', 50_000_000)
    const next = sale('1', 45_000_000)
    const events = diffListing(prev, next, at)
    expect(events.length).toBe(1)
    expect(events[0].kind).toBe('price_drop')
    expect(events[0].oldPriceYen).toBe(50_000_000)
    expect(events[0].newPriceYen).toBe(45_000_000)
    expect(events[0].pctChange).toBe(-10)
    expect(events[0].priceKind).toBe('sale')
  })

  test('price increase produces a price_increase event with positive pct', () => {
    const prev = sale('1', 50_000_000)
    const next = sale('1', 52_500_000)
    const events = diffListing(prev, next, at)
    expect(events[0].kind).toBe('price_increase')
    expect(events[0].pctChange).toBe(5)
  })

  test('sale and rent prices diff independently', () => {
    const prev = sale('1', 50_000_000, 100_000)
    const next = sale('1', 50_000_000, 90_000)
    const events = diffListing(prev, next, at)
    expect(events.length).toBe(1)
    expect(events[0].priceKind).toBe('rent')
    expect(events[0].kind).toBe('price_drop')
  })

  test('a null in either prev or next is ignored — no spurious event', () => {
    expect(diffListing(sale('1', null), sale('1', 50_000_000), at)).toEqual([])
    expect(diffListing(sale('1', 50_000_000), sale('1', null), at)).toEqual([])
  })
})

describe('priceHistoryEntriesFromEvents', () => {
  test('extracts entries only from price_drop / price_increase events', () => {
    const events = diffListing(null, sale('1', 50_000_000), at)
    expect(priceHistoryEntriesFromEvents(events)).toEqual([])
  })

  test('builds history rows from price changes', () => {
    const prev = sale('1', 50_000_000)
    const next = sale('1', 45_000_000)
    const events = diffListing(prev, next, at)
    const rows = priceHistoryEntriesFromEvents(events)
    expect(rows).toEqual([{ kind: 'sale', priceYen: 45_000_000, observedAt: at }])
  })
})
