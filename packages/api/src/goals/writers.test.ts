import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { saveGoal, setCategoryBudget, setGoalSaved } from "./writers"

const KEY = "e6000000-0000-4000-8000-000000000001"
const GOAL = "90000000-0000-4000-8000-000000000001"
const CAT = "c0000000-0000-4000-8000-000000000001"

type Call = { table: string; op: string; values?: Record<string, unknown>; filters: [string, unknown][] }
type Answer = { data: unknown; error: { code: string; message: string } | null }

/**
 * Stand-in for the signed-in user's client. Records every table call; `answer` decides what
 * each one returns (by table and operation, e.g. "goals.insert").
 */
function fakeClient(answer: (call: Call) => Answer = () => ({ data: null, error: null })) {
  const calls: Call[] = []
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []
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
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "user_local_today") return { data: "2026-10-26", error: null }
      rpcs.push({ fn, args })
      return { data: {}, error: null }
    },
  }
  return { client: client as unknown as UserClient, calls, rpcs }
}

const profile = (call: Call): Answer | null => (call.table === "profiles" ? { data: { currency: "INR" }, error: null } : null)

const tripInput = {
  type: "trip",
  name: "Japan in spring",
  targetDate: "2027-03-20",
  saved: "20000",
  idempotencyKey: KEY,
  scope: "international",
  place: "Japan",
  people: "2",
  days: "8",
  travelMode: "flight",
  stay: "hotel",
  cost_transport: "90000",
  cost_stay: "64000",
}

describe("saveGoal", () => {
  it("adds a goal with the target recomputed from the answers, never taken from the client", async () => {
    const { client, calls } = fakeClient((call) => profile(call) ?? { data: { id: GOAL }, error: null })
    const result = await saveGoal(client, { ...tripInput, targetAmount: "1", target_amount_minor: "1", amount: "1" })
    expect(result).toEqual({ status: "success", message: "Goal added.", goalId: GOAL })
    const insert = calls.find((c) => c.op === "insert")
    expect(insert?.values).toMatchObject({ type: "trip", target_amount_minor: 154_000_00, saved_amount_minor: 20_000_00, idempotency_key: KEY })
    expect(insert?.values).not.toHaveProperty("currency")
  })

  it("returns the existing goal when the request key was already used (double submit)", async () => {
    const { client, calls } = fakeClient((call) => {
      if (call.table === "profiles") return { data: { currency: "INR" }, error: null }
      if (call.op === "insert") return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "goals_idempotency_unique"' } }
      return { data: { id: GOAL }, error: null }
    })
    expect(await saveGoal(client, tripInput)).toEqual({ status: "success", message: "Goal added.", goalId: GOAL })
    expect(calls.filter((c) => c.op === "insert")).toHaveLength(1)
    expect(calls.at(-1)).toMatchObject({ table: "goals", op: "select", filters: [["idempotency_key", KEY]] })
  })

  it("reports other unique violations as errors", async () => {
    const { client } = fakeClient((call) =>
      profile(call) ?? { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "goals_pkey"' } },
    )
    expect((await saveGoal(client, tripInput)).status).toBe("error")
  })

  it("an edit recomputes the target, keeps the goal's type and currency", async () => {
    const { client, calls } = fakeClient((call) => {
      if (call.op === "select") return { data: { id: GOAL, type: "car", currency: "INR", target_date: "2026-10-01", archived_at: null }, error: null }
      return { data: [{ id: GOAL }], error: null }
    })
    const result = await saveGoal(client, {
      goalId: GOAL,
      type: "trip", // ignored: the stored type wins
      name: "Car",
      targetDate: "2026-10-01", // in the past but unchanged: allowed
      condition: "used",
      model: "Sedan",
      payment: "loan_down_payment",
      price: "6,00,000",
      extras: "20,000",
      downPayment: "1,50,000",
      rate: "9.5",
      months: "48",
    })
    expect(result).toEqual({ status: "success", message: "Goal saved.", goalId: GOAL })
    const update = calls.find((c) => c.op === "update")
    expect(update?.values).toMatchObject({ target_amount_minor: 1_70_000_00, target_date: "2026-10-01" })
    expect(update?.values).not.toHaveProperty("type")
    expect(update?.values).not.toHaveProperty("currency")
  })

  it("does not write when the form is invalid", async () => {
    const { client, calls } = fakeClient((call) => profile(call) ?? { data: null, error: null })
    const result = await saveGoal(client, { ...tripInput, people: "0" })
    expect(result.status === "error" && result.fieldErrors?.people).toBeTruthy()
    expect(calls.some((c) => c.op !== "select")).toBe(false)
  })
})

describe("setGoalSaved", () => {
  it("changes only the saved amount", async () => {
    const { client, calls } = fakeClient((call) =>
      call.op === "select" ? { data: { id: GOAL, type: "other", currency: "INR", target_date: null, archived_at: null }, error: null } : { data: [{ id: GOAL }], error: null },
    )
    expect((await setGoalSaved(client, { goalId: GOAL, saved: "5,000" })).status).toBe("success")
    expect(calls.find((c) => c.op === "update")?.values).toEqual({ saved_amount_minor: 5_000_00 })
  })

  it("maps an archived goal to its message", async () => {
    const { client } = fakeClient((call) =>
      call.op === "select" ? { data: { id: GOAL, type: "other", currency: "INR", target_date: null, archived_at: "x" }, error: null } : { data: null, error: { code: "FC024", message: "Goal is archived" } },
    )
    expect(await setGoalSaved(client, { goalId: GOAL, saved: "1" })).toEqual({ status: "error", message: "This goal is archived. Restore it first." })
  })
})

describe("setCategoryBudget", () => {
  it("sends the month's first day and minor units", async () => {
    const { client, rpcs } = fakeClient((call) => profile(call) ?? { data: null, error: null })
    expect(await setCategoryBudget(client, { categoryId: CAT, month: "2026-11", amount: "12,000" })).toEqual({ status: "success", message: "Budget saved." })
    expect(rpcs).toEqual([{ fn: "set_category_budget", args: { p_category_id: CAT, p_effective_from: "2026-11-01", p_amount_minor: 12_000_00 } }])
  })

  it("refuses a past month without calling the database", async () => {
    const { client, rpcs } = fakeClient((call) => profile(call) ?? { data: null, error: null })
    const result = await setCategoryBudget(client, { categoryId: CAT, month: "2026-09", amount: "100" })
    expect(result.status === "error" && result.fieldErrors?.month).toBeTruthy()
    expect(rpcs).toEqual([])
  })
})
