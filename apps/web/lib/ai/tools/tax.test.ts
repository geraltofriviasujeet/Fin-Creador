import { describe, expect, it, vi } from "vitest"
import type { UserClient } from "@fin-creador/api"
import { runChat } from "../chat"
import { toolsFor } from "../handle"
import { answerBasis } from "../history"
import { NOT_ADVICE } from "../knowledge/citations"
import { isTaxCalculation, routeQuestion } from "../knowledge/route"
import { mockProvider, mockText, mockToolCall } from "../llm/mock"
import { boldParts } from "../wording"
import { DEDUCTIONS_NEEDED, NOT_COVERED, ROUNDED, SALARY_NEEDED, TAX_SOURCES, outOfScope, salaryRange, taxEstimateTool } from "./tax"
import { type FinanceTool, ToolError, type ToolContext } from "./types"

const api = vi.hoisted(() => ({ loadSalaryEntries: vi.fn() }))
vi.mock("@fin-creador/api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }))

// tax_estimate (10.6e) on the mock provider: amounts only from the person's own words, the
// card built in code, nothing outside salary income for 2026-27.

const QUESTION = "my in hand salary is 1415000 how much i have to pay tax calculate it in old and new tax regime"

const ctx = (asked: string, over: Partial<ToolContext> = {}): ToolContext => ({
  supabase: {} as UserClient,
  today: "2026-11-14",
  currency: "INR",
  descriptionsOk: false,
  asked,
  said: asked,
  ...over,
})

const run = (asked: string, input: Record<string, unknown>, over: Partial<ToolContext> = {}) =>
  taxEstimateTool.run(ctx(asked, over), taxEstimateTool.input.parse(input))

describe("tax_estimate", () => {
  it("works out the dev question: in-hand ₹14,15,000 taken as gross, both regimes, the card built in code", async () => {
    const out = await run(QUESTION, { salary: "1415000" })
    expect(out.needs).toBeUndefined()
    expect(out.tax).toMatchObject({ taxYear: "2026-27", comparison: "The new regime's total is lower by ₹1,46,640.", sources: TAX_SOURCES })
    expect(out.tax?.outOfDate).toBeUndefined()
    const [next, old] = out.tax!.regimes
    expect(next!.rows.at(-1)).toEqual({ label: "Total tax", value: "₹84,240", total: true })
    expect(next!.rows).toContainEqual({ label: "15% on ₹1,40,000 (₹12,00,001 to ₹16,00,000)", value: "₹21,000" })
    expect(next!.rows).toContainEqual({ label: "Cess at 4% of tax plus surcharge", value: "₹3,240" })
    expect(old!.rows.at(-1)).toEqual({ label: "Total tax", value: "₹2,30,880", total: true })
    expect(old!.rows).toContainEqual({ label: "Tax on slabs", value: "₹2,22,000" })
    expect(out.tax?.assumptions).toEqual([
      "₹14,15,000 is taken as your annual gross salary (you called it in-hand salary).",
      "No deductions given: the old regime is shown with the standard deduction only.",
      "Age taken as under 60, since you didn't give one. Under the old regime, slabs differ from 60.",
      "Salary income only, for a resident individual, tax year 2026-27.",
    ])
    expect(out.figures.every((f) => f.inCard)).toBe(true)
    expect(out.figures.map((f) => [f.label, f.kind === "money" ? f.minor / 100 : null])).toEqual([
      ["Gross salary used", 1_415_000],
      ["New regime total tax", 84_240],
      ["Old regime total tax", 230_880],
      ["Difference between the regimes", 146_640],
      ["New regime taxable income", 1_340_000],
      ["Old regime taxable income", 1_365_000],
    ])
  })

  it("reads lakh, lpa and crore, and multiplies a monthly figure by 12, saying so", async () => {
    expect((await run("tax on 14.15 lakh salary?", { salary: "14.15 lakh" })).figures[0]).toMatchObject({ minor: 141_500_000 })
    expect((await run("tax on 14 lpa", { salary: "14 lpa" })).figures[0]).toMatchObject({ minor: 140_000_000 })
    const crore = await run("how much tax on a 1.2 crore salary", { salary: "1.2 crore" })
    expect(crore.tax?.regimes[0]!.rows).toContainEqual({ label: "Surcharge at 15%", value: expect.any(String) })
    const monthly = await run("calculate tax, my salary is 1.2 lakh a month", { salary: "1.2 lakh" })
    expect(monthly.figures[0]).toMatchObject({ minor: 144_000_000 })
    expect(monthly.tax?.assumptions[0]).toBe("₹1,20,000 a month is taken as monthly gross salary: × 12 = ₹14,40,000 a year.")
  })

  it("never uses an amount the person didn't write", async () => {
    // The model worked out an annual figure from a monthly one: not theirs.
    expect((await run("calculate tax, my salary is 1.2 lakh a month", { salary: "14,40,000" })).needs?.question).toBe(SALARY_NEEDED)
    expect((await run("calculate my tax", { salary: "12 lakh" })).needs?.question).toBe(SALARY_NEEDED)
    expect((await run("calculate my tax", { salary: null })).needs?.question).toBe(SALARY_NEEDED)
    expect((await run("tax on 14 lakh salary", { salary: "14 lakh", old_regime_deductions: ["1.5 lakh"] })).needs?.question).toBe(DEDUCTIONS_NEEDED)
    // Their age only when they said it.
    const guessed = await run("tax on 14 lakh salary", { salary: "14 lakh", age: 65 })
    expect(guessed.tax?.assumptions).toContain("Age taken as under 60, since you didn't give one. Under the old regime, slabs differ from 60.")
  })

  it("takes deductions as given, says their limits weren't checked, and counts them under the old regime only", async () => {
    const out = await run("salary 12 lakh, 1.5 lakh in 80C, 50000 NPS and 25000 health insurance: calculate tax", {
      salary: "12 lakh",
      old_regime_deductions: ["1.5 lakh", "50000", "25000"],
    })
    expect(out.tax?.assumptions[1]).toBe("Old-regime deductions taken as you gave them (₹2,25,000 in all); their limits were not checked. The new regime counts none of them.")
    expect(out.tax?.regimes[1]!.rows).toContainEqual({ label: "Deductions you gave", value: "− ₹2,25,000" })
    expect(out.tax?.regimes[0]!.rows.some((r) => r.label === "Deductions you gave")).toBe(false)
    expect(out.tax?.comparison).toBe("The new regime's total is lower by ₹1,01,400.")
  })

  it("uses an age the person gave, or senior citizen in their words", async () => {
    expect((await run("I am 65, salary 7.5 lakh, calculate tax", { salary: "7.5 lakh", age: 65 })).tax?.assumptions).toContain("Aged 65: the old regime's slabs for 60 to 79 are used.")
    const senior = await run("senior citizen with 7.5 lakh salary, how much tax?", { salary: "7.5 lakh" })
    expect(senior.tax?.assumptions).toContain("You said senior citizen: taken as aged 60 to 79. If you're 80 or more, say so.")
    expect(senior.tax?.regimes[1]!.rows.at(-1)).toMatchObject({ value: "₹52,000" })
  })

  it("says when a figure was rounded to the rupee", async () => {
    const out = await run("tax on salary 1340001", { salary: "1340001" })
    expect(out.tax?.assumptions.at(-1)).toBe(ROUNDED)
  })

  it("gives no figure outside salary income of a resident for 2026-27", async () => {
    for (const asked of ["tax on 14 lakh salary and 2 lakh capital gains", "I'm an NRI, tax on 14 lakh salary", "tax on 14 lakh salary for FY 2025-26", "tax on 14 lakh freelance income"]) {
      const out = await run(asked, { salary: "14 lakh" })
      expect(out.needs?.question, asked).toBe(NOT_COVERED)
      expect(out.figures, asked).toEqual([])
    }
    expect(outOfScope("tax on 14 lakh salary for tax year 2026-27, asked on 2026-11-14")).toBe(false)
  })

  it("labels the year and marks it out of date once it has ended", async () => {
    expect((await run("tax on 14 lakh salary", { salary: "14 lakh" }, { today: "2027-03-31" })).tax?.outOfDate).toBeUndefined()
    expect((await run("tax on 14 lakh salary", { salary: "14 lakh" }, { today: "2027-04-01" })).tax).toMatchObject({ taxYear: "2026-27", outOfDate: true })
  })
})

describe("tax_estimate from the records", () => {
  const ASKED = "calculate my tax using the salary in my records"
  const fromRecords = (entries: { occurredOn: string; amountMinor: number; currency?: string }[] | null) => {
    api.loadSalaryEntries.mockResolvedValueOnce(entries ? { ok: true, entries: entries.map((e) => ({ currency: "INR", ...e })) } : { ok: false })
    return run(ASKED, { salary: null, salary_from_records: true })
  }
  // Today 2026-11-14: the 12 complete months are November 2025 to October 2026.
  const months = (n: number, amountMinor = 11_800_000) =>
    Array.from({ length: n }, (_, i) => ({ occurredOn: `${i < 2 ? 2025 : 2026}-${String(((10 + i) % 12) + 1).padStart(2, "0")}-01`, amountMinor }))

  it("reads the last 12 complete months", () => {
    expect(salaryRange("2026-11-14")).toEqual({ from: "2025-11-01", to: "2026-10-31" })
    expect(salaryRange("2027-01-01")).toEqual({ from: "2026-01-01", to: "2026-12-31" })
  })

  it("estimates from the Salary category's entries when all 12 months have one, and says so", async () => {
    const out = await fromRecords(months(12))
    expect(api.loadSalaryEntries).toHaveBeenLastCalledWith(expect.anything(), { from: "2025-11-01", to: "2026-10-31" })
    expect(out.figures[0]).toMatchObject({ label: "Gross salary used", minor: 141_600_000 })
    expect(out.tax?.assumptions[0]).toBe(
      "Salary taken from your records: income entries in your Salary category from 2025-11-01 to 2026-10-31, found in all 12 months (₹14,16,000), taken as annual gross salary.",
    )
  })

  it("asks for the salary when there are no salary entries", async () => {
    const out = await fromRecords([])
    expect(out.needs?.question).toBe(
      "I found no income entries in your Salary category from 2025-11-01 to 2026-10-31. Type your annual gross salary, such as 14,15,000 or 14.15 lakh, and I'll work out the tax for tax year 2026-27 under both regimes.",
    )
    expect(out.figures).toEqual([])
  })

  it("asks for the salary when fewer than 12 months have entries, saying how many", async () => {
    const out = await fromRecords([...months(7), { occurredOn: "2026-05-15", amountMinor: 500_000 }])
    expect(out.needs?.question).toMatch(/^I found salary entries in 7 of the 12 months from 2025-11-01 to 2026-10-31, so I won't work out a year's salary from them\. Type your annual gross salary/)
    expect(out.tax).toBeUndefined()
  })

  it("leaves out entries in other currencies, and says so", async () => {
    const out = await fromRecords([...months(11), { occurredOn: "2026-10-01", amountMinor: 500_000, currency: "USD" }])
    expect(out.needs?.question).toContain("in 11 of the 12 months")
    expect(out.needs?.question).toContain("1 entry in other currencies was left out.")
  })

  it("reads the records only when the person asked for them, and says when they can't be read", async () => {
    expect((await run("calculate my tax", { salary: null, salary_from_records: true })).needs?.question).toBe(SALARY_NEEDED)
    await expect(fromRecords(null)).rejects.toThrow(ToolError)
  })
})

describe("tax routing", () => {
  it("routes a tax calculation to tax_estimate and knowledge_search only", () => {
    expect(routeQuestion(QUESTION)).toBe("tax")
    expect(routeQuestion("how much tax on 14 lakh?")).toBe("tax")
    expect(routeQuestion("Calculate tax on my salary under both regimes")).toBe("tax")
    expect(toolsFor("tax", true).map((t) => t.name)).toEqual(["tax_estimate", "knowledge_search"])
  })

  it("leaves rule questions and the person's own tax spending where they were", () => {
    expect(isTaxCalculation("What are the old regime tax slabs?")).toBe(false)
    expect(routeQuestion("What are the old regime tax slabs?")).toBe("knowledge")
    expect(routeQuestion("How much tax did I pay this month?")).toBe("both")
  })

  it("doesn't say the answer is from the records", () => {
    expect(answerBasis(["tax_estimate", "knowledge_search"])).toEqual({ records: false, knowledge: true })
  })
})

describe("a tax answer in the chat loop", () => {
  const ask = (script: Parameters<typeof mockProvider>[0], question = QUESTION) =>
    runChat({ provider: mockProvider(script), tools: [taxEstimateTool as FinanceTool], context: ctx(""), question, route: "tax" })

  it("fills both totals by placeholder, carries the card, and ends with the not-advice line once", async () => {
    const { result } = await ask(undefined)
    expect(result).toMatchObject({
      kind: "answer",
      text: `**New regime:** ₹84,240. **Old regime:** ₹2,30,880. (Test answer.)\n\n${NOT_ADVICE}`,
      toolsRan: ["tax_estimate"],
      tax: { taxYear: "2026-27" },
    })
  })

  it("refuses an amount the model typed itself", async () => {
    const { result } = await ask((_r, round) => (round === 0 ? mockToolCall("tax_estimate", { salary: "1415000" }) : mockText("You'd pay ₹84,000.")))
    expect(result).toEqual({ kind: "unverified", unmatched: ["84000"] })
  })

  it("shows the code-built line, not the model's text, when it isn't covered", async () => {
    const { result } = await ask(
      (_r, round) => (round === 0 ? mockToolCall("tax_estimate", { salary: "14 lakh" }) : mockText("Roughly ₹1,00,000.")),
      "calculate tax on 14 lakh salary and my capital gains",
    )
    expect(result).toMatchObject({ kind: "answer", text: NOT_COVERED, figures: [] })
  })
})

describe("boldParts", () => {
  it("splits at Markdown bold and drops a stray marker", () => {
    expect(boldParts("**New regime:** ₹84,240. Old **regime")).toEqual([
      { text: "New regime:", bold: true },
      { text: " ₹84,240. Old regime", bold: false },
    ])
    expect(boldParts("<b>not html</b>")).toEqual([{ text: "<b>not html</b>", bold: false }])
  })
})
