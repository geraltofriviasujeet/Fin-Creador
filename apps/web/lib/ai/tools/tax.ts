import { z } from "zod"
import { type SalaryEntry, loadSalaryEntries } from "@fin-creador/api"
import {
  type RegimeTax,
  type SalaryTaxEstimate,
  TAX_YEAR_2026_27,
  type TaxAgeBand,
  type WrittenAmount,
  addDays,
  formatMoney,
  isPastFinancialYear,
  parseRupeeAmount,
  previousMonthRange,
  rupeeAmountsIn,
  salaryTaxEstimate,
  taxAgeBand,
} from "@fin-creador/domain"
import { type Figure, type FinanceTool, type TaxBlock, type ToolContext, type ToolOutput, ToolError } from "./types"

// tax_estimate (Sprint 10.6e): income tax on salary for tax year 2026-27, both regimes, worked
// out in packages/domain (salaryTaxEstimate) from the approved regime documents only. The model
// passes the person's amounts as they wrote them; code finds each one in their own words (this
// question and the recent earlier ones) and refuses one they didn't write, so the model never
// supplies a figure. The breakdown, the comparison and every assumption are built here; the
// answer refers to the totals only by placeholder. Anything outside salary income of a resident
// individual for 2026-27 gets a code-built "not covered" line and no figure.

export const TAX_SOURCES = ["Income tax under the default (new) regime, tax year 2026-27", "Income tax under the old regime, tax year 2026-27"]

export const NOT_COVERED =
  "Tax estimates here cover only salary income of a resident individual for tax year 2026-27. Capital gains, business or freelance income, rental income, other tax years and non-residents aren't covered, so no figure is given."
export const SALARY_NEEDED =
  "Tell me your annual gross salary as a figure, such as 14,15,000, 14.15 lakh or 1.2 lakh a month, and I'll work out the tax for tax year 2026-27 under both regimes."
export const DEDUCTIONS_NEEDED = "Give each old-regime deduction as a figure, such as 1.5 lakh, so I can include it."
export const ROUNDED = "This is an estimate: figures that aren't whole rupees are rounded to the nearest rupee."
/** A records salary needs entries in each of this many complete months. */
export const SALARY_MONTHS = 12

/** Words that put a question outside this estimate. */
const OUT_OF_SCOPE =
  /\b(?:capital gains?|ltcg|stcg|business income|income from business|profession(?:al)? income|freelanc\w*|rental income|rent income|house property|nri|non[- ]?residents?)\b/i
/** A tax or financial year written out ("FY 2025-26", "2027-28"): two years in a row, so a date isn't one. */
const YEAR = /\b(20\d\d)\s?[-–/]\s?(\d\d)\b(?![-–/]\d)/g
const RECORDS = /\brecord(?:s|ed)?\b/i
const SENIOR = /\bsenior(?:\s+citizens?)?\b/i
const SUPER_SENIOR = /\b(?:super|very)[\s-]senior\b/i
/** What the person called the figure, said back in the assumption. */
const SALARY_KIND: [RegExp, string][] = [
  [/\bin[\s-]?hand\b/i, "in-hand salary"],
  [/\btake[\s-]?home\b/i, "take-home salary"],
  [/\bctc\b|\bcost to company\b/i, "CTC"],
  [/\bnet salary\b/i, "net salary"],
]

const amountText = z.string().trim().min(1).max(60)

const input = z.object({
  salary: amountText
    .nullable()
    .describe("The salary exactly as the person wrote it ('1415000', '14,15,000', '14.15 lakh', '14 lpa', '1.2 lakh a month'), in-hand or CTC included. null when they gave none or asked to use their records."),
  salary_from_records: z
    .boolean()
    .default(false)
    .describe("true only when the person asked for the salary to be taken from their records: their Salary category's entries over the last 12 complete months."),
  age: z.number().int().nullable().default(null).describe("The person's age, only when they said it. Never guess."),
  old_regime_deductions: z
    .array(amountText)
    .max(10)
    .default([])
    .describe("Each old-regime deduction amount the person gave (80C, NPS, health insurance and so on), exactly as they wrote it. Never add one they didn't give."),
})

type Input = z.infer<typeof input>

const rupeesText = (rupees: number) => formatMoney(rupees * 100, { currency: "INR" })

/** The person's own amount matching what the model passed; null when they never wrote it. */
function theirAmount(passed: string, said: string): WrittenAmount | null {
  const parsed = parseRupeeAmount(passed) ?? rupeeAmountsIn(passed)[0] ?? null
  if (!parsed) return null
  const written = rupeeAmountsIn(said).filter((a) => a.rupees === parsed.rupees)
  // The person's words decide whether it was per month.
  return written.find((a) => a.perMonth) ?? written[0] ?? null
}

/** What a question that can't be estimated gets instead of an answer: one line built here. */
const needs = (question: string, missing: string): ToolOutput => ({
  data: { note: "The app shows the person a line of its own instead of your answer." },
  figures: [],
  needs: { tool: "tax_estimate", missing: [missing], question },
})

