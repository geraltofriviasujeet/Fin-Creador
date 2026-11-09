import { currencyMinorDigits, formatMoney } from "@fin-creador/domain"
import { decimalToMinor } from "../search/totals"
import { webPrice } from "../web-format"
import type { CheckedPlan, PlanAmount, PlanChange, PlanLine, PlanLineName, PlanPrice } from "./types"

// How a checked plan's figures are written on screen and in the PDF (10.9): one wording for
// both, so the PDF says exactly what the modal says.

/** A plan's figure in whole units of its currency (₹33,874, never ₹33,873.58): a web estimate's paise are false precision. */
const money = (amount: string, currency: string) => {
  const unit = 10 ** currencyMinorDigits(currency)
  return formatMoney(Math.round(decimalToMinor(amount, currencyMinorDigits(currency)) / unit) * unit, { currency })
}

/** "₹18,000", "₹18,000 to ₹36,000", "at least ₹7,026", "at most $300". */
export function planAmount(a: PlanAmount): string {
  if (a.bound === "at_least") return `at least ${money(a.low, a.currency)}`
  if (a.bound === "at_most") return `at most ${money(a.high, a.currency)}`
  const range = a.low === a.high ? money(a.low, a.currency) : `${money(a.low, a.currency)} to ${money(a.high, a.currency)}`
  return a.bound === "mixed" ? `${range} (neither a minimum nor a maximum)` : range
}

/** A web price as its page listed it, with the converted figure beside it when there is one: "USD 152 a night (about ₹14,306)". */
export const planPrice = (p: PlanPrice) => `${webPrice(p)}${p.converted ? ` (about ${money(p.converted.amount, p.converted.currency)})` : ""}`

const LINE_WORDS: Record<PlanLineName, string> = {
  transport: "Transport",
  stay: "Stay",
  food: "Food",
  local_travel: "Local travel",
  sightseeing: "Sightseeing",
  shopping: "Shopping",
  buffer: "Buffer",
  price: "Price",
  extras: "Insurance and extras",
}
export const lineWords = (line: PlanLineName) => LINE_WORDS[line]

/** Where a line's figure came from, on every line. */
export const LINE_SOURCE: Record<PlanLine["from"], string> = {
  goal: "From your records",
  web: "Web estimate",
  worked_out: "Calculated",
  none: "No estimate",
  not_estimated: "Your choice",
}

const STYLE_WORDS = { budget: "budget", comfort: "mid-range", luxury: "luxury" } as const
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** "December 2026" from "2026-12". */
const monthWords = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })
/** "8 Nov 2026" from "2026-11-08". */
export const dayWords = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

/** The plan's heading: "Delhi to Chennai · December 2026", and what it is for: "5 nights · 2 travellers · Created 8 Nov 2026". Older plans without their request keep their title. */
export function planHeading(plan: CheckedPlan, madeOn: string): { eyebrow: string; title: string; subline: string } {
  const r = plan.intake.request
  const created = `Created ${dayWords(madeOn)}`
  const eyebrow = plan.kind === "trip" ? "Roma · Travel plan" : "Roma · Purchase plan"
  if (!r) return { eyebrow, title: plan.intake.title, subline: created }
  if (r.kind === "trip") {
    const where = r.origin && r.destination ? `${r.origin} to ${r.destination}` : r.destination ? `Trip to ${r.destination}` : "A trip"
    const parts = [r.nights !== null ? count(r.nights, "night", "nights") : null, r.travellers !== null ? count(r.travellers, "traveller", "travellers") : null]
    return { eyebrow, title: [where, r.month ? monthWords(r.month) : null].filter(Boolean).join(" · "), subline: [...parts, created].filter(Boolean).join(" · ") }
  }
  const what = r.item === "house" ? "A house" : [r.make, r.model].filter(Boolean).join(" ") || `A ${r.item}`
  const deposit = r.depositMinor ? `Trade-in or deposit ${formatMoney(r.depositMinor, { currency: plan.saved?.currency ?? plan.verdicts.figures?.currency ?? plan.verdicts.totals[0]?.currency ?? "INR" })}` : null
  return { eyebrow, title: [what, r.month ? monthWords(r.month) : null].filter(Boolean).join(" · "), subline: [deposit, created].filter(Boolean).join(" · ") }
}

