import got, { type OptionsOfTextResponseBody, type Method } from 'got'
import logger from './logger'
import { config } from './config'

// Single source of truth for browser fingerprints we rotate through.
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.2 Safari/605.1.15'
]

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  DNT: '1',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
}

const DEFAULT_TIMEOUT = {
  request: 20_000,
  response: 10_000,
  connect: 5_000,
  lookup: 3_000
}

const DEFAULT_RETRY = {
  limit: 2,
  methods: ['GET'] as Method[],
  statusCodes: [408, 413, 429, 500, 502, 503, 504, 521, 522, 524]
}

// --- Global rate limiter -----------------------------------------------------
// Module-level token-bucket. Every fetchHtml call awaits a slot before sending
// a request, replacing the ad-hoc 2-3 s sleeps that lived in each crawler.

// Lazy init so importing lib/http.ts doesn't read env until it's needed.
let minIntervalMs: number | null = null
let nextAllowedAt = 0

const ensureInitialized = (): void => {
  if (minIntervalMs !== null) return
  const rpm = config().scraper.maxReqPerMinute
  minIntervalMs = Math.floor(60_000 / Math.max(1, rpm))
}

export const setRateLimit = (requestsPerMinute: number): void => {
  if (!Number.isFinite(requestsPerMinute) || requestsPerMinute <= 0) {
    throw new Error(`setRateLimit: invalid value ${requestsPerMinute}`)
  }
  minIntervalMs = Math.floor(60_000 / requestsPerMinute)
  nextAllowedAt = 0
}

// Test-only: reset the next-allowed cursor so each test starts fresh.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const __resetRateLimiterForTests = (): void => {
  nextAllowedAt = 0
}

// Exported for direct unit testing. Callers should usually use fetchHtml instead.
export const acquireSlot = async (): Promise<void> => {
  ensureInitialized()
  const interval = minIntervalMs ?? 0
  const now = Date.now()
  const wait = Math.max(0, nextAllowedAt - now)
  nextAllowedAt = Math.max(now, nextAllowedAt) + interval
  if (wait > 0) {
    await new Promise<void>(resolve => setTimeout(resolve, wait))
  }
}

// --- Block-page detector -----------------------------------------------------
// HTTP 200 with a body that's a "we're sorry" / CAPTCHA / robot-check page.
// Surfaces as a transient ScrapeResult in the caller.
const BLOCK_PATTERNS: Array<{ test: RegExp | ((html: string) => boolean), reason: string }> = [
  { test: (h) => h.length < 1000, reason: 'response too small (<1KB)' },
  { test: (h) => !h.includes('html') && !h.includes('HTML'), reason: 'response not HTML' },
  { test: /アクセスが集中/, reason: 'block page: アクセスが集中 (traffic surge)' },
  { test: /一時的にアクセス/, reason: 'block page: 一時的にアクセスできません' },
  { test: /CAPTCHA/i, reason: 'block page: CAPTCHA prompt' },
  { test: /robot[\s_-]?check/i, reason: 'block page: robot check' },
  { test: /Are you a human/i, reason: 'block page: human-check prompt' }
]

export const detectBlockPage = (html: string): { blocked: boolean, reason?: string } => {
  for (const { test, reason } of BLOCK_PATTERNS) {
    const hit = typeof test === 'function' ? test(html) : test.test(html)
    if (hit) return { blocked: true, reason }
  }
  return { blocked: false }
}

// --- The public client -------------------------------------------------------

export interface FetchOptions {
  // Override the per-request total timeout. Default comes from DEFAULT_TIMEOUT.
  timeoutMs?: number
  // Allow the caller to cancel.
  signal?: AbortSignal
}

export interface FetchResult {
  body: string
  statusCode: number
}

export const fetchHtml = async (url: string, options: FetchOptions = {}): Promise<FetchResult> => {
  await acquireSlot()
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
  const requestOptions: OptionsOfTextResponseBody = {
    headers: { 'User-Agent': userAgent, ...DEFAULT_HEADERS },
    timeout: options.timeoutMs ? { ...DEFAULT_TIMEOUT, request: options.timeoutMs } : DEFAULT_TIMEOUT,
    retry: DEFAULT_RETRY,
    signal: options.signal
  }
  const start = Date.now()
  const response = await got(url, requestOptions)
  logger.info(`[HTTP] ${response.statusCode} ${url} (${response.body.length}B, ${Date.now() - start}ms)`)
  return { body: response.body, statusCode: response.statusCode }
}
