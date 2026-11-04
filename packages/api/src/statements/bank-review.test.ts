import { describe, expect, it } from "vitest"
import { type BankStatementLine, type BankStatementParse, bankStatementLineKey, parseBankStatementCsv } from "@fin-creador/domain"
import {
  type BankImportMatches,
  type BankImportOptions,
  REFUND_NOTE,
  bankCheckReasons,
  bankLineErrors,
  bankLinesShown,
  bankReviewTotals,
  bankSaveBlockers,
  buildBankReview,
  canTickBank,
  offerPayeeLabel,
  reviewPage,
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
const none: BankImportMatches = { importedKeys: [], deletedKeys: [], entries: [], transfers: [], bookBalanceMinor: null, refundCandidates: [] }
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

  it("matches count occurrences: N ledger transfers (or entries) mark only the first N identical lines", () => {
    const twin = line("2026-10-25", 500_000, "debit", "IMPS/TRANSFER TO OWN ACCOUNT", 6_216_700, 1)
    const twins: BankStatementParse = { ...parse, lines: [twin, ...LINES] }
    const transfer = { date: "2026-10-25", amountMinor: 500_000, direction: "debit" as const }
    const statusOf = (m: BankImportMatches) => {
      const r = buildBankReview(twins, m, options, context)
      return [0, 4].map((i) => [r.lines[i]!.status, r.lines[i]!.transferMatch, canTickBank(r.lines[i]!)])
    }
    expect(statusOf(none)).toEqual([["new", false, true], ["new", false, true]])
    expect(statusOf({ ...none, transfers: [transfer] })).toEqual([["imported", true, false], ["new", false, true]])
    expect(statusOf({ ...none, transfers: [transfer, transfer] })).toEqual([["imported", true, false], ["imported", true, false]])

    const entry = { date: "2026-10-25", amountMinor: 500_000, direction: "debit" as const }
    expect(statusOf({ ...none, entries: [entry] })).toEqual([["duplicate", false, true], ["new", false, true]])
    expect(statusOf({ ...none, entries: [entry, entry] })).toEqual([["duplicate", false, true], ["duplicate", false, true]])
    expect(statusOf({ ...none, transfers: [transfer], entries: [entry] })).toEqual([["imported", true, false], ["duplicate", false, true]])
  })

  it("the closing balance warning is soft: shown when the app's balance differs, never a blocker", () => {
    const r = buildBankReview(parse, { ...none, bookBalanceMinor: 6_500_000 }, options, context)
    expect(r.balanceWarning).toBe(
      "Your FinCreador balance differs from the bank's: on 28 Oct 2026 FinCreador shows ₹65,000 for this account, and the statement ends at ₹65,384. Lines not saved yet, or entries added by hand, can explain it. This doesn't stop Save.",
    )
    expect(buildBankReview(parse, { ...none, bookBalanceMinor: 6_538_400 }, options, context).balanceWarning).toBeNull()
    expect(bankSaveBlockers(r, options, context, false)).toEqual([])
    expect(statementClosingMinor({ ...parse, summary: { ...parse.summary, closingMinor: null } })).toBe(6_538_400)
  })
})

