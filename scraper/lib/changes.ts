// Pure helpers for diffing a freshly scraped listing against the prior version
// stored in Mongo. The crawler turns these events into change_events docs and,
// later, into notifications.

export type ChangeKind =
  | 'new_listing'
  | 'price_drop'
  | 'price_increase'

export type PriceKind = 'sale' | 'rent'

export interface ChangeEvent {
  listingId: string
  kind: ChangeKind
  priceKind?: PriceKind
  oldPriceYen?: number | null
  newPriceYen?: number | null
  pctChange?: number | null
  listingUrl: string
  observedAt: Date
}

export interface ListingPriceState {
  _id: string
  url: string
  salePriceYen: number | null
  rentPriceYen: number | null
}

// Round to 2 decimals so pct values are readable when persisted.
const pct = (oldYen: number, newYen: number): number =>
  Math.round(((newYen - oldYen) / oldYen) * 10_000) / 100

// Build the change events for one listing observed in a fresh crawl.
// `prev` is null when the listing has never been seen before.
export const diffListing = (
  prev: ListingPriceState | null,
  next: ListingPriceState,
  now: Date = new Date()
): ChangeEvent[] => {
  if (prev === null) {
    return [{
      listingId: next._id,
      kind: 'new_listing',
      newPriceYen: next.salePriceYen ?? next.rentPriceYen ?? null,
      priceKind: next.salePriceYen !== null ? 'sale' : (next.rentPriceYen !== null ? 'rent' : undefined),
      listingUrl: next.url,
      observedAt: now
    }]
  }

  const events: ChangeEvent[] = []
  for (const priceKind of ['sale', 'rent'] as const) {
    const field = priceKind === 'sale' ? 'salePriceYen' : 'rentPriceYen'
    const oldYen = prev[field]
    const newYen = next[field]
    if (oldYen === null || newYen === null) continue
    if (oldYen === newYen) continue
    events.push({
      listingId: next._id,
      kind: newYen < oldYen ? 'price_drop' : 'price_increase',
      priceKind,
      oldPriceYen: oldYen,
      newPriceYen: newYen,
      pctChange: pct(oldYen, newYen),
      listingUrl: next.url,
      observedAt: now
    })
  }
  return events
}

// Mongo $push spec for priceHistory entries derived from the events.
// Returns an empty array when nothing should be pushed (no price change).
export const priceHistoryEntriesFromEvents = (
  events: ChangeEvent[]
): Array<{ kind: PriceKind, priceYen: number, observedAt: Date }> => {
  const entries: Array<{ kind: PriceKind, priceYen: number, observedAt: Date }> = []
  for (const e of events) {
    if (e.kind !== 'price_drop' && e.kind !== 'price_increase') continue
    if (e.priceKind === undefined) continue
    if (e.newPriceYen === null || e.newPriceYen === undefined) continue
    entries.push({ kind: e.priceKind, priceYen: e.newPriceYen, observedAt: e.observedAt })
  }
  return entries
}
