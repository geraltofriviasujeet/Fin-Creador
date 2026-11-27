import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { spendLimitLabel } from "./label"
import { loadSpendLimit } from "./load"
import { removeSpendLimit, saveSpendLimit } from "./writers"

type Answer = { data: unknown; error: { code: string; message: string } | null }

/** Stand-in for the signed-in user's client: records rpc calls and table deletes. */
function fakeClient({
  row = null as unknown,
  rpcError = null as Answer["error"],
  signedIn = true,
  selectError = null as Answer["error"],
} = {}) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []
  const deletes: { table: string; filters: [string, unknown][] }[] = []
  const query = (table: string) => {
    const filters: [string, unknown][] = []
    let op = "select"
    const settle = async (): Promise<Answer> => {
      if (op === "delete") {
        deletes.push({ table, filters })
        return { data: null, error: null }
      }
      if (table === "profiles") return { data: { currency: "INR" }, error: null }
      return { data: row, error: selectError }
    }
    const builder = {
      select: () => builder,
      delete: () => ((op = "delete"), builder),
      eq: (column: string, value: unknown) => (filters.push([column, value]), builder),
      maybeSingle: settle,
      then: (resolve: (a: Answer) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject),
    }
    return builder
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "user-1" } : null } }) },
    from: query,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "user_local_today") return signedIn ? { data: "2026-11-27", error: null } : { data: null, error: null }
      rpcs.push({ fn, args })
      return { data: {}, error: rpcError }
    },
  }
  return { client: client as unknown as UserClient, rpcs, deletes }
}

describe("saveSpendLimit", () => {
  it("sends a fixed period's day count and the amount in paise", async () => {
    const { client, rpcs } = fakeClient()
    expect(await saveSpendLimit(client, { period: "week", amount: "7,000" })).toEqual({ status: "success", message: "Daily spend limit saved." })
    expect(rpcs).toEqual([{ fn: "set_spend_limit", args: { p_amount_minor: 700_000, p_period: "week", p_period_days: 7 } }])
  })

  it("sends no day count for a month and the chosen count for custom", async () => {
    const { client, rpcs } = fakeClient()
    await saveSpendLimit(client, { period: "month", amount: "30000" })
    await saveSpendLimit(client, { period: "custom", days: "10", amount: "5000" })
    expect(rpcs.map((r) => r.args)).toEqual([
      { p_amount_minor: 3_000_000, p_period: "month" },
      { p_amount_minor: 500_000, p_period: "custom", p_period_days: 10 },
    ])
  })

  it("returns field errors and writes nothing for a bad form", async () => {
    const { client, rpcs } = fakeClient()
    expect(await saveSpendLimit(client, { period: "custom", days: "400", amount: "0" })).toEqual({
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { days: "Enter 2 to 365 days" },
    })
    expect(rpcs).toEqual([])
  })

  it("says the session ended when signed out", async () => {
    const { client, rpcs } = fakeClient({ signedIn: false })
    expect(await saveSpendLimit(client, { period: "day", amount: "1000" })).toEqual({
      status: "error",
      message: "Your session has ended. Please sign in again.",
    })
    expect(rpcs).toEqual([])
  })

  it("reports a database refusal without crashing", async () => {
    const { client } = fakeClient({ rpcError: { code: "23514", message: "spend_limits_period" } })
    const result = await saveSpendLimit(client, { period: "day", amount: "1000" })
    expect(result.status).toBe("error")
  })
})

describe("removeSpendLimit", () => {
  it("deletes the signed-in person's row", async () => {
    const { client, deletes } = fakeClient()
    expect(await removeSpendLimit(client)).toEqual({ status: "success", message: "Daily spend limit removed." })
    expect(deletes).toEqual([{ table: "spend_limits", filters: [["user_id", "user-1"]] }])
  })

  it("deletes nothing when signed out", async () => {
    const { client, deletes } = fakeClient({ signedIn: false })
    expect((await removeSpendLimit(client)).status).toBe("error")
    expect(deletes).toEqual([])
  })
})

describe("loadSpendLimit", () => {
  it("returns null when no limit is set", async () => {
    expect(await loadSpendLimit(fakeClient().client)).toEqual({ ok: true, data: null })
  })

  it("maps the row", async () => {
    const row = { amount_minor: 500_000, currency: "INR", period: "custom", period_days: 10, starts_on: "2026-11-20" }
    expect(await loadSpendLimit(fakeClient({ row }).client)).toEqual({
      ok: true,
      data: { amountMinor: 500_000, currency: "INR", period: "custom", periodDays: 10, startsOn: "2026-11-20" },
    })
  })

  it("is unavailable when the read fails or the row is not valid", async () => {
    expect(await loadSpendLimit(fakeClient({ selectError: { code: "500", message: "x" } }).client)).toEqual({ ok: false, reason: "unavailable" })
    const row = { amount_minor: 100, currency: "INR", period: "fortnight", period_days: 14, starts_on: "2026-11-20" }
    expect(await loadSpendLimit(fakeClient({ row }).client)).toEqual({ ok: false, reason: "unavailable" })
  })
})

describe("spendLimitLabel", () => {
  const label = (amountMinor: number, period: "day" | "week" | "month" | "custom", periodDays: number | null) =>
    spendLimitLabel({ amountMinor, currency: "INR", period, periodDays })

  it("shows what the person set", () => {
    expect(label(100_000, "day", 1)).toBe("₹1,000 / day")
    expect(label(700_000, "week", 7)).toBe("₹7,000 / week")
    expect(label(3_000_000, "month", null)).toBe("₹30,000 / month")
    expect(label(500_000, "custom", 10)).toBe("₹5,000 / 10 days")
  })

  it("keeps paise when the amount has them, and groups in lakhs", () => {
    expect(label(100_050, "day", 1)).toBe("₹1,000.50 / day")
    expect(label(15_000_000, "month", null)).toBe("₹1,50,000 / month")
  })
})
