import { describe, expect, it } from "vitest"
import { type StatementLine, statementLineKey } from "@fin-creador/domain"
import type { UserClient } from "../income/client"
import { enterImportedStatement, importStatementKey, saveImportLines } from "./save"

// saveImportLines and enterImportedStatement against a stand-in client: tables answer from the
// scenario (RLS is the database's job, covered in pgTAP); every RPC is recorded. Synthetic lines.

const CARD = "c0000000-0000-4000-8000-0000000000c1"
const CARD_ACCOUNT = "a0000000-0000-4000-8000-0000000000a1"
const CAT = "c0000000-0000-4000-8000-000000000001"
const BANK = "c0000000-0000-4000-8000-000000000002"

type Tx = { id: string; idempotency_key: string; voided_at: string | null; replaces_id: string | null }
type Scenario = {
  today?: string
  card?: { account_id: string; currency: string; tracking_started_on: string; archived_at: string | null } | null
  categories?: string[]
  transactions?: Tx[]
  statementExists?: boolean
  rpcError?: (args: Record<string, unknown>) => { code: string; message: string } | null
}

function fakeClient(s: Scenario = {}) {
  const today = s.today ?? "2026-10-29"
  const card = s.card === undefined ? { account_id: CARD_ACCOUNT, currency: "INR", tracking_started_on: "2026-10-01", archived_at: null } : s.card
  const tables: Record<string, Record<string, unknown>[]> = {
    credit_cards: card ? [{ id: CARD, statement_day: 15, due_day: 4, ...card }] : [],
    accounts: [],
    account_balances: [],
    categories: [...(s.categories ?? [CAT]).map((id) => ({ id, kind: "expense", archived_at: null, system_key: null })), { id: BANK, kind: "expense", archived_at: null, system_key: "bank_charges" }],
    transactions: s.transactions ?? [],
    card_statements: s.statementExists ? [{ id: "s1", card_id: CARD, statement_date: "2026-10-15" }] : [],
  }
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []
  const from = (table: string) => {
    let rows = tables[table] ?? []
    const builder = {
      select: () => builder,
      eq: (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), builder),
      is: (col: string, v: unknown) => ((rows = rows.filter((r) => (r[col] ?? null) === v)), builder),
      in: (col: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), builder),
      order: () => builder,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
    }
    return builder
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "user_local_today") return { data: today, error: null }
      rpcs.push({ fn, args })
      const error = s.rpcError?.(args) ?? null
      if (error) return { data: null, error }
      if (fn === "enter_card_statement") return { data: { id: "st-1", difference_minor: 0 }, error: null }
      return { data: { id: `tx-${rpcs.length}`, voided_at: null }, error: null }
    },
  }
  return { client: client as unknown as UserClient, rpcs }
}

const original = (over: Partial<StatementLine> = {}): StatementLine => ({
  date: "2026-10-10", amountMinor: 178_400, direction: "debit", kind: "purchase",
  description: "FRESH BASKET STORES", foreignCurrency: null, occurrence: 0, ...over,
})
const line = (over: Partial<StatementLine> = {}, edits: Partial<{ date: string; amount: string; categoryId: string }> = {}) => {
  const o = original(over)
  return { original: o, date: o.date, amount: "1,784", categoryId: CAT, ...edits }
}
const input = (lines: ReturnType<typeof line>[]) => ({ cardId: CARD, statementDate: "2026-10-15", lines })
const keyOf = (over: Partial<StatementLine> = {}) => statementLineKey(CARD, "2026-10-15", original(over))

