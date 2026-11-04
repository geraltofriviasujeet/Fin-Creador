import { describe, expect, it } from "vitest"
import { type BankStatementLine, bankStatementLineKey } from "@fin-creador/domain"
import type { UserClient } from "../income/client"
import { loadBankImportMatches, saveBankImportLines } from "./bank-import"

// saveBankImportLines and loadBankImportMatches against a stand-in client: tables answer from the
// scenario (RLS is the database's job, covered in pgTAP); every RPC is recorded. Synthetic lines.

const A = "a0000000-0000-4000-8000-0000000000a1"
const B = "a0000000-0000-4000-8000-0000000000b2"
const USD = "a0000000-0000-4000-8000-0000000000d3"
const CARD = "c0000000-0000-4000-8000-0000000000c1"
const GROCERIES = "c0000000-0000-4000-8000-000000000001"
const SALARY = "c0000000-0000-4000-8000-000000000002"

type Row = Record<string, unknown>
function fakeClient(s: { transactions?: Row[]; payments?: Row[]; balance?: number } = {}) {
  const tables: Record<string, Row[]> = {
    accounts: [
      { id: A, kind: "bank", name: "PNB", last4: "4821", institution: "Punjab National Bank", currency: "INR", opening_balance_date: "2026-10-01", archived_at: null },
      { id: B, kind: "bank", name: "SBI", last4: "1111", institution: null, currency: "INR", opening_balance_date: "2026-10-01", archived_at: null },
      { id: USD, kind: "other", name: "US wallet", last4: null, institution: null, currency: "USD", opening_balance_date: "2026-10-01", archived_at: null },
    ],
    categories: [
      { id: GROCERIES, name: "Groceries", kind: "expense", system_key: null, archived_at: null },
      { id: SALARY, name: "Salary", kind: "income", system_key: null, archived_at: null },
    ],
    credit_cards: [{ id: CARD, issuer: "Punjab National Bank", product: null, product_other: "Rupay Select", nickname: null, currency: "INR", archived_at: null }],
    transactions: s.transactions ?? [],
    liability_payments: s.payments ?? [],
  }
  const rpcs: { fn: string; args: Row }[] = []
  const from = (table: string) => {
    let rows = tables[table] ?? []
    const builder = {
      select: () => builder,
      eq: (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), builder),
      is: (col: string, v: unknown) => ((rows = rows.filter((r) => (r[col] ?? null) === v)), builder),
      in: (col: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), builder),
      or: (filter: string) => {
        const ors = filter.split(",").map((f) => f.split(".eq."))
        rows = rows.filter((r) => ors.some(([col, v]) => r[col!] === v))
        return builder
      },
      gte: (col: string, v: string) => ((rows = rows.filter((r) => (r[col] as string) >= v)), builder),
      lte: (col: string, v: string) => ((rows = rows.filter((r) => (r[col] as string) <= v)), builder),
      limit: () => builder,
      order: () => builder,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
    }
    return builder
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from,
    rpc: async (fn: string, args: Row) => {
      if (fn === "user_local_today") return { data: "2026-10-30", error: null }
      if (fn === "account_balances_at") return { data: [{ as_of: "2026-10-28", account_id: A, balance_minor: s.balance ?? 0 }], error: null }
      rpcs.push({ fn, args })
      return { data: { id: `row-${rpcs.length}`, voided_at: null }, error: null }
    },
  }
  return { client: client as unknown as UserClient, rpcs }
}

const original = (over: Partial<BankStatementLine> = {}): BankStatementLine => ({
  date: "2026-10-20", amountMinor: 500_000, direction: "debit", description: "IMPS/TRANSFER TO OWN ACCOUNT", balanceMinor: 1_000_000, occurrence: 0, ...over,
})
type Edit = Partial<{ type: "expense" | "income" | "transfer" | "card_payment"; categoryId: string; otherAccountId: string; cardId: string; amount: string }>
const line = (over: Partial<BankStatementLine>, edit: Edit) => {
  const o = original(over)
  return { original: o, date: o.date, amount: "5,000", type: "expense" as const, categoryId: "", otherAccountId: "", cardId: "", ...edit }
}
const keyOf = (over: Partial<BankStatementLine> = {}) => bankStatementLineKey(A, original(over))

