import { describe, expect, it } from "vitest"
import type { IncomeAccount, IncomeEntryItem, IncomeSourceItem } from "./types"
import { accountTypeLabel, buildIncomePageView } from "./view"

// The Income page's server-built view: what the charts show must equal the tables' Total rows
// and Total available, to the paisa. Demo figures only.

const today = "2026-11-21"
const account = (over: Partial<IncomeAccount>): IncomeAccount => ({
  id: "a",
  kind: "bank",
  bankType: "savings",
  currency: "INR",
  openingBalanceMinor: 0,
  openingBalanceDate: "2026-01-01",
  archived: false,
  inflowMinor: 0,
  outflowMinor: 0,
  name: "Demo Bank",
  institution: null,
  last4: null,
  label: "Demo Bank",
  lastActivityAt: "2026-11-20T10:00:00Z",
  ...over,
})
const accounts = [
  account({ id: "hdfc", name: "HDFC Bank", last4: "4821", label: "HDFC Bank ··4821", openingBalanceMinor: 24_860_050 }),
  account({ id: "od", name: "ICICI Bank", bankType: "current", label: "ICICI Bank", openingBalanceMinor: -1_250_000 }),
  account({ id: "cash", kind: "cash", bankType: null, name: "Cash in hand", label: "Cash in hand", openingBalanceMinor: 150_000 }),
  account({ id: "usd", kind: "other", bankType: null, name: "US account", label: "US account", currency: "USD", openingBalanceMinor: 90_000 }),
  account({ id: "old", name: "Closed bank", label: "Closed bank", archived: true, openingBalanceMinor: 5_000_000 }),
]
const src = (id: string, name: string, isDefault = true): IncomeSourceItem => ({ id, name, sourceType: "other", defaultAccountId: null, isDefault, archived: false })
const sources = Array.from({ length: 8 }, (_, i) => src(`s${i}`, `Source ${i}`))
let n = 0
const entry = (sourceId: string, amountMinor: number, occurredOn = today, note: string | null = null): IncomeEntryItem => ({
  id: `e${++n}`,
  amountMinor,
  currency: "INR",
  occurredOn,
  sourceId,
  accountId: "hdfc",
  voided: false,
  note,
  voidReason: null,
  edited: false,
})
const entries = [
  ...sources.map((s, i) => entry(s.id, (i + 1) * 100_001)),
  entry("s0", 7_777_777, "2026-03-15"),
  entry("s1", 42, "2025-06-01"),
]
const data = { currency: "INR", today, accounts, sources, entries }
const rules = [{ type: "income", categoryId: "s7", amountMinor: 5_000_000, currency: "INR", frequency: "monthly" as const, endDate: null, archived: false }]

describe("buildIncomePageView: accounts", () => {
  const view = buildIncomePageView(data, rules).accounts

  it("archived accounts are not in the chart or the table", () => {
    expect(view.rows.map((r) => r.account.id)).toEqual(["hdfc", "od", "cash", "usd"])
    expect(view.archived.map((a) => a.id)).toEqual(["old"])
  })

  it("Total available = the sum of balances in the total; another currency is listed but not added", () => {
    expect(view.totalAvailableMinor).toBe(24_860_050 - 1_250_000 + 150_000)
    const charted = view.rows.filter((r) => r.bar !== null)
    expect(charted.map((r) => r.account.id)).toEqual(["hdfc", "od", "cash"])
    expect(charted.reduce((s, r) => s + r.balanceMinor, 0)).toBe(view.totalAvailableMinor)
    expect(view.rows.find((r) => r.account.id === "usd")).toMatchObject({ inTotal: false, bar: null })
  })

  it("a negative balance draws left of the zero line", () => {
    const od = view.rows.find((r) => r.account.id === "od")!
    expect(od.balanceMinor).toBe(-1_250_000)
    expect(view.zeroBp).toBeGreaterThan(0)
    expect(od.bar!.startBp + od.bar!.lengthBp).toBe(view.zeroBp)
    expect(view.rows.find((r) => r.account.id === "hdfc")!.bar!.startBp).toBe(view.zeroBp)
  })

  it("type labels", () => {
    expect(view.rows.map((r) => r.typeLabel)).toEqual(["Savings", "Current", "Cash", "Other"])
    expect(accountTypeLabel({ kind: "bank", bankType: null })).toBe("Bank")
  })
})

describe("buildIncomePageView: income by period", () => {
  it("month and year always; All time only when asked for", () => {
    expect(buildIncomePageView(data, rules).periods.all).toBeUndefined()
    expect(buildIncomePageView(data, rules, { allTime: true }).periods.all?.rangeLabel).toBe("All recorded income")
  })

  it("chart bars, table rows and the period total agree exactly, in every period", () => {
    const { periods } = buildIncomePageView(data, rules, { allTime: true })
    const expected = { month: 3_600_036, year: 3_600_036 + 7_777_777, all: 3_600_036 + 7_777_777 + 42 }
    for (const key of ["month", "year", "all"] as const) {
      const p = periods[key]!
      expect(p.totalMinor).toBe(expected[key])
      expect(p.bars.reduce((s, b) => s + b.amountMinor, 0)).toBe(p.totalMinor)
      expect(p.rows.reduce((s, r) => s + r.amountMinor, 0)).toBe(p.totalMinor)
    }
  })

  it("top 6 sources have their own colour, the rest share Other in both chart and table", () => {
    const month = buildIncomePageView(data, rules).periods.month
    expect(month.bars).toHaveLength(7)
    expect(month.bars.at(-1)).toMatchObject({ key: "other", label: "Other", amountMinor: 100_001 + 200_002, colorIndex: null })
    expect(month.rows.map((r) => r.color)).toEqual([0, 1, 2, 3, 4, 5, "other", "other"])
  })

  it("Repeats comes from a linked recurring rule, else none (one-off)", () => {
    const month = buildIncomePageView(data, rules).periods.month
    expect(month.rows.find((r) => r.sourceId === "s7")?.repeats).toEqual(["₹50,000 / month"])
    expect(month.rows.find((r) => r.sourceId === "s0")?.repeats).toEqual([])
  })

  it("labels: calendar month and the calendar year (as the old Income this year card)", () => {
    const { periods } = buildIncomePageView(data, rules)
    expect(periods.month.rangeLabel).toBe("November 2026")
    expect(periods.year.rangeLabel).toBe("January – December 2026")
  })
})
