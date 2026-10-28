import { DEFAULT_REPORT_MONTHS, type IsoDate, MAX_REPORT_MONTHS, monthStart, monthsBetween } from "@fin-creador/domain"

// The Reports range (Sprint 8c): whole calendar months ending this month by default (?months=
// 3, 6, 12 or 24), or a custom span (?from=2026-01&to=2026-10), at most 24 months, never
// past the current month.

type Params = Pick<URLSearchParams, "get">

export const REPORT_PRESETS = [3, 6, 12, 24] as const

export type ReportsRange = {
  /** First and last month starts, inclusive. */
  from: IsoDate
  to: IsoDate
  months: IsoDate[]
  preset: (typeof REPORT_PRESETS)[number] | null
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

export function readReportsParams(params: Params, today: IsoDate): ReportsRange {
  const current = monthStart(today)
  const from = params.get("from")
  const to = params.get("to")
  if (from && to && MONTH.test(from) && MONTH.test(to)) {
    let start = `${from}-01`
    let end = `${to}-01`
    if (start > end) [start, end] = [end, start]
    if (end > current) end = current
    if (start > end) start = end
    const earliest = monthStart(end, -(MAX_REPORT_MONTHS - 1))
    if (start < earliest) start = earliest
    return { from: start, to: end, months: monthsBetween(start, end), preset: null }
  }
  const asked = Number(params.get("months"))
  const preset = (REPORT_PRESETS as readonly number[]).includes(asked) ? (asked as ReportsRange["preset"] & number) : DEFAULT_REPORT_MONTHS
  const start = monthStart(current, -(preset - 1))
  return { from: start, to: current, months: monthsBetween(start, current), preset: preset as ReportsRange["preset"] }
}
