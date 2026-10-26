import { describe, expect, it } from "vitest"
import { type GoalRecord, type GoalsData, buildGoalsView } from "./view"

const goal = (over: Partial<GoalRecord>): GoalRecord => ({
  id: "g1",
  type: "other",
  name: "Gift",
  targetMinor: 12_000_00,
  savedMinor: 0,
  currency: "INR",
  targetDate: null,
  details: { v: 1, description: "Gift" },
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
})

const base: GoalsData = {
  today: "2026-10-26",
  currency: "INR",
  goals: [],
  budgetRows: [],
  categories: [
    { id: "food", name: "Food", icon: "food", archived: false },
    { id: "fuel", name: "Fuel", icon: "transport", archived: false },
    { id: "old", name: "Old", icon: null, archived: true },
  ],
  spending: new Map([
    ["food", 9_000_00],
    ["fuel", 1_000_00],
  ]),
}

describe("buildGoalsView: goals", () => {
  it("orders by target date, undated last, and splits archived", () => {
    const view = buildGoalsView({
      ...base,
      goals: [
        goal({ id: "a", targetDate: null }),
        goal({ id: "b", targetDate: "2027-01-31" }),
        goal({ id: "c", targetDate: "2026-12-01" }),
        goal({ id: "d", archivedAt: "2026-10-20T00:00:00Z" }),
      ],
    })
    expect(view.active.map((i) => i.goal.id)).toEqual(["c", "b", "a"])
    expect(view.archived.map((i) => i.goal.id)).toEqual(["d"])
    expect(view.active[2]?.plan).toMatchObject({ basis: "assumed_months", monthlyMinor: 1_000_00 })
  })

  it("keeps a goal whose stored answers can't be read, without derived figures", () => {
    const view = buildGoalsView({ ...base, goals: [goal({ type: "vehicle", details: { v: 9 } })] })
    expect(view.active[0]).toMatchObject({ answers: null, figures: null })
    expect(view.active[0]?.plan.remainingMinor).toBe(12_000_00)
  })
})

describe("buildGoalsView: budgets", () => {
  it("compares spending with budgets in the profile currency", () => {
    const view = buildGoalsView({
      ...base,
      budgetRows: [
        { categoryId: "food", effectiveFrom: "2026-09-01", amountMinor: 10_000_00, currency: "INR" },
        { categoryId: "fuel", effectiveFrom: "2026-10-01", amountMinor: 5_000_00, currency: "INR" },
      ],
    })
    expect(view.budgets.map((b) => [b.category.id, b.status?.level])).toEqual([
      ["food", "warning"],
      ["fuel", "ok"],
    ])
    expect(view.total).toMatchObject({ spentMinor: 10_000_00, budgetMinor: 15_000_00, level: "ok" })
    expect(view.unbudgeted).toEqual([])
  })

  it("a budget in another currency gets no percentage and is left out of the total", () => {
    const view = buildGoalsView({
      ...base,
      budgetRows: [
        { categoryId: "food", effectiveFrom: "2026-10-01", amountMinor: 100_00, currency: "USD" },
        { categoryId: "fuel", effectiveFrom: "2026-10-01", amountMinor: 1_000_00, currency: "INR" },
      ],
    })
    const food = view.budgets.find((b) => b.category.id === "food")
    expect(food?.status).toBeNull()
    expect(view.total).toMatchObject({ budgetMinor: 1_000_00, spentMinor: 1_000_00, level: "over" })
  })

  it("no total when every budget is in another currency; unbudgeted lists active categories only", () => {
    const view = buildGoalsView({
      ...base,
      budgetRows: [{ categoryId: "food", effectiveFrom: "2026-10-01", amountMinor: 100_00, currency: "USD" }],
    })
    expect(view.total).toBeNull()
    expect(view.unbudgeted.map((c) => c.id)).toEqual(["fuel"])
  })

  it("an ended budget (0) and future rows don't show this month", () => {
    const view = buildGoalsView({
      ...base,
      budgetRows: [
        { categoryId: "food", effectiveFrom: "2026-09-01", amountMinor: 10_000_00, currency: "INR" },
        { categoryId: "food", effectiveFrom: "2026-10-01", amountMinor: 0, currency: "INR" },
        { categoryId: "fuel", effectiveFrom: "2026-11-01", amountMinor: 5_000_00, currency: "INR" },
      ],
    })
    expect(view.budgets).toEqual([])
    expect(view.total).toBeNull()
  })
})
