import { beforeEach, describe, expect, it, vi } from "vitest"
import type { GoalRecord, LoansView, UserClient } from "@fin-creador/api"
import { cashFlowReport, monthStart } from "@fin-creador/domain"
import { withVerdict } from "../chat"
import { allowedNumbers, checkAnswer, literalStrings } from "../output"
import { goalProjectionTool, liabilityClaims } from "./goals"
import { type ToolContext, ToolError } from "./types"

// goal_projection (10.4) against stubbed page loaders; the Goals view, the Reports rows and
// goalProjection run for real. The projection's own rules are tested in packages/domain.

const api = vi.hoisted(() => ({ loadGoalsData: vi.fn(), loadCashFlow: vi.fn(), loadLoansData: vi.fn(), buildLoansView: vi.fn() }))
vi.mock("@fin-creador/api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }))

const TODAY = "2026-11-06"
const ctx: ToolContext = { supabase: {} as UserClient, today: TODAY, currency: "INR", descriptionsOk: false }

const goal = (over: Partial<GoalRecord> = {}): GoalRecord => ({
  id: "g1",
  type: "other",
  name: "Bike",
  targetMinor: 12_000_000,
  savedMinor: 0,
  currency: "INR",
  targetDate: "2027-10-31",
  details: { version: 1 },
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
})

/** Six complete months at this net each (income only), then this month so far. */
function cash(nets: number[], otherCurrencies: string[] = []) {
  const months = Array.from({ length: 7 }, (_, i) => monthStart(TODAY, i - 6))
  const monthly = months.map((m, i) => {
    const net = nets[i] ?? 0
    return { month: m, incomeMinor: Math.max(net, 0), expenseMinor: Math.max(-net, 0), categories: [] }
  })
  return { ok: true, data: { today: TODAY, currency: "INR", report: cashFlowReport(monthly, TODAY), otherCurrencies } }
}

const emptyLoans = { loans: [], shortTerm: { borrowings: [] }, statutory: { dues: [] } } as unknown as LoansView

function setUp({ goals = [goal()], nets = [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 0], view = emptyLoans } = {}) {
  api.loadGoalsData.mockResolvedValue({ ok: true, data: { today: TODAY, currency: "INR", goals, budgetRows: [], categories: [], spending: new Map() } })
  api.loadCashFlow.mockResolvedValue(cash(nets))
  api.loadLoansData.mockResolvedValue({ ok: true, data: {} })
  api.buildLoansView.mockReturnValue(view)
}

type Out = { data: Record<string, unknown>; figures: Parameters<typeof allowedNumbers>[0]; dates?: string[]; period?: { start: string; end: string } }
/** As the chat loop checks it: figures, dates, and the strings the tool returned. */
const passes = (text: string, out: Out) =>
  checkAnswer(
    text,
    allowedNumbers(out.figures, [TODAY, ...(out.dates ?? []), ...(out.period ? [out.period.start, out.period.end] : [])]),
    literalStrings([out.data, out.figures.map((f) => f.label)]),
  ).ok

beforeEach(() => vi.clearAllMocks())

describe("goal_projection", () => {
  it("says Yes with the month it is reached and the figures it used", async () => {
    setUp()
    const out = await goalProjectionTool.run(ctx, { goal: "bike" })
    expect(out.check).toMatchObject({ goal: "Bike", verdict: "Yes." })
    expect(out.check!.summary).toBe(
      "Yes. At your current rate Bike would be reached in October 2027, by the target of October 2027. Free for it this month: ₹10,000.",
    )
    expect(out.data).toMatchObject({ verdict: "Yes.", median_monthly_net: "₹10,000", months_with_records: 6, thin_estimate: false })
    expect(out.figures.map((f) => f.label)).toContain("Median monthly net (income minus spending)")
    expect(out.period).toEqual({ start: "2026-05-01", end: "2026-10-31" })
    expect(passes(out.check!.summary, out)).toBe(true)
    expect(out.check!.assumptions.join(" ")).toContain("Only INR entries are counted; entries in other currencies are ignored, not added")
    expect(out.check!.assumptions.join(" ")).toContain("deliberately conservative")
  })

  it("says No, how much more a month, or the date to move to; other goals shown as an assumption", async () => {
    setUp({ goals: [goal(), goal({ id: "g2", name: "Laptop", targetMinor: 1_500_000, targetDate: "2027-01-31" })] })
    const out = await goalProjectionTool.run(ctx, { goal: "Bike" })
    expect(out.check!.verdict).toBe("No.")
    expect(out.check!.summary).toContain("To make it by October 2027, save ₹1,250 more a month, or move the target to December 2027.")
    expect(out.figures).toContainEqual({
      label: "Assuming you keep saving for your other goals: Laptop, a month",
      kind: "money",
      minor: 500_000,
      currency: "INR",
    })
    expect(out.check!.assumptions.join(" ")).toContain("Assuming you keep saving for your other goals (Laptop)")
    expect(passes(out.check!.summary, out)).toBe(true)
  })

  it("is too early to say with under 3 months of records, and projects nothing", async () => {
    setUp({ nets: [0, 0, 0, 0, 500_000, 500_000, 200_000] })
    const out = await goalProjectionTool.run(ctx, { goal: "Bike" })
    expect(out.check).toMatchObject({ verdict: "Too early to say." })
    expect(out.check!.summary).toBe(
      "Too early to say. There are only 2 complete months of records, too few to project from. Bike needs ₹10,000 a month. Your net since 2026-09-01: ₹12,000.",
    )
    expect(out.data).toMatchObject({ reached_in: null, median_monthly_net: null })
    expect(passes(out.check!.summary, out)).toBe(true)
  })

  it("says the estimate is thin with 3 to 5 months", async () => {
    setUp({ nets: [0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 0] })
    const out = await goalProjectionTool.run(ctx, { goal: "Bike" })
    expect(out.check!.summary).toContain("This is based on only 4 months of records, so the estimate is thin.")
  })

  it("says No when the target date has passed", async () => {
    setUp({ goals: [goal({ targetDate: "2026-08-31", targetMinor: 3_000_000 })] })
    const out = await goalProjectionTool.run(ctx, { goal: "Bike" })
    expect(out.check!.summary).toMatch(
      /^No\. The target date for Bike \(August 2026\) has passed\. ₹30,000 is still needed now\. At your current rate it would be reached in January 2027\./,
    )
  })

  it("a goal named with digits (Car 2027): the summary and a model answer quoting the name pass the figure check", async () => {
    setUp({ goals: [goal({ name: "Car 2027" })] })
    const out = await goalProjectionTool.run(ctx, { goal: "car 2027" })
    expect(out.check!.summary).toMatch(/^Yes\. At your current rate Car 2027 would be reached in October 2027/)
    expect(passes(out.check!.summary, out)).toBe(true)
    expect(passes("Yes. Car 2027 is reached in October 2027, with ₹10,000 free this month.", out)).toBe(true)
    // A bare year passes (10.8); the name's digits written as money are still refused.
    expect(passes("Yes. Car 2027 is reached in 2029.", out)).toBe(true)
    expect(passes("Yes. Car 2027 needs ₹2,029 more.", out)).toBe(false)
  })

  it("asks which goal, from code, when none is named: even with one goal it never picks it unasked (10.5)", async () => {
    setUp({ goals: [goal(), goal({ id: "g2", name: "Car" })] })
    const out = await goalProjectionTool.run(ctx, {})
    expect(out.needs).toMatchObject({ missing: ["goal"], question: "Which goal do you mean? Your goals are Bike and Car." })
    expect(out.check).toBeUndefined()
    setUp({ goals: [goal({ name: "Assam Trip" })] })
    const one = await goalProjectionTool.run(ctx, {})
    expect(one.needs?.question).toBe("Which goal do you mean? Your goal is Assam Trip.")
    expect(one.check).toBeUndefined()
  })

  it("says a named goal doesn't exist and lists the real ones, never putting another in its place (10.5)", async () => {
    setUp({ goals: [goal({ name: "Assam Trip" })] })
    const out = await goalProjectionTool.run(ctx, { goal: "Vietnam" })
    expect(out.needs).toMatchObject({ missing: ["no_such_goal"] })
    expect(out.needs!.question).toMatch(/^You have no goal called “Vietnam”\. Your goal is Assam Trip\. For a new trip/)
    expect(out.check).toBeUndefined()
  })

  it("asks which of several goals a name matches", async () => {
    setUp({ goals: [goal({ name: "Car 2027" }), goal({ id: "g2", name: "Car insurance" })] })
    const out = await goalProjectionTool.run(ctx, { goal: "car" })
    expect(out.needs?.question).toBe("Which goal do you mean: Car 2027 or Car insurance?")
  })

  it("refuses a goal in another currency and an empty list", async () => {
    setUp({ goals: [goal({ currency: "USD" })] })
    await expect(goalProjectionTool.run(ctx, { goal: "Bike" })).rejects.toThrow("Bike is saved in USD; goals are checked in INR only.")
    setUp({ goals: [] })
    await expect(goalProjectionTool.run(ctx, {})).rejects.toBeInstanceOf(ToolError)
  })
})

describe("liabilityClaims", () => {
  const item = (dueDate: string, amountMinor: number, principalMinor: number, extra = {}) => ({
    status: "pending",
    notNeeded: false,
    dueDate,
    amountMinor,
    principalMinor,
    payment: null,
    ...extra,
  })

  it("takes principal only from a loan paid in the months measured, the whole EMI otherwise", () => {
    const view = {
      loans: [
        {
          loan: { currency: "INR" },
          badge: "due",
          items: [item("2026-10-05", 0, 0, { status: "paid", payment: { paidOn: "2026-10-05" } }), item("2026-11-05", 10_000, 8_000)],
        },
        { loan: { currency: "INR" }, badge: "not_due_yet", items: [item("2027-01-05", 10_000, 8_000)] },
        { loan: { currency: "USD" }, badge: "due", items: [item("2026-11-05", 99_999, 99_999)] },
        { loan: { currency: "INR" }, badge: "closed", items: [item("2026-11-05", 99_999, 99_999)] },
      ],
      shortTerm: {
        borrowings: [
          {
            borrowing: { currency: "INR" },
            owedMinor: 5_000,
            payments: [],
            dues: [{ status: "pending", dueDate: "2026-12-01", remainingMinor: 5_000, remainingPrincipalMinor: 4_000 }],
          },
          { borrowing: { currency: "INR" }, owedMinor: 2_000, payments: [], dues: [] },
        ],
      },
      statutory: {
        dues: [
          { due: { currency: "INR" }, leftMinor: 3_000, item: { dueDate: "2027-03-31" } },
          { due: { currency: "INR" }, leftMinor: 0, item: { dueDate: "2027-03-31" } },
        ],
      },
    } as unknown as LoansView
    expect(liabilityClaims(view, "INR", "2026-05-01")).toEqual({
      loans: [
        { date: "2026-11-05", amountMinor: 8_000 },
        { date: "2027-01-05", amountMinor: 10_000 },
        { date: "2026-12-01", amountMinor: 5_000 },
      ],
      dues: [{ date: "2027-03-31", amountMinor: 3_000 }],
      unscheduledBorrowing: true,
    })
  })
})

describe("the verdict check", () => {
  const check = { goal: "Bike", verdict: "No.", summary: "No. Code-built summary.", assumptions: [] }

  it("keeps an answer that starts with the verdict", () => {
    expect(withVerdict("No. Bike would be reached in December 2027.", [check])).toBe("No. Bike would be reached in December 2027.")
  })

  it("replaces a softened or reordered answer with the code-built summary", () => {
    expect(withVerdict("Unfortunately, not quite. No.", [check])).toBe("No. Code-built summary.")
    expect(withVerdict("Yes. It's fine.", [check])).toBe("No. Code-built summary.")
  })

  it("leaves answers without a goal check alone", () => {
    expect(withVerdict("You spent ₹10.", [])).toBe("You spent ₹10.")
  })
})
