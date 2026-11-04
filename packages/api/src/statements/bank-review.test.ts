import { describe, expect, it } from "vitest"
import { type BankStatementLine, type BankStatementParse, bankStatementLineKey } from "@fin-creador/domain"
import {
  type BankImportMatches,
  type BankImportOptions,
  REFUND_NOTE,
  bankCheckReasons,
  bankLineErrors,
  bankReviewTotals,
  bankSaveBlockers,
  buildBankReview,
  canTickBank,
  offerPayeeLabel,
  setBankLineType,
  statementClosingMinor,
} from "./bank-review"

const ACCOUNT = "a0000000-0000-4000-8000-000000000001"
const line = (date: string, amountMinor: number, direction: "debit" | "credit", description: string, balanceMinor: number, occurrence = 0): BankStatementLine => ({
  date, amountMinor, direction, description, balanceMinor, occurrence,
})
// Newest first, as PNB prints them.
const LINES = [
  line("2026-10-28", 64_900, "debit", "RAVI KUMAR", 6_538_400),
  line("2026-10-27", 233_400, "debit", "CARD PAYMENT PNB RUPAY", 6_603_300),
  line("2026-10-26", 120_000, "credit", "RAVI KUMAR", 6_836_700),
  line("2026-10-25", 500_000, "debit", "IMPS/TRANSFER TO OWN ACCOUNT", 6_716_700),
  line("2026-10-24", 64_900, "debit", "RAVI KUMAR", 7_216_700),
  line("2026-10-23", 178_400, "debit", "FRESH BASKET", 7_281_600),
  line("2026-10-22", 5_000_000, "credit", "NEFT/SALARY OCT/EXAMPLE EMPLOYER PVT LTD", 7_460_000),
  line("2026-09-30", 1_000, "debit", "OLD FEE", 2_460_000),
]
const parse: BankStatementParse = {
  summary: { from: "2026-09-30", to: "2026-10-28", openingMinor: null, closingMinor: 6_538_400 },
  lines: LINES,
  issues: [{ line: 12, reason: "no_amount", shape: "date, text, no amount" }],
  checks: [{ name: "balance_chain", status: "ok", foundMinor: null, expectedMinor: null }],
}
const options: BankImportOptions = {
  expenseCategories: [{ id: "e1", name: "Other expenses", systemKey: null }, { id: "e2", name: "Groceries", systemKey: null }],
  incomeSources: [{ id: "i1", name: "Salary", systemKey: null }],
  accounts: [{ id: "b2", name: "SBI ··1111" }],
  cards: [{ id: "c1", name: "PNB Rupay" }],
}
const context = { accountId: ACCOUNT, openingBalanceDate: "2026-10-01", today: "2026-10-30", currency: "INR" }
const none: BankImportMatches = { importedKeys: [], deletedKeys: [], entries: [], transfers: [], bookBalanceMinor: null }
const keyOf = (i: number) => bankStatementLineKey(ACCOUNT, LINES[i]!)

describe("buildBankReview", () => {
  it("debits start ticked as Other expenses; credits start unticked with no type; early lines are skipped", () => {
    const r = buildBankReview(parse, none, options, context)
    expect(r.lines.map((l) => [l.original.direction, l.status, l.ticked, l.type, l.categoryId])).toEqual([
      ["debit", "new", true, "expense", "e1"],
      ["debit", "new", true, "expense", "e1"],
      ["credit", "new", false, "", ""],
      ["debit", "new", true, "expense", "e1"],
      ["debit", "new", true, "expense", "e1"],
      ["debit", "new", true, "expense", "e1"],
      ["credit", "new", false, "", ""],
      ["debit", "skipped", false, "", ""],
    ])
    expect(r.lines[7]!.skipReason).toBe("before_account")
    expect(r.unreadableRows).toBe(1)
    expect(canTickBank(r.lines[2]!)).toBe(false)
  })

  it("Already imported by key, by deleted key, and by a transfer already recorded from the other account; duplicates start unticked", () => {
    const r = buildBankReview(
      parse,
      {
        ...none,
        importedKeys: [keyOf(0)],
        deletedKeys: [keyOf(1)],
        transfers: [{ date: "2026-10-25", amountMinor: 500_000, direction: "debit" }, { date: "2026-10-26", amountMinor: 120_000, direction: "debit" }],
        entries: [{ date: "2026-10-23", amountMinor: 178_400, direction: "debit" }],
      },
      options,
      context,
    )
    expect(r.lines.slice(0, 6).map((l) => [l.status, l.transferMatch, l.ticked])).toEqual([
      ["imported", false, false],
      ["deleted", false, false],
      ["new", false, false], // a debit transfer never matches a credit line
      ["imported", true, false],
      ["new", false, true],
      ["duplicate", false, false],
    ])
  })

  it("the closing balance warning is soft: shown when the app's balance differs, never a blocker", () => {
    const r = buildBankReview(parse, { ...none, bookBalanceMinor: 6_500_000 }, options, context)
    expect(r.balanceWarning).toBe(
      "In FinCreador this account's balance at the end of the statement (28 Oct 2026) is ₹65,000; the statement's closing balance is ₹65,384. Lines not saved yet, or entries added by hand, can explain it. This doesn't stop Save.",
    )
    expect(buildBankReview(parse, { ...none, bookBalanceMinor: 6_538_400 }, options, context).balanceWarning).toBeNull()
    expect(bankSaveBlockers(r, options, context, false)).toEqual([])
    expect(statementClosingMinor({ ...parse, summary: { ...parse.summary, closingMinor: null } })).toBe(6_538_400)
  })
})

