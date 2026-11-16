import { type UpiRow, type UpiStatementParse, upiRowKey } from "@fin-creador/domain"
import { PAYTM_TAG_SLOTS, merchantSlot, paytmTagSlot } from "@fin-creador/schemas"
import { describe, expect, it } from "vitest"
import {
  type UpiAccountMatch,
  type UpiImportOptions,
  type UpiMatches,
  answerDuplicates,
  buildUpiReview,
  namesToSuggest,
  ruleCategory,
  slotCategoryId,
  upiAccountsNeeded,
  upiLineErrors,
  upiLiteNeeded,
  upiReviewTotals,
} from "./upi-review"

// The UPI review (Sprint 9e) on synthetic payments: invented payees, references and digits.

const cat = (id: string, name: string, icon: string | null, key: string | null = null) => ({ id, name, systemKey: null, icon, key })
const options: UpiImportOptions = {
  accounts: [
    { id: "bank", name: "Example Bank ··1234", kind: "bank", openingBalanceDate: "2026-01-01" },
    { id: "other-bank", name: "Other Bank ··5678", kind: "bank", openingBalanceDate: "2026-01-01" },
    { id: "lite", name: "UPI Lite", kind: "other", openingBalanceDate: "2026-01-01" },
    { id: "late", name: "New Bank", kind: "bank", openingBalanceDate: "2026-10-14" },
  ],
  expenseCategories: [
    cat("food", "Food & dining", "food"),
    cat("groceries", "Groceries", "groceries"),
    cat("transport", "Transport & Cabs", "transport"),
    cat("bills", "Utilities & bills", "bills"),
    cat("medical", "Medical", "health"),
    cat("shopping", "Shopping", "shopping"),
    cat("misc", "Miscellaneous", "other"),
    cat("services", "Services", "services", "services"),
    cat("sent", "Money sent to people", "money_sent", "money_sent"),
    cat("fun", "Entertainment", "fun"),
  ],
  incomeSources: [
    { id: "salary", name: "Salary", systemKey: null, sourceType: "salary" },
    { id: "other-income", name: "Other income", systemKey: null, sourceType: "other" },
  ],
}
const context = { today: "2026-10-31", currency: "INR" }
const bankMatch: UpiAccountMatch = { kind: "bank", app: "paytm", bankLabel: "example bank", digits: "12", accountId: "bank" }

let n = 0
const row = (over: Partial<UpiRow>): UpiRow => ({
  line: ++n,
  date: "2026-10-12",
  kind: "paid",
  direction: "debit",
  amountMinor: 10_000,
  payee: "Green Leaf Cafe",
  tag: null,
  account: { bankLabel: "Example Bank", digits: "12" },
  viaLite: false,
  toAccount: null,
  status: "success",
  ref: `6123456${String(n).padStart(5, "0")}`,
  ...over,
})
const parse = (app: UpiStatementParse["app"], rows: UpiRow[]): UpiStatementParse => ({ app, period: { from: "2026-10-01", to: "2026-10-31" }, rows, issues: [], checks: [] })
const none: UpiMatches = { importedKeys: [], deletedKeys: [], entries: [] }
const review = (p: UpiStatementParse, over: Partial<Parameters<typeof buildUpiReview>[1]> = {}) =>
  buildUpiReview(p, { matches: [bankMatch], options, existing: none, history: new Map(), suggestions: new Map(), context, ...over })

