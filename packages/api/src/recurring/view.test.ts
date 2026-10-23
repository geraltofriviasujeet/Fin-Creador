import { describe, expect, it } from "vitest"
import type { LedgerAccount, LedgerCategory } from "../transactions/types"
import { type RecurringRule, buildRecurringView, showCostTile } from "./view"

const today = "2026-10-24"
const account = (id: string, archived = false, currency = "INR"): LedgerAccount => ({
  id, kind: "bank", bankType: "savings", label: id, currency, openingBalanceMinor: 0, openingBalanceDate: "2026-01-01",
  inflowMinor: 0, outflowMinor: 0, archived,
})
const category = (id: string, key: LedgerCategory["key"] = null, archived = false, name = id): LedgerCategory => ({
  id, kind: "expense", name, icon: "other", archived, defaultAccountId: null, key,
})
const rule = (id: string, over: Partial<RecurringRule> = {}): RecurringRule => ({
  id, type: "expense", amountMinor: 64_900, currency: "INR", accountId: "bank", counterAccountId: null, categoryId: "sub",
  paymentMode: null, note: id, frequency: "monthly", startDate: "2026-08-01", endDate: null, archived: false, ...over,
})

const accounts = [account("bank"), account("old", true), account("usd", false, "USD")]
const categories = [category("sub", "subscription", false, "Apps & streaming"), category("club", "membership"), category("rent"), category("gym", null, true)]

function view(rules: RecurringRule[], progress: Record<string, { lastPostedOn?: string; lastSkippedOn?: string }> = {}) {
  const p = new Map(Object.entries(progress).map(([id, v]) => [id, { lastPostedOn: v.lastPostedOn ?? null, lastSkippedOn: v.lastSkippedOn ?? null }]))
  return buildRecurringView({ rules, progress: p, accounts, categories, today, currency: "INR" })
}

describe("buildRecurringView", () => {
  it("sorts rules into Due, Needs attention, Coming in 30 days, Ended and Archived", () => {
    const v = view(
      [
        rule("due"), // 1 Oct not handled
        rule("posted"),
        rule("blocked", { accountId: "old" }),
        rule("later", { startDate: "2027-01-01" }), // beyond 30 days
        rule("ended", { endDate: "2026-09-01" }),
        rule("archived", { archived: true }),
      ],
      { posted: { lastPostedOn: "2026-10-01" }, ended: { lastPostedOn: "2026-09-01" } }
    )
    expect(v.due.map((i) => [i.rule.id, i.date])).toEqual([["due", "2026-10-01"]])
    expect(v.attention.map((i) => i.rule.id)).toEqual(["blocked"])
    expect(v.attention[0]?.attention).toContain("old is archived")
    expect(v.soon.map((i) => [i.rule.id, i.date])).toEqual([["posted", "2026-11-01"]])
    expect(v.ended.map((i) => i.rule.id)).toEqual(["ended"])
    expect(v.archived.map((i) => i.rule.id)).toEqual(["archived"])
  })

  it("groups active rules by the category key, whatever the category is called; ended ones stay out", () => {
    const v = view([rule("s"), rule("m", { categoryId: "club" }), rule("o", { categoryId: "rent" }), rule("e", { endDate: "2026-09-01" })], {
      e: { lastPostedOn: "2026-09-01" },
    })
    expect(Object.fromEntries(Object.entries(v.groups).map(([g, items]) => [g, items.map((i) => i.rule.id)]))).toEqual({
      subscription: ["s"],
      membership: ["m"],
      other: ["o"],
    })
  })

  it("costs count active expense rules (needs attention too), never ended, income or transfers", () => {
    const v = view([
      rule("s"), // 64,900 x 12
      rule("blocked", { categoryId: "gym", amountMinor: 10_000 }), // needs attention, other: 10,000 x 12
      rule("ended", { endDate: "2026-09-01", amountMinor: 99_999 }),
      rule("income", { type: "income", amountMinor: 95_00_000 }),
      rule("move", { type: "transfer", categoryId: null, counterAccountId: "old", amountMinor: 5_000 }),
    ], { ended: { lastPostedOn: "2026-09-01" } }) // (an ended rule whose last date is still unhandled stays due)
    expect(v.costs).toEqual([
      {
        currency: "INR",
        subscriptions: { yearlyMinor: 7_78_800, monthlyMinor: 64_900, count: 1 },
        memberships: { yearlyMinor: 0, monthlyMinor: 0, count: 0 },
        total: { yearlyMinor: 8_98_800, monthlyMinor: 74_900, count: 2 },
      },
    ])
  })

  it("always has profile-currency tiles; other currencies show only their non-empty tiles", () => {
    const empty = view([])
    expect(empty.costs.map((c) => c.currency)).toEqual(["INR"])
    expect(showCostTile(empty.costs[0]!, "memberships", "INR")).toBe(true)

    const usd = view([rule("cloud", { currency: "USD", accountId: "usd", amountMinor: 299 })])
    expect(usd.costs.map((c) => c.currency)).toEqual(["INR", "USD"])
    expect(showCostTile(usd.costs[1]!, "subscriptions", "INR")).toBe(true)
    expect(showCostTile(usd.costs[1]!, "memberships", "INR")).toBe(false)
  })

  it("offers Undo only while the skip is the latest handled occurrence", () => {
    const v = view([rule("a"), rule("b")], {
      a: { lastPostedOn: "2026-09-01", lastSkippedOn: "2026-10-01" },
      b: { lastPostedOn: "2026-10-01", lastSkippedOn: "2026-09-01" },
    })
    const byId = new Map([...v.soon, ...v.due].map((i) => [i.rule.id, i]))
    expect(byId.get("a")?.undoableSkip).toBe("2026-10-01")
    expect(byId.get("b")?.undoableSkip).toBeNull()
  })
})
