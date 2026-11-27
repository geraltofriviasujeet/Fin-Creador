import { type SafeToSpendInput, safeToSpend } from "@fin-creador/domain"
import { describe, expect, it } from "vitest"
import { AFTER_BILLS_LINE, LIMIT_NOTE, billDisplayMinor, heroText, shortWarnings } from "./text"
import type { HomeSpendLimit } from "./view"

// Safe to spend's wording (phone Home and web Overview) from the shared safeToSpend result (demo figures, sprint-plan examples).
const R = (rupees: number) => rupees * 100
const now = new Date("2026-11-23T06:30:00Z"); // Monday 23 Nov, 12:00 in Asia/Kolkata
const salary = {
  id: "salary", name: "Salary", amountMinor: R(85_000), currency: "INR", archived: false, recordedToday: [],
  schedule: { frequency: "monthly" as const, startDate: "2026-01-01", endDate: null },
}
const base: SafeToSpendInput = {
  now, timeZone: "Asia/Kolkata", currency: "INR",
  accounts: [{ id: "hdfc", name: "HDFC Savings", kind: "bank", currency: "INR", archived: false, startOfTodayMinor: R(42_000) }],
  incomes: [salary],
  bills: [{ id: "power", name: "Electricity", dueDate: "2026-11-25", amountMinor: R(4_000), currency: "INR", accountId: "hdfc" }],
  goals: [{ id: "g", name: "Emergency fund", monthlySavingMinor: R(2_000), currency: "INR", contributions: [] }],
  spentTodayMinor: R(1_200),
}
const home = (input: Partial<SafeToSpendInput>, spentTodayMinor = input.spentTodayMinor ?? base.spentTodayMinor) => ({
  safe: safeToSpend({ ...base, ...input }),
  currency: "INR",
  spentTodayMinor,
  limit: null as HomeSpendLimit | null,
})

describe("heroText", () => {
  it("normal month (final rule): (₹42,000 − ₹4,000) ÷ 8 = ₹4,750 a day, until 1 Dec; ₹3,550 left today; figures and the spent bar", () => {
    const h = heroText(home({}))
    expect(h.title).toBe("Safe to spend today")
    expect(h.amountMinor).toBe(R(4_750))
    expect(h.suffix).toBe("a day, until 1 Dec")
    expect(h.lines).toEqual([AFTER_BILLS_LINE, "₹3,550 left today"])
    expect(h.note).toBeNull()
    expect(h.figures).toEqual([
      { label: "At start of today", minor: R(42_000) },
      { label: "Bills due", minor: R(4_000) },
      { label: "For goals", minor: R(2_000) },
    ])
    expect(h.spentBar?.label).toBe("₹1,200 spent today of ₹4,750")
    expect(h.spentBar?.value).toBeCloseTo(1_200 / 4_750, 3)
    expect(h.short).toBe(false)
    expect(h.label).toBe(
      "Safe to spend today: ₹4,750 a day, until 1 Dec. After you pay your bills, you can spend this much each day. ₹3,550 left today",
    )
  })

  it("rounds the daily figure down and a shortfall up (whole rupees only on screen)", () => {
    // ₹24,000.10 over 8 days = ₹3,000.01 a day → ₹3,000.
    const h = heroText(home({ accounts: [{ ...base.accounts[0]!, startOfTodayMinor: R(28_000) + 10 }], spentTodayMinor: 0 }))
    expect(h.amountMinor).toBe(R(3_000))
  })

  it("bills with paise: each row and Bills due round up the same way, so the rows add up", () => {
    // An EMI of ₹11,423.40 and a phone bill of ₹600.30: exact total ₹12,023.70.
    const bills = [
      { id: "emi", name: "Education EMI", dueDate: "2026-11-25", amountMinor: R(11_423) + 40, currency: "INR", accountId: "hdfc" },
      { id: "phone", name: "Phone", dueDate: "2026-11-27", amountMinor: R(600) + 30, currency: "INR", accountId: "hdfc" },
    ]
    const h = home({ bills })
    expect(h.safe.billsMinor).toBe(R(12_023) + 70) // the maths stays exact
    expect(bills.map(billDisplayMinor)).toEqual([R(11_424), R(601)])
    // ₹11,424 + ₹601, not the exact total rounded up (₹12,024).
    expect(heroText(h).figures[1]).toEqual({ label: "Bills due", minor: R(12_025) })
    // A single bill: the row and the total are the same figure.
    const one = heroText(home({ bills: [bills[0]!] }))
    expect(one.figures[1]!.minor).toBe(billDisplayMinor(bills[0]!))
    // Whole-rupee bills are unchanged.
    expect(billDisplayMinor({ amountMinor: R(4_000), currency: "INR" })).toBe(R(4_000))
  })

  it("below zero: ₹0 a day and '₹3,000 short before 1 Dec in HDFC Savings', with the runs-short warning", () => {
    const input = {
      accounts: [{ ...base.accounts[0]!, startOfTodayMinor: R(9_000) }],
      bills: [{ id: "rent", name: "Rent", dueDate: "2026-11-28", amountMinor: R(12_000), currency: "INR", accountId: "hdfc" }],
      goals: [],
    }
    const h = heroText(home(input))
    expect(h.amountMinor).toBe(0)
    expect(h.lines[0]).toBe("₹3,000 short before 1 Dec in HDFC Savings")
    expect(h.short).toBe(true)
    expect(h.spentBar).toBeNull()
    expect(shortWarnings(home(input))).toEqual(["Rent on 28 Nov leaves you ₹3,000 short in HDFC Savings"])
  })

  it("a shortfall of paise still shows a whole rupee short", () => {
    const h = heroText(home({ accounts: [{ ...base.accounts[0]!, startOfTodayMinor: R(4_000) - 1 }] }))
    expect(h.lines[0]).toBe("₹1 short before 1 Dec in HDFC Savings")
  })

  it("no income date: a daily figure to the month's end (no prompt: income is added when it arrives)", () => {
    const h = heroText(home({ incomes: [] }))
    expect(h.title).toBe("Safe to spend today")
    expect(h.amountMinor).toBe(R(4_750))
    expect(h.suffix).toBe("a day, until 1 Dec")
    expect(h.spentBar?.label).toBe("₹1,200 spent today of ₹4,750")
  })

  it("no income date and short: '₹X short before 1 Dec' (the day after the month's end)", () => {
    const h = heroText(home({ incomes: [], accounts: [{ ...base.accounts[0]!, startOfTodayMinor: R(1_000) }] }))
    expect(h.lines[0]).toBe("₹3,000 short before 1 Dec in HDFC Savings")
    expect(h.short).toBe(true)
  })

  it("spending past today's figure says how far over, never a negative 'left'", () => {
    const h = heroText(home({ spentTodayMinor: R(5_000) }))
    expect(h.lines).toEqual([AFTER_BILLS_LINE, "₹250 over today's figure"])
    expect(h.spentBar?.value).toBeGreaterThan(1)
  })

  it("payday before the salary is recorded says so", () => {
    const h = heroText(home({ incomes: [{ ...salary, schedule: { ...salary.schedule, startDate: "2026-01-23" } }] }))
    expect(h.lines).toContain("Income due today isn't counted until you record it.")
  })

  it("payday-pending line keeps one full stop in the screen-reader label", () => {
    const h = heroText(home({ incomes: [{ ...salary, schedule: { ...salary.schedule, startDate: "2026-01-23" } }] }))
    expect(h.label).not.toContain("..")
  })
})