describe("category rules", () => {
  it("maps every Paytm tag through the fixed map", () => {
    const expected: Record<string, string> = {
      Food: "food", Groceries: "groceries", Medical: "medical", Shopping: "shopping", Taxi: "transport", Entertainment: "fun",
      "Bill Payments": "bills", Miscellaneous: "misc", Services: "services", "Financial Services": "services", "Money Transfer": "sent",
    }
    for (const [tag, id] of Object.entries(expected)) expect(slotCategoryId(paytmTagSlot(tag)!, options.expenseCategories), tag).toBe(id)
    expect(Object.keys(PAYTM_TAG_SLOTS)).toHaveLength(11)
    expect(paytmTagSlot("Money Received")).toBeNull()
  })

  it("finds the slot's category by key, then the default's name (old or new), then the icon", () => {
    expect(slotCategoryId("transport", [cat("t", "Transport", "transport")])).toBe("t")
    expect(slotCategoryId("misc", [cat("o", "Other expenses", "other")])).toBe("o")
    expect(slotCategoryId("medical", [cat("h", "My doctors", "health")])).toBe("h")
    expect(slotCategoryId("services", [cat("s", "Home help", "services", "services")])).toBe("s")
    expect(slotCategoryId("fuel", [])).toBe("")
  })

  it("order: tag, then history, then the merchant list, then Bill paid", () => {
    const history = new Map([["green leaf cafe", "groceries"]])
    expect(ruleCategory(row({ tag: "Food" }), options.expenseCategories, history)).toEqual({ categoryId: "food", source: "tag" })
    expect(ruleCategory(row({}), options.expenseCategories, history)).toEqual({ categoryId: "groceries", source: "history" })
    expect(ruleCategory(row({ payee: "SWIGGY LIMITED" }), options.expenseCategories, new Map())).toEqual({ categoryId: "food", source: "merchant" })
    expect(ruleCategory(row({ payee: "Example Power", kind: "bill" }), options.expenseCategories, new Map())).toEqual({ categoryId: "bills", source: "rule" })
    // Paytm's Miscellaneous tag is the weakest: history and merchants come first.
    expect(ruleCategory(row({ tag: "Miscellaneous", payee: "Uber India" }), options.expenseCategories, new Map())).toEqual({ categoryId: "transport", source: "merchant" })
    expect(ruleCategory(row({ payee: "Asha Stores" }), options.expenseCategories, new Map())).toBeNull()
  })

  it("matches merchants as whole words only", () => {
    expect(merchantSlot("Uber India Systems")).toBe("transport")
    expect(merchantSlot("Jio Prepaid")).toBe("bills")
    expect(merchantSlot("Juber Ahmed")).toBeNull()
    expect(merchantSlot("Shellfish Corner")).toBeNull()
  })

  it("asks the model only for payees no rule covers, each once", () => {
    const p = parse("paytm", [
      row({ payee: "Asha Stores" }),
      row({ payee: "asha  stores" }),
      row({ payee: "Swiggy" }),
      row({ payee: "Ravi Kumar", kind: "sent" }),
      row({ payee: "Meera N", kind: "received", direction: "credit" }),
      row({ payee: "Corner Shop", status: "failed" }),
      row({ payee: "Unknown Mart", tag: "Miscellaneous" }),
    ])
    expect(namesToSuggest(p, options.expenseCategories, new Map())).toEqual([
      { id: "0", name: "Asha Stores" },
      { id: "1", name: "Unknown Mart" },
    ])
  })
})