describe("saveImportLines", () => {
  it("posts each line as an expense on the card, under the key of the line as read, with the edited values", async () => {
    const { client, rpcs } = fakeClient()
    const result = await saveImportLines(client, input([line({}, { date: "2026-10-11", amount: "1,800" })]))
    expect(result).toEqual({ ok: true, results: [{ key: keyOf(), status: "saved" }] })
    expect(rpcs).toEqual([
      {
        fn: "record_transaction",
        args: {
          p_type: "expense", p_idempotency_key: keyOf(), p_amount_minor: 180_000, p_occurred_on: "2026-10-11",
          p_account_id: CARD_ACCOUNT, p_category_id: CAT, p_note: "FRESH BASKET STORES",
        },
      },
    ])
  })

  it("never posts a key twice: an existing row is already saved, a voided one with no newer version is deleted", async () => {
    const { client, rpcs } = fakeClient({
      transactions: [
        { id: "t1", idempotency_key: keyOf(), voided_at: null, replaces_id: null },
        { id: "t2", idempotency_key: keyOf({ occurrence: 1 }), voided_at: "2026-10-20T10:00:00Z", replaces_id: null },
        { id: "t3", idempotency_key: keyOf({ occurrence: 2 }), voided_at: "2026-10-20T10:00:00Z", replaces_id: null },
        { id: "t4", idempotency_key: "edited-version", voided_at: null, replaces_id: "t3" },
      ],
    })
    const result = await saveImportLines(client, input([line(), line({ occurrence: 1 }), line({ occurrence: 2 })]))
    expect(result.ok && result.results.map((r) => r.status)).toEqual(["already_saved", "deleted", "already_saved"])
    expect(rpcs).toEqual([])
  })

  it("follows an edited line to its latest version: edited then deleted is deleted, and nothing is posted", async () => {
    const { client, rpcs } = fakeClient({
      transactions: [
        { id: "t1", idempotency_key: keyOf(), voided_at: "2026-10-20T10:00:00Z", replaces_id: null },
        { id: "t2", idempotency_key: "edit-1", voided_at: "2026-10-21T10:00:00Z", replaces_id: "t1" },
        { id: "t3", idempotency_key: "edit-2", voided_at: "2026-10-22T10:00:00Z", replaces_id: "t2" },
      ],
    })
    const result = await saveImportLines(client, input([line()]))
    expect(result).toEqual({ ok: true, results: [{ key: keyOf(), status: "deleted" }] })
    expect(rpcs).toEqual([])
  })

  it("signed out mid-save: asks to sign in again, saves nothing", async () => {
    const { client, rpcs } = fakeClient()
    ;(client as unknown as { auth: { getUser: () => Promise<unknown> } }).auth.getUser = async () => ({ data: { user: null } })
    expect(await saveImportLines(client, input([line()]))).toEqual({ ok: false, message: "Sign in again; your file is still here." })
    expect(rpcs).toEqual([])
  })

  it("checks each line against the person's today, the card's start, the amount and their categories", async () => {
    const { client, rpcs } = fakeClient()
    const result = await saveImportLines(
      client,
      input([
        line({}, { date: "2026-10-30" }),
        line({ occurrence: 1 }, { date: "2026-09-30" }),
        line({ occurrence: 2 }, { amount: "0" }),
        line({ occurrence: 3 }, { categoryId: "c0000000-0000-4000-8000-0000000000ff" }),
        line({ occurrence: 4, date: "2026-09-20" }),
      ]),
    )
    expect(result.ok && result.results.map((r) => r.reason)).toEqual([
      "Choose today or an earlier date",
      "Before you added the card",
      "Enter an amount above zero",
      "Choose a category",
      "Not a purchase on the card",
    ])
    expect(rpcs).toEqual([])
  })

  it("saves the other lines when one fails, and gives a reason without any statement text", async () => {
    const failing = keyOf({ occurrence: 1 })
    const { client } = fakeClient({ rpcError: (a) => (a.p_idempotency_key === failing ? { code: "FC036", message: "FRESH BASKET 1784 secret" } : null) })
    const result = await saveImportLines(client, input([line(), line({ occurrence: 1 }), line({ occurrence: 2 })]))
    expect(result.ok && result.results.map((r) => r.status)).toEqual(["saved", "failed", "saved"])
    const out = JSON.stringify(result)
    expect(out).not.toMatch(/FRESH|1784|1,784|secret/)
  })

  it("treats a reused key with edited values (FC007) as already saved", async () => {
    const { client } = fakeClient({ rpcError: () => ({ code: "FC007", message: "x" }) })
    const result = await saveImportLines(client, input([line()]))
    expect(result.ok && result.results[0]!.status).toBe("already_saved")
  })

  it("refuses input that is not lines as read: credits, payments, digits in a note, too many lines", async () => {
    const { client, rpcs } = fakeClient()
    for (const bad of [
      input([line({ direction: "credit" as "debit" })]),
      input([line({ kind: "payment" as "purchase" })]),
      input([line({ description: "CARD 5555 0000" })]),
      input(Array.from({ length: 11 }, (_, i) => line({ occurrence: i }))),
      input([]),
    ]) {
      expect(await saveImportLines(client, bad)).toEqual({ ok: false, message: "These lines couldn't be checked. Read the statement again and try again." })
    }
    expect(rpcs).toEqual([])
  })

  it("refuses a card the person cannot see or that is archived", async () => {
    expect((await saveImportLines(fakeClient({ card: null }).client, input([line()]))).ok).toBe(false)
    const archived = fakeClient({ card: { account_id: CARD_ACCOUNT, currency: "INR", tracking_started_on: "2026-10-01", archived_at: "2026-10-20T00:00:00Z" } })
    expect((await saveImportLines(archived.client, input([line()]))).ok).toBe(false)
  })
})

describe("enterImportedStatement", () => {
  const figures = { cardId: CARD, statementDate: "2026-10-15", total: "2,334", minimum: "116.70", dueDate: "2026-11-04" }

  it("enters the statement once per card and date, with Bank charges & interest for any difference", async () => {
    const { client, rpcs } = fakeClient()
    expect(await enterImportedStatement(client, figures)).toEqual({ status: "saved", message: "Statement saved." })
    expect(rpcs).toEqual([
      {
        fn: "enter_card_statement",
        args: {
          p_card_id: CARD, p_idempotency_key: importStatementKey(CARD, "2026-10-15"), p_statement_date: "2026-10-15",
          p_total_minor: 233_400, p_minimum_minor: 11_670, p_due_date: "2026-11-04", p_emi_included_minor: 0, p_difference_category_id: BANK,
        },
      },
    ])
  })

  it("changes nothing when a statement for that date exists", async () => {
    const { client, rpcs } = fakeClient({ statementExists: true })
    expect((await enterImportedStatement(client, figures)).status).toBe("exists")
    expect(rpcs).toEqual([])
  })
})
