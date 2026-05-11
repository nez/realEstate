import { toYen } from './parserUtils'

// Subset of detail-page fields worth copying onto the listing document so that
// `bun run query listings` and ad-hoc Mongo queries can filter by layout / age /
// fees without joining the details collection. Each field is optional — a
// detail page that's missing a row should leave the listing unchanged for it.
export interface ListingHydration {
  layout?: string // 間取り             e.g. "2LDK"
  builtYear?: number // 完成時期 / 築年月    e.g. 1978
  builtMonth?: number // 1-12, when present
  floor?: number // 所在階              e.g. 6
  orientation?: string // 向き                e.g. "北東"
  buildingStructure?: string // 構造・階建て         e.g. "SRC11階地下1階建"
  useDistrict?: string // 用途地域            e.g. "商業"
  parkingAvailable?: boolean // 駐車場 != 無 / なし
  isLeasehold?: boolean // 敷地の権利形態 contains 借地 / 地上権
  managementFeeYen?: number // 管理費 / month
  repairFundYen?: number // 修繕積立金 / month
  monthlyFeesYen?: number // management + repair, computed
}

const stringOf = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed === '-') return undefined
  return trimmed
}

export const extractHydration = (detail: Record<string, any>): ListingHydration => {
  const h: ListingHydration = {}

  const layout = stringOf(detail['間取り'])
  if (layout !== undefined) h.layout = layout

  for (const k of ['完成時期（築年月）', '完成時期(築年月)', '完成時期', '築年月']) {
    const raw = stringOf(detail[k])
    if (raw === undefined) continue
    const full = raw.match(/(\d{4})年(\d{1,2})月/)
    if (full) {
      h.builtYear = parseInt(full[1], 10)
      h.builtMonth = parseInt(full[2], 10)
      break
    }
    const yearOnly = raw.match(/(\d{4})年/)
    if (yearOnly) {
      h.builtYear = parseInt(yearOnly[1], 10)
      break
    }
  }

  const floorRaw = stringOf(detail['所在階'])
  if (floorRaw !== undefined) {
    const m = floorRaw.match(/(\d+)階/)
    if (m) h.floor = parseInt(m[1], 10)
  }

  const orientation = stringOf(detail['向き'])
  if (orientation !== undefined) h.orientation = orientation

  for (const k of ['構造・階建て', '所在階/構造・階建']) {
    const raw = stringOf(detail[k])
    if (raw !== undefined) { h.buildingStructure = raw; break }
  }

  const useDistrict = stringOf(detail['用途地域'])
  if (useDistrict !== undefined) h.useDistrict = useDistrict

  const parking = stringOf(detail['駐車場'])
  if (parking !== undefined) {
    h.parkingAvailable = !/^(無|なし|無し)$/.test(parking)
  }

  const landRights = stringOf(detail['敷地の権利形態'])
  if (landRights !== undefined) {
    h.isLeasehold = /借地|地上権/.test(landRights)
  }

  const mgmt = stringOf(detail['管理費'])
  if (mgmt !== undefined) {
    const yen = toYen(mgmt)
    if (yen !== null) h.managementFeeYen = yen
  }

  const repair = stringOf(detail['修繕積立金'])
  if (repair !== undefined) {
    const yen = toYen(repair)
    if (yen !== null) h.repairFundYen = yen
  }

  if (h.managementFeeYen !== undefined || h.repairFundYen !== undefined) {
    h.monthlyFeesYen = (h.managementFeeYen ?? 0) + (h.repairFundYen ?? 0)
  }

  return h
}
