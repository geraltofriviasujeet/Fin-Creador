import { beforeEach, describe, expect, it, vi } from "vitest"
import type { GoalRecord, LoansView, UserClient } from "@fin-creador/api"
import { cashFlowReport, monthStart } from "@fin-creador/domain"
import { ADVICE, runChat, whatIfAnswer } from "../chat"
import { routeQuestion } from "../knowledge/route"
import { mockProvider, mockText, mockToolCall } from "../llm/mock"
import { ROMA_SYSTEM_PROMPT } from "../prompts/roma-system"
import { ONLY_THIS_GOAL, SAVINGS_ONLY, goalWhatIfTool } from "./goal-what-if"
import type { FinanceTool, GoalCheck, ToolContext } from "./types"

// goal_what_if (10.7a) against stubbed page loaders, as goals.test.ts does; the Goals view, the
// Reports rows and goalWhatIf run for real. The arithmetic itself is tested in packages/domain.

const api = vi.hoisted(() => ({ loadGoalsData: vi.fn(), loadCashFlow: vi.fn(), loadLoansData: vi.fn(), buildLoansView: vi.fn() }))
vi.mock("@fin-creador/api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }))

const TODAY = "2026-11-06"
const base: ToolContext = { supabase: {} as UserClient, today: TODAY, currency: "INR", descriptionsOk: false }
const ctx = (asked: string): ToolContext => ({ ...base, asked, said: asked })

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

function cash(nets: number[]) {
  const months = Array.from({ length: 7 }, (_, i) => monthStart(TODAY, i - 6))
  const monthly = months.map((m, i) => {
    const net = nets[i] ?? 0
    return { month: m, incomeMinor: Math.max(net, 0), expenseMinor: Math.max(-net, 0), categories: [] }
  })
  return { ok: true, data: { today: TODAY, currency: "INR", report: cashFlowReport(monthly, TODAY), otherCurrencies: [] } }
}

const emptyLoans = { loans: [], shortTerm: { borrowings: [] }, statutory: { dues: [] } } as unknown as LoansView
const SIX = [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 0]

function setUp({ goals = [goal()], nets = SIX } = {}) {
  api.loadGoalsData.mockResolvedValue({ ok: true, data: { today: TODAY, currency: "INR", goals, budgetRows: [], categories: [], spending: new Map() } })
  api.loadCashFlow.mockResolvedValue(cash(nets))
  api.loadLoansData.mockResolvedValue({ ok: true, data: {} })
  api.buildLoansView.mockReturnValue(emptyLoans)
}

beforeEach(() => vi.clearAllMocks())

describe("goal_what_if", () => {
  it("saving more: reached sooner, the before/after rows and the lines, all built in code", async () => {
    setUp()
    // ₹10,000 free a month; ₹2,000 more makes ₹12,000: ₹1,20,000 in 10 months, by August 2027.
    const out = await goalWhatIfTool.run(ctx("What if I save 2000 more a month for Bike?"), { goal: "Bike", change: "save_more", amount: "2000" })
    expect(out.check).toMatchObject({ kind: "what_if", goal: "Bike", verdict: "Reached in August 2027." })
    expect(out.check!.summary).toBe("Reached in August 2027. Saving ₹2,000 more a month (₹12,000 for it this month), Bike would be reached in August 2027, instead of October 2027.")
    expect(out.check!.comparison).toStrictEqual({
      before: "As it is",
      after: "₹2,000 more a month",
      rows: [
        { label: "For this goal this month", before: "₹10,000", after: "₹12,000" },
        { label: "Reached in", before: "October 2027", after: "August 2027" },
      ],
    })
    expect(out.check!.lines).toStrictEqual([SAVINGS_ONLY, ONLY_THIS_GOAL, "Your records show ₹10,000 free a month today; this assumes you find the extra ₹2,000."])
    expect(out.subject).toStrictEqual({ checked: "Bike", goals: ["Bike"] })
    expect(out.figures.map((f) => f.label)).toContain("Saved more a month")
  })

  it("saving more than is free is still worked out, with the line about finding the extra", async () => {
    setUp()
    const out = await goalWhatIfTool.run(ctx("agar 50 hazaar zyada bachau to Bike kab tak"), { goal: "Bike", change: "save_more" })
    expect(out.check!.verdict).toBe("Reached in December 2026.")
    expect(out.check!.lines).toContain("Your records show ₹10,000 free a month today; this assumes you find the extra ₹50,000.")
  })

  it("saving less that leaves nothing: not reached, no date", async () => {
    setUp()
    const out = await goalWhatIfTool.run(ctx("if I save 10k less a month for Bike?"), { goal: "Bike", change: "save_less", amount: "10k" })
    expect(out.check).toMatchObject({ verdict: "Not reached." })
    expect(out.check!.summary).toBe("Not reached. Saving ₹10,000 less a month leaves nothing for Bike (₹0 this month), so it is not reached.")
    expect(out.check!.comparison!.rows.at(-1)).toStrictEqual({ label: "Reached in", before: "October 2027", after: "not reached" })
  })

  it("the amount a month by a month: the shortfall as a figure, and nothing more", async () => {
    setUp({ nets: [900_000, 900_000, 900_000, 900_000, 900_000, 900_000, 0] })
    const out = await goalWhatIfTool.run(ctx("How much a month do I need to reach Bike by Oct 2027?"), { goal: "Bike", change: "by_month", by: "Oct 2027" })
    expect(out.check!.verdict).toBe("More than is free.")
    expect(out.check!.summary).toBe(
      "More than is free. To reach Bike by October 2027: ₹10,000 a month over 12 months. Your records show ₹1,08,000 free from this month to October 2027: short by ₹1,000 a month.",
    )
    expect(out.check!.lines).toContain("Short by ₹1,000 a month: your records show ₹1,08,000 free from this month to October 2027, and ₹1,20,000 is still needed.")
    expect(ADVICE.test(out.check!.summary)).toBe(false)
  })

  it("the amount a month by a month, covered by what is free", async () => {
    setUp()
    const out = await goalWhatIfTool.run(ctx("bike 2 saal mein ke liye kitna har mahine?"), { goal: "Bike", change: "by_month" })
    expect(out.check!.verdict).toBe("Covered by what is free.")
    expect(out.check!.comparison).toBeUndefined()
  })

  it("costing more or less", async () => {
    setUp()
    const more = await goalWhatIfTool.run(ctx("What if Bike costs 20,000 more?"), { goal: "Bike", change: "cost_more", amount: "20,000" })
    expect(more.check!.summary).toBe("Reached in December 2027. If Bike cost ₹20,000 more (₹1,40,000 in all), it would be reached in December 2027, instead of October 2027.")
    expect(more.check!.comparison!.rows[0]).toStrictEqual({ label: "Cost", before: "₹1,20,000", after: "₹1,40,000" })
    const zero = await goalWhatIfTool.run(ctx("What if Bike costs 2 lakh less?"), { goal: "Bike", change: "cost_less", amount: "2 lakh" })
    expect(zero.check!.verdict).toBe("Nothing left to save.")
  })

  it("edge cases: reached, no target, a past month, too early", async () => {
    setUp({ goals: [goal({ savedMinor: 12_000_000 })] })
    expect((await goalWhatIfTool.run(ctx("save 5000 more for Bike"), { goal: "Bike", change: "save_more" })).check!.verdict).toBe("Already reached.")
    setUp({ goals: [goal({ targetMinor: 0 })] })
    expect((await goalWhatIfTool.run(ctx("save 5000 more for Bike"), { goal: "Bike", change: "save_more" })).check!.verdict).toBe("No target amount.")
    setUp()
    expect((await goalWhatIfTool.run(ctx("Bike by Jan 2026?"), { goal: "Bike", change: "by_month" })).check!.verdict).toBe("That month has passed.")
    setUp({ nets: [0, 0, 0, 0, 1_000_000, 1_000_000, 0] })
    const early = await goalWhatIfTool.run(ctx("save 5000 more for Bike"), { goal: "Bike", change: "save_more" })
    expect(early.check!.verdict).toBe("Too early to say.")
    expect(early.figures.filter((f) => f.kind === "money").map((f) => f.label)).toStrictEqual(["Bike: target", "Bike: saved"])
  })

  it("3 to 5 months with records: worked out, and said to be thin", async () => {
    setUp({ nets: [0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 0] })
    const out = await goalWhatIfTool.run(ctx("save 2000 more for Bike"), { goal: "Bike", change: "save_more" })
    expect(out.check!.verdict).toBe("Reached in August 2027.")
    expect(out.check!.summary).toContain("This is based on only 4 months of records, so the estimate is thin.")
  })

  it("never uses an amount or month the person didn't type, and asks in code when it can't read one", async () => {
    setUp()
    // The model's amount isn't among the person's.
    const made = await goalWhatIfTool.run(ctx("What if I save 5000 more for Bike?"), { goal: "Bike", change: "save_more", amount: "7000" })
    expect(made.needs?.question).toBe("How much more or less a month do you want to try for Bike? Write the amount, for example 5000, 5k, 5 hazaar or 2 lakh.")
    expect(made.check).toBeUndefined()
    // Words the code can't read.
    const words = await goalWhatIfTool.run(ctx("if I save a bit more for Bike"), { goal: "Bike", change: "save_more", amount: "a bit" })
    expect(words.needs?.missing).toStrictEqual(["amount"])
    // Two amounts and no pointer.
    const two = await goalWhatIfTool.run(ctx("save 5000 or 8000 more for Bike"), { goal: "Bike", change: "save_more" })
    expect(two.needs?.missing).toStrictEqual(["amount"])
    // A month it can't read.
    const month = await goalWhatIfTool.run(ctx("How much a month to reach Bike by June?"), { goal: "Bike", change: "by_month", by: "June" })
    expect(month.needs?.question).toBe("By which month do you want to reach Bike? Write it as, for example Dec 2027, next June, in 18 months or 2 saal mein.")
    // "More" and "less" the wrong way round.
    const flipped = await goalWhatIfTool.run(ctx("agar 5000 kam bachau to Bike kab tak"), { goal: "Bike", change: "save_more" })
    expect(flipped.needs?.question).toBe("Do you mean ₹5,000 more or less a month for Bike?")
  })

  it("needs a named goal, never the only one", async () => {
    setUp()
    const out = await goalWhatIfTool.run(ctx("What if I save 5000 more a month?"), { change: "save_more" })
    expect(out.needs?.question).toBe("Which goal do you mean? Your goal is Bike.")
  })
})

describe("what-if answers in the chat loop", () => {
  const check = (summary: string): GoalCheck => ({ kind: "what_if", goal: "Bike", verdict: "Reached in August 2027.", summary, assumptions: [] })

  it("replaces advice phrasing with the summary, leaves facts alone, and adds the savings-only line once", () => {
    const answers = [
      ["Reached in August 2027. You should reach it two months sooner.", false],
      ["Reached in August 2027. It should be reached in August.", false],
      ["Reached in August 2027. That takes {fig:saved_more_a_month} a month on top of what is free.", false],
      ["Reached in August 2027. You should save more to get there.", true],
      ["Reached in August 2027. I recommend cutting your dining out.", true],
      ["Reached in August 2027. I suggest moving money from House fund.", true],
      ["Reached in August 2027. It is better to save first.", true],
      ["Reached in August 2027. It's best to start now.", true],
      ["Reached in August 2027. Consider a recurring deposit.", true],
    ] as const
    let fired = 0
    for (const [text, advice] of answers) {
      const out = whatIfAnswer(text, [check("Reached in August 2027. The summary.")])
      const replaced = out.startsWith("Reached in August 2027. The summary.")
      if (replaced) fired++
      expect(replaced).toBe(advice)
      expect(out.endsWith(SAVINGS_ONLY)).toBe(true)
      expect(out.split(SAVINGS_ONLY)).toHaveLength(2)
    }
    expect(fired).toBe(6)
    // Not a what-if: untouched.
    expect(whatIfAnswer("Yes. You should be fine.", [{ ...check("x"), kind: undefined }])).toBe("Yes. You should be fine.")
  })

  it("runs end to end on the mock provider: the code's verdict, card and savings-only line", async () => {
    setUp()
    const run = await runChat({
      provider: mockProvider((req, round) =>
        round === 0
          ? mockToolCall("goal_what_if", { goal: "Bike", change: "save_more", amount: "2000" })
          : mockText("Reached in August 2027. With {fig:saved_more_a_month} more a month, Bike would be reached in August 2027. I recommend starting now."),
      ),
      tools: [goalWhatIfTool as FinanceTool],
      context: base,
      question: "What if I save 2000 more a month for Bike?",
    })
    expect(run.result.kind).toBe("answer")
    if (run.result.kind !== "answer") return
    expect(run.result.text).toBe(
      `Reached in August 2027. Saving ₹2,000 more a month (₹12,000 for it this month), Bike would be reached in August 2027, instead of October 2027.\n\n${SAVINGS_ONLY}`,
    )
    expect(run.result.checks[0]?.comparison?.after).toBe("₹2,000 more a month")
  })

  it("fills the placeholders of a factual answer", async () => {
    setUp()
    const run = await runChat({
      provider: mockProvider((req, round) =>
        round === 0
          ? mockToolCall("goal_what_if", { goal: "Bike", change: "save_more", amount: "2000" })
          : mockText("Reached in August 2027. With {fig:saved_more_a_month} more a month, Bike would be reached in August 2027."),
      ),
      tools: [goalWhatIfTool as FinanceTool],
      context: base,
      question: "What if I save 2000 more a month for Bike?",
    })
    expect(run.result).toMatchObject({ kind: "answer", text: `Reached in August 2027. With ₹2,000 more a month, Bike would be reached in August 2027.\n\n${SAVINGS_ONLY}` })
  })
})

describe("routing and the prompt", () => {
  it.each([
    "What if I save 5000 more a month for Car?",
    "If I save 5k less, when do I reach Bike?",
    "How much a month do I need to reach Car by Dec 2027?",
    "How much do I need a month for Bike by next June?",
    "What if the bike costs 20,000 more?",
    "agar 5000 zyada bachau to kab tak",
    "agar car 1 lakh mehenga ho to?",
    "car 2 saal mein ke liye har mahine kitna bachana padega",
    "suppose I save 2 hazaar less for Goa trip",
  ])("%s goes to the records", (q) => {
    expect(routeQuestion(q)).toBe("records")
  })

  it("leaves general what-ifs alone", () => {
    expect(routeQuestion("What is an SIP?")).toBe("knowledge")
    expect(routeQuestion("what if inflation is 6%?")).not.toBe("records")
  })

  it("tells the model to state results as facts and never advise", () => {
    expect(ROMA_SYSTEM_PROMPT).toContain("comes only from goal_what_if, for the one goal the person named")
    expect(ROMA_SYSTEM_PROMPT).toContain('State the results as facts ("it would be reached in March 2028"): never say what the person should do')
  })
})
