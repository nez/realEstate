import { describe, expect, test } from 'bun:test'
import {
  MAX_ATTEMPTS,
  ScrapeStatus,
  classifyError,
  eligibleForDetailScrape,
  nextAttemptDelayMs,
  permanentErrorPatch,
  successPatch,
  transientErrorPatch
} from '../lib/status'

describe('classifyError', () => {
  test('treats timeouts and aborts as transient', () => {
    const err = new Error('timed out')
    err.name = 'TimeoutError'
    expect(classifyError(err)).toBe('transient')

    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(classifyError(abort)).toBe('transient')
  })

  test('treats 5xx and 429 as transient', () => {
    const fiveXX: any = new Error('server error')
    fiveXX.response = { statusCode: 503 }
    expect(classifyError(fiveXX)).toBe('transient')

    const tooMany: any = new Error('rate limited')
    tooMany.response = { statusCode: 429 }
    expect(classifyError(tooMany)).toBe('transient')
  })

  test('treats 404 and other 4xx as permanent', () => {
    const notFound: any = new Error('gone')
    notFound.response = { statusCode: 404 }
    expect(classifyError(notFound)).toBe('permanent')

    const forbidden: any = new Error('forbidden')
    forbidden.response = { statusCode: 403 }
    expect(classifyError(forbidden)).toBe('permanent')
  })

  test('classifies common network codes as transient', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND']) {
      const err: any = new Error(code)
      err.code = code
      expect(classifyError(err)).toBe('transient')
    }
  })
})

describe('backoff schedule', () => {
  test('nextAttemptDelayMs grows by attempt count', () => {
    const first = nextAttemptDelayMs(0)
    const fifth = nextAttemptDelayMs(4)
    expect(first).toBeLessThan(fifth)
  })

  test('first delay is in the ~5 minute neighborhood (±20% jitter)', () => {
    const fiveMin = 5 * 60_000
    const delay = nextAttemptDelayMs(0)
    expect(delay).toBeGreaterThanOrEqual(fiveMin * 0.8)
    expect(delay).toBeLessThanOrEqual(fiveMin * 1.2)
  })
})

describe('transientErrorPatch', () => {
  test('keeps status transient while attempts < MAX_ATTEMPTS', () => {
    const patch = transientErrorPatch('timeout', 1)
    expect(patch.$set.status).toBe(ScrapeStatus.transientError)
    expect(patch.$inc?.attempts).toBe(1)
    expect(patch.$set.nextAttemptAt).toBeInstanceOf(Date)
  })

  test('promotes to permanent_error once MAX_ATTEMPTS would be reached', () => {
    const patch = transientErrorPatch('timeout', MAX_ATTEMPTS - 1)
    expect(patch.$set.status).toBe(ScrapeStatus.permanentError)
    expect(String(patch.$set.lastError)).toContain('exceeded')
    expect(patch.$set.nextAttemptAt).toBeNull()
  })
})

describe('successPatch / permanentErrorPatch', () => {
  test('success clears nextAttemptAt and records scrapedAt', () => {
    const patch = successPatch()
    expect(patch.$set.status).toBe(ScrapeStatus.success)
    expect(patch.$set.lastError).toBeNull()
    expect(patch.$set.nextAttemptAt).toBeNull()
    expect(patch.$set.scrapedAt).toBeInstanceOf(Date)
  })

  test('permanent error records the reason', () => {
    const patch = permanentErrorPatch('schema validation failed')
    expect(patch.$set.status).toBe(ScrapeStatus.permanentError)
    expect(patch.$set.lastError).toBe('schema validation failed')
  })
})

describe('eligibleForDetailScrape filter', () => {
  test('excludes legacy scraped:true and successful/permanent rows', () => {
    const filter = eligibleForDetailScrape()
    expect(filter.scraped).toEqual({ $ne: true })
    expect(filter.status).toEqual({
      $nin: [ScrapeStatus.success, ScrapeStatus.permanentError]
    })
    expect(Array.isArray(filter.$or)).toBe(true)
  })
})
