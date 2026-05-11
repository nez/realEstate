import { describe, expect, test } from 'bun:test'
import { formatM2, formatYen, renderTable, truncate } from '../cli/format'

describe('formatYen', () => {
  test('plain 万円 amounts', () => {
    expect(formatYen(71_000_000)).toBe('7,100万円')
    expect(formatYen(45_000_000)).toBe('4,500万円')
  })

  test('handles 億+万 composites', () => {
    expect(formatYen(150_000_000)).toBe('1億5,000万円')
    expect(formatYen(100_000_000)).toBe('1億円')
  })

  test('null / undefined returns a placeholder', () => {
    expect(formatYen(null)).toBe('-')
    expect(formatYen(undefined)).toBe('-')
  })
})

describe('formatM2', () => {
  test('one-decimal rendering', () => {
    expect(formatM2(75.5)).toBe('75.5m²')
    expect(formatM2(110.255)).toBe('110.3m²')
  })

  test('null is dash', () => {
    expect(formatM2(null)).toBe('-')
  })
})

describe('truncate', () => {
  test('passes short strings through', () => {
    expect(truncate('short', 20)).toBe('short')
  })

  test('chops long strings with an ellipsis', () => {
    const out = truncate('this is a very long sentence', 12)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(12)
  })

  test('null / undefined returns a placeholder', () => {
    expect(truncate(null, 10)).toBe('-')
    expect(truncate(undefined, 10)).toBe('-')
  })
})

describe('renderTable', () => {
  test('produces a header row, separator, and data rows', () => {
    const out = renderTable(['ID', 'Price'], [['1', '50万円'], ['2', '60万円']])
    const lines = out.split('\n')
    // 1 top sep + 1 header + 1 mid sep + 2 data + 1 bottom sep = 6 lines
    expect(lines.length).toBe(6)
    expect(lines[1]).toContain('ID')
    expect(lines[1]).toContain('Price')
  })

  test('columns widen to fit the longest cell', () => {
    const out = renderTable(['x'], [['very-long-content']])
    expect(out).toContain('very-long-content')
  })
})
