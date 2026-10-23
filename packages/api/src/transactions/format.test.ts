import { describe, expect, it } from "vitest"
import type { Lookup } from "./filters"
import { accountChipText, dayHeading, entryKindLabel, entryTitle, fullDate, signedAmount } from "./format"
import type { LedgerItem } from "./types"

const lookup: Lookup = {
  accounts: new Map([
    ["bank", { id: "bank", kind: "bank", bankType: "savings", label: "HDFC Bank ··4821", currency: "INR", openingBalanceMinor: 0, openingBalanceDate: "2026-01-01", inflowMinor: 0, outflowMinor: 0, archived: false }],
    ["cash", { id: "cash", kind: "cash", bankType: null, label: "Cash in hand", currency: "INR", openingBalanceMinor: 0, openingBalanceDate: "2026-01-01", inflowMinor: 0, outflowMinor: 0, archived: true }],
  ]),
  categories: new Map([["food", { id: "food", kind: "expense", name: "Food & dining", icon: "food", archived: true, defaultAccountId: null, key: null }]]),
}
const entry = (over: Partial<LedgerItem>): LedgerItem => ({
  id: "e", type: "expense", amountMinor: 248000, currency: "INR", occurredOn: "2026-10-16", accountId: "bank",
  counterAccountId: null, categoryId: "food", voided: false, replacesId: null, note: null, paymentMode: "upi",
  createdAt: "2026-10-16T10:00:00.123456+00:00", voidReason: null, ...over,
})

describe("entry text", () => {
  it("names the entry by note, else category, else Transfer", () => {
    expect(entryTitle(entry({ note: "Lunch" }), lookup)).toBe("Lunch")
    expect(entryTitle(entry({}), lookup)).toBe("Food & dining")
    expect(entryTitle(entry({ type: "transfer", categoryId: null }), lookup)).toBe("Transfer")
  })

  it("shows payment mode and accounts, marking archived ones", () => {
    expect(accountChipText(entry({}), lookup)).toBe("UPI · HDFC Bank ··4821")
    expect(accountChipText(entry({ type: "transfer", counterAccountId: "cash", paymentMode: null }), lookup)).toBe("HDFC Bank ··4821 → Cash in hand (archived)")
    expect(entryKindLabel(entry({}), lookup)).toBe("Food & dining (archived)")
  })

  it("signs expenses and income, never transfers", () => {
    expect(signedAmount(entry({}))).toMatch(/^[−-]₹2,480$/)
    expect(signedAmount(entry({ type: "income" }))).toBe("+₹2,480")
    expect(signedAmount(entry({ type: "transfer" }))).toBe("₹2,480")
  })

  it("writes calendar dates without time zones", () => {
    expect(fullDate("2026-10-16")).toBe("16 Oct 2026")
    expect(dayHeading("2026-10-23", "2026-10-23")).toBe("Today")
    expect(dayHeading("2026-10-22", "2026-10-23")).toBe("Yesterday")
    expect(dayHeading("2026-10-16", "2026-10-23")).toBe("Fri, 16 Oct")
    expect(dayHeading("2025-12-31", "2026-01-01")).toBe("Yesterday")
    expect(dayHeading("2025-12-30", "2026-01-01")).toBe("Tue, 30 Dec 2025")
  })
})
