import { describe, expect, test, beforeEach } from 'bun:test'
import { __resetRateLimiterForTests, acquireSlot, detectBlockPage, setRateLimit } from '../lib/http'

describe('detectBlockPage', () => {
  test('passes a normal HTML page through', () => {
    const html = '<html><body>' + 'normal content '.repeat(200) + '</body></html>'
    expect(detectBlockPage(html)).toEqual({ blocked: false })
  })

  test('flags a tiny body as blocked', () => {
    const res = detectBlockPage('<html>short</html>')
    expect(res.blocked).toBe(true)
    expect(res.reason).toContain('too small')
  })

  test('flags a non-HTML body as blocked', () => {
    const big = 'plain text '.repeat(200)
    const res = detectBlockPage(big)
    expect(res.blocked).toBe(true)
    expect(res.reason).toContain('not HTML')
  })

  test('flags the アクセスが集中 Suumo block marker', () => {
    const html = '<html><body>' + 'x'.repeat(1100) + 'アクセスが集中しています</body></html>'
    expect(detectBlockPage(html).blocked).toBe(true)
  })

  test('flags a CAPTCHA prompt', () => {
    const html = '<html><body>' + 'x'.repeat(1100) + ' Please solve this CAPTCHA</body></html>'
    const res = detectBlockPage(html)
    expect(res.blocked).toBe(true)
    expect(res.reason).toContain('CAPTCHA')
  })

  test('flags a robot-check page', () => {
    const html = '<html><body>' + 'x'.repeat(1100) + ' robot-check required</body></html>'
    expect(detectBlockPage(html).blocked).toBe(true)
  })
})

describe('rate limiter', () => {
  beforeEach(() => {
    __resetRateLimiterForTests()
  })

  test('first acquireSlot returns immediately', async () => {
    setRateLimit(60_000) // 1ms between requests, basically no spacing
    __resetRateLimiterForTests()
    const start = Date.now()
    await acquireSlot()
    expect(Date.now() - start).toBeLessThan(20)
  })

  test('back-to-back acquireSlot calls are spaced by the configured interval', async () => {
    setRateLimit(600) // 600 req/min => 100ms between requests
    __resetRateLimiterForTests()

    const start = Date.now()
    await acquireSlot()
    await acquireSlot()
    await acquireSlot()
    const elapsed = Date.now() - start

    // Three calls => two intervals of spacing. Allow a generous lower bound for
    // timer-precision wobble and an upper bound to catch runaway sleeps.
    expect(elapsed).toBeGreaterThanOrEqual(180) // ~2 × 100ms minus jitter
    expect(elapsed).toBeLessThan(500)
  })

  test('setRateLimit rejects invalid values', () => {
    expect(() => { setRateLimit(0) }).toThrow()
    expect(() => { setRateLimit(-1) }).toThrow()
    expect(() => { setRateLimit(Number.NaN) }).toThrow()
  })
})
