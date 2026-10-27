import { cardBillMinor, cardBillState, cardCycleDate, cardDueDate, cardUtilisation, borrowingDueStatus, payBillDefaultMinor, statementDifferenceMinor, summarizeHoldings } from "@fin-creador/domain"
import { NO_DIGITS, borrowingEditFormSchema, borrowingFormSchema, cardEditFormSchema, cardFormSchema } from "@fin-creador/schemas"
import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { loadIncomeData } from "../income/load"
import { loadTransactionsContext } from "../transactions/load"
import { cardErrorMessage } from "./errors"
import { addBorrowing, addCard, enterStatement, payCard, repayBorrowing } from "./writers"

// QA (Sprint 8b): Total available never holds a card or borrowing, no digit-like text in names,
// double submits, and the date / amount boundaries. Expected values are worked out by hand in
// paise (₹1 = 100) in the comments, never by calling the function under test.

const KEY = "e8000000-0000-4000-8000-0000000000d1"
const CARD = "f8000000-0000-4000-8000-0000000000d1"
const BORROWING = "f8000000-0000-4000-8000-0000000000d2"
const BANK = "a8000000-0000-4000-8000-0000000000d1"
const CARD_ACCOUNT = "a8000000-0000-4000-8000-0000000000d2"
const BORROWING_ACCOUNT = "a8000000-0000-4000-8000-0000000000d3"

type DbError = { code: string; message: string; details?: string }
type Rpc = { fn: string; args: Record<string, unknown> }

/** Answers selects from `rows` (applying eq / in / is filters), records `.in()` calls and RPCs. */
function fakeClient(rows: Record<string, Record<string, unknown>[]>, rpcAnswer: (call: Rpc) => { data: unknown; error: DbError | null } = () => ({ data: { id: "new" }, error: null })) {
  const rpcs: Rpc[] = []
  const ins: { table: string; column: string; values: unknown[] }[] = []
  const from = (table: string) => {
    let result = [...(rows[table] ?? [])]
    const builder = {
      select: () => builder,
      eq: (c: string, v: unknown) => {
        if (table !== "transactions" && table !== "profiles") result = result.filter((r) => r[c] === v)
        return builder
      },
      in: (c: string, v: unknown[]) => {
        ins.push({ table, column: c, values: v })
        result = result.filter((r) => v.includes(r[c]))
        return builder
      },
      is: (c: string, v: unknown) => ((result = result.filter((r) => (r[c] ?? null) === v)), builder),
      not: () => builder,
      gte: () => builder,
      gt: (c: string, v: number) => ((result = result.filter((r) => (r[c] as number) > v)), builder),
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === "transactions" ? [] : result, error: null }).then(resolve),
    }
    return builder
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "user_local_today") return { data: "2026-10-28", error: null }
      rpcs.push({ fn, args })
      return rpcAnswer({ fn, args })
    },
    from,
  }
  return { client: client as unknown as UserClient, rpcs, ins }
}

const account = (id: string, kind: string, name: string, opening: number) => ({
  id,
  kind,
  bank_type: kind === "bank" ? "savings" : null,
  name,
  institution: null,
  last4: null,
  currency: "INR",
  opening_balance_minor: opening,
  opening_balance_date: "2026-10-01",
  archived_at: null,
  updated_at: "2026-10-01T00:00:00Z",
})
const balance = (id: string, inflow: number, outflow: number) => ({ account_id: id, inflow_minor: inflow, outflow_minor: outflow, last_activity_at: null })

// Bank 100,000.00 less 3,000.00 paid to the card and 450.00 of repayment; cash 50.00; a wallet (other)
// 30.00 plus the 1,000.00 borrowed into it. The card is at minus 6,000.00 (opening 6,000 + 3,000 of
// purchases - 3,000 paid), the borrowing at minus 600.00 (1,000 received, 400 repaid), the loan at minus 20,000.00.
function ledgerRows(cardOutflow = 300_000): Record<string, Record<string, unknown>[]> {
  return {
    profiles: [{ currency: "INR", time_zone: "Asia/Kolkata" }],
    accounts: [
      account("bank", "bank", "HDFC Bank", 10_000_000),
      account("cash", "cash", "Cash in hand", 5_000),
      account("wallet", "other", "Wallet", 3_000),
      account("card", "card", "Travel", -600_000),
      account("card-old", "card", "Old card", 0),
      account("ravi", "borrowing", "Ravi", 0),
      account("loan", "loan", "Home loan", -2_000_000),
    ],
    account_balances: [
      balance("bank", 0, 345_000),
      balance("wallet", 100_000, 0),
      balance("card", 300_000, cardOutflow),
      balance("ravi", 40_000, 100_000),
    ],
    credit_cards: [
      { account_id: "card", limit_minor: 5_000_000 },
      { account_id: "card-old", limit_minor: 1_000_000 },
    ],
    categories: [
      { id: "inc", kind: "income", name: "Salary", source_type: "salary", icon: null, default_account_id: null, is_default: true, key: null, archived_at: null },
      { id: "exp", kind: "expense", name: "Shopping", source_type: null, icon: "shopping", default_account_id: null, is_default: true, key: null, archived_at: null },
    ],
  }
}

