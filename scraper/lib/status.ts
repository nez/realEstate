// Lifecycle of a listing through the detail-scraping pipeline.
// Legacy rows have `scraped: true` and no `status` — readers must tolerate both.
export const ScrapeStatus = {
  pending: 'pending',
  success: 'success',
  transientError: 'transient_error',
  permanentError: 'permanent_error'
} as const
export type ScrapeStatusValue = (typeof ScrapeStatus)[keyof typeof ScrapeStatus]

export const MAX_ATTEMPTS = 5
// Backoff schedule: ~5 min, 15 min, 1 h, 4 h, 12 h.
const BACKOFF_MINUTES = [5, 15, 60, 240, 720]

export const nextAttemptDelayMs = (attempts: number): number => {
  const idx = Math.min(attempts, BACKOFF_MINUTES.length - 1)
  const base = BACKOFF_MINUTES[idx] * 60_000
  // ±20% jitter so retries don't bunch up.
  const jitter = base * (Math.random() * 0.4 - 0.2)
  return Math.round(base + jitter)
}

export type ErrorKind = 'transient' | 'permanent'

// Classify an error thrown by got (or downstream) as worth retrying or not.
// Network/timeout/abort/5xx/429 → transient. 4xx other than 429 → permanent.
// Anything we can't classify defaults to transient so a single oddity doesn't
// burn the listing forever.
export const classifyError = (error: unknown): ErrorKind => {
  if (!(error instanceof Error)) return 'transient'

  // got's tagged errors expose `code` / `name` / `response`.
  const e = error as Error & {
    code?: string
    response?: { statusCode?: number }
  }

  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'transient'
  if (e.name === 'RequestError') return 'transient'

  if (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' ||
      e.code === 'EAI_AGAIN' || e.code === 'ENOTFOUND') {
    return 'transient'
  }

  const status = e.response?.statusCode
  if (status !== undefined) {
    if (status === 429 || status === 408 || (status >= 500 && status < 600)) return 'transient'
    if (status >= 400 && status < 500) return 'permanent'
  }

  return 'transient'
}

// Build the Mongo $set patch for a given outcome. Centralizing this avoids the
// scattered `scraped: true, scrapedAt: …` updates that hid the legacy boolean
// in three different code paths.
export interface OutcomePatch {
  $set: Record<string, unknown>
  $unset?: Record<string, unknown>
  $inc?: Record<string, number>
}

export const successPatch = (): OutcomePatch => ({
  $set: { status: ScrapeStatus.success, scrapedAt: new Date(), lastError: null, nextAttemptAt: null }
})

export const permanentErrorPatch = (reason: string): OutcomePatch => ({
  $set: {
    status: ScrapeStatus.permanentError,
    scrapedAt: new Date(),
    lastError: reason,
    nextAttemptAt: null
  }
})

export const transientErrorPatch = (reason: string, currentAttempts: number): OutcomePatch => {
  const attempts = currentAttempts + 1
  if (attempts >= MAX_ATTEMPTS) {
    return {
      $set: {
        status: ScrapeStatus.permanentError,
        scrapedAt: new Date(),
        lastError: `${reason} (exceeded ${MAX_ATTEMPTS} attempts)`,
        nextAttemptAt: null
      },
      $inc: { attempts: 1 }
    }
  }
  return {
    $set: {
      status: ScrapeStatus.transientError,
      lastError: reason,
      nextAttemptAt: new Date(Date.now() + nextAttemptDelayMs(attempts))
    },
    $inc: { attempts: 1 }
  }
}

// Filter for listings that are eligible for (re-)scraping in DETAIL mode.
// Excludes:
//   - rows already successful (new status field or legacy `scraped: true`)
//   - rows we've given up on permanently
//   - rows whose backoff window hasn't elapsed yet
export const eligibleForDetailScrape = (now: Date = new Date()): Record<string, unknown> => ({
  scraped: { $ne: true },
  status: { $nin: [ScrapeStatus.success, ScrapeStatus.permanentError] },
  $or: [
    { nextAttemptAt: { $exists: false } },
    { nextAttemptAt: null },
    { nextAttemptAt: { $lte: now } }
  ]
})
