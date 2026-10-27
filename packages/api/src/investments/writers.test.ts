import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { saveHolding } from "./writers"

const KEY = "e7000000-0000-4000-8000-000000000001"
const HOLDING = "97000000-0000-4000-8000-000000000001"
const INSTRUMENT = "a7000000-0000-4000-8000-000000000001"

type Call = { table: string; op: string; values?: Record<string, unknown>; filters: [string, unknown][] }
type Answer = { data: unknown; error: { code: string; message: string } | null }

/** Stand-in for the signed-in user's client; `answer` decides what each table call returns. */
function fakeClient(answer: (call: Call) => Answer) {
  const calls: Call[] = []
  const query = (table: string) => {
    const call: Call = { table, op: "select", filters: [] }
    const settle = async () => {
      calls.push(call)
      return answer(call)
    }
    const builder = {
      select: () => builder,
      insert: (values: Record<string, unknown>) => Object.assign(call, { op: "insert", values }) && builder,
      update: (values: Record<string, unknown>) => Object.assign(call, { op: "update", values }) && builder,
      eq: (column: string, value: unknown) => (call.filters.push([column, value]), builder),
      single: settle,
      maybeSingle: settle,
      then: (resolve: (a: Answer) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject),
    }
    return builder
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: query,
    rpc: async () => ({ data: "2026-10-26", error: null }),
  }
  return { client: client as unknown as UserClient, calls }
}

const input = { instrumentId: INSTRUMENT, units: "12.5", buyPrice: "1,250.50", buyDate: "2026-10-01", idempotencyKey: KEY }
const duplicate = { code: "23505", message: 'duplicate key value violates unique constraint "investments_idempotency_unique"' }

describe("saveHolding", () => {
  it("adds a record with scaled units and price, without isin_at_entry", async () => {
    const { client, calls } = fakeClient(() => ({ data: { id: HOLDING }, error: null }))
    expect(await saveHolding(client, input)).toEqual({ status: "success", message: "Holding added.", holdingId: HOLDING })
    const insert = calls.find((c) => c.op === "insert")
    expect(insert?.values).toEqual({
      instrument_id: INSTRUMENT,
      units_scaled: 125_000,
      buy_price_scaled: 12_505_000,
      buy_date: "2026-10-01",
      idempotency_key: KEY,
    })
  })

  it("returns the existing record when the request key was already used (double submit)", async () => {
    const { client, calls } = fakeClient((call) =>
      call.op === "insert" ? { data: null, error: duplicate } : { data: { id: HOLDING }, error: null },
    )
    expect(await saveHolding(client, input)).toEqual({ status: "success", message: "Holding added.", holdingId: HOLDING })
    expect(calls.filter((c) => c.op === "insert")).toHaveLength(1)
    expect(calls.at(-1)).toMatchObject({ table: "investments", op: "select", filters: [["idempotency_key", KEY]] })
  })

  it("reports other unique violations as errors", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: "23505", message: 'violates unique constraint "investments_pkey"' } }))
    expect((await saveHolding(client, input)).status).toBe("error")
  })

  it("edits in place without the instrument or request key", async () => {
    const { client, calls } = fakeClient(() => ({ data: [{ id: HOLDING }], error: null }))
    expect(await saveHolding(client, { ...input, holdingId: HOLDING })).toEqual({ status: "success", message: "Holding saved.", holdingId: HOLDING })
    const update = calls.find((c) => c.op === "update")
    expect(update?.values).toEqual({ units_scaled: 125_000, buy_price_scaled: 12_505_000, buy_date: "2026-10-01" })
    expect(update?.filters).toEqual([["id", HOLDING]])
  })

  it("maps database errors to the form field", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: "FC028", message: "x" } }))
    expect(await saveHolding(client, input)).toEqual({
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { buyDate: "The buy date can't be in the future." },
    })
  })

  it("does not write when the form is invalid", async () => {
    const { client, calls } = fakeClient(() => ({ data: null, error: null }))
    expect((await saveHolding(client, { ...input, units: "0" })).status).toBe("error")
    expect(calls).toHaveLength(0)
  })
})
