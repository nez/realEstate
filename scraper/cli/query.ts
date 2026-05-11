/* eslint-disable @typescript-eslint/no-misused-promises */
import { parseArgs } from 'util'
import client from '../lib/client'
import { ensureIndexes } from '../lib/indexes'
import { formatM2, formatYen, renderTable, truncate } from './format'

const USAGE = `Usage:
  bun run query listings [options]
  bun run query changes  [options]

listings options:
  --max-sale <yen>        Filter to listings with salePriceYen <= yen
  --min-size <m2>         Filter to listings with sizeM2 >= m2
  --max-pp-m2 <yen>       Filter to listings with pricePerM2 <= yen
  --station <substr>      Filter: station contains substr
  --address <substr>      Filter: address contains substr
  --status <status>       Filter by status (default: success)
  --any-status            Show all statuses (overrides --status)
  --sort <field>          price-per-m2 | price | size | newest (default: price-per-m2)
  --limit <n>             Default 20
  --format <table|json>   Default table

changes options:
  --kind <kind>           new_listing | price_drop | price_increase
  --since <date>          ISO date (2026-05-01) or relative (7d, 24h, 30m)
  --listing-id <id>       Filter to a single listing
  --limit <n>             Default 20
  --format <table|json>   Default table
`

const parseSinceFlag = (raw: string): Date => {
  const relMatch = raw.match(/^(\d+)([dhm])$/)
  if (relMatch) {
    const n = parseInt(relMatch[1], 10)
    const unit = relMatch[2]
    const ms = unit === 'd' ? n * 86_400_000 : unit === 'h' ? n * 3_600_000 : n * 60_000
    return new Date(Date.now() - ms)
  }
  const d = new Date(raw)
  if (isNaN(d.getTime())) throw new Error(`could not parse --since value: ${raw}`)
  return d
}

const sortKeyMap: Record<string, [string, 1 | -1]> = {
  'price-per-m2': ['pricePerM2', 1],
  price: ['salePriceYen', 1],
  size: ['sizeM2', -1],
  newest: ['lastSeenAt', -1]
}

const runListings = async (args: string[]): Promise<void> => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      'max-sale': { type: 'string' },
      'min-size': { type: 'string' },
      'max-pp-m2': { type: 'string' },
      station: { type: 'string' },
      address: { type: 'string' },
      status: { type: 'string' },
      'any-status': { type: 'boolean' },
      sort: { type: 'string' },
      limit: { type: 'string' },
      format: { type: 'string' }
    }
  })

  const dbName = process.env.MONGO_DB_NAME ?? 'suumo'
  const listings = client.db(dbName).collection(process.env.MONGO_COLLECTION_NAME ?? 'listings')

  const match: Record<string, unknown> = {}
  if (values['max-sale']) match.salePriceYen = { $lte: parseInt(values['max-sale'], 10) }
  if (values['min-size']) match.sizeM2 = { $gte: parseFloat(values['min-size']) }
  if (values.station) match.station = { $regex: values.station, $options: 'i' }
  if (values.address) match.address = { $regex: values.address, $options: 'i' }
  if (!values['any-status']) {
    const status = values.status ?? 'success'
    // Successful detail scrapes — include legacy `scraped: true` rows so the
    // pre-M1 backlog is still queryable.
    if (status === 'success') {
      match.$or = [{ status: 'success' }, { scraped: true }]
    } else {
      match.status = status
    }
  }

  const sortFlag = values.sort ?? 'price-per-m2'
  const sortEntry = sortKeyMap[sortFlag]
  if (!sortEntry) throw new Error(`unknown --sort value: ${sortFlag}`)
  const [sortField, sortDir] = sortEntry
  const limit = values.limit ? parseInt(values.limit, 10) : 20

  // Sorting on a sale-only quantity means rent-only and price-less rows
  // shouldn't appear — their values would be null and clutter the top of
  // the table.
  if (sortField === 'pricePerM2' || sortField === 'salePriceYen') {
    match.salePriceYen = { ...(match.salePriceYen as object ?? {}), $ne: null }
    match.sizeM2 = { ...(match.sizeM2 as object ?? {}), $gt: 0 }
  }

  const pipeline: any[] = [{ $match: match }]
  pipeline.push({
    $addFields: {
      pricePerM2: {
        $cond: [
          {
            $and: [
              { $ne: ['$salePriceYen', null] },
              { $ne: ['$sizeM2', null] },
              { $gt: ['$sizeM2', 0] }
            ]
          },
          { $divide: ['$salePriceYen', '$sizeM2'] },
          null
        ]
      }
    }
  })
  if (values['max-pp-m2']) {
    pipeline.push({ $match: { pricePerM2: { $lte: parseInt(values['max-pp-m2'], 10) } } })
  }
  pipeline.push({ $sort: { [sortField]: sortDir, _id: 1 } })
  pipeline.push({ $limit: limit })

  const rows = await listings.aggregate(pipeline).toArray()

  if (values.format === 'json') {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n')
    return
  }

  if (rows.length === 0) {
    process.stdout.write('No listings matched.\n')
    return
  }

  const headers = ['ID', 'Name', 'Price', 'Size', '¥/m²', 'Station', 'URL']
  const tableRows = rows.map(r => [
    String(r._id ?? ''),
    truncate(r.name, 24),
    formatYen(r.salePriceYen ?? r.rentPriceYen),
    formatM2(r.sizeM2),
    r.pricePerM2 ? formatYen(Math.round(r.pricePerM2)) : '-',
    truncate(r.station, 28),
    truncate(r.url, 60)
  ])
  process.stdout.write(renderTable(headers, tableRows) + '\n')
  process.stdout.write(`\n${rows.length} listing${rows.length === 1 ? '' : 's'} shown.\n`)
}

