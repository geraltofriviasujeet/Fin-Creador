import { describe, expect, it } from "vitest"
import { filtersToQuery, groupByDay, periodRange, readFilters, toApiFilters } from "./filters"

const today = "2026-10-23"
const read = (query: string) => readFilters(new URLSearchParams(query), today)

describe("URL filters", () => {
  it("defaults to all types, this month, no voided", () => {
    expect(read("")).toMatchObject({ type: "all", period: "this-month", showVoided: false, q: "" })
    expect(periodRange(read(""), today)).toEqual({ start: "2026-10-01", end: "2026-10-31" })
  })

  it("ignores unknown values and bad dates", () => {
    expect(read("type=refund&period=forever&from=2026-02-30")).toMatchObject({ type: "all", period: "this-month", from: "2026-10-01" })
  })

  it("round-trips through the query string, leaving defaults out", () => {
    const f = read("type=expense&period=custom&from=2026-09-01&to=2026-09-15&q=rent&voided=1")
    expect(read(filtersToQuery(f).slice(1))).toEqual(f)
    expect(filtersToQuery(read(""))).toBe("")
  })

  it("swaps a custom range given backwards", () => {
    expect(periodRange(read("period=custom&from=2026-09-15&to=2026-09-01"), today)).toEqual({ start: "2026-09-01", end: "2026-09-15" })
  })

  it("last month crosses the year boundary in January", () => {
    expect(periodRange({ period: "last-month", from: "", to: "" }, "2027-01-05")).toEqual({ start: "2026-12-01", end: "2026-12-31" })
  })
})

describe("database filters", () => {
  it("leaves the type out on the All tab and keeps the rest", () => {
    const f = read("type=all&category=c0000000-0000-4000-8000-000000000001&q=rent&voided=1")
    expect(toApiFilters(f, periodRange(f, today))).toEqual({
      from: "2026-10-01", to: "2026-10-31", type: null, categoryId: "c0000000-0000-4000-8000-000000000001",
      accountId: null, query: "rent", includeVoided: true,
    })
  })

  it("drops a category or account that is not an id", () => {
    expect(read("category=1%27%20or%201%3D1&account=x")).toMatchObject({ category: "", account: "" })
  })

  it("groups rows by day, keeping order", () => {
    const rows = [{ occurredOn: "2026-10-23" }, { occurredOn: "2026-10-23" }, { occurredOn: "2026-10-20" }]
    expect(groupByDay(rows).map((g) => [g.date, g.rows.length])).toEqual([["2026-10-23", 2], ["2026-10-20", 1]])
  })
})