describe("heroText with a daily spend limit", () => {
  const limit = (dailyMinor: number, spentTodayMinor: number, exceedsMoneyAfterBills = false): HomeSpendLimit => ({
    amountMinor: R(7_000), currency: "INR", period: "week", periodDays: 7, startsOn: "2026-11-20",
    today: { period: { start: "2026-11-20", end: "2026-11-26" }, daysLeft: 4, spentEarlierMinor: 0, spentTodayMinor, dailyMinor, leftTodayMinor: dailyMinor - spentTodayMinor },
    exceedsMoneyAfterBills,
  })

  it("only '₹X left of your ₹Y daily limit' with the spent bar: no after-bills line, no shortfall", () => {
    const h = heroText({ ...home({}), limit: limit(R(1_750) + 50, R(1_200)) })
    expect(h.amountMinor).toBe(R(550))
    expect(h.suffix).toBe("left of your ₹1,750 daily limit")
    expect(h.lines).toEqual([])
    expect(h.short).toBe(false)
    expect(h.note).toBeNull()
    expect(h.spentBar?.label).toBe("₹1,200 spent today of ₹1,750")
    expect(h.spentBar?.value).toBeCloseTo(1_200 / 1_750.5, 3)
    // The figures row stays as it is.
    expect(h.figures.map((f) => f.label)).toEqual(["At start of today", "Bills due", "For goals"])
    expect(h.label).toBe("Safe to spend today: ₹550 left of your ₹1,750 daily limit")
  })

  it("even when Safe to spend is short, the limit card shows no shortfall", () => {
    const short = home({ accounts: [{ ...base.accounts[0]!, startOfTodayMinor: R(1_000) }] })
    const h = heroText({ ...short, limit: limit(R(1_000), 0) })
    expect(h.short).toBe(false)
    expect(h.lines).toEqual([])
    expect(h.amountMinor).toBe(R(1_000))
  })

  it("over the limit: ₹0 left and how far over", () => {
    const h = heroText({ ...home({}), limit: limit(R(1_000), R(1_200)) })
    expect(h.amountMinor).toBe(0)
    expect(h.lines).toEqual(["₹200 over today's limit"])
    expect(h.spentBar?.value).toBeGreaterThan(1)
  })

  it("the period's amount used up: ₹0 daily limit, a full bar once anything is spent", () => {
    const h = heroText({ ...home({}), limit: limit(0, R(50)) })
    expect(h.suffix).toBe("left of your ₹0 daily limit")
    expect(h.spentBar?.value).toBe(1)
  })

  it("the safety note, quiet and separate from the lines", () => {
    const h = heroText({ ...home({}), limit: limit(R(5_000), 0, true) })
    expect(h.note).toBe(LIMIT_NOTE)
    expect(h.lines).toEqual([])
    expect(h.label).toBe("Safe to spend today: ₹5,000 left of your ₹5,000 daily limit. Your limit is more than you have left after bills")
  })
})