const runChanges = async (args: string[]): Promise<void> => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      kind: { type: 'string' },
      since: { type: 'string' },
      'listing-id': { type: 'string' },
      limit: { type: 'string' },
      format: { type: 'string' }
    }
  })

  const dbName = process.env.MONGO_DB_NAME ?? 'suumo'
  const changes = client.db(dbName).collection(process.env.MONGO_COLLECTION_CHANGES ?? 'change_events')

  const match: Record<string, unknown> = {}
  if (values.kind) match.kind = values.kind
  if (values.since) match.observedAt = { $gte: parseSinceFlag(values.since) }
  if (values['listing-id']) match.listingId = values['listing-id']

  const limit = values.limit ? parseInt(values.limit, 10) : 20

  const rows = await changes
    .find(match)
    .sort({ observedAt: -1 })
    .limit(limit)
    .toArray()

  if (values.format === 'json') {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n')
    return
  }

  if (rows.length === 0) {
    process.stdout.write('No change events matched.\n')
    return
  }

  const headers = ['When', 'Kind', 'Listing', 'Old', 'New', 'Δ%', 'URL']
  const tableRows = rows.map(r => [
    r.observedAt instanceof Date ? r.observedAt.toISOString().slice(0, 16) : String(r.observedAt ?? ''),
    String(r.kind ?? ''),
    String(r.listingId ?? ''),
    formatYen(r.oldPriceYen),
    formatYen(r.newPriceYen),
    r.pctChange === null || r.pctChange === undefined ? '-' : `${r.pctChange}%`,
    truncate(r.listingUrl, 60)
  ])
  process.stdout.write(renderTable(headers, tableRows) + '\n')
  process.stdout.write(`\n${rows.length} event${rows.length === 1 ? '' : 's'} shown.\n`)
}

const main = async (): Promise<void> => {
  const [, , subcommand, ...rest] = process.argv
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(USAGE)
    return
  }

  const dbName = process.env.MONGO_DB_NAME ?? 'suumo'
  const db = client.db(dbName)
  await ensureIndexes(db, {
    listings: process.env.MONGO_COLLECTION_NAME ?? 'listings',
    details: process.env.MONGO_COLLECTION_DETAILS ?? 'details',
    changeEvents: process.env.MONGO_COLLECTION_CHANGES ?? 'change_events',
    parseErrors: process.env.MONGO_COLLECTION_PARSE_ERRORS ?? 'parse_errors'
  })

  switch (subcommand) {
    case 'listings':
      await runListings(rest)
      break
    case 'changes':
      await runChanges(rest)
      break
    default:
      process.stderr.write(`unknown subcommand: ${subcommand}\n\n${USAGE}`)
      process.exit(1)
  }
}

main()
  .catch(err => {
    process.stderr.write(`error: ${err.message ?? String(err)}\n`)
    process.exit(1)
  })
  .finally(async () => {
    await client.close()
  })