describe("Total available never holds a card or a borrowing", () => {
  it("the Income page asks only for bank, cash and other accounts and totals 9,763,000 paise", async () => {
    const { client, ins } = fakeClient(ledgerRows())
    const result = await loadIncomeData(client)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(ins.filter((i) => i.table === "accounts")).toEqual([{ table: "accounts", column: "kind", values: ["bank", "cash", "other"] }])
    expect(result.data.accounts.map((a) => a.id)).toEqual(["bank", "cash", "wallet"])
    // Bank 10,000,000 - 345,000 = 9,655,000; cash 5,000; wallet 3,000 + 100,000 = 103,000; sum 9,763,000.
    const summary = summarizeHoldings(result.data.accounts, "INR")
    expect(summary.totalAvailableMinor).toBe(9_763_000)
    expect(summary.rows.map((r) => r.balanceMinor)).toEqual([9_655_000, 5_000, 103_000])
  })

  it("the ledger context keeps cards in cardAccounts only, with their limit; no borrowing or loan", async () => {
    const { client } = fakeClient(ledgerRows())
    const result = await loadTransactionsContext(client)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { accounts, cardAccounts, loanAccounts } = result.data
    expect(accounts.map((a) => [a.id, a.kind])).toEqual([
      ["bank", "bank"],
      ["cash", "cash"],
      ["wallet", "other"],
    ])
    expect(cardAccounts.map((a) => [a.id, a.kind, a.limitMinor])).toEqual([
      ["card", "card", 5_000_000],
      ["card-old", "card", 1_000_000],
    ])
    // A card account's own balance is minus what is owed: -600,000 + 300,000 - 300,000 = -600,000.
    expect(cardAccounts[0]).toMatchObject({ openingBalanceMinor: -600_000, inflowMinor: 300_000, outflowMinor: 300_000 })
    // Cards, the borrowing and the loan are only labels for entries posted to them.
    expect(loanAccounts.map((a) => a.id)).toEqual(["card", "card-old", "ravi", "loan"])
    const total = summarizeHoldings(accounts, "INR").totalAvailableMinor
    expect(total).toBe(9_763_000)
    // Even handed the cards as well (a caller slip), the total does not move.
    expect(summarizeHoldings([...accounts, ...cardAccounts], "INR").totalAvailableMinor).toBe(9_763_000)
  })

  it("a purchase on the card (more outflow on the card account) leaves the total unchanged", async () => {
    // Purchases add outflow to the card account only; 2,500.00 more changes the card, not the money accounts.
    const before = await loadTransactionsContext(fakeClient(ledgerRows()).client)
    const after = await loadTransactionsContext(fakeClient(ledgerRows(300_000 + 250_000)).client)
    expect(before.ok && after.ok).toBe(true)
    if (!before.ok || !after.ok) return
    expect(summarizeHoldings(after.data.accounts, "INR").totalAvailableMinor).toBe(summarizeHoldings(before.data.accounts, "INR").totalAvailableMinor)
    expect(summarizeHoldings(after.data.accounts, "INR").totalAvailableMinor).toBe(9_763_000)
    // ... while the card shows the 2,500.00 more owed: balance -600,000 + 300,000 - 550,000 = -850,000.
    const card = after.data.cardAccounts[0]
    expect(card && card.openingBalanceMinor + card.inflowMinor - card.outflowMinor).toBe(-850_000)
  })
})

