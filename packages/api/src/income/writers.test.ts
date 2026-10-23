import { describe, expect, it } from "vitest"
import { TODAY_UNAVAILABLE, type UserClient } from "./client"
import { loadIncomeData } from "./load"
import { recordIncome, saveAccount, saveSource, setAccountArchived, updateCashOnHand } from "./writers"

// A minimal stand-in for the signed-in user's Supabase client: records every write and
// RPC, and answers from the scenario given. No network, no service role.
type Scenario = {
  signedIn?: boolean
  today?: string | null
  accountCurrency?: string | null
  rpcError?: { code: string; message: string } | null
  writeError?: { code: string; message: string } | null
}
type Call = { kind: "rpc" | "insert" | "update"; target: string; payload: unknown }

function fakeClient(s: Scenario = {}) {
  const calls: Call[] = []
  const { signedIn = true, today = "2026-10-22", accountCurrency = "INR", rpcError = null, writeError = null } = s

  const from = (table: string) => {
    let mode: "select" | "insert" | "update" = "select"
    const result = () => {
      if (mode !== "select") return { data: writeError ? null : { id: "row-1" }, error: writeError }
      if (table === "accounts") return { data: accountCurrency ? { currency: accountCurrency } : null, error: null }
      return { data: null, error: null }
    }
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      gte: () => builder,
      insert: (payload: unknown) => {
        mode = "insert"
        calls.push({ kind: "insert", target: table, payload })
        return builder
      },
      update: (payload: unknown) => {
        mode = "update"
        calls.push({ kind: "update", target: table, payload })
        return builder
      },
      maybeSingle: async () => result(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }
    return builder
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "user-1" } : null } }) },
    rpc: async (fn: string, args: unknown) => {
      calls.push({ kind: "rpc", target: fn, payload: args })
      if (fn === "user_local_today") return today ? { data: today, error: null } : { data: null, error: { code: "08006", message: "offline" } }
      return { data: null, error: rpcError }
    },
    from,
  }
  return { client: client as unknown as UserClient, calls }
}

const KEY = "e0000000-0000-4000-8000-000000000001"
const income = {
  amount: "1,28,000",
  sourceId: "c0000000-0000-4000-8000-000000000001",
  accountId: "a0000000-0000-4000-8000-000000000001",
  occurredOn: "2026-10-22",
  note: " October ",
  idempotencyKey: KEY,
}
const bank = {
  kind: "bank",
  bankType: "savings",
  bankName: "HDFC Bank",
  last4: "4821",
  currency: "INR",
  openingBalance: "2,48,600",
  openingBalanceDate: "2026-10-01",
}
const writes = (calls: Call[]) => calls.filter((c) => c.target !== "user_local_today")

describe("database errors through the shared mapper (FC001–FC013)", () => {
  // Field each code lands on in Add income; undefined = form-level message.
  const incomeFields: Record<string, string | undefined> = {
    FC001: "accountId",
    FC002: "accountId",
    FC003: "occurredOn",
    FC004: "currency",
    FC005: undefined,
    FC006: "sourceId",
    FC007: undefined,
    FC008: undefined,
    FC009: undefined,
    FC010: "accountId",
    FC011: "openingBalanceDate",
    FC012: undefined,
    FC013: undefined,
  }

  it.each(Object.entries(incomeFields))("%s → friendly message on %s, never the raw text", async (code, field) => {
    const { client } = fakeClient({ rpcError: { code, message: "raw database text" } })
    const result = await recordIncome(client, income)
    expect(result.status).toBe("error")
    expect(JSON.stringify(result)).not.toContain("raw database text")
    if (field) expect(result).toMatchObject({ message: "Please fix the highlighted fields.", fieldErrors: { [field]: expect.any(String) } })
    else expect(result).not.toHaveProperty("fieldErrors")
  })

  it("puts a future-date (FC003) or locked-date (FC011) error on the account form's As of field", async () => {
    for (const code of ["FC003", "FC011"]) {
      const { client } = fakeClient({ writeError: { code, message: "raw" } })
      const result = await saveAccount(client, { ...bank, id: "a0000000-0000-4000-8000-000000000001" })
      expect(result).toMatchObject({ fieldErrors: { openingBalanceDate: expect.any(String) } })
    }
  })

  it("maps a duplicate source name (23505) to the name field", async () => {
    const { client } = fakeClient({ writeError: { code: "23505", message: "duplicate key" } })
    expect(await saveSource(client, { name: "Salary", sourceType: "salary", defaultAccountId: "" })).toEqual({
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { name: "You already have a source with this name." },
    })
  })
})

describe("validation before any write", () => {
  it("rejects a bad amount without calling record_income", async () => {
    const { client, calls } = fakeClient()
    const result = await recordIncome(client, { ...income, amount: "12.345" })
    expect(result).toMatchObject({ status: "error", fieldErrors: { amount: "Too many decimal places for this currency" } })
    expect(writes(calls)).toEqual([])
  })

  it("rejects a future date in the user's own calendar", async () => {
    const { client, calls } = fakeClient({ today: "2026-10-22" })
    expect(await recordIncome(client, { ...income, occurredOn: "2026-10-23" })).toMatchObject({
      fieldErrors: { occurredOn: "The date can't be in the future" },
    })
    expect(writes(calls)).toEqual([])
  })

  it("rejects an unknown account", async () => {
    const { client } = fakeClient({ accountCurrency: null })
    expect(await recordIncome(client, income)).toMatchObject({ fieldErrors: { accountId: "Choose where it was received" } })
  })

  it("rejects bad account details without inserting", async () => {
    const { client, calls } = fakeClient()
    expect(await saveAccount(client, { ...bank, last4: "12a4" })).toMatchObject({ fieldErrors: { last4: "Enter exactly 4 digits" } })
    expect(writes(calls)).toEqual([])
  })
})

