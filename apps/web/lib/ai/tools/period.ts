import { z } from "zod"
import { type DateRange, type IsoDate, addDays, isIsoDate, monthRange, previousMonthRange, yearRange } from "@fin-creador/domain"
import { ToolError } from "./types"

// The period every period tool takes (Sprint 10.1, shared from 10.2): a named preset or a
// from–to range, inclusive, resolved against the person's own today (their profile time zone).

export const PERIODS = ["this_month", "last_month", "this_year", "last_year", "last_7_days", "last_30_days", "custom"] as const

/** The longest custom range (about five years). */
export const MAX_RANGE_DAYS = 5 * 366

export const periodFields = {
  period: z.enum(PERIODS).describe("The period. Use a named one when it fits; 'custom' needs from and to."),
  from: z.string().optional().describe("First day, YYYY-MM-DD (custom only)."),
  to: z.string().optional().describe("Last day, YYYY-MM-DD (custom only)."),
}

export const periodInput = z.object(periodFields).strict()

export type PeriodInput = z.infer<typeof periodInput>

/** The inclusive range for a period, or why it can't be used. Future days are cut at today. */
export function resolvePeriod(p: PeriodInput, today: IsoDate): { ok: true; range: DateRange } | { ok: false; message: string } {
  switch (p.period) {
    case "this_month":
      return { ok: true, range: { start: monthRange(today).start, end: today } }
    case "last_month":
      return { ok: true, range: previousMonthRange(today) }
    case "this_year":
      return { ok: true, range: { start: yearRange(today).start, end: today } }
    case "last_year":
      return { ok: true, range: yearRange(`${Number(today.slice(0, 4)) - 1}-01-01`) }
    case "last_7_days":
      return { ok: true, range: { start: addDays(today, -6), end: today } }
    case "last_30_days":
      return { ok: true, range: { start: addDays(today, -29), end: today } }
    case "custom": {
      const { from = "", to = "" } = p
      if (!isIsoDate(from) || !isIsoDate(to)) return { ok: false, message: "A custom period needs from and to as YYYY-MM-DD." }
      if (from > to) return { ok: false, message: "from must be on or before to." }
      if (from > today) return { ok: false, message: "That period is in the future." }
      const end = to > today ? today : to
      if (from < addDays(end, -(MAX_RANGE_DAYS - 1))) return { ok: false, message: "A period can be at most five years." }
      return { ok: true, range: { start: from, end } }
    }
  }
}

/** The range for a period, or a ToolError the model sees. */
export function periodRangeOrThrow(p: PeriodInput, today: IsoDate): DateRange {
  const resolved = resolvePeriod(p, today)
  if (!resolved.ok) throw new ToolError(resolved.message)
  return resolved.range
}

export const periodData = (range: DateRange) => ({ from: range.start, to: range.end })