describe("no digits in a card issuer, nickname or lender", () => {
  const card = { issuer: "Axis Bank", nickname: "Travel", limit: "50,000", statementDay: "20", dueDay: "8", openingOwed: "", idempotencyKey: KEY }
  const edit = { cardId: CARD, issuer: "Axis Bank", nickname: "Travel", limit: "50,000", statementDay: "20", dueDay: "8" }
  const ASCII_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
  const errorAt = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }, field: string) =>
    r.success ? null : (r.error?.issues.find((i) => i.path[0] === field)?.message ?? null)

  it("refuses every ASCII digit in each name, when a card is added or edited and a lender is added or renamed", () => {
    for (const d of ASCII_DIGITS) {
      expect(errorAt(cardFormSchema({ currency: "INR" }).safeParse({ ...card, issuer: `Ax${d}is` }), "issuer")).toBe(NO_DIGITS)
      expect(errorAt(cardFormSchema({ currency: "INR" }).safeParse({ ...card, nickname: `Tr${d}vel` }), "nickname")).toBe(NO_DIGITS)
      expect(errorAt(cardEditFormSchema({ currency: "INR" }).safeParse({ ...edit, issuer: `Ax${d}is` }), "issuer")).toBe(NO_DIGITS)
      expect(errorAt(cardEditFormSchema({ currency: "INR" }).safeParse({ ...edit, nickname: `Tr${d}vel` }), "nickname")).toBe(NO_DIGITS)
      expect(errorAt(borrowingEditFormSchema().safeParse({ borrowingId: BORROWING, lender: `Ra${d}vi` }), "lender")).toBe(NO_DIGITS)
      const add = borrowingFormSchema({ today: "2026-10-28", currency: "INR", accounts: [] }).safeParse({ lender: `Ra${d}vi`, amount: "100", received: "earlier", idempotencyKey: KEY })
      expect(errorAt(add, "lender")).toBe(NO_DIGITS)
    }
  })

  it("accepts the same names without digits (so the refusals above are about the digit)", () => {
    expect(cardFormSchema({ currency: "INR" }).safeParse(card).success).toBe(true)
    expect(cardEditFormSchema({ currency: "INR" }).safeParse(edit).success).toBe(true)
    expect(borrowingEditFormSchema().safeParse({ borrowingId: BORROWING, lender: "Ravi Kumar" }).success).toBe(true)
  })

  it("a digit sends nothing to the database", async () => {
    const { client, rpcs } = fakeClient({ profiles: [{ id: "user-1", currency: "INR" }] })
    const r = await addCard(client, { ...card, nickname: "Card 1" })
    expect(r).toMatchObject({ status: "error", fieldErrors: { nickname: NO_DIGITS } })
    const b = await addBorrowing(client, { lender: "Ravi 2", amount: "100", received: "earlier", idempotencyKey: KEY })
    expect(b).toMatchObject({ status: "error", fieldErrors: { lender: NO_DIGITS } })
    expect(rpcs).toEqual([])
  })

  it("the database CHECK on a name becomes the same plain message, on the right field", () => {
    expect(cardErrorMessage({ code: "23514", message: 'violates check constraint "credit_cards_issuer"' })).toEqual({ message: NO_DIGITS, field: "issuer" })
    expect(cardErrorMessage({ code: "23514", message: 'violates check constraint "credit_cards_nickname"' })).toEqual({ message: NO_DIGITS, field: "nickname" })
    expect(cardErrorMessage({ code: "23514", message: 'violates check constraint "borrowings_lender"' })).toEqual({ message: NO_DIGITS, field: "lender" })
  })

  // F1 (QA): the shared schema refuses digits in any script (\p{Nd}). The database constraints are
  // ASCII [0-9] until a follow-up migration (see the pgTAP TODO in cards_borrowing_qa.test.sql).
  it("refuses full-width, Arabic-Indic and Devanagari digits in a name", () => {
    for (const digit of ["１", "٣", "४"]) {
      expect(errorAt(cardFormSchema({ currency: "INR" }).safeParse({ ...card, issuer: `Axis ${digit}` }), "issuer")).toBe(NO_DIGITS)
      expect(errorAt(borrowingEditFormSchema().safeParse({ borrowingId: BORROWING, lender: `Ravi ${digit}` }), "lender")).toBe(NO_DIGITS)
    }
  })
})