describe("types, payee labels and errors", () => {
  const r = buildBankReview(parse, none, options, context)

  it("a credit becomes tickable once a type is chosen, a refund too; skip never is", () => {
    const income = setBankLineType(r.lines[2]!, "income", options)
    expect(canTickBank(income)).toBe(true)
    expect(income.ticked).toBe(false)
    const refund = setBankLineType(r.lines[2]!, "refund", options)
    expect([canTickBank(refund), refund.ticked, refund.categoryId, refund.refundOfId]).toEqual([true, false, "", ""])
    expect(bankLineErrors(refund, options, context)).toEqual({ target: "Choose a category" })
    expect(REFUND_NOTE).toMatch(/isn't income/)
    const skipped = setBankLineType(r.lines[0]!, "skip", options)
    expect([skipped.ticked, canTickBank(skipped)]).toEqual([false, false])
  })

  it("a refund takes the purchase with exactly its amount left (and its category); a payee label never copies the link", () => {
    const purchase = { id: "p1", date: "2026-10-20", amountMinor: 120_000, leftMinor: 120_000, categoryId: "e2", note: "RAVI KUMAR" }
    const refund = setBankLineType(r.lines[2]!, "refund", options, [purchase])
    expect([refund.refundOfId, refund.categoryId]).toEqual(["p1", "e2"])
    const later = setBankLineType(r.lines[2]!, "refund", options, [{ ...purchase, date: "2026-10-27" }])
    expect(later.refundOfId).toBe("") // a purchase after the refund can't be the one refunded
    const twin = { ...r.lines[2]!, key: "twin" }
    const offered = offerPayeeLabel([{ ...refund, ticked: true }, twin], 0)
    expect([offered[1]!.type, offered[1]!.categoryId, offered[1]!.refundOfId]).toEqual(["refund", "e2", ""])
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

describe("the statement's own figures and the app's balance are worded apart", () => {
  it("a mismatch in the statement's own Opening or Closing Balance says the statement doesn't add up; the app warning names FinCreador", () => {
    const own = bankCheckReasons(
      [
        { name: "opening", status: "mismatch", foundMinor: 100, expectedMinor: 200 },
        { name: "closing", status: "mismatch", foundMinor: 300, expectedMinor: 400 },
      ],
      LINES,
      "INR",
    )
    for (const reason of own) {
      expect(reason).toMatch(/^The statement doesn't add up: its lines (start from|end at) .+, but its own (Opening|Closing) Balance is /)
      expect(reason).not.toMatch(/FinCreador/)
    }
    const warning = buildBankReview(parse, { ...none, bookBalanceMinor: 6_500_000 }, options, context).balanceWarning!
    expect(warning).toMatch(/^Your FinCreador balance differs from the bank's/)
    expect(warning).not.toMatch(/doesn't add up|Closing Balance/)
  })
})

describe("a 1,200-line statement: filters and pages", () => {
  // An invented year of lines, oldest first, separate withdrawal and deposit columns, balances with
  // thousand commas: every 4th line a salary-style credit, every 10th a repeat payee credit.
  const N = 1_200
  const rows = ["Date,Narration,Ref No,Withdrawal Amt.,Deposit Amt.,Closing Balance"]
  let balance = 10_000_000
  const day = (i: number) => {
    const d = new Date(Date.UTC(2025, 10, 1) + Math.floor(i / 4) * 86_400_000)
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`
  }
  const rupees = (minor: number) => (minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })
  for (let i = 0; i < N; i++) {
    const credit = i % 4 === 0
    const amount = 10_000 + (i % 7) * 1_550
    balance += credit ? amount : -amount
    const payee = credit ? (i % 20 === 0 ? "UPI/CR/EXAMPLE FRIEND" : `NEFT/CR/PAYER ${i}`) : `UPI/DR/SHOP ${i % 50}`
    rows.push(`${day(i)},"${payee}",REF${i},${credit ? "" : rupees(amount)},${credit ? rupees(amount) : ""},"${rupees(balance)}"`)
  }
  const parsed = parseBankStatementCsv(rows.join("\n"))
  const ctx = { ...context, openingBalanceDate: "2025-01-01", today: "2026-10-30" }
  const credits = N / 4

  it("reads every line with the balance chain holding", () => {
    expect(parsed.lines).toHaveLength(N)
    expect(parsed.issues).toEqual([])
    expect(parsed.checks.find((c) => c.name === "balance_chain")!.status).toBe("ok")
  })

  it("All, Need a choice, Ticked and Possible duplicates show the right lines, and pages cover them 100 at a time", () => {
    const dup = parsed.lines[5]!
    const r = buildBankReview(parsed, { ...none, entries: [{ date: dup.date, amountMinor: dup.amountMinor, direction: dup.direction }] }, options, ctx)
    expect(bankLinesShown(r.lines, "all")).toHaveLength(N)
    expect(bankLinesShown(r.lines, "choice")).toHaveLength(credits)
    expect(bankLinesShown(r.lines, "choice").every(({ line }) => line.original.direction === "credit")).toBe(true)
    expect(bankLinesShown(r.lines, "ticked")).toHaveLength(N - credits - 1) // the duplicate starts unticked
    expect(bankLinesShown(r.lines, "duplicates").map(({ index }) => index)).toEqual([5])

    // Labelling one repeat payee offers the label on its other lines: they stay in Need a choice (suggested, unticked).
    const friend = r.lines.findIndex((l) => l.original.description === "UPI/CR/EXAMPLE FRIEND")
    const labelled = offerPayeeLabel(r.lines.map((l, i) => (i === friend ? { ...setBankLineType(l, "income", options), categoryId: "i1", ticked: true } : l)), friend)
    const repeats = r.lines.filter((l) => l.original.description === "UPI/CR/EXAMPLE FRIEND").length
    expect(labelled.filter((l) => l.suggested)).toHaveLength(repeats - 1)
    expect(bankLinesShown(labelled, "choice")).toHaveLength(credits - 1)
    expect(bankLinesShown(labelled, "ticked")).toHaveLength(N - credits)

    // Each shown line keeps its place in the review, so a change on page 7 lands on the right line.
    const choice = bankLinesShown(labelled, "choice")
    expect(choice.every(({ line, index }) => labelled[index] === line)).toBe(true)

    expect(reviewPage(N, 0, 100)).toEqual({ current: 0, pages: 12, from: 0, to: 100 })
    expect(reviewPage(N, 11, 100)).toEqual({ current: 11, pages: 12, from: 1_100, to: 1_200 })
    expect(reviewPage(credits - 1, 5, 100)).toEqual({ current: 2, pages: 3, from: 200, to: 299 }) // a narrower filter keeps the page in range
    expect(reviewPage(0, 3, 100)).toEqual({ current: 0, pages: 1, from: 0, to: 0 })
  })
})