/** A cost line's short sub-label, from what the plan is for: "5 nights · mid-range stay". Null on older plans or when nothing is known. */
export function lineCaption(line: PlanLine, plan: CheckedPlan): string | null {
  const r = plan.intake.request
  if (line.line === "buffer") return "A share of the lines with an estimate, for costs not listed"
  if (line.line === "shopping") return "Not estimated: it is up to you"
  if (!r) return null
  if (r.kind === "purchase") {
    if (line.line === "price") return r.item === "house" ? "The home's price" : `${[r.make, r.model].filter(Boolean).join(" ") || `The ${r.item}`}, ex-showroom`
    if (line.line === "extras") return r.item === "house" ? null : "First year's insurance and extras"
    return null
  }
  const party = r.travellers !== null ? count(r.travellers, "traveller", "travellers") : null
  const days = r.nights !== null ? count(r.nights + 1, "day", "days") : null
  const parts: Partial<Record<PlanLineName, (string | null)[]>> = {
    transport: [r.origin && r.destination ? `${r.origin} to ${r.destination}` : null, party ? `for ${party}` : null],
    stay: [r.nights !== null ? count(r.nights, "night", "nights") : null, r.style ? `${STYLE_WORDS[r.style]} stay` : null],
    food: [days, party],
    local_travel: [days, r.destination ? `getting around ${r.destination}` : null],
    sightseeing: [r.destination ? `Places and tours in ${r.destination}` : null],
  }
  const words = (parts[line.line] ?? []).filter(Boolean)
  if (words.length === 0) return null
  const text = words.join(" · ").replace(" · for ", " for ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The records-only verdict in one sentence run: its word, then its summary, unless the summary already says it ("No verdict. No verdict from your records: …"). */
export function recordsLine(records: { verdict: string; summary: string }): string {
  const stem = records.verdict.replace(/\.$/, "").toLowerCase()
  return records.summary.toLowerCase().startsWith(stem) ? records.summary : `${records.verdict} ${records.summary}`.trim()
}

export type PlanStatus = "fits" | "adjust" | "unknown"
export const STATUS_WORDS: Record<PlanStatus, string> = { fits: "Fits", adjust: "Needs adjustment", unknown: "Can't say" }

/**
 * The verdict card: the plan's verdict in plain words (a trip's from both signals; a purchase's,
 * or an older trip's, from the web estimates' projection) and its one-line reason, as code wrote it.
 */
export function planVerdictCard(plan: CheckedPlan): { status: PlanStatus; headline: string; reason: string } {
  const thing = plan.kind === "trip" ? "trip" : "purchase"
  const v = plan.verdicts.both ?? plan.verdicts.web
  const status: PlanStatus = v.verdict === "Yes." ? "fits" : v.verdict === "No." || v.verdict === "Not yet." ? "adjust" : "unknown"
  const headline =
    status === "fits" ? `This ${thing} fits your current plan.` : status === "adjust" ? `This ${thing} does not fit your current plan yet.` : `Roma can't say yet whether this ${thing} fits.`
  // A trip's summary is one or two short sentences; the web one is the long account, so its verdict word is dropped.
  const reason = plan.verdicts.both ? v.summary : v.summary.replace(/^(?:Yes|No|Too early to say|No verdict)\.\s*/, "")
  return { status, headline, reason }
}

/** A way to make it fit, as a title and one line; an older plan's sentence splits at its first colon. */
export function changeParts(c: PlanChange): { title: string; detail: string | null } {
  if (typeof c !== "string") return c
  const [title = c, ...rest] = c.replace(/\.$/, "").split(": ")
  return { title, detail: rest.length > 0 ? `${rest.join(": ").charAt(0).toUpperCase()}${rest.join(": ").slice(1)}.` : null }
}

export const PLAN_NOT_LIVE = "Estimates, not quotes or bookings. Web prices are as pages listed them when the plan was made, not live fares or room rates."
export const PLAN_REOPENED = "Web prices may have changed since this plan was made. Make a new plan for today's prices."

/**
 * A total for a stat card: one representative figure, the median of the estimates, with the range
 * and its kind in the caption ("₹77,387", "Median of web estimates · ₹33,874 to ₹2,58,862").
 * "web" only when a line is from the web. An older plan without a median shows its range.
 */
export function totalFigure(a: PlanAmount, web: boolean): { value: string; caption: string } {
  const kind = web ? "web estimates" : "estimates"
  const range = a.low === a.high ? null : `${money(a.low, a.currency)} to ${money(a.high, a.currency)}`
  const bound = a.bound === "at_least" ? "a minimum" : a.bound === "at_most" ? "a maximum" : a.bound === "mixed" ? "neither a minimum nor a maximum" : null
  const middle = a.median ?? (range ? null : a.low)
  if (middle === null) return { value: planAmount(a), caption: [`Range of ${kind}`, bound].filter(Boolean).join(" · ") }
  return { value: money(middle, a.currency), caption: [range ? `Median of ${kind} · ${range}` : `From ${kind}`, bound].filter(Boolean).join(" · ") }
}

/** "Dec 2026" from "2026-12", for the stat card's label. */
export const shortMonth = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })
