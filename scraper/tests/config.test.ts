import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { __resetConfigForTests, config } from '../lib/config'

// Snapshot env so individual tests can mutate freely without leaking state.
const ENV_KEYS = [
  'MONGO_URI',
  'MONGO_DB_NAME',
  'MONGO_COLLECTION_NAME',
  'MONGO_COLLECTION_DETAILS',
  'MONGO_COLLECTION_STATE',
  'MONGO_COLLECTION_PARSE_ERRORS',
  'MONGO_COLLECTION_CHANGES',
  'SCRAPE_MODE',
  'START_PATH',
  'BASE_PATH',
  'STORE_HTML',
  'MAX_REQ_PER_MINUTE'
]

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  __resetConfigForTests()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    const prior = saved[k]
    if (prior === undefined) process.env[k] = ''
    else process.env[k] = prior
  }
  __resetConfigForTests()
})

describe('config() — required fields', () => {
  test('MONGO_URI throws on access when missing', () => {
    delete process.env.MONGO_URI
    const c = config()
    expect(() => c.mongo.uri).toThrow(/MONGO_URI/)
  })

  test('MONGO_URI throws on access when empty', () => {
    process.env.MONGO_URI = '   '
    const c = config()
    expect(() => c.mongo.uri).toThrow(/MONGO_URI/)
  })

  test('MONGO_URI returns the value when set', () => {
    process.env.MONGO_URI = 'mongodb://localhost:27017'
    expect(config().mongo.uri).toBe('mongodb://localhost:27017')
  })

  test('config() itself does not throw when MONGO_URI is missing', () => {
    delete process.env.MONGO_URI
    expect(() => config()).not.toThrow()
  })
})

describe('config() — optional defaults', () => {
  test('mongo collection names fall back to documented defaults', () => {
    for (const k of ENV_KEYS) process.env[k] = ''
    const c = config()
    expect(c.mongo.dbName).toBe('suumo')
    expect(c.mongo.collections.listings).toBe('listings')
    expect(c.mongo.collections.details).toBe('details')
    expect(c.mongo.collections.state).toBe('scraper_state')
    expect(c.mongo.collections.parseErrors).toBe('parse_errors')
    expect(c.mongo.collections.changeEvents).toBe('change_events')
  })

  test('scraper.mode defaults to LISTING', () => {
    delete process.env.SCRAPE_MODE
    expect(config().scraper.mode).toBe('LISTING')
  })

  test('scraper.mode accepts DETAIL', () => {
    process.env.SCRAPE_MODE = 'DETAIL'
    expect(config().scraper.mode).toBe('DETAIL')
  })

  test('unknown SCRAPE_MODE falls back to LISTING (no junk modes)', () => {
    process.env.SCRAPE_MODE = 'TYPO'
    expect(config().scraper.mode).toBe('LISTING')
  })

  test('storeHtml parses true/false/0/1/yes/no', () => {
    const cases: Array<[string, boolean]> = [
      ['true', true], ['false', false],
      ['1', true], ['0', false],
      ['yes', true], ['no', false],
      ['TRUE', true], ['FALSE', false]
    ]
    for (const [raw, expected] of cases) {
      process.env.STORE_HTML = raw
      __resetConfigForTests()
      expect(config().scraper.storeHtml).toBe(expected)
    }
  })

  test('storeHtml falls back to true on garbage', () => {
    process.env.STORE_HTML = 'maybe'
    expect(config().scraper.storeHtml).toBe(true)
  })

  test('maxReqPerMinute parses integers and ignores garbage', () => {
    process.env.MAX_REQ_PER_MINUTE = '15'
    expect(config().scraper.maxReqPerMinute).toBe(15)

    __resetConfigForTests()
    process.env.MAX_REQ_PER_MINUTE = 'banana'
    expect(config().scraper.maxReqPerMinute).toBe(30)

    __resetConfigForTests()
    delete process.env.MAX_REQ_PER_MINUTE
    expect(config().scraper.maxReqPerMinute).toBe(30)
  })

  test('basePath defaults to suumo.jp', () => {
    delete process.env.BASE_PATH
    expect(config().scraper.basePath).toBe('https://suumo.jp')
  })
})

describe('config() — caching', () => {
  test('returns the same object on repeated calls', () => {
    const a = config()
    const b = config()
    expect(a).toBe(b)
  })

  test('__resetConfigForTests forces a re-read', () => {
    process.env.MONGO_DB_NAME = 'first'
    config()
    process.env.MONGO_DB_NAME = 'second'
    expect(config().mongo.dbName).toBe('first') // cached
    __resetConfigForTests()
    expect(config().mongo.dbName).toBe('second')
  })
})
