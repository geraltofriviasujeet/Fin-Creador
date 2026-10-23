import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { loadExpenseCategories, saveExpenseCategory, setExpenseCategoryArchived } from "./categories"

// Stand-in for the signed-in user's client: records each write and answers from the scenario.
function fakeClient({ error = null as { code: string; message: string } | null, rows = [] as unknown[] } = {}) {
  const calls: { op: string; payload?: unknown; filters: [string, unknown][] }[] = []
  const rpcs: string[] = []
  const from = () => {
    const call = { op: "select", payload: undefined as unknown, filters: [] as [string, unknown][] }
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (col: string, val: unknown) => {
        call.filters.push([col, val])
        return builder
      },
      insert: (payload: unknown) => {
        Object.assign(call, { op: "insert", payload })
        return builder
      },
      update: (payload: unknown) => {
        Object.assign(call, { op: "update", payload })
        return builder
      },
      maybeSingle: async () => {
        calls.push(call)
        return { data: error ? null : { id: "c1" }, error }
      },
      then: (resolve: (v: unknown) => unknown) => {
        calls.push(call)
        return Promise.resolve({ data: rows, error: null }).then(resolve)
      },
    }
    return builder
  }
  const client = { from, rpc: async (fn: string) => (rpcs.push(fn), { data: 12, error: null }) }
  return { client: client as unknown as UserClient, calls, rpcs }
}

const ID = "c0000000-0000-4000-8000-000000000001"

describe("expense categories", () => {
  it("adds with a trimmed name and an icon", async () => {
    const { client, calls } = fakeClient()
    expect(await saveExpenseCategory(client, { name: "  Pets ", icon: "other" })).toEqual({ status: "success", message: "Category added." })
    expect(calls[0]).toMatchObject({ op: "insert", payload: { kind: "expense", name: "Pets", icon: "other" } })
  })

  it("renames only an expense category", async () => {
    const { client, calls } = fakeClient()
    expect(await saveExpenseCategory(client, { id: ID, name: "Dining out", icon: "food" })).toEqual({ status: "success", message: "Category saved." })
    expect(calls[0]).toMatchObject({ op: "update", payload: { name: "Dining out", icon: "food" }, filters: [["id", ID], ["kind", "expense"]] })
  })

  it.each([
    [{ name: "", icon: "food" }, "name"],
    [{ name: "x".repeat(61), icon: "food" }, "name"],
    [{ name: "Pets", icon: "rocket" }, "icon"],
  ])("rejects %o without writing", async (input, field) => {
    const { client, calls } = fakeClient()
    const result = await saveExpenseCategory(client, input)
    expect(result.status === "error" && result.fieldErrors?.[field]).toBeTruthy()
    expect(calls).toEqual([])
  })

  it("explains a duplicate name on the name field", async () => {
    const { client } = fakeClient({ error: { code: "23505", message: "raw database text" } })
    expect(await saveExpenseCategory(client, { name: "Groceries", icon: "groceries" })).toEqual({
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { name: "You already have a category with this name." },
    })
  })

  it("archives and restores; a restore that would duplicate a name is explained", async () => {
    const ok = fakeClient()
    expect(await setExpenseCategoryArchived(ok.client, { id: ID, archived: true })).toEqual({ status: "success", message: "Category archived." })
    expect(await setExpenseCategoryArchived(ok.client, { id: ID, archived: false })).toEqual({ status: "success", message: "Category restored." })
    expect((ok.calls[1]?.payload as { archived_at: unknown }).archived_at).toBeNull()

    const dup = fakeClient({ error: { code: "23505", message: "raw database text" } })
    const result = await setExpenseCategoryArchived(dup.client, { id: ID, archived: false })
    expect(JSON.stringify(result)).not.toContain("raw database text")
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("Rename one of them first") })
  })

  it("creates the defaults when none exist yet", async () => {
    const { client, rpcs } = fakeClient({ rows: [] })
    expect(await loadExpenseCategories(client)).toEqual({ ok: true, categories: [] })
    expect(rpcs).toEqual(["ensure_my_expense_categories"])
  })
})