describe("buildUpiReview", () => {
  it("types each row: expenses ticked, money sent to people, received waits, cashback is income, failed skipped", () => {
    const p = parse("bhim", [
      row({ payee: "Swiggy" }),
      row({ kind: "sent", payee: "Ravi Kumar" }),
      row({ kind: "received", direction: "credit", payee: "Meera N" }),
      row({ kind: "cashback", direction: "credit", payee: "BHIM cashback" }),
      row({ status: "failed" }),
      row({ status: "pending" }),
    ])
    const r = review(p, { matches: [{ ...bankMatch, app: "bhim" }] })
    expect(r.lines.map((l) => [l.status, l.type, l.ticked, l.categoryId, l.categorySource, l.skipReason])).toEqual([
      ["new", "expense", true, "food", "merchant", null],
      ["new", "expense", true, "sent", "rule", null],
      ["new", "", false, "", null, null],
      ["new", "income", true, "other-income", "default", null],
      ["skipped", "", false, "", null, "failed"],
      ["skipped", "", false, "", null, "pending"],
    ])
    expect(upiReviewTotals(r.lines, "INR")).toMatchObject({ ticked: 3, needChoice: 1, skipped: { failed: 1, pending: 1 } })
  })

  it("uses the model's suggestion after the rules, and Miscellaneous when nothing applies or the reply was invalid", () => {
    const p = parse("paytm", [row({ payee: "Asha Stores" }), row({ payee: "Zeta Hall" })])
    const r = review(p, { suggestions: new Map([["asha stores", "groceries"]]) })
    expect(r.lines.map((l) => [l.categoryId, l.categorySource])).toEqual([
      ["groceries", "claude"],
      ["misc", "default"],
    ])
  })

  it("payments on an account not matched yet are skipped and counted", () => {
    const r = review(parse("paytm", [row({ account: { bankLabel: "Unmatched Bank", digits: "99" } })]))
    expect(r.lines[0]).toMatchObject({ status: "skipped", skipReason: "unmatched", ticked: false })
  })

  it("Already imported by key; before the account's opening date or in the future skipped", () => {
    const a = row({})
    const r = review(parse("paytm", [a, row({ date: "2026-11-02" })]), { existing: { importedKeys: [upiRowKey(a)], deletedKeys: [], entries: [] } })
    expect(r.lines.map((l) => [l.status, l.skipReason])).toEqual([["imported", null], ["skipped", "future"]])
    const late: UpiAccountMatch = { kind: "bank", app: "paytm", bankLabel: "new bank", digits: "77", accountId: "late" }
    const r2 = review(parse("paytm", [row({ account: { bankLabel: "New Bank", digits: "77" }, date: "2026-10-13" })]), { matches: [late] })
    expect(r2.lines[0]!.skipReason).toBe("before_account")
  })

  it("possible duplicates: same account, amount and direction within a day either side; each entry marks one payment", () => {
    const entry = (id: string, date: string, over = {}) => ({ id, type: "expense" as const, accountId: "bank", counterAccountId: null, date, amountMinor: 10_000, note: "Green Leaf", categoryName: "Food & dining", ...over })
    const p = parse("paytm", [row({ date: "2026-10-12" }), row({ date: "2026-10-12" }), row({ date: "2026-10-20" }), row({ date: "2026-10-25", direction: "credit", kind: "received" })])
    const r = review(p, {
      existing: {
        importedKeys: [],
        deletedKeys: [],
        entries: [entry("next-day", "2026-10-13"), entry("two-days", "2026-10-22"), entry("income", "2026-10-25", { type: "income" }), entry("other-account", "2026-10-12", { accountId: "other-bank" })],
      },
    })
    expect(r.lines.map((l) => [l.status, l.duplicateOf?.id ?? null, l.ticked])).toEqual([
      ["duplicate", "next-day", false],
      ["new", null, true],
      ["new", null, true],
      ["duplicate", "income", false],
    ])
    const added = answerDuplicates(r.lines, "add")
    expect(added.map((l) => l.ticked)).toEqual([true, true, true, false])
    const one = answerDuplicates(r.lines, "skip", new Set([r.lines[0]!.key]))
    expect(one[0]!.ticked).toBe(false)
  })

  it("a bank statement's transfer on the same account counts as a possible duplicate of a self transfer", () => {
    const m: UpiAccountMatch[] = [
      { kind: "bank", app: "google_pay", bankLabel: "example bank", digits: "1234", accountId: "bank" },
      { kind: "bank", app: "google_pay", bankLabel: "other bank", digits: "5678", accountId: "other-bank" },
    ]
    const p = parse("google_pay", [row({ kind: "self_transfer", payee: "", account: { bankLabel: "Example Bank", digits: "1234" }, toAccount: { bankLabel: "Other Bank", digits: "5678" } })])
    const r = review(p, {
      matches: m,
      existing: { importedKeys: [], deletedKeys: [], entries: [{ id: "t", type: "transfer", accountId: "bank", counterAccountId: "other-bank", date: "2026-10-12", amountMinor: 10_000, note: null, categoryName: null }] },
    })
    expect(r.lines[0]).toMatchObject({ type: "transfer", accountId: "bank", counterAccountId: "other-bank", status: "duplicate" })
  })
})

