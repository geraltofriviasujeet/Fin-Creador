import { describe, expect, it } from "vitest"
import { periodTotals } from "@fin-creador/domain"
import { createDemoData } from "./demo-data"
import { filterForList, filterForSummary, filtersToQuery, groupByDay, matchesSearch, periodRange, readFilters } from "./filters"

const today = "2026-10-23"
const data = createDemoData(today)
const lookup = {
  accounts: new Map(data.accounts.map((a) => [a.id, a])),
  categories: new Map(data.categories.map((c) => [c.id, c])),
}
const read = (query: string) => readFilters(new URLSearchParams(query), today)

describe("demo data", () => {
  it("never has a future date and uses fictional accounts only", () => {
    expect(data.entries.every((e) => e.occurredOn <= today)).toBe(true)
    expect(data.accounts.every((a) => a.label.includes("Demo") || a.kind === "cash")).toBe(true)
  })
})

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

describe("search", () => {
  const groceries = data.entries.find((e) => e.note === "Weekly groceries" && e.amountMinor === 248_000)!
  it.each(["groceries", "GROCER", "demo savings", "₹2,480", "2480", "2,480.00"])("finds %j", (q) => {
    expect(matchesSearch(groceries, q, lookup)).toBe(true)
  })
  it.each(["rent", "2481", "24.80"])("does not find %j", (q) => {
    expect(matchesSearch(groceries, q, lookup)).toBe(false)
  })
})

describe("summary and list", () => {
  it("summary ignores the type tab; the list applies it", () => {
    const f = read("type=expense")
    const summary = filterForSummary(data.entries, f, periodRange(f, today), lookup)
    expect(summary.some((e) => e.type === "income")).toBe(true)
    expect(filterForList(summary, f).every((e) => e.type === "expense")).toBe(true)
  })

  it("shows only the latest version of an edited entry", () => {
    const rows = filterForList(filterForSummary(data.entries, read("q=airport&voided=1"), periodRange(read("q=airport&voided=1"), today), lookup), read("voided=1"))
    expect(rows.map((r) => r.note)).toEqual(["Cab to airport (with toll)"])
  })

  it("hides voided entries unless asked, and never counts them", () => {
    const summary = filterForSummary(data.entries, read("q=pharmacy"), periodRange(read("q=pharmacy"), today), lookup)
    expect(filterForList(summary, read(""))).toHaveLength(1)
    expect(filterForList(summary, read("voided=1"))).toHaveLength(2)
    expect(periodTotals(summary, periodRange(read(""), today), "INR").expenseMinor).toBe(45_000)
  })

  it("an account filter includes transfers into and out of it", () => {
    const rows = filterForSummary(data.entries, read("account=a-cash"), periodRange(read("account=a-cash"), today), lookup)
    expect(rows.some((e) => e.type === "transfer" && e.counterAccountId === "a-cash")).toBe(true)
  })

  it("keeps the history of an archived account and category", () => {
    const rows = filterForSummary(data.entries, read("period=last-month&category=c-gym"), periodRange(read("period=last-month&category=c-gym"), today), lookup)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.accountId).toBe("a-old")
  })

  it("lists newest first, grouped by day", () => {
    const rows = filterForList(filterForSummary(data.entries, read(""), periodRange(read(""), today), lookup), read(""))
    const groups = groupByDay(rows)
    expect(groups[0]!.date).toBe(today)
    expect(groups.map((g) => g.date)).toEqual([...groups.map((g) => g.date)].sort().reverse())
  })
})
