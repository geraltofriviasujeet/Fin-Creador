import { describe, expect, it } from "vitest"
import {
  ACTIVITY_CHIPS,
  activeChip,
  activityApiFilters,
  activityPreviousRange,
  activityRange,
  clearActivityFilters,
  dayTotals,
  hasActivityFilters,
  initialActivityFilters,
  monthChips,
  moreFiltersCount,
  withCustomRange,
  withMonth,
} from "./activity"
import type { LedgerItem } from "./types"

const today = "2026-11-24"
const start = initialActivityFilters(today)

// Demo entries only.
let n = 0
function entry(occurredOn: string, type: LedgerItem["type"], amountMinor: number, extra: Partial<LedgerItem> = {}): LedgerItem {
  n += 1
  return {
    id: `e${n}`,
    type,
    amountMinor,
    currency: "INR",
    occurredOn,
    accountId: "a1",
    counterAccountId: type === "transfer" ? "a2" : null,
    categoryId: null,
    voided: false,
    replacesId: null,
    refundOfId: null,
    note: null,
    paymentMode: null,
    createdAt: "2026-11-24T10:00:00.000000+00:00",
    voidReason: null,
    ...extra,
  }
}

describe("chips", () => {
  it("maps Spent to expenses and Received to income; Refunds have no chip", () => {
    expect(ACTIVITY_CHIPS.map((c) => [c.value, c.label])).toEqual([
      ["all", "All"],
      ["expense", "Spent"],
      ["income", "Received"],
      ["transfer", "Transfers"],
    ])
    expect(activeChip("expense")).toBe("expense")
    expect(activeChip("refund")).toBeNull()
  })

  it("lists this month and earlier, with the year once it changes", () => {
    expect(monthChips(today)).toEqual([
      { month: "2026-11-01", label: "Nov" },
      { month: "2026-10-01", label: "Oct" },
      { month: "2026-09-01", label: "Sep" },
      { month: "2026-08-01", label: "Aug" },
      { month: "2026-07-01", label: "Jul" },
      { month: "2026-06-01", label: "Jun" },
    ])
    expect(monthChips("2027-02-10", 3).map((c) => c.label)).toEqual(["Feb", "Jan", "Dec 2026"])
  })
})

describe("ranges", () => {
  it("opens on this whole month", () => {
    expect(activityRange(start)).toEqual({ range: { start: "2026-11-01", end: "2026-11-30" }, label: "Nov 2026" })
  })

  it("covers a picked month, leap February included", () => {
    expect(activityRange(withMonth(start, "2028-02-17")).range).toEqual({ start: "2028-02-01", end: "2028-02-29" })
  })

  it("searches all time, whatever month is chosen", () => {
    const f = { ...withMonth(start, "2026-09-01"), q: "  chai " }
    expect(activityRange(f)).toEqual({ range: { start: "1900-01-01", end: "9999-12-31" }, label: "All time" })
    expect(activityApiFilters(f)).toMatchObject({ from: "1900-01-01", to: "9999-12-31", query: "chai" })
    expect(activityPreviousRange(f)).toBeNull()
  })

  it("orders a custom range and labels it", () => {
    const f = withCustomRange(start, "2026-11-10", "2026-10-05")
    expect(activityRange(f)).toEqual({ range: { start: "2026-10-05", end: "2026-11-10" }, label: "5 Oct 2026 – 10 Nov 2026" })
    expect(activityPreviousRange(f)).toBeNull()
  })

  it("compares a month with the one before, across the year", () => {
    expect(activityPreviousRange(withMonth(start, "2027-01-01"))).toEqual({ start: "2026-12-01", end: "2026-12-31" })
  })
})

describe("filters", () => {
  it("passes the same database filters as the web", () => {
    const f = { ...start, type: "refund" as const, category: "c1", account: "a1", showVoided: true }
    expect(activityApiFilters(f)).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
      type: "refund",
      categoryId: "c1",
      accountId: "a1",
      query: null,
      includeVoided: true,
    })
    expect(activityApiFilters(start).type).toBeNull()
  })

  it("counts More filters and clears back to the chosen month", () => {
    expect(moreFiltersCount(start)).toBe(0)
    expect(hasActivityFilters(start)).toBe(false)
    const october = { ...withMonth(start, "2026-10-01"), type: "refund" as const, account: "a1", showVoided: true }
    expect(moreFiltersCount(october)).toBe(3)
    expect(clearActivityFilters(october, today)).toEqual({ ...start, month: "2026-10-01" })
    expect(moreFiltersCount(withCustomRange(start, "2026-10-01", "2026-10-15"))).toBe(1)
    expect(clearActivityFilters(withCustomRange(start, "2026-10-01", "2026-10-15"), today)).toEqual(start)
    expect(hasActivityFilters({ ...start, type: "expense" })).toBe(true)
    expect(hasActivityFilters({ ...start, q: "rent" })).toBe(true)
  })
})

describe("dayTotals", () => {
  it("groups by day and totals money in and out, net of refunds", () => {
    const rows = [
      entry("2026-11-24", "expense", 125_050),
      entry("2026-11-24", "income", 500_000),
      entry("2026-11-24", "refund", 25_000),
      entry("2026-11-23", "expense", 9_900),
    ]
    const groups = dayTotals(rows, { currency: "INR", hasMore: false })
    expect(groups.map((g) => [g.date, g.rows.length, g.totals])).toEqual([
      ["2026-11-24", 3, { inMinor: 500_000, outMinor: 100_050 }],
      ["2026-11-23", 1, { inMinor: 0, outMinor: 9_900 }],
    ])
  })

  it("leaves out voided rows, transfers and other currencies", () => {
    const rows = [
      entry("2026-11-24", "expense", 1_000, { voided: true }),
      entry("2026-11-24", "transfer", 50_000),
      entry("2026-11-24", "expense", 2_000, { currency: "USD" }),
      entry("2026-11-24", "expense", 300),
    ]
    expect(dayTotals(rows, { currency: "INR", hasMore: false })[0]?.totals).toEqual({ inMinor: 0, outMinor: 300 })
  })

  it("does not total the last day while more rows may follow", () => {
    const rows = [entry("2026-11-24", "expense", 100), entry("2026-11-20", "expense", 200)]
    expect(dayTotals(rows, { currency: "INR", hasMore: true }).map((g) => g.totals)).toEqual([{ inMinor: 0, outMinor: 100 }, null])
    expect(dayTotals([], { currency: "INR", hasMore: true })).toEqual([])
  })
})
