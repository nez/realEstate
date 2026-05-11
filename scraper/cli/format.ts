// Tiny ASCII table renderer. Used by the query CLI.
// No external deps; keeps the personal-tool footprint small.

const visibleLength = (s: string): number => {
  let len = 0
  for (const ch of s) {
    // Treat CJK characters as double-width so the columns roughly align.
    const code = ch.codePointAt(0) ?? 0
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xa960 && code <= 0xa97f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      len += 2
    } else {
      len += 1
    }
  }
  return len
}

const padTo = (s: string, width: number): string => {
  const pad = width - visibleLength(s)
  return pad > 0 ? s + ' '.repeat(pad) : s
}

export const renderTable = (headers: string[], rows: string[][]): string => {
  const widths = headers.map((h, i) =>
    Math.max(visibleLength(h), ...rows.map(r => visibleLength(r[i] ?? '')))
  )
  const sep = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+'
  const fmt = (cells: string[]): string =>
    '| ' + cells.map((c, i) => padTo(c, widths[i])).join(' | ') + ' |'
  const lines = [sep, fmt(headers), sep, ...rows.map(fmt), sep]
  return lines.join('\n')
}

// Render a yen amount as a compact, human-readable string: "7,100万円" / "1億5,000万円".
export const formatYen = (yen: number | null | undefined): string => {
  if (yen === null || yen === undefined) return '-'
  const oku = Math.floor(yen / 100_000_000)
  const remainder = yen - oku * 100_000_000
  const man = Math.floor(remainder / 10_000)
  const okuStr = oku > 0 ? `${oku}億` : ''
  const manStr = man > 0 ? `${man.toLocaleString()}万` : (oku > 0 ? '' : '0万')
  return `${okuStr}${manStr}円`
}

export const formatM2 = (m2: number | null | undefined): string =>
  m2 === null || m2 === undefined ? '-' : `${m2.toFixed(1)}m²`

export const truncate = (s: string | null | undefined, max: number): string => {
  if (!s) return '-'
  if (visibleLength(s) <= max) return s
  // Naïve: truncate by code points, not visible cells. Fine for table output.
  return Array.from(s).slice(0, max - 1).join('') + '…'
}
