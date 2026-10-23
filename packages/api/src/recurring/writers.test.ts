import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { confirmRecurringOccurrence, saveRecurringRule, setRecurringRuleArchived, skipRecurringOccurrence, undoRecurringSkip } from "./writers"

// Stand-in for the signed-in user's client: records every RPC and answers from the scenario.
function fakeClient({ account = { currency: "INR", kind: "bank" } as { currency: string; kind: string } | null, rpcError = null as { code: string; message: string } | null } = {}) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []
  const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: account, error: null }) }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => builder,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "user_local_today") return { data: "2026-10-24", error: null }
      rpcs.push({ fn, args })
      return { data: rpcError ? null : { id: "row-1" }, error: rpcError }
    },
  }
  return { client: client as unknown as UserClient, rpcs }
}

const KEY = "e0000000-0000-4000-8000-000000000001"
const RULE = "d0000000-0000-4000-8000-000000000001"
const ACC = "a0000000-0000-4000-8000-000000000001"
const CAT = "c0000000-0000-4000-8000-000000000001"
const add = { type: "expense", amount: "649", categoryId: CAT, accountId: ACC, paymentMode: "upi", frequency: "monthly", startDate: "2026-10-01", note: " Streaming ", idempotencyKey: KEY }

describe("saveRecurringRule", () => {
  it("adds a rule once per request key, in minor units", async () => {
    const { client, rpcs } = fakeClient()
    expect(await saveRecurringRule(client, add)).toEqual({ status: "success", message: "Recurring item added." })
    expect(rpcs).toEqual([
      {
        fn: "create_recurring_rule",
        args: {
          p_idempotency_key: KEY, p_type: "expense", p_frequency: "monthly", p_start_date: "2026-10-01", p_amount_minor: 64900,
          p_account_id: ACC, p_category_id: CAT, p_counter_account_id: undefined, p_payment_mode: "upi", p_note: "Streaming", p_end_date: undefined,
        },
      },
    ])
  })

  it("edits without sending the type, frequency or start date", async () => {
    const { client, rpcs } = fakeClient()
    expect(await saveRecurringRule(client, { ...add, ruleId: RULE, idempotencyKey: "", endDate: "2027-10-01" })).toEqual({ status: "success", message: "Recurring item saved." })
    expect(rpcs[0]?.fn).toBe("update_recurring_rule")
    expect(rpcs[0]?.args).toMatchObject({ p_rule_id: RULE, p_end_date: "2027-10-01" })
    expect(rpcs[0]?.args).not.toHaveProperty("p_frequency")
  })

  it.each([
    [{ endDate: "2026-09-30" }, "endDate"],
    [{ frequency: "daily" }, "frequency"],
    [{ categoryId: "" }, "categoryId"],
    [{ idempotencyKey: "" }, "idempotencyKey"],
  ])("rejects %o without saving", async (change, field) => {
    const { client, rpcs } = fakeClient()
    const result = await saveRecurringRule(client, { ...add, ...change })
    expect(result.status === "error" && result.fieldErrors?.[field]).toBeTruthy()
    expect(rpcs).toEqual([])
  })

  it("puts an end date before a saved entry on the end date field", async () => {
    const { client } = fakeClient({ rpcError: { code: "FC022", message: "raw database text" } })
    const result = await saveRecurringRule(client, { ...add, ruleId: RULE, endDate: "2026-10-01" })
    expect(result).toMatchObject({ status: "error", fieldErrors: { endDate: expect.stringContaining("before an entry") } })
  })
})

describe("confirm, skip, undo, archive", () => {
  const confirm = { ruleId: RULE, occurrenceDate: "2026-10-01", amount: "649", occurredOn: "2026-10-03", accountId: ACC, paymentMode: "upi", note: "", idempotencyKey: KEY, type: "expense" }

  it("confirms with the entered date and the occurrence date", async () => {
    const { client, rpcs } = fakeClient()
    expect(await confirmRecurringOccurrence(client, confirm)).toEqual({ status: "success", message: "Expense saved." })
    expect(rpcs[0]).toMatchObject({ fn: "confirm_recurring_occurrence", args: { p_rule_id: RULE, p_occurrence_date: "2026-10-01", p_occurred_on: "2026-10-03", p_amount_minor: 64900 } })
  })

  it("refuses a future entry date without saving, and explains a second confirm", async () => {
    const future = fakeClient()
    expect((await confirmRecurringOccurrence(future.client, { ...confirm, occurredOn: "2026-10-25" })).status).toBe("error")
    expect(future.rpcs).toEqual([])
    const twice = fakeClient({ rpcError: { code: "FC020", message: "raw database text" } })
    expect(JSON.stringify(await confirmRecurringOccurrence(twice.client, confirm))).toContain("already saved or skipped")
  })

  it("skips with a trimmed reason, undoes, archives and restores", async () => {
    const { client, rpcs } = fakeClient()
    expect((await skipRecurringOccurrence(client, { ruleId: RULE, occurrenceDate: "2026-10-01", reason: " by hand ", idempotencyKey: KEY })).status).toBe("success")
    expect(rpcs[0]?.args).toMatchObject({ p_reason: "by hand" })
    expect((await undoRecurringSkip(client, { ruleId: RULE, occurrenceDate: "2026-10-01" })).status).toBe("success")
    expect(await setRecurringRuleArchived(client, { ruleId: RULE, archived: false })).toEqual({ status: "success", message: "Recurring item restored." })
    expect(rpcs.map((r) => r.fn)).toEqual(["skip_recurring_occurrence", "undo_recurring_skip", "set_recurring_rule_archived"])
  })

  it("explains an undo that isn't the latest", async () => {
    const { client } = fakeClient({ rpcError: { code: "FC021", message: "raw database text" } })
    expect(await undoRecurringSkip(client, { ruleId: RULE, occurrenceDate: "2026-09-01" })).toEqual({
      status: "error",
      message: "Only the latest saved or skipped date can be undone.",
    })
  })
})
