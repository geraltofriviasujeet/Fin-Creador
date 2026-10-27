import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { deleteFixedDeposit, saveFixedDeposit, setFixedDepositArchived } from "./fixed-deposit-writers"

const KEY = "e7000000-0000-4000-8000-000000000003"
const DEPOSIT = "f7000000-0000-4000-8000-000000000001"

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
      delete: () => Object.assign(call, { op: "delete" }) && builder,
      eq: (column: string, value: unknown) => (call.filters.push([column, value]), builder),
      not: (column: string, operator: string, value: unknown) => (call.filters.push([`not.${column}.${operator}`, value]), builder),
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

const input = {
  bank: "State Bank of India",
  label: "Emergency fund",
  principal: "1,00,000",
  rate: "7.25",
  compounding: "",
  startDate: "2026-01-15",
  maturityDate: "2027-01-15",
  idempotencyKey: KEY,
}
const duplicate = { code: "23505", message: 'duplicate key value violates unique constraint "fixed_deposits_idempotency_unique"' }
const stored = {
  bank: "State Bank of India",
  label: "Emergency fund",
  principal_minor: 10_000_000,
  rate_bps: 725,
  compounding: "quarterly",
  start_date: "2026-01-15",
  maturity_date: "2027-01-15",
}

describe("saveFixedDeposit", () => {
  it("adds a deposit in minor units and basis points", async () => {
    const { client, calls } = fakeClient(() => ({ data: { id: DEPOSIT }, error: null }))
    expect(await saveFixedDeposit(client, input)).toEqual({ status: "success", message: "Fixed deposit added.", depositId: DEPOSIT })
    expect(calls.find((c) => c.op === "insert")?.values).toEqual({ ...stored, idempotency_key: KEY })
  })

  it("returns the existing deposit when the request key was already used (double submit)", async () => {
    const { client, calls } = fakeClient((call) => (call.op === "insert" ? { data: null, error: duplicate } : { data: { id: DEPOSIT }, error: null }))
    expect(await saveFixedDeposit(client, input)).toEqual({ status: "success", message: "Fixed deposit added.", depositId: DEPOSIT })
    expect(calls.filter((c) => c.op === "insert")).toHaveLength(1)
    expect(calls.at(-1)).toMatchObject({ table: "fixed_deposits", op: "select", filters: [["idempotency_key", KEY]] })
  })

  it("edits in place without the request key; a blank label is no label", async () => {
    const { client, calls } = fakeClient(() => ({ data: [{ id: DEPOSIT }], error: null }))
    expect(await saveFixedDeposit(client, { ...input, depositId: DEPOSIT, idempotencyKey: "", label: " " })).toEqual({
      status: "success",
      message: "Fixed deposit saved.",
      depositId: DEPOSIT,
    })
    const update = calls.find((c) => c.op === "update")
    expect(update?.values).toEqual({ ...stored, label: null })
    expect(update?.filters).toEqual([["id", DEPOSIT]])
  })

  it("maps database errors to the form or the dialog", async () => {
    const future = fakeClient(() => ({ data: null, error: { code: "FC031", message: "x" } }))
    expect(await saveFixedDeposit(future.client, input)).toEqual({
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { startDate: "The start date can't be in the future." },
    })
    const archived = fakeClient(() => ({ data: null, error: { code: "FC030", message: "x" } }))
    expect(await saveFixedDeposit(archived.client, { ...input, depositId: DEPOSIT })).toEqual({
      status: "error",
      message: "This fixed deposit is archived. Restore it first.",
    })
  })

  it("does not write when the form is invalid", async () => {
    const { client, calls } = fakeClient(() => ({ data: null, error: null }))
    expect((await saveFixedDeposit(client, { ...input, rate: "26" })).status).toBe("error")
    expect(calls).toHaveLength(0)
  })
})

describe("archive, restore and delete", () => {
  it("archives and restores by id (the database stamps the time)", async () => {
    const { client, calls } = fakeClient(() => ({ data: [{ id: DEPOSIT }], error: null }))
    expect(await setFixedDepositArchived(client, { depositId: DEPOSIT, archived: true })).toMatchObject({ message: "Fixed deposit archived." })
    expect(typeof calls[0]?.values?.archived_at).toBe("string")
    expect(await setFixedDepositArchived(client, { depositId: DEPOSIT, archived: false })).toMatchObject({ message: "Fixed deposit restored." })
    expect(calls[1]?.values).toEqual({ archived_at: null })
  })

  it("reports a deposit it can't see (another user's, or gone)", async () => {
    const { client } = fakeClient(() => ({ data: [], error: null }))
    expect(await setFixedDepositArchived(client, { depositId: DEPOSIT, archived: true })).toEqual({
      status: "error",
      message: "We couldn't find that fixed deposit. Reload and try again.",
    })
  })

  it("deletes archived deposits only", async () => {
    const { client, calls } = fakeClient(() => ({ data: [{ id: DEPOSIT }], error: null }))
    expect(await deleteFixedDeposit(client, { depositId: DEPOSIT })).toEqual({ status: "success", message: "Fixed deposit deleted." })
    expect(calls[0]).toMatchObject({ op: "delete", filters: [["id", DEPOSIT], ["not.archived_at.is", null]] })
    const active = fakeClient(() => ({ data: [], error: null }))
    expect(await deleteFixedDeposit(active.client, { depositId: DEPOSIT })).toEqual({
      status: "error",
      message: "Only an archived fixed deposit can be deleted. Reload and try again.",
    })
  })
})
