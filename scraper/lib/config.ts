// Single source of truth for env-var-driven configuration.
//
// Required vars (MONGO_URI) throw only when the caller actually reads them, so
// parser unit tests that import library code without needing a database can
// still call config() freely. Entrypoints (cron jobs, CLI) trigger validation
// immediately by touching the required fields at startup.

const optional = (key: string, fallback: string): string => {
  const value = process.env[key]
  return value === undefined || value.length === 0 ? fallback : value
}

const optionalInt = (key: string, fallback: number): number => {
  const raw = process.env[key]
  if (raw === undefined || raw.length === 0) return fallback
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const optionalBool = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key]
  if (raw === undefined) return fallback
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  return fallback
}

const scrapeModeOf = (raw: string): 'LISTING' | 'DETAIL' => {
  if (raw === 'DETAIL') return 'DETAIL'
  return 'LISTING'
}

export interface MongoConfig {
  readonly uri: string
  readonly dbName: string
  readonly collections: {
    readonly listings: string
    readonly details: string
    readonly state: string
    readonly parseErrors: string
    readonly changeEvents: string
  }
}

export interface ScraperConfig {
  readonly mode: 'LISTING' | 'DETAIL'
  readonly startPath: string
  readonly basePath: string
  readonly storeHtml: boolean
  readonly maxReqPerMinute: number
}

export interface Config {
  readonly mongo: MongoConfig
  readonly scraper: ScraperConfig
}

const build = (): Config => {
  const mongo: MongoConfig = {
    // Getter so the value is required-on-access, not required-on-load.
    get uri () {
      const v = process.env.MONGO_URI
      if (v === undefined || v.trim().length === 0) {
        throw new Error('Required env var MONGO_URI is not set (see .env.example)')
      }
      return v
    },
    dbName: optional('MONGO_DB_NAME', 'suumo'),
    collections: {
      listings: optional('MONGO_COLLECTION_NAME', 'listings'),
      details: optional('MONGO_COLLECTION_DETAILS', 'details'),
      state: optional('MONGO_COLLECTION_STATE', 'scraper_state'),
      parseErrors: optional('MONGO_COLLECTION_PARSE_ERRORS', 'parse_errors'),
      changeEvents: optional('MONGO_COLLECTION_CHANGES', 'change_events')
    }
  }
  const scraper: ScraperConfig = {
    mode: scrapeModeOf(optional('SCRAPE_MODE', 'LISTING')),
    startPath: optional('START_PATH', ''),
    basePath: optional('BASE_PATH', 'https://suumo.jp'),
    storeHtml: optionalBool('STORE_HTML', true),
    maxReqPerMinute: optionalInt('MAX_REQ_PER_MINUTE', 30)
  }
  return { mongo, scraper }
}

let cached: Config | null = null

export const config = (): Config => {
  if (cached === null) cached = build()
  return cached
}

// Test-only: clear the cached config so the next config() call re-reads env vars.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const __resetConfigForTests = (): void => {
  cached = null
}