describe("double submits send one request key and one set of values", () => {
  const rows = {
    profiles: [{ id: "user-1", currency: "INR" }],
    credit_cards: [{ id: CARD, account_id: CARD_ACCOUNT, currency: "INR", tracking_started_on: "2026-10-01", statement_day: 20, due_day: 8 }],
    borrowings: [{ id: BORROWING, account_id: BORROWING_ACCOUNT, currency: "INR" }],
    accounts: [
      { id: BANK, kind: "bank", name: "HDFC Savings", currency: "INR", opening_balance_date: "2026-01-01", opening_balance_minor: 10_000_00, archived_at: null },
      { id: CARD_ACCOUNT, kind: "card", name: "Travel", currency: "INR", opening_balance_date: "2026-10-01", opening_balance_minor: -6_000_00, archived_at: null },
      { id: BORROWING_ACCOUNT, kind: "borrowing", name: "Ravi", currency: "INR", opening_balance_date: "2026-10-20", opening_balance_minor: -2_000_00, archived_at: null },
    ],
    account_balances: [],
  }

  it("the same form submitted twice sends identical calls with the same key (the database returns the saved row)", async () => {
    const { client, rpcs } = fakeClient(rows)
    const add = { issuer: "HDFC Bank", nickname: "Travel", limit: "1,00,000", statementDay: "20", dueDay: "8", openingOwed: "6,000", idempotencyKey: KEY }
    const statement = { cardId: CARD, statementDate: "2026-10-20", total: "9,000", minimum: "450", emiIncluded: "0", idempotencyKey: KEY }
    const pay = { cardId: CARD, accountId: BANK, amount: "3,000", idempotencyKey: KEY }
    const borrow = { lender: "Ravi", amount: "2,000", received: "earlier", idempotencyKey: KEY }
    const repay = { borrowingId: BORROWING, accountId: BANK, principal: "500", interest: "20", idempotencyKey: KEY }
    for (let i = 0; i < 2; i++) {
      expect((await addCard(client, add)).status).toBe("success")
      expect((await enterStatement(client, statement)).status).toBe("success")
      expect((await payCard(client, pay)).status).toBe("success")
      expect((await addBorrowing(client, borrow)).status).toBe("success")
      expect((await repayBorrowing(client, repay)).status).toBe("success")
    }
    expect(rpcs.map((r) => r.fn)).toEqual(["create_card", "enter_card_statement", "pay_card", "create_borrowing", "repay_borrowing", "create_card", "enter_card_statement", "pay_card", "create_borrowing", "repay_borrowing"])
    for (let i = 0; i < 5; i++) {
      expect(rpcs[i + 5]).toEqual(rpcs[i])
      expect(rpcs[i]?.args.p_idempotency_key).toBe(KEY)
    }
  })

  it("a form without a request key is refused before anything is sent", async () => {
    const { client, rpcs } = fakeClient(rows)
    const r = await payCard(client, { cardId: CARD, accountId: BANK, amount: "3,000", idempotencyKey: "" })
    expect(r).toMatchObject({ status: "error", fieldErrors: { idempotencyKey: "Please reopen the form and try again" } })
    expect(rpcs).toEqual([])
  })

  it("the same key reused for different values (FC007), a second void (FC005) and a replaced edit (FC014) show plain messages", async () => {
    const seen = new Set<string>()
    for (const code of ["FC007", "FC005", "FC014"]) {
      const m = cardErrorMessage({ code, message: "raw database text" })
      expect(m.message.length).toBeGreaterThan(5)
      expect(m.message).not.toContain("raw")
      seen.add(m.message)
    }
    expect(seen.size).toBe(3)
    const { client } = fakeClient(rows, () => ({ data: null, error: { code: "FC007", message: "raw database text" } }))
    const r = await payCard(client, { cardId: CARD, accountId: BANK, amount: "3,000", idempotencyKey: KEY })
    expect(r.status).toBe("error")
    expect(JSON.stringify(r)).not.toContain("raw")
  })
})