describe("writes", () => {
  it("records income in minor units with the caller's request key", async () => {
    const { client, calls } = fakeClient()
    expect(await recordIncome(client, income)).toEqual({ status: "success", message: "Income saved." })
    expect(writes(calls)).toEqual([
      {
        kind: "rpc",
        target: "record_income",
        payload: {
          p_account_id: income.accountId,
          p_category_id: income.sourceId,
          p_amount_minor: 12_800_000,
          p_occurred_on: "2026-10-22",
          p_idempotency_key: KEY,
          p_note: "October",
        },
      },
    ])
  })

  it("a double submit sends the same request key both times (the database records it once)", async () => {
    const { client, calls } = fakeClient()
    await Promise.all([recordIncome(client, income), recordIncome(client, income)])
    const keys = writes(calls).map((c) => (c.payload as { p_idempotency_key: string }).p_idempotency_key)
    expect(keys).toEqual([KEY, KEY])
  })

  it("inserts a new account and updates an existing one", async () => {
    const add = fakeClient()
    expect(await saveAccount(add.client, bank)).toEqual({ status: "success", message: "Account added." })
    expect(writes(add.calls)[0]).toMatchObject({ kind: "insert", target: "accounts", payload: { kind: "bank", opening_balance_minor: 24_860_000 } })

    const edit = fakeClient()
    expect(await saveAccount(edit.client, { ...bank, id: "a0000000-0000-4000-8000-000000000001" })).toEqual({
      status: "success",
      message: "Account updated.",
    })
    expect(writes(edit.calls)[0]).toMatchObject({ kind: "update", target: "accounts" })
    expect(writes(edit.calls)[0]?.payload).not.toHaveProperty("kind")
  })

  it("archives and restores", async () => {
    const { client, calls } = fakeClient()
    expect(await setAccountArchived(client, { id: "a1", archived: true })).toEqual({ status: "success", message: "Account archived." })
    expect(await setAccountArchived(client, { id: "a1", archived: false })).toEqual({ status: "success", message: "Account restored." })
    expect((writes(calls)[1]?.payload as { archived_at: unknown }).archived_at).toBeNull()
  })
})

describe("today comes from the database, never the device clock", () => {
  it("blocks saving when the date can't be checked", async () => {
    for (const write of [() => recordIncome, () => saveAccount] as const) {
      const { client, calls } = fakeClient({ today: null })
      expect(await write()(client, write() === recordIncome ? income : bank)).toEqual({ status: "error", message: TODAY_UNAVAILABLE })
      expect(writes(calls)).toEqual([])
    }
  })

  it("asks for a sign-in when the session has ended", async () => {
    const { client } = fakeClient({ signedIn: false })
    expect(await recordIncome(client, income)).toEqual({ status: "error", message: "Your session has ended. Please sign in again." })
  })

  it("the loader fails instead of guessing today", async () => {
    expect(await loadIncomeData(fakeClient({ today: null }).client)).toEqual({ ok: false, reason: "unavailable" })
    expect(await loadIncomeData(fakeClient({ signedIn: false }).client)).toEqual({ ok: false, reason: "unauthenticated" })
  })
})

describe("updateCashOnHand (one cash account, a correction not income)", () => {
  const cash = { accountId: "a0000000-0000-4000-8000-000000000001", amount: "10,000" }

  it("sets the amount held now in minor units", async () => {
    const { client, calls } = fakeClient()
    expect(await updateCashOnHand(client, cash)).toEqual({ status: "success", message: "Cash in hand updated." })
    expect(writes(calls)).toEqual([
      { kind: "rpc", target: "set_cash_on_hand", payload: { p_account_id: cash.accountId, p_amount_minor: 1_000_000 } },
    ])
  })

  it("allows zero but not a negative amount", async () => {
    expect((await updateCashOnHand(fakeClient().client, { ...cash, amount: "0" })).status).toBe("success")
    const { client, calls } = fakeClient()
    expect(await updateCashOnHand(client, { ...cash, amount: "-5" })).toMatchObject({ fieldErrors: { amount: "Amount can't be negative" } })
    expect(writes(calls)).toEqual([])
  })

  it("explains an amount below today's cash income", async () => {
    const { client } = fakeClient({ rpcError: { code: "23514", message: "violates check constraint" } })
    expect(await updateCashOnHand(client, cash)).toMatchObject({
      fieldErrors: { amount: "That's less than the cash income you recorded today." },
    })
  })

  it("maps 'not a cash account' and 'already have cash'", async () => {
    expect((await updateCashOnHand(fakeClient({ rpcError: { code: "FC013", message: "raw" } }).client, cash))).toEqual({
      status: "error",
      message: "Only Cash in hand can be updated this way.",
    })
    const add = fakeClient({ writeError: { code: "FC012", message: "raw" } })
    expect(await saveAccount(add.client, { kind: "cash", name: "Cash in hand", currency: "INR", openingBalance: "500", openingBalanceDate: "2026-10-22" })).toEqual({
      status: "error",
      message: "You already have Cash in hand. Update its amount instead.",
    })
  })

  it("reports a missing account", async () => {
    expect(await updateCashOnHand(fakeClient({ accountCurrency: null }).client, cash)).toEqual({
      status: "error",
      message: "We couldn't find your cash account.",
    })
  })
})