/** Whether the question is outside this estimate: other income, non-residents, another tax year. */
export function outOfScope(asked: string): boolean {
  if (OUT_OF_SCOPE.test(asked)) return true
  return [...asked.matchAll(YEAR)].some(([, start = "", end = ""]) => Number(end) === (Number(start) + 1) % 100 && `${start}-${end}` !== TAX_YEAR_2026_27)
}

/** The age band and the line that says where it came from. */
function ageOf(age: number | null, said: string): { band: TaxAgeBand; line: string } {
  if (age !== null && new RegExp(`\\b${age}\\b`).test(said)) {
    const band = taxAgeBand(age)
    if (band) return { band, line: `Aged ${age}: ${band === "under_60" ? "the old regime's under-60 slabs are used." : band === "60_to_79" ? "the old regime's slabs for 60 to 79 are used." : "the old regime's slabs for 80 or more are used."}` }
  }
  if (SUPER_SENIOR.test(said)) return { band: "80_plus", line: "You said super senior citizen: taken as aged 80 or more." }
  if (SENIOR.test(said)) return { band: "60_to_79", line: "You said senior citizen: taken as aged 60 to 79. If you're 80 or more, say so." }
  return { band: "under_60", line: "Age taken as under 60, since you didn't give one. Under the old regime, slabs differ from 60." }
}

/** The last 12 complete months before today's month. */
export function salaryRange(today: string): { from: string; to: string } {
  const to = previousMonthRange(today).end
  const next = addDays(to, 1)
  return { from: `${Number(next.slice(0, 4)) - 1}${next.slice(4)}`, to }
}

/**
 * A year's salary from the person's salary entries, or the code-built line that says why not:
 * only entries in their salary categories, in rupees, and only when every one of the 12
 * complete months has one; otherwise they are asked to type their salary.
 */
export function salaryFromEntries(entries: readonly SalaryEntry[], range: { from: string; to: string }): { rupees: number; line: string } | { needs: string } {
  const rupeeEntries = entries.filter((e) => e.currency === "INR")
  const others = entries.length - rupeeEntries.length
  const months = new Set(rupeeEntries.map((e) => e.occurredOn.slice(0, 7))).size
  const period = `from ${range.from} to ${range.to}`
  const othersNote = others > 0 ? ` ${others} ${others === 1 ? "entry" : "entries"} in other currencies ${others === 1 ? "was" : "were"} left out.` : ""
  const typeIt = "Type your annual gross salary, such as 14,15,000 or 14.15 lakh, and I'll work out the tax for tax year 2026-27 under both regimes."
  if (months === 0) return { needs: `I found no income entries in your Salary category ${period}.${othersNote} ${typeIt}` }
  if (months < SALARY_MONTHS) {
    return { needs: `I found salary entries in ${months} of the ${SALARY_MONTHS} months ${period}, so I won't work out a year's salary from them.${othersNote} ${typeIt}` }
  }
  // Whole rupees: paise are left out of the salary.
  const rupees = Math.floor(rupeeEntries.reduce((sum, e) => sum + e.amountMinor, 0) / 100)
  return {
    rupees,
    line: `Salary taken from your records: income entries in your Salary category ${period}, found in all ${SALARY_MONTHS} months (${rupeesText(rupees)}), taken as annual gross salary.${othersNote}`,
  }
}

async function salaryFromRecords(ctx: ToolContext): Promise<{ rupees: number; line: string } | { needs: string }> {
  const range = salaryRange(ctx.today)
  const result = await loadSalaryEntries(ctx.supabase, range)
  if (!result.ok) throw new ToolError("The salary entries couldn't be loaded.")
  return salaryFromEntries(result.entries, range)
}

/** One regime's rows, in the order of the calculation. */
function regimeRows(t: RegimeTax, gross: number): TaxBlock["regimes"][number]["rows"] {
  const rows: TaxBlock["regimes"][number]["rows"] = [
    { label: "Gross salary", value: rupeesText(gross) },
    { label: "Standard deduction", value: `− ${rupeesText(t.standardDeduction)}` },
    ...(t.regime === "old" && t.deductions > 0 ? [{ label: "Deductions you gave", value: `− ${rupeesText(t.deductions)}` }] : []),
    { label: "Taxable income", value: rupeesText(t.taxableIncome) },
    ...t.slabs.map((s) => ({
      label: `${s.ratePct === 0 ? "Nil" : `${s.ratePct}%`} on ${rupeesText(s.income)} (${s.upTo === null ? `above ${rupeesText(s.from)}` : `${rupeesText(s.from === 0 ? 0 : s.from + 1)} to ${rupeesText(s.upTo)}`})`,
      value: rupeesText(s.tax),
    })),
    { label: "Tax on slabs", value: rupeesText(t.slabTax) },
  ]
  if (t.rebate > 0) rows.push({ label: t.rebateRelief ? "Rebate (relief above ₹12,00,000)" : "Rebate (section 156)", value: `− ${rupeesText(t.rebate)}` })
  if (t.surchargeRatePct > 0) {
    rows.push({ label: `Surcharge at ${t.surchargeRatePct}%`, value: rupeesText(t.surcharge + t.surchargeRelief) })
    if (t.surchargeRelief > 0) rows.push({ label: "Marginal relief", value: `− ${rupeesText(t.surchargeRelief)}` })
  }
  rows.push({ label: "Cess at 4% of tax plus surcharge", value: rupeesText(t.cess) })
  rows.push({ label: "Total tax", value: rupeesText(t.total), total: true })
  return rows
}