describe("boundaries (same hand-worked cases as the pgTAP QA suite)", () => {
  it("day 29, 30 and 31 clamp to the month end and the due date is the first due-day date after the statement", () => {
    expect(cardCycleDate(31, "2027-02-10")).toBe("2027-02-28")
    expect(cardCycleDate(31, "2028-02-10")).toBe("2028-02-29")
    expect(cardCycleDate(30, "2027-02-10")).toBe("2027-02-28")
    expect(cardCycleDate(29, "2027-02-10")).toBe("2027-02-28")
    expect(cardCycleDate(29, "2028-02-10")).toBe("2028-02-29")
    expect(cardDueDate("2027-01-31", 31)).toBe("2027-02-28")
    expect(cardDueDate("2027-02-28", 31)).toBe("2027-03-31")
    expect(cardDueDate("2028-02-29", 31)).toBe("2028-03-31")
    expect(cardDueDate("2026-12-31", 5)).toBe("2027-01-05")
    expect(cardDueDate("2027-01-31", 30)).toBe("2027-02-28")
  })

  it("the statement difference: before the card was added, exactly zero, below what is owed and above it", () => {
    // Bill 1,300.00 against 1,000.00 owed: 300.00 is missing.
    expect(statementDifferenceMinor(130_000, 100_000)).toBe(30_000)
    expect(statementDifferenceMinor(100_000, 100_000)).toBe(0)
    expect(statementDifferenceMinor(60_000, 100_000)).toBe(0)
    // A statement dated before the card was added measures nothing.
    expect(statementDifferenceMinor(130_000, null)).toBe(0)
  })

  it("the bill is total less card EMIs; EMIs equal to the total give a zero bill; more than the total is refused", () => {
    expect(cardBillMinor(100_000, 40_000)).toBe(60_000)
    expect(cardBillMinor(40_000, 40_000)).toBe(0)
    expect(() => cardBillMinor(40_000, 40_001)).toThrow(RangeError)
  })

  it("a minimum equal to the bill covers it; one paisa under does not", () => {
    expect(cardBillState({ amountDueMinor: 60_000, minimumDueMinor: 60_000, paidMinor: 60_000, closed: false })).toEqual({ state: "paid", leftMinor: 0, covered: true })
    expect(cardBillState({ amountDueMinor: 100_000, minimumDueMinor: 50_000, paidMinor: 50_000, closed: false })).toMatchObject({ state: "minimum_paid", leftMinor: 50_000, covered: true })
    expect(cardBillState({ amountDueMinor: 100_000, minimumDueMinor: 50_000, paidMinor: 49_999, closed: false })).toMatchObject({ state: "part_paid", covered: false })
    // Free payments beyond the bill never show a negative amount left.
    expect(cardBillState({ amountDueMinor: 90_000, minimumDueMinor: null, paidMinor: 100_000, closed: false })).toEqual({ state: "paid", leftMinor: 0, covered: true })
  })

  it("Pay bill defaults to what is left, never more than the card owes, never negative", () => {
    expect(payBillDefaultMinor(90_000, 10_000, 200_000)).toBe(80_000)
    expect(payBillDefaultMinor(90_000, 10_000, 50_000)).toBe(50_000)
    expect(payBillDefaultMinor(90_000, 100_000, 200_000)).toBe(0)
    // A card in credit (owed below zero) leaves nothing to pay.
    expect(payBillDefaultMinor(90_000, 0, -50_000)).toBe(0)
  })

  it("a borrowing due date is paid at zero and when overpaid, pending while anything is owed", () => {
    expect(borrowingDueStatus(1)).toBe("pending")
    expect(borrowingDueStatus(0)).toBe("paid")
    expect(borrowingDueStatus(-1)).toBe("paid")
  })

  it("limit used: 80% is high, 100% is over, 79.99% is ok; a card in credit uses nothing", () => {
    expect(cardUtilisation(79_99, 100_00)).toEqual({ bps: 7_999, level: "ok" })
    expect(cardUtilisation(80_00, 100_00)).toEqual({ bps: 8_000, level: "high" })
    expect(cardUtilisation(100_00, 100_00)).toEqual({ bps: 10_000, level: "over" })
    expect(cardUtilisation(-50_000, 100_00)).toEqual({ bps: 0, level: "ok" })
  })

  it("archiving at a balance: owed and in-credit messages carry the amount, zero does not", () => {
    const ctx = { currency: "INR" }
    expect(cardErrorMessage({ code: "FC045", message: "x", details: "70000" }, { ...ctx, subject: "borrowing" }).message).toBe("You still owe ₹700 on this borrowing. Archive it once nothing is owed.")
    expect(cardErrorMessage({ code: "FC045", message: "x", details: "-50000" }, ctx).message).toBe("This card has ₹500 in credit. Archive it once the balance is zero.")
    expect(cardErrorMessage({ code: "FC045", message: "x", details: "-50000" }, { ...ctx, subject: "borrowing" }).message).toBe("This borrowing has ₹500 overpaid. Archive it once the balance is zero.")
    expect(cardErrorMessage({ code: "FC045", message: "x", details: "0" }, ctx).message).toBe("Archive this card once its balance is zero.")
  })
})
