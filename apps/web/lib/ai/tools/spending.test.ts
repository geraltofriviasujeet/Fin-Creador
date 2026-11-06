import { describe, expect, it } from "vitest"
import type { UserClient } from "@fin-creador/api"
import { resolvePeriod, spendingTool } from "./spending"
import { ToolError } from "./types"

// A stand-in for the signed-in user's client: answers transaction_summary from the rows given.
function fakeClient(rows: unknown[] | null, calls: unknown[] = []) {
  return {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args })
      return rows ? { data: rows, error: null } : { data: null, error: { code: "XX000", message: "down" } }
    },
  } as unknown as UserClient
}

const row = (currency: string, expense: number, refund = 0, counts = { expense: 3, refund: 0 }) => ({
  currency,
  income_minor: 0,
  expense_minor: expense,
  refund_minor: refund,
  income_count: 0,
  expense_count: counts.expense,
  refund_count: counts.refund,
  transfer_count: 0,
})

describe("spending periods (inclusive, the person's own today)", () => {
  const today = "2026-11-05"
  it("resolves the named periods", () => {
    expect(resolvePeriod({ period: "this_month" }, today)).toEqual({ ok: true, range: { start: "2026-11-01", end: today } })
    expect(resolvePeriod({ period: "last_month" }, today)).toEqual({ ok: true, range: { start: "2026-10-01", end: "2026-10-31" } })
    expect(resolvePeriod({ period: "this_year" }, today)).toEqual({ ok: true, range: { start: "2026-01-01", end: today } })
    expect(resolvePeriod({ period: "last_year" }, today)).toEqual({ ok: true, range: { start: "2025-01-01", end: "2025-12-31" } })
    expect(resolvePeriod({ period: "last_7_days" }, today)).toEqual({ ok: true, range: { start: "2026-10-30", end: today } })
    expect(resolvePeriod({ period: "last_30_days" }, today)).toEqual({ ok: true, range: { start: "2026-10-07", end: today } })
  })

  it("crosses the year in January and handles a leap February", () => {
    expect(resolvePeriod({ period: "last_month" }, "2027-01-10")).toEqual({ ok: true, range: { start: "2026-12-01", end: "2026-12-31" } })
    expect(resolvePeriod({ period: "last_month" }, "2028-03-01")).toEqual({ ok: true, range: { start: "2028-02-01", end: "2028-02-29" } })
  })

  it("checks custom ranges and cuts them at today", () => {
    expect(resolvePeriod({ period: "custom", from: "2026-10-15", to: "2026-12-31" }, today)).toEqual({
      ok: true,
      range: { start: "2026-10-15", end: today },
    })
    expect(resolvePeriod({ period: "custom", from: "2026-10-15" }, today)).toMatchObject({ ok: false })
    expect(resolvePeriod({ period: "custom", from: "2026-10-31", to: "2026-10-01" }, today)).toMatchObject({ ok: false })
    expect(resolvePeriod({ period: "custom", from: "2026-12-01", to: "2026-12-31" }, today)).toMatchObject({ ok: false })
    expect(resolvePeriod({ period: "custom", from: "2020-01-01", to: today }, today)).toMatchObject({ ok: false })
  })

  it("accepts only the documented input", () => {
    expect(spendingTool.input.safeParse({ period: "last_month" }).success).toBe(true)
    expect(spendingTool.input.safeParse({ period: "forever" }).success).toBe(false)
    expect(spendingTool.input.safeParse({ period: "last_month", sql: "select 1" }).success).toBe(false)
  })
})

describe("spending_for_period", () => {
  const ctx = (rows: unknown[] | null, calls: unknown[] = []) => ({ supabase: fakeClient(rows, calls), today: "2026-11-05", currency: "INR" })

  it("returns the Overview's spending figure for the period, formatted, with figures to check against", async () => {
    const calls: unknown[] = []
    const out = await spendingTool.run(ctx([row("INR", 1234550, 50000, { expense: 17, refund: 1 }), row("USD", 1000)], calls), { period: "last_month" })
    expect(calls).toEqual([
      { name: "transaction_summary", args: expect.objectContaining({ p_from: "2026-10-01", p_to: "2026-10-31" }) },
    ])
    expect(out.data).toMatchObject({
      period: { from: "2026-10-01", to: "2026-10-31" },
      spent: "₹12,345.50",
      refunds: "₹500",
      expense_count: 17,
      other_currency_entries: 3,
    })
    expect(out.figures[0]).toEqual({ label: "Spent", kind: "money", minor: 1234550, currency: "INR" })
    expect(out.period).toEqual({ start: "2026-10-01", end: "2026-10-31" })
  })

  it("says zero when nothing was spent", async () => {
    const out = await spendingTool.run(ctx([]), { period: "this_month" })
    expect(out.data).toMatchObject({ spent: "₹0", expense_count: 0 })
  })

  it("fails plainly when the figures can't be loaded or the period is invalid", async () => {
    await expect(spendingTool.run(ctx(null), { period: "this_month" })).rejects.toBeInstanceOf(ToolError)
    await expect(spendingTool.run(ctx([]), { period: "custom" })).rejects.toBeInstanceOf(ToolError)
  })
})