describe("saveBankImportLines", () => {
  it("routes each type: expense and income entries, a transfer from the debit side, a card payment through pay_card", async () => {
    const { client, rpcs } = fakeClient()
    const result = await saveBankImportLines(client, {
      accountId: A,
      lines: [
        line({ description: "FRESH BASKET" }, { type: "expense", categoryId: GROCERIES }),
        line({ direction: "credit", description: "SALARY" }, { type: "income", categoryId: SALARY }),
        line({}, { type: "transfer", otherAccountId: B }),
        line({ direction: "credit", description: "FROM SBI" }, { type: "transfer", otherAccountId: B }),
        line({ description: "CARD PAYMENT" }, { type: "card_payment", cardId: CARD }),
      ],
    })
    expect(result.ok && result.results.map((r) => r.status)).toEqual(["saved", "saved", "saved", "saved", "saved"])
    expect(rpcs.map((r) => [r.fn, r.args.p_type, r.args.p_account_id, r.args.p_counter_account_id, r.args.p_category_id])).toEqual([
      ["record_transaction", "expense", A, undefined, GROCERIES],
      ["record_transaction", "income", A, undefined, SALARY],
      ["record_transaction", "transfer", A, B, undefined],
      ["record_transaction", "transfer", B, A, undefined],
      ["pay_card", undefined, A, undefined, undefined],
    ])
    expect(rpcs[0]!.args).toMatchObject({ p_idempotency_key: keyOf({ description: "FRESH BASKET" }), p_amount_minor: 500_000, p_note: "FRESH BASKET" })
    expect(rpcs[4]!.args).toMatchObject({ p_card_id: CARD, p_idempotency_key: keyOf({ description: "CARD PAYMENT" }), p_allow_shortfall: true })
  })

  it("refuses a type that doesn't fit the line, a target that isn't the person's, and posts nothing for them", async () => {
    const { client, rpcs } = fakeClient()
    const result = await saveBankImportLines(client, {
      accountId: A,
      lines: [
        line({ direction: "credit" }, { type: "expense", categoryId: GROCERIES }),
        line({ direction: "credit" }, { type: "card_payment", cardId: CARD }),
        line({}, { type: "income", categoryId: SALARY }),
        line({}, { type: "transfer", otherAccountId: USD }),
        line({}, { type: "transfer", otherAccountId: A }),
        line({}, { type: "expense", categoryId: SALARY }),
        line({ date: "2026-09-30" }, { type: "expense", categoryId: GROCERIES }),
      ],
    })
    expect(result.ok && result.results.map((r) => r.status)).toEqual(Array(7).fill("failed"))
    expect(rpcs).toEqual([])
  })

  it("a key already in the ledger, as an entry or a card payment, is never posted again", async () => {
    const { client, rpcs } = fakeClient({
      transactions: [{ id: "t1", idempotency_key: keyOf(), voided_at: null, replaces_id: null }],
      payments: [{ id: "p1", idempotency_key: keyOf({ description: "CARD PAYMENT" }), voided_at: "2026-10-21T00:00:00Z", replaces_id: null }],
    })
    const result = await saveBankImportLines(client, {
      accountId: A,
      lines: [line({}, { type: "transfer", otherAccountId: B }), line({ description: "CARD PAYMENT" }, { type: "card_payment", cardId: CARD })],
    })
    expect(result.ok && result.results.map((r) => r.status)).toEqual(["already_saved", "deleted"])
    expect(rpcs).toEqual([])
  })
})

describe("loadBankImportMatches", () => {
  it("lists the other account's transfer (either side), entries on the account, and leaves out this statement's own lines", async () => {
    const own = keyOf({ description: "CARD PAYMENT" })
    const { client } = fakeClient({
      balance: 1_234_500,
      transactions: [
        // From B's import: B -> A on the 20th (a credit here).
        { type: "transfer", account_id: B, counter_account_id: A, occurred_on: "2026-10-20", amount_minor: 500_000, idempotency_key: "k-b", liability_payment_id: null, voided_at: null },
        { type: "expense", account_id: A, counter_account_id: null, occurred_on: "2026-10-21", amount_minor: 178_400, idempotency_key: "k-hand", liability_payment_id: null, voided_at: null },
        // This statement's card payment: its ledger row has its own key, the payment has ours.
        { type: "transfer", account_id: A, counter_account_id: "card-acct", occurred_on: "2026-10-22", amount_minor: 233_400, idempotency_key: "k-random", liability_payment_id: "p1", voided_at: null },
        { type: "expense", account_id: B, counter_account_id: null, occurred_on: "2026-10-21", amount_minor: 1, idempotency_key: "k-other", liability_payment_id: null, voided_at: null },
      ],
      payments: [{ id: "p1", idempotency_key: own, voided_at: null, replaces_id: null }],
    })
    const r = await loadBankImportMatches(client, { accountId: A, keys: [own], from: "2026-10-01", to: "2026-10-28" })
    expect(r).toEqual({
      ok: true,
      matches: {
        importedKeys: [own],
        deletedKeys: [],
        entries: [{ date: "2026-10-21", amountMinor: 178_400, direction: "debit" }],
        transfers: [{ date: "2026-10-20", amountMinor: 500_000, direction: "credit" }],
        bookBalanceMinor: 1_234_500,
      },
    })
  })
})