describe("types, payee labels and errors", () => {
  const r = buildBankReview(parse, none, options, context)

  it("a credit becomes tickable once a type is chosen; refund and skip never are", () => {
    const income = setBankLineType(r.lines[2]!, "income", options)
    expect(canTickBank(income)).toBe(true)
    expect(income.ticked).toBe(false)
    expect(canTickBank(setBankLineType(r.lines[2]!, "refund", options))).toBe(false)
    expect(REFUND_NOTE).toMatch(/can't be saved yet/)
    const skipped = setBankLineType(r.lines[0]!, "skip", options)
    expect([skipped.ticked, canTickBank(skipped)]).toEqual([false, false])
  })

  it("labelling a payee offers the same label on its other lines (same direction), unticked, never over the person's own choice", () => {
    let lines = r.lines.map((l, i) => (i === 0 ? { ...setBankLineType(l, "transfer", options), otherAccountId: "b2", ticked: true } : l))
    lines = offerPayeeLabel(lines, 0)
    expect([lines[4]!.type, lines[4]!.otherAccountId, lines[4]!.ticked, lines[4]!.suggested]).toEqual(["transfer", "b2", false, true])
    expect(lines[2]!.type).toBe("") // the same payee's credit is another direction
    const own = r.lines.map((l, i) => (i === 4 ? setBankLineType(l, "expense", options) : i === 0 ? { ...setBankLineType(l, "transfer", options), otherAccountId: "b2" } : l))
    expect(offerPayeeLabel(own, 0)[4]!.suggested).toBe(false)
  })

  it("each type needs its own target", () => {
    const base = { date: "2026-10-20", amount: "100" }
    expect(bankLineErrors({ ...base, type: "", categoryId: "", otherAccountId: "", cardId: "" }, options, context).type).toBe("Choose what this is")
    expect(bankLineErrors({ ...base, type: "income", categoryId: "e1", otherAccountId: "", cardId: "" }, options, context).target).toBe("Choose an income source")
    expect(bankLineErrors({ ...base, type: "transfer", categoryId: "", otherAccountId: ACCOUNT, cardId: "" }, options, context).target).toBe("Choose the other account")
    expect(bankLineErrors({ ...base, type: "card_payment", categoryId: "", otherAccountId: "", cardId: "c1" }, options, context)).toEqual({})
    expect(bankLineErrors({ ...base, date: "2026-09-30", type: "expense", categoryId: "e1", otherAccountId: "", cardId: "" }, options, context).date).toMatch(/opening balance date/)
  })

  it("totals and the check gate", () => {
    const t = bankReviewTotals(r.lines, "INR")
    expect([t.ticked, t.outMinor, t.inMinor, t.needChoice, t.skipped.count]).toEqual([5, 1_041_600, 0, 2, 1])
    const broken = { ...r, checks: [{ name: "balance_chain" as const, status: "mismatch" as const, foundMinor: null, expectedMinor: null, lines: [3] }] }
    expect(bankCheckReasons(broken.checks, LINES, "INR")[0]).toMatch(/^The balances don't follow line by line \(first on 2026-10-25\)/)
    expect(bankSaveBlockers(broken, options, context, false)).toEqual(["check_not_confirmed"])
    expect(bankSaveBlockers(broken, options, context, true)).toEqual([])
    expect(broken.lines.filter((l) => l.ticked)).toHaveLength(5) // a failed check unticks nothing
  })
})