describe("Google Pay: self transfers and UPI Lite", () => {
  const gm = (extra: UpiAccountMatch[] = []): UpiAccountMatch[] => [{ kind: "bank", app: "google_pay", bankLabel: "example bank", digits: "1234", accountId: "bank" }, ...extra]
  const acct = { bankLabel: "Example Bank", digits: "1234" }
  const rows = () => [
    row({ kind: "lite_topup", payee: "", account: acct, amountMinor: 40_000 }),
    row({ payee: "Corner Store", account: acct, viaLite: true, amountMinor: 10_000 }),
    row({ kind: "self_transfer", payee: "", account: acct, toAccount: { bankLabel: "Other Bank", digits: "5678" } }),
  ]

  it("asks for the Lite choice when Lite rows exist, and lists both sides of a self transfer to match", () => {
    const p = parse("google_pay", rows())
    expect(upiLiteNeeded(p)).toBe(true)
    expect(upiAccountsNeeded(p).map((a) => [a.label, a.digits, a.payments])).toEqual([
      ["Example Bank", "1234", 3],
      ["Other Bank", "5678", 1],
    ])
  })

  it("with a Lite account: the top-up is a transfer into it and Lite payments are expenses from it", () => {
    const r = review(parse("google_pay", rows()), { matches: gm([{ kind: "upi_lite", app: "google_pay", accountId: "lite" }, { kind: "bank", app: "google_pay", bankLabel: "other bank", digits: "5678", accountId: "other-bank" }]) })
    expect(r.lines.map((l) => [l.type, l.accountId, l.counterAccountId, l.status])).toEqual([
      ["transfer", "bank", "lite", "new"],
      ["expense", "lite", "", "new"],
      ["transfer", "bank", "other-bank", "new"],
    ])
  })

  it("Lite declined: Lite payments come from the linked bank, top-ups are skipped (never both as spending)", () => {
    const r = review(parse("google_pay", rows()), { matches: gm([{ kind: "upi_lite", app: "google_pay", accountId: null }]) })
    expect(r.lines.map((l) => [l.type, l.accountId, l.status, l.skipReason])).toEqual([
      ["", "", "skipped", "lite_topup"],
      ["expense", "bank", "new", null],
      ["", "", "skipped", "unmatched"],
    ])
    const spent = r.lines.filter((l) => l.ticked && l.type === "expense").reduce((a, l) => a + l.original.amountMinor, 0)
    expect(spent).toBe(10_000)
  })

  it("a self transfer with an unmatched side is never an expense", () => {
    const r = review(parse("google_pay", [rows()[2]!]), { matches: gm() })
    expect(r.lines[0]).toMatchObject({ status: "skipped", skipReason: "unmatched", type: "" })
  })
})

describe("upiLineErrors", () => {
  it("needs a matched account, a date in range, an amount and a category", () => {
    const line = { type: "expense" as const, date: "2026-10-12", amount: "100", accountId: "bank", counterAccountId: "", categoryId: "food" }
    expect(upiLineErrors(line, options, context)).toEqual({})
    expect(upiLineErrors({ ...line, accountId: "" }, options, context).account).toBeDefined()
    expect(upiLineErrors({ ...line, categoryId: "salary" }, options, context).category).toBeDefined()
    expect(upiLineErrors({ ...line, type: "income", categoryId: "salary" }, options, context)).toEqual({})
    expect(upiLineErrors({ ...line, date: "2026-11-30" }, options, context).date).toBeDefined()
    expect(upiLineErrors({ ...line, type: "transfer", counterAccountId: "bank" }, options, context).account).toBeDefined()
  })
})