/** The card, its figures and what the model is sent, from an estimate and its assumptions. */
export function taxOutput(e: SalaryTaxEstimate, assumptions: string[], today: string): ToolOutput {
  const comparison =
    e.lower === "same"
      ? `Both regimes come to ${rupeesText(e.new.total)}.`
      : `The ${e.lower === "new" ? "new" : "old"} regime's total is lower by ${rupeesText(e.difference)}.`
  const lines = [...assumptions, ...(e.new.wholeRupees && e.old.wholeRupees ? [] : [ROUNDED])]
  const tax: TaxBlock = {
    taxYear: e.taxYear,
    ...(isPastFinancialYear(e.taxYear, today) ? { outOfDate: true as const } : {}),
    regimes: [
      { title: "New regime (default)", rows: regimeRows(e.new, e.grossSalary) },
      { title: "Old regime", rows: regimeRows(e.old, e.grossSalary) },
    ],
    comparison,
    assumptions: lines,
    sources: TAX_SOURCES,
  }
  const money = (label: string, rupees: number): Figure => ({ label, kind: "money", minor: rupees * 100, currency: "INR", inCard: true })
  return {
    data: {
      tax_year: e.taxYear,
      note: "Worked out by the app; the person sees the full breakdown under your answer. Say both totals by their placeholders, which is lower and by how much, and the assumptions in a few words. Never write an amount, rate or slab result yourself, and don't say which regime to choose.",
      lower: e.lower,
      assumptions: lines,
    },
    figures: [
      money("Gross salary used", e.grossSalary),
      money("New regime total tax", e.new.total),
      money("Old regime total tax", e.old.total),
      money("Difference between the regimes", e.difference),
      money("New regime taxable income", e.new.taxableIncome),
      money("Old regime taxable income", e.old.taxableIncome),
    ],
    tax,
  }
}

export const taxEstimateTool: FinanceTool<Input> = {
  name: "tax_estimate",
  description:
    "Works out income tax on a salary for tax year 2026-27 (resident individual, salary income only) under both the new (default) and the old regime, with the breakdown shown to the person by the app. Pass the salary and any old-regime deductions exactly as the person wrote them. Use it whenever the person asks how much tax they'd pay on a salary. It says itself when a question isn't covered.",
  input,
  async run(ctx, { salary, salary_from_records, age, old_regime_deductions }) {
    const asked = ctx.asked ?? ""
    const said = ctx.said ?? asked
    if (outOfScope(asked)) return needs(NOT_COVERED, "scope")
    if (ctx.currency !== "INR" && salary_from_records) return needs(NOT_COVERED, "scope")

    const assumptions: string[] = []
    let gross: number
    if (salary !== null) {
      const theirs = theirAmount(salary, said)
      if (!theirs) return needs(SALARY_NEEDED, "salary")
      gross = theirs.perMonth ? theirs.rupees * 12 : theirs.rupees
      const called = SALARY_KIND.find(([re]) => re.test(said))?.[1]
      assumptions.push(
        theirs.perMonth
          ? `${rupeesText(theirs.rupees)} a month is taken as monthly gross salary: × 12 = ${rupeesText(gross)} a year.`
          : `${rupeesText(gross)} is taken as your annual gross salary${called ? ` (you called it ${called})` : ""}.`,
      )
    } else if (salary_from_records && RECORDS.test(said)) {
      const fromRecords = await salaryFromRecords(ctx)
      if ("needs" in fromRecords) return needs(fromRecords.needs, "salary")
      gross = fromRecords.rupees
      assumptions.push(fromRecords.line)
    } else {
      return needs(SALARY_NEEDED, "salary")
    }

    let deductions = 0
    for (const passed of old_regime_deductions) {
      const theirs = theirAmount(passed, said)
      if (!theirs) return needs(DEDUCTIONS_NEEDED, "deductions")
      deductions += theirs.perMonth ? theirs.rupees * 12 : theirs.rupees
    }
    assumptions.push(
      deductions === 0
        ? "No deductions given: the old regime is shown with the standard deduction only."
        : `Old-regime deductions taken as you gave them (${rupeesText(deductions)} in all); their limits were not checked. The new regime counts none of them.`,
    )
    const { band, line } = ageOf(age, said)
    assumptions.push(line, "Salary income only, for a resident individual, tax year 2026-27.")

    let estimate: SalaryTaxEstimate
    try {
      estimate = salaryTaxEstimate({ grossSalary: gross, ageBand: band, oldRegimeDeductions: deductions })
    } catch {
      return needs(SALARY_NEEDED, "salary")
    }
    return taxOutput(estimate, assumptions, ctx.today)
  },
}
