import { type SafeToSpendInput, safeToSpend } from "@fin-creador/domain"
import { describe, expect, it } from "vitest"
import { billDisplayMinor, heroText, shortWarnings } from "./text"

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
})

describe("heroText", () => {
  it("normal month: ₹4,500 a day, until 1 Dec; ₹3,300 left today; three figures and the spent bar", () => {
    const h = heroText(home({}))
    expect(h.title).toBe("Safe to spend today")
    expect(h.amountMinor).toBe(R(4_500))
    expect(h.suffix).toBe("a day, until 1 Dec")
    expect(h.lines).toEqual(["₹3,300 left today"])
    expect(h.figures).toEqual([
      { label: "At start of today", minor: R(42_000) },
      { label: "Bills due", minor: R(4_000) },
      { label: "For goals", minor: R(2_000) },
    ])
    expect(h.spentBar?.label).toBe("₹1,200 spent today of ₹4,500")
    expect(h.spentBar?.value).toBeCloseTo(1_200 / 4_500, 3)
    expect(h.short).toBe(false)
    expect(h.needsIncomeDate).toBe(false)
    expect(h.label).toBe("Safe to spend today: ₹4,500 a day, until 1 Dec. ₹3,300 left today")
  })

  it("rounds the daily figure down and a shortfall up (whole rupees only on screen)", () => {
    // ₹24,000.10 over 8 days = ₹3,000.01 a day → ₹3,000.
    const h = heroText(home({ accounts: [{ ...base.accounts[0]!, startOfTodayMinor: R(30_000) + 10 }], spentTodayMinor: 0 }))
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
    const h = heroText(home({ accounts: [{ ...base.accounts[0]!, startOfTodayMinor: R(4_000) - 1 }], goals: [] }))
    expect(h.lines[0]).toBe("₹1 short before 1 Dec in HDFC Savings")
  })

  it("no income date: money left this month with the 'Set your income date' prompt and no daily figure", () => {
    const h = heroText(home({ incomes: [] }))
    expect(h.title).toBe("Money left this month")
    expect(h.amountMinor).toBe(R(36_000))
    expect(h.suffix).toBeNull()
    expect(h.spentBar).toBeNull()
    expect(h.needsIncomeDate).toBe(true)
  })

  it("spending past today's figure says how far over, never a negative 'left'", () => {
    const h = heroText(home({ spentTodayMinor: R(5_000) }))
    expect(h.lines).toEqual(["₹500 over today's figure"])
    expect(h.spentBar?.value).toBeGreaterThan(1)
  })

  it("payday before the salary is recorded says so", () => {
    const h = heroText(home({ incomes: [{ ...salary, schedule: { ...salary.schedule, startDate: "2026-01-23" } }] }))
    expect(h.lines).toContain("Income due today isn't counted until you record it.")
  })
})
