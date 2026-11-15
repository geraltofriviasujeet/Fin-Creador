import { beforeEach, describe, expect, it, vi } from "vitest"
import type { GoalRecord, LoansView, UserClient } from "@fin-creador/api"
import { cashFlowReport, monthStart } from "@fin-creador/domain"
import { ADVICE, runChat, whatIfAnswer } from "../chat"
import { routeQuestion } from "../knowledge/route"
import { mockProvider, mockText, mockToolCall } from "../llm/mock"
import { ROMA_SYSTEM_PROMPT } from "../prompts/roma-system"
import { ONLY_THE_AMOUNT, ONLY_THIS_GOAL, SAVINGS_ONLY, goalWhatIfTool } from "./goal-what-if"
import { goalProjectionTool } from "./goals"
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
    expect(out.check).toMatchObject({ kind: "what_if", goal: "Bike", verdict: "Reached in August 2027 (10 months)." })
    expect(out.check!.caveat).toBe("Your records show ₹10,000 free a month today; this assumes you find the extra ₹2,000.")
    expect(out.check!.summary).toBe("Reached in August 2027 (10 months). Saving ₹2,000 more a month (₹12,000 for it this month), it would be reached in August 2027 (10 months), instead of October 2027 (12 months).")
    expect(out.check!.comparison).toStrictEqual({
      before: "As it is",
      after: "₹2,000 more a month",
      rows: [
        { label: "For this goal a month", before: "₹10,000", after: "₹12,000" },
        { label: "Reached in", before: "October 2027 (12 months)", after: "August 2027 (10 months)" },
      ],
    })
    expect(out.check!.lines).toStrictEqual([SAVINGS_ONLY, ONLY_THIS_GOAL])
    expect(out.subject).toStrictEqual({ checked: "Bike", goals: ["Bike"] })
    expect(out.figures.map((f) => f.label)).toContain("Saved more a month")
  })

  it("saving more than is free is still worked out, with the line about finding the extra", async () => {
    setUp()
    const out = await goalWhatIfTool.run(ctx("agar 50 hazaar zyada bachau to Bike kab tak"), { goal: "Bike", change: "save_more" })
    expect(out.check!.verdict).toBe("Reached in December 2026 (2 months).")
    expect(out.check!.caveat).toBe("Your records show ₹10,000 free a month today; this assumes you find the extra ₹50,000.")
  })

  it("saving less that leaves nothing: not reached, no date", async () => {
    setUp()
    const out = await goalWhatIfTool.run(ctx("if I save 10k less a month for Bike?"), { goal: "Bike", change: "save_less", amount: "10k" })
    expect(out.check).toMatchObject({ verdict: "Not reached.", caveat: "₹10,000 less a month leaves nothing free for it." })
    expect(out.check!.summary).toBe("Not reached. Saving ₹10,000 less a month leaves nothing free for Bike.")
    expect(out.check!.comparison!.rows).toStrictEqual([
      { label: "For this goal a month", before: "₹10,000", after: "nothing free" },
      { label: "Reached in", before: "October 2027 (12 months)", after: "not reached" },
    ])
  })

  it("the amount a month by a month: the shortfall as a figure, and nothing more", async () => {
    setUp({ nets: [900_000, 900_000, 900_000, 900_000, 900_000, 900_000, 0] })
    const out = await goalWhatIfTool.run(ctx("How much a month do I need to reach Bike by Oct 2027?"), { goal: "Bike", change: "by_month", by: "Oct 2027" })
    // The answer first, the caveat second, and the sentence under the card starts with the amount.
    expect(out.check).toMatchObject({ verdict: "₹10,000 a month for 12 months.", caveat: "More than your records show is free today." })
    expect(out.check!.summary).toBe("₹10,000 a month for 12 months. That is ₹1,000 a month more than your records show free, to reach Bike by October 2027.")
    expect(out.check!.lines).toContain("Short by ₹1,000 a month on what your records show free from this month to October 2027.")
    expect(ADVICE.test(out.check!.summary)).toBe(false)
  })

  // From dev (10.7a): median net −₹49,819.30 and −₹2,90,659.13 free for the goal this month.
  const ASSAM_NETS = [-4_981_930, -4_981_930, -4_981_930, -4_981_930, -4_981_930, -4_981_930, 0]
  const assam = () => {
    setUp({ goals: [goal({ name: "Assam trip", targetMinor: 10_000_000, targetDate: null })], nets: ASSAM_NETS })
    api.buildLoansView.mockReturnValue({
      loans: [{ loan: { currency: "INR" }, badge: "active", items: [{ status: "pending", notNeeded: false, dueDate: "2026-11-20", amountMinor: 24_083_983, principalMinor: null, payment: null }] }],
      shortTerm: { borrowings: [] },
      statutory: { dues: [] },
    } as unknown as LoansView)
  }
  const noPaise = (out: { check?: GoalCheck; figures: { kind: string; minor?: number }[] }) => {
    const text = [out.check!.summary, ...(out.check!.lines ?? []), ...(out.check!.comparison?.rows.flatMap((r) => [r.before, r.after]) ?? [])].join(" ")
    expect(text).not.toMatch(/₹[\d,]+\.\d/)
    expect(text).not.toMatch(/[−-]₹/)
    for (const f of out.figures) if (f.kind === "money") expect(Math.abs(f.minor! % 100)).toBe(0)
  }

  it("nothing free: ₹X more is what goes to the goal a month, never a negative bare amount (the dev case)", async () => {
    assam()
    const out = await goalWhatIfTool.run(ctx("If I save 5000 more a month, when do I reach assam trip?"), { goal: "assam trip", change: "save_more", amount: "5000" })
    // ₹1,00,000 at ₹5,000 a month, asked on 6 November 2026: this month is month 1, so month 20 is June 2028.
    expect(out.check!.verdict).toBe("Reached in June 2028 (20 months).")
    expect(out.check!.summary).toBe("Reached in June 2028 (20 months). With ₹5,000 a month going to Assam trip, it would be reached in June 2028 (20 months), instead of not at all.")
    expect(out.check!.comparison).toStrictEqual({
      before: "As it is",
      after: "₹5,000 a month",
      rows: [
        { label: "For this goal a month", before: "nothing free: short by ₹2,90,660 a month before this goal", after: "₹5,000" },
        { label: "Reached in", before: "not reached", after: "June 2028 (20 months)" },
      ],
    })
    expect(out.check!.caveat).toBe("Your records show nothing free a month today; this assumes you find the extra ₹5,000.")
    expect(out.figures.find((f) => f.label === "Free for this goal this month: short before this goal")).toMatchObject({ minor: 29_066_000 })
    expect(out.figures.find((f) => f.label === "Median monthly net (income minus spending)")).toMatchObject({ minor: -4_981_900 })
    noPaise(out)
  })

  it("nothing free, by a month: the full monthly amount, with the same line", async () => {
    assam()
    const out = await goalWhatIfTool.run(ctx("How much a month to reach Assam trip by Oct 2027?"), { goal: "Assam trip", change: "by_month", by: "Oct 2027" })
    expect(out.check).toMatchObject({ verdict: "₹8,334 a month for 12 months.", caveat: "More than your records show is free today." })
    expect(out.check!.summary).toBe(
      "₹8,334 a month for 12 months. Your records show nothing free: short by ₹2,90,660 a month before this goal, so all of it would have to come from elsewhere to reach Assam trip by October 2027.",
    )
    expect(out.check!.lines).toContain("Your records show nothing free a month today; this assumes you find the ₹8,334 a month.")
    expect(out.check!.comparison!.rows.at(-1)).toStrictEqual({ label: "Reached in", before: "not reached", after: "October 2027 (12 months)" })
    noPaise(out)
  })

  it("nothing free, costing more or less: not reached, said without a negative amount", async () => {
    assam()
    const out = await goalWhatIfTool.run(ctx("What if Assam trip costs 10,000 less?"), { goal: "Assam trip", change: "cost_less", amount: "10,000" })
    expect(out.check!.caveat).toBe("If it costs ₹10,000 less (₹90,000 in all).")
    expect(out.check!.summary).toBe("Not reached. If Assam trip cost ₹10,000 less (₹90,000 in all), it would not be reached: your records show nothing free for it.")
    expect(out.check!.comparison!.rows[1]).toStrictEqual({ label: "For this goal a month", before: "nothing free: short by ₹2,90,660 a month before this goal", after: "nothing free: short by ₹2,90,660 a month before this goal" })
    noPaise(out)
  })

  it("counts this month as month 1: ₹95,000 at ₹5,000 a month, asked in November 2026, is May 2028, 19 months", async () => {
    assam()
    api.loadGoalsData.mockResolvedValue({
      ok: true,
      data: { today: "2026-11-15", currency: "INR", goals: [goal({ name: "Assam trip", targetMinor: 9_500_000, targetDate: null })], budgetRows: [], categories: [], spending: new Map() },
    })
    const out = await goalWhatIfTool.run({ ...ctx("If I save 5000 more a month, when do I reach assam trip?"), today: "2026-11-15" }, { goal: "assam trip", change: "save_more", amount: "5000" })
    expect(out.check!.verdict).toBe("Reached in May 2028 (19 months).")
    expect(out.check!.comparison!.rows.at(-1)).toStrictEqual({ label: "Reached in", before: "not reached", after: "May 2028 (19 months)" })
  })

  it("the amount a month by a month, covered by what is free", async () => {
    setUp()
    const out = await goalWhatIfTool.run(ctx("bike 2 saal mein ke liye kitna har mahine?"), { goal: "Bike", change: "by_month" })
    expect(out.check).toMatchObject({ verdict: "₹4,800 a month for 25 months.", caveat: "Within what your records show is free today." })
    expect(out.check!.comparison).toBeUndefined()
  })

  it("costing more or less", async () => {
    setUp()
    const more = await goalWhatIfTool.run(ctx("What if Bike costs 20,000 more?"), { goal: "Bike", change: "cost_more", amount: "20,000" })
    expect(more.check!.caveat).toBe("If it costs ₹20,000 more (₹1,40,000 in all).")
    expect(more.check!.summary).toBe("Reached in December 2027 (14 months). If Bike cost ₹20,000 more (₹1,40,000 in all), it would be reached in December 2027 (14 months), instead of October 2027 (12 months).")
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
    // Saving less with records too new: nothing to work out (saving more is, below).
    const early = await goalWhatIfTool.run(ctx("save 5000 less for Bike"), { goal: "Bike", change: "save_less" })
    expect(early.check!.verdict).toBe("Too early to say.")
    expect(early.figures.filter((f) => f.kind === "money").map((f) => f.label)).toStrictEqual(["Bike: target", "Bike: saved"])
  })

  describe("records too new to show what is free (the prod case): worked out on the amount given", () => {
    // From prod (10.7a): Thailand trip, ₹1,85,000, nothing saved, no date; spending that would
    // say otherwise in the months there are.
    const thailand = (n: number) => {
      const nets = [0, 0, 0, 0, 0, 0, 0].map((_, i) => (i >= 6 - n && i < 6 ? -9_000_000 : 0))
      setUp({ goals: [goal({ name: "Thailand trip", targetMinor: 18_500_000, targetDate: null })], nets })
    }
    const recordFigures = (out: { figures: { label: string }[] }) => out.figures.map((f) => f.label).filter((l) => /free|short|median/i.test(l))
    const tooNew = (n: number) => `Your records are too new (${n} complete ${n === 1 ? "month" : "months"}) to show what is free each month`

    for (const n of [0, 1, 2]) {
      it(`${n} complete months: ₹X more a month`, async () => {
        thailand(n)
        const out = await goalWhatIfTool.run(ctx("If I save 5000 more a month, when do I reach thailand trip?"), { goal: "thailand trip", change: "save_more", amount: "5000" })
        // ₹1,85,000 at ₹5,000 a month from November 2026: 37 months.
        expect(out.check).toMatchObject({ kind: "what_if", goal: "Thailand trip", verdict: "Reached in November 2029 (37 months)." })
        expect(out.check!.caveat).toBe(`${tooNew(n)}; this assumes you set aside the ₹5,000.`)
        expect(out.check!.summary).toBe("Reached in November 2029 (37 months). With ₹5,000 a month going to Thailand trip, it would be reached in November 2029 (37 months).")
        expect(out.check!.comparison).toStrictEqual({
          before: "As it is",
          after: "₹5,000 a month",
          rows: [
            { label: "For this goal a month", before: "too early to say", after: "₹5,000" },
            { label: "Reached in", before: "too early to say", after: "November 2029 (37 months)" },
          ],
        })
        expect(out.check!.lines).toStrictEqual([SAVINGS_ONLY, ONLY_THE_AMOUNT])
        expect(out.check!.assumptions.join(" ")).not.toMatch(/median/i)
        expect(recordFigures(out)).toStrictEqual([])
        expect(out.figures.filter((f) => f.kind === "money").map((f) => f.label)).toStrictEqual(["Thailand trip: target", "Thailand trip: saved", "Saved more a month"])
        noPaise(out)
      })

      it(`${n} complete months: how much a month by a month`, async () => {
        thailand(n)
        const out = await goalWhatIfTool.run(ctx("How much a month to reach Thailand trip by Oct 2027?"), { goal: "Thailand trip", change: "by_month", by: "Oct 2027" })
        // ₹1,85,000 over 12 months: ₹15,416.67, shown rounded up.
        expect(out.check).toMatchObject({ verdict: "₹15,417 a month for 12 months.", caveat: `${tooNew(n)}; this assumes you set aside the ₹15,417.` })
        expect(out.check!.summary).toBe("₹15,417 a month for 12 months. Your records are too new to show what is free, so that is the full amount a month for Thailand trip to be reached by October 2027.")
        expect(out.check!.comparison!.rows).toStrictEqual([
          { label: "For this goal a month", before: "too early to say", after: "₹15,417" },
          { label: "Reached in", before: "too early to say", after: "October 2027 (12 months)" },
        ])
        expect(recordFigures(out)).toStrictEqual([])
        noPaise(out)
      })

      it(`${n} complete months: costing more, with and without an amount a month`, async () => {
        thailand(n)
        const bare = await goalWhatIfTool.run(ctx("What if Thailand trip costs 15,000 more?"), { goal: "Thailand trip", change: "cost_more", amount: "15,000" })
        expect(bare.check).toMatchObject({ verdict: "New target ₹2,00,000.", caveat: `${tooNew(n)}; an amount a month is needed to date it.` })
        expect(bare.check!.comparison!.rows).toStrictEqual([
          { label: "Cost", before: "₹1,85,000", after: "₹2,00,000" },
          { label: "Reached in", before: "too early to say", after: "needs an amount a month" },
        ])
        expect(recordFigures(bare)).toStrictEqual([])

        // ₹2,00,000 at ₹5,000 a month: 40 months, February 2030.
        const dated = await goalWhatIfTool.run(ctx("What if Thailand trip costs 15,000 more and I save 5000 a month?"), { goal: "Thailand trip", change: "cost_more", amount: "15,000" })
        expect(dated.check).toMatchObject({ verdict: "Reached in February 2030 (40 months).", caveat: `${tooNew(n)}; this assumes you set aside the ₹5,000.` })
        expect(dated.check!.summary).toBe("Reached in February 2030 (40 months). If Thailand trip cost ₹15,000 more (₹2,00,000 in all), with ₹5,000 a month going to it, it would be reached in February 2030 (40 months).")
        expect(dated.check!.comparison!.rows).toStrictEqual([
          { label: "Cost", before: "₹1,85,000", after: "₹2,00,000" },
          { label: "For this goal a month", before: "too early to say", after: "₹5,000" },
          { label: "Reached in", before: "too early to say", after: "February 2030 (40 months)" },
        ])
        expect(recordFigures(dated)).toStrictEqual([])
        noPaise(dated)

        // Costing less, the amount a month pointed at by the model.
        const less = await goalWhatIfTool.run(ctx("agar thailand trip 15000 sasta ho aur 5 hazaar bachau?"), { goal: "Thailand trip", change: "cost_less", amount: "15000", monthly: "5 hazaar" })
        expect(less.check!.verdict).toBe("Reached in August 2029 (34 months).")
      })
    }

    it("the plain goal check is still too early to say; saving less too", async () => {
      thailand(1)
      expect((await goalProjectionTool.run(ctx("Can I reach thailand trip?"), { goal: "thailand trip" })).check!.verdict).toBe("Too early to say.")
      const less = await goalWhatIfTool.run(ctx("If I save 5000 less a month for thailand trip?"), { goal: "thailand trip", change: "save_less", amount: "5000" })
      expect(less.check!.verdict).toBe("Too early to say.")
    })
  })

  it("3 to 5 months with records: worked out, and said to be thin", async () => {
    setUp({ nets: [0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 0] })
    const out = await goalWhatIfTool.run(ctx("save 2000 more for Bike"), { goal: "Bike", change: "save_more" })
    expect(out.check!.verdict).toBe("Reached in August 2027 (10 months).")
    expect(out.check!.lines).toContain("Only 4 months have records, so the estimate is thin.")
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

  it("replaces advice phrasing with the summary, leaves facts alone, and keeps two sentences", () => {
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
      const replaced = out === "Reached in August 2027. The summary."
      if (replaced) fired++
      expect(replaced).toBe(advice)
      if (!advice) expect(out).toBe(text)
    }
    expect(fired).toBe(6)
    // At most two sentences, and "savings only" is left to the card; an amount's decimal point isn't a full stop.
    expect(whatIfAnswer(`Reached in August 2027. It takes ₹1.5 lakh. ${SAVINGS_ONLY} A third sentence.`, [check("x")])).toBe("Reached in August 2027. It takes ₹1.5 lakh.")
    expect(whatIfAnswer(`Reached in August 2027. ${SAVINGS_ONLY} Then this.`, [check("x")])).toBe("Reached in August 2027. Then this.")
    // Not a what-if: untouched.
    expect(whatIfAnswer("Yes. You should be fine.", [{ ...check("x"), kind: undefined }])).toBe("Yes. You should be fine.")
  })

  it("runs end to end on the mock provider: the code's verdict and card, two sentences", async () => {
    setUp()
    const run = await runChat({
      provider: mockProvider((req, round) =>
        round === 0
          ? mockToolCall("goal_what_if", { goal: "Bike", change: "save_more", amount: "2000" })
          : mockText("Reached in August 2027 (10 months). With {fig:saved_more_a_month} more a month, Bike would be reached then. I recommend starting now."),
      ),
      tools: [goalWhatIfTool as FinanceTool],
      context: base,
      question: "What if I save 2000 more a month for Bike?",
    })
    expect(run.result.kind).toBe("answer")
    if (run.result.kind !== "answer") return
    expect(run.result.text).toBe("Reached in August 2027 (10 months). Saving ₹2,000 more a month (₹12,000 for it this month), it would be reached in August 2027 (10 months), instead of October 2027 (12 months).")
    expect(run.result.checks[0]?.comparison?.after).toBe("₹2,000 more a month")
  })

  it("fills the placeholders of a factual answer", async () => {
    setUp()
    const run = await runChat({
      provider: mockProvider((req, round) =>
        round === 0
          ? mockToolCall("goal_what_if", { goal: "Bike", change: "save_more", amount: "2000" })
          : mockText("Reached in August 2027 (10 months). With {fig:saved_more_a_month} more a month, Bike would be reached then."),
      ),
      tools: [goalWhatIfTool as FinanceTool],
      context: base,
      question: "What if I save 2000 more a month for Bike?",
    })
    expect(run.result).toMatchObject({ kind: "answer", text: "Reached in August 2027 (10 months). With ₹2,000 more a month, Bike would be reached then." })
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
