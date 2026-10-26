import { describe, expect, it } from "vitest"
import { buildBreakdown, dashboardQuery, readDashboardParams, transactionsHref } from "."

const params = (q: string) => new URLSearchParams(q)

describe("readDashboardParams", () => {
  it("defaults to this month", () => {
    expect(readDashboardParams(params(""), "2026-10-26")).toEqual({
      period: "month",
      range: { start: "2026-10-01", end: "2026-10-31" },
      charts: { spending: "bar", flow: "bar", categories: "bars" },
    })
    expect(readDashboardParams(params("period=day"), "2026-10-26").period).toBe("month")
  })
  it("reads week and year", () => {
    expect(readDashboardParams(params("period=week"), "2026-10-26").range).toEqual({ start: "2026-10-26", end: "2026-11-01" })
    expect(readDashboardParams(params("period=year"), "2026-10-26").range).toEqual({ start: "2026-01-01", end: "2026-12-31" })
  })
  it("reads a custom range, in either order, and falls back to month-to-date when it is invalid", () => {
    expect(readDashboardParams(params("period=custom&from=2026-09-30&to=2026-08-01"), "2026-10-26").range).toEqual({
      start: "2026-08-01",
      end: "2026-09-30",
    })
    expect(readDashboardParams(params("period=custom&from=2026-02-30&to=2026-03-01"), "2026-10-26").range).toEqual({
      start: "2026-10-01",
      end: "2026-10-26",
    })
  })
})

describe("chart choices", () => {
  it("reads chart types and ignores unknown ones", () => {
    expect(readDashboardParams(params("spending=line&flow=pie&categories=pie"), "2026-10-26").charts).toEqual({
      spending: "line",
      flow: "bar",
      categories: "pie",
    })
  })
  it("keeps chart types in the query, leaving defaults out", () => {
    const charts = { spending: "line", flow: "bar", categories: "pie" } as const
    expect(dashboardQuery("month", undefined, charts)).toBe("?spending=line&categories=pie")
    expect(dashboardQuery("custom", { start: "2026-08-01", end: "2026-09-30" }, charts)).toBe(
      "?period=custom&from=2026-08-01&to=2026-09-30&spending=line&categories=pie",
    )
  })
})

describe("links", () => {
  it("builds dashboard and transactions query strings", () => {
    expect(dashboardQuery("month")).toBe("")
    expect(dashboardQuery("year")).toBe("?period=year")
    expect(dashboardQuery("custom", { start: "2026-08-01", end: "2026-09-30" })).toBe("?period=custom&from=2026-08-01&to=2026-09-30")
    expect(transactionsHref({ start: "2026-10-01", end: "2026-10-31" }, { type: "expense", categoryId: "c1" })).toBe(
      "/transactions?type=expense&period=custom&from=2026-10-01&to=2026-10-31&category=c1",
    )
  })
})

describe("buildBreakdown", () => {
  const row = (over: Partial<Parameters<typeof buildBreakdown>[0][number]>) => ({
    kind: "day",
    currency: "INR",
    bucket_start: null,
    category_id: null,
    income_minor: 0,
    expense_minor: 0,
    ...over,
  })
  it("keeps the profile currency, fills empty days and notes other currencies", () => {
    const b = buildBreakdown(
      [
        row({ bucket_start: "2026-10-27", expense_minor: 500 }),
        row({ currency: "USD", bucket_start: "2026-10-27", expense_minor: 900 }),
        row({ kind: "category", category_id: "food", expense_minor: 500 }),
        row({ kind: "category", currency: "USD", category_id: "food", expense_minor: 900 }),
      ],
      { start: "2026-10-26", end: "2026-11-01" },
      "INR",
    )
    expect(b.buckets).toHaveLength(7)
    expect(b.buckets[1]).toEqual({ start: "2026-10-27", incomeMinor: 0, expenseMinor: 500 })
    expect(b.buckets.reduce((s, x) => s + x.expenseMinor, 0)).toBe(500)
    expect(b.categories).toEqual([{ categoryId: "food", expenseMinor: 500 }])
    expect(b.otherCurrencies).toEqual(["USD"])
  })
})
