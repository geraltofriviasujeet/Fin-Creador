import { describe, expect, it } from "vitest"
import { balancesWithout, previewDraft } from "./preview"
import type { LedgerAccount, LedgerItem } from "./types"

const acc = (id: string, kind: LedgerAccount["kind"], opening: number, inflow = 0, outflow = 0): LedgerAccount => ({
  id, kind, bankType: kind === "bank" ? "savings" : null, label: id, currency: "INR",
  openingBalanceMinor: opening, openingBalanceDate: "2026-10-01", inflowMinor: inflow, outflowMinor: outflow, archived: false,
})
const bank = acc("bank", "bank", 100000, 0, 25000) // 750.00 now
const cash = acc("cash", "cash", 5000)

describe("previewDraft", () => {
  it("moves both sides of a transfer and warns when cash goes below zero", () => {
    const p = previewDraft({ type: "transfer", amountMinor: 10000, occurredOn: "2026-10-20", account: cash, counter: bank, balances: balancesWithout([bank, cash], null) })
    expect(p.moves.map((m) => [m.account.id, m.before, m.after])).toEqual([["cash", 5000, -5000], ["bank", 75000, 85000]])
    expect(p.goesNegative?.account.id).toBe("cash")
  })

  it("lets a bank go negative without a warning", () => {
    const p = previewDraft({ type: "expense", amountMinor: 100000, occurredOn: "2026-10-20", account: bank, counter: undefined, balances: balancesWithout([bank], null) })
    expect(p.moves[0]?.after).toBe(-25000)
    expect(p.goesNegative).toBeNull()
  })

  it("leaves out an entry dated before the opening balance", () => {
    const p = previewDraft({ type: "income", amountMinor: 1000, occurredOn: "2026-09-30", account: bank, counter: undefined, balances: new Map() })
    expect(p.moves).toEqual([])
    expect(p.beforeOpening.map((a) => a.id)).toEqual(["bank"])
  })

  it("previews an edit against the balance without the version being edited", () => {
    const editing = { id: "e", type: "expense", amountMinor: 25000, occurredOn: "2026-10-05", accountId: "bank", counterAccountId: null, voided: false } as LedgerItem
    expect(balancesWithout([bank], editing).get("bank")).toBe(100000)
  })
})
