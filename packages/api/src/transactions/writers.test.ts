import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { saveTransaction, voidTransaction } from "./writers"

// Stand-in for the signed-in user's client: records every RPC and answers from the scenario.
type Scenario = {
  today?: string | null
  account?: { currency: string; kind: string } | null
  rpcError?: { code: string; message: string } | null
  voidedType?: string
}

function fakeClient(s: Scenario = {}) {
  const { today = "2026-10-23", account = { currency: "INR", kind: "bank" }, rpcError = null, voidedType = "expense" } = s
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []
  const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: account, error: null }) }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => builder,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "user_local_today") return today ? { data: today, error: null } : { data: null, error: { code: "08006", message: "offline" } }
      rpcs.push({ fn, args })
      if (rpcError) return { data: null, error: rpcError }
      return { data: { id: "row-1", type: voidedType }, error: null }
    },
  }
  return { client: client as unknown as UserClient, rpcs }
}

const KEY = "e0000000-0000-4000-8000-000000000001"
const ACC = "a0000000-0000-4000-8000-000000000001"
const ACC2 = "a0000000-0000-4000-8000-000000000002"
const CAT = "c0000000-0000-4000-8000-000000000001"
const expense = { type: "expense", amount: "2,480.50", categoryId: CAT, accountId: ACC, occurredOn: "2026-10-22", note: " Lunch ", paymentMode: "upi", idempotencyKey: KEY }

describe("saveTransaction", () => {
  it("records an expense once per request key, in minor units", async () => {
    const { client, rpcs } = fakeClient()
    expect(await saveTransaction(client, expense)).toEqual({ status: "success", message: "Expense saved." })
    expect(rpcs).toEqual([
      {
        fn: "record_transaction",
        args: {
          p_type: "expense", p_idempotency_key: KEY, p_amount_minor: 248050, p_occurred_on: "2026-10-22", p_account_id: ACC,
          p_category_id: CAT, p_counter_account_id: undefined, p_note: "Lunch", p_payment_mode: "upi",
        },
      },
    ])
  })

  it("drops the payment mode for a cash account", async () => {
    const { client, rpcs } = fakeClient({ account: { currency: "INR", kind: "cash" } })
    await saveTransaction(client, expense)
    expect(rpcs[0]?.args.p_payment_mode).toBeUndefined()
  })

  it("records a transfer without a category", async () => {
    const { client, rpcs } = fakeClient()
    const result = await saveTransaction(client, { type: "transfer", amount: "500", accountId: ACC, counterAccountId: ACC2, categoryId: CAT, occurredOn: "2026-10-22", idempotencyKey: KEY })
    expect(result).toEqual({ status: "success", message: "Transfer saved." })
    expect(rpcs[0]?.args).toMatchObject({ p_type: "transfer", p_counter_account_id: ACC2, p_category_id: undefined })
  })

  it.each([
    [{ type: "transfer", counterAccountId: ACC }, "counterAccountId", "Choose a different account"],
    [{ type: "transfer", counterAccountId: "" }, "counterAccountId", "Choose an account"],
    [{ categoryId: "" }, "categoryId", "Choose a category"],
    [{ type: "income", categoryId: "" }, "categoryId", "Choose a source"],
    [{ occurredOn: "2026-10-24" }, "occurredOn", "The date can't be in the future"],
    [{ amount: "0" }, "amount", undefined],
  ])("rejects %o on %s without saving", async (change, field, message) => {
    const { client, rpcs } = fakeClient()
    const result = await saveTransaction(client, { ...expense, ...change })
    expect(result.status).toBe("error")
    if (result.status === "error") {
      expect(result.fieldErrors?.[field]).toBeTruthy()
      if (message) expect(result.fieldErrors?.[field]).toBe(message)
    }
    expect(rpcs).toEqual([])
  })

  it("saves an edit of the version being viewed", async () => {
    const { client, rpcs } = fakeClient()
    const id = "e0000000-0000-4000-8000-0000000000aa"
    expect(await saveTransaction(client, { ...expense, transactionId: id })).toEqual({ status: "success", message: "Changes saved." })
    expect(rpcs[0]).toMatchObject({ fn: "edit_transaction", args: { p_transaction_id: id, p_idempotency_key: KEY } })
    expect(rpcs[0]?.args).not.toHaveProperty("p_type")
  })

  it.each([
    ["FC014", undefined, "changed elsewhere"],
    ["FC006", "categoryId", "can't be used"],
    ["FC016", "paymentMode", "bank account"],
    ["FC003", "occurredOn", "future"],
  ])("maps %s without showing database text", async (code, field, text) => {
    const { client } = fakeClient({ rpcError: { code, message: "raw database text" } })
    const result = await saveTransaction(client, expense)
    expect(JSON.stringify(result)).not.toContain("raw database text")
    expect(JSON.stringify(result)).toContain(text)
    if (field && result.status === "error") expect(result.fieldErrors?.[field]).toBeTruthy()
  })

  it("saves nothing when today can't be read from the database", async () => {
    const { client, rpcs } = fakeClient({ today: null })
    expect((await saveTransaction(client, expense)).status).toBe("error")
    expect(rpcs).toEqual([])
  })
})

describe("voidTransaction", () => {
  it("voids under the request key with a trimmed reason", async () => {
    const { client, rpcs } = fakeClient({ voidedType: "transfer" })
    const result = await voidTransaction(client, { transactionId: ACC, idempotencyKey: KEY, reason: " Entered twice " })
    expect(result).toEqual({ status: "success", message: "Transfer voided." })
    expect(rpcs).toEqual([{ fn: "void_transaction", args: { p_transaction_id: ACC, p_idempotency_key: KEY, p_reason: "Entered twice" } }])
  })

  it("needs an entry id and a request key", async () => {
    const { client, rpcs } = fakeClient()
    expect((await voidTransaction(client, { transactionId: "", idempotencyKey: KEY })).status).toBe("error")
    expect((await voidTransaction(client, { transactionId: ACC, idempotencyKey: "" })).status).toBe("error")
    expect(rpcs).toEqual([])
  })
})
