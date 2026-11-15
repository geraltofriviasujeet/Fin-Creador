import { describe, expect, it } from "vitest"
import { type GoalRecord, type GoalsData, budgetMonthFromParam, buildGoalsView } from "./view"

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

  it("refunds larger than the month's purchases count as nothing spent, never below zero", () => {
    const view = buildGoalsView({
      ...base,
      spending: new Map([
        ["food", -2_000_00],
        ["fuel", 1_000_00],
      ]),
      budgetRows: [
        { categoryId: "food", effectiveFrom: "2026-10-01", amountMinor: 10_000_00, currency: "INR" },
        { categoryId: "fuel", effectiveFrom: "2026-10-01", amountMinor: 5_000_00, currency: "INR" },
      ],
    })
    expect(view.budgets.map((b) => [b.category.id, b.spentMinor, b.status?.usedBps, b.status?.leftMinor, b.status?.level])).toEqual([
      ["food", 0, 0, 10_000_00, "ok"],
      ["fuel", 1_000_00, 2_000, 4_000_00, "ok"],
    ])
    expect(view.total).toMatchObject({ spentMinor: 1_000_00, budgetMinor: 15_000_00 })
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

describe("buildGoalsView: budgets carried forward", () => {
  const rows = [
    { categoryId: "food", effectiveFrom: "2026-08-01", amountMinor: 10_000_00, currency: "INR" },
    { categoryId: "fuel", effectiveFrom: "2026-10-01", amountMinor: 3_000_00, currency: "INR" },
    { categoryId: "fuel", effectiveFrom: "2026-12-01", amountMinor: 4_000_00, currency: "INR" },
  ]

  it("this month: a budget from an earlier month says since when; one set this month doesn't", () => {
    const view = buildGoalsView({ ...base, budgetRows: rows })
    expect(view.budgetMonth).toEqual({ start: "2026-10-01", end: "2026-10-31" })
    expect(view.budgets.map((b) => [b.category.id, b.since, b.budget.amountMinor])).toEqual([
      ["food", "2026-08-01", 10_000_00],
      ["fuel", null, 3_000_00],
    ])
    expect(view.previousBudgetMonth).toBeNull()
    expect(view.nextBudgetMonth).toBe("2026-11-01")
  })

  it("a later month shows the budgets that will apply, carried forward, with nothing spent", () => {
    const view = buildGoalsView({ ...base, budgetRows: rows, spending: new Map(), budgetMonth: "2026-11-01" })
    expect(view.budgets.map((b) => [b.category.id, b.since, b.spentMinor, b.status?.level])).toEqual([
      ["food", "2026-08-01", 0, "ok"],
      ["fuel", "2026-10-01", 0, "ok"],
    ])
    expect(view.previousBudgetMonth).toBe("2026-10-01")
    expect(view.nextBudgetMonth).toBe("2026-12-01")
    // The month view of this month is unchanged.
    expect(view.month).toEqual({ start: "2026-10-01", end: "2026-10-31" })
  })

  it("a change from a later month applies from then on; earlier months keep their amount", () => {
    const dec = buildGoalsView({ ...base, budgetRows: rows, spending: new Map(), budgetMonth: "2026-12-01" })
    expect(dec.budgets.find((b) => b.category.id === "fuel")).toMatchObject({ since: null, budget: { amountMinor: 4_000_00 } })
    const oct = buildGoalsView({ ...base, budgetRows: rows })
    expect(oct.budgets.find((b) => b.category.id === "fuel")?.budget.amountMinor).toBe(3_000_00)
  })

  it("the last month that can be shown has no next month", () => {
    const view = buildGoalsView({ ...base, budgetMonth: "2028-09-01" })
    expect(view.nextBudgetMonth).toBeNull()
    expect(view.previousBudgetMonth).toBe("2028-08-01")
  })
})

describe("budgetMonthFromParam", () => {
  it("reads a month from this month up to 23 months ahead", () => {
    expect(budgetMonthFromParam("2026-10", "2026-10-26")).toBe("2026-10-01")
    expect(budgetMonthFromParam("2027-01", "2026-10-26")).toBe("2027-01-01")
    expect(budgetMonthFromParam("2028-09", "2026-10-26")).toBe("2028-09-01")
  })

  it("anything else is this month", () => {
    for (const value of [undefined, "", "2026-09", "2028-10", "2026-13", "2026-1", "2026-10-01", "next"]) {
      expect(budgetMonthFromParam(value, "2026-10-26")).toBe("2026-10-01")
    }
  })
})
