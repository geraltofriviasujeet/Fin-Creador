import { z } from "zod"
import { AMOUNT_ERROR_MESSAGES, type IsoDate, formatMoney, monthStart, parseAmount } from "@fin-creador/domain"
import { VEHICLE_CATALOGUE, tripPlaceScope, vehicleMakes } from "@fin-creador/schemas"
import { PURCHASE_USES, type PurchaseUse, TRIP_STYLES } from "../search/query"
import { type PlanRequest, type PurchasePlanRequest, type TripPlanRequest, planRequest } from "./types"

// The plan intake (10.9), in code: a question that asks for a plan ("plan my trip to Goa",
// "make my plan from Delhi to Shillong", "can I buy a car", "I want to buy a bike") is recognised here, what it already says is filled in, and only the
// missing fields are asked, with questions written here, never by the model. Every question
// can be skipped: a skipped field stays null and the lines that need it are "no estimate".

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
const MONTH_WORD = new RegExp(`\\bin\\s+(${MONTHS.map((m) => `${m.slice(0, 3)}(?:${m.slice(3)})?`).join("|")})\\b(?:\\s+(\\d{4}))?`, "i")

// A trip plan, in the ways people ask (2026-11-09):
//   * a plan and a trip word: "plan my trip", "plan a trip to Goa", "help me plan our holiday";
//   * affording or taking a trip ahead: "can I afford a trip to Bali", "should I take a vacation";
//   * wanting to go somewhere: "I want to go to Shillong", "we'd like to travel to Japan";
//   * a plan with a route to a place on the app's list: "make my plan from Delhi to Shillong"
//     (PLAN_ROUTE, checked in detectPlan), so "plan to reduce my spending" isn't a trip.
// A question about past travel ("how much did I spend on travel last year") is none of these.
const TRIP = new RegExp(
  [
    /\b(?:plan|planning)\b[^.?!]*\b(?:trip|holiday|vacation|travel)\b|\b(?:trip|holiday|vacation)\b[^.?!]*\bplan\b/.source,
    // Asked ahead, never a past trip: "did I take a trip last year" isn't one.
    /\b(?:afford|(?:can|could|should|shall)\s+(?:i|we)\s+(?:take|go on|book))\s+(?:a|an|my|our|the|this)?\s*(?:\w+\s+)?(?:trip|holiday|vacation)\b/.source,
    // Going "to" a place, or visiting one: "want to go over my budget" isn't one.
    /\b(?:want|wanna|would like|'d like|wish|hope|planning|thinking of|thinking about)\s+(?:to\s+)?(?:(?:go(?:ing)?|travel(?:ling)?|fly(?:ing)?)\s+to|visit(?:ing)?)\s+[A-Za-z]/.source,
  ].join("|"),
  "i",
)
const PLAN_ROUTE = /\b(?:plan|planning|itinerary)\b[^.?!]*\b(?:from\s+[A-Za-z][^.?!]*?\s+)?to\s+[A-Za-z]/i
const PURCHASE = new RegExp(
  [
    /\b(?:can i|could i|should i)\s+(?:afford|buy|get)\b|\bplan(?:ning)?\s+(?:to\s+buy|buying|for\s+(?:a|an|my)\s+new)\b/.source,
    // "I want to buy a bike", "we'd like to get a car", "thinking of buying a flat".
    /\b(?:want|wanna|would like|'d like|need|hope|wish|plan|planning|thinking of|thinking about)\s+(?:to\s+)?(?:buy(?:ing)?|get(?:ting)?|purchas(?:e|ing))\b/.source,
  ].join("|"),
  "i",
)
const ORIGIN = /\bfrom\s+([A-Za-z][A-Za-z .'-]{1,39}?)(?=\s+(?:to|in|for|with|on|this|next|over|during)\b|[,.?!]|$)/i
const DESTINATION =
  /\b(?:trip|holiday|vacation|travel(?:ling)?|go(?:ing)?|fly(?:ing)?|visit(?:ing)?|plan|itinerary)(?:\s+from\s+[A-Za-z .'-]{1,39}?)?\s+to\s+([A-Za-z][A-Za-z .'-]{1,39}?)(?=\s+(?:in|for|with|on|this|next|over|during)\b|[,.?!]|$)|\bvisit(?:ing)?\s+([A-Za-z][A-Za-z .'-]{1,39}?)(?=\s+(?:in|for|with|on|this|next|over|during)\b|[,.?!]|$)/i
/** "shillong" as "Shillong": a place as the person typed it, capitalised for the plan's title. */
const placeWords = (place: string) => place.replace(/(^|[\s-])(\p{Ll})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase())
const ITEMS: [RegExp, PurchasePlanRequest["item"]][] = [
  [/\b(?:bike|motorbike|motorcycle|scooter|scooty)\b/i, "bike"],
  [/\b(?:car|suv|sedan|hatchback)\b/i, "car"],
  [/\b(?:house|home|flat|apartment|villa)\b/i, "house"],
]

/** The month a question names: "in January 2027", or the next January from today. */
export function monthIn(text: string, today: IsoDate): string | null {
  if (/\bnext month\b/i.test(text)) return monthStart(today, 1).slice(0, 7)
  const m = MONTH_WORD.exec(text)
  if (!m) return null
  const index = MONTHS.findIndex((name) => name.startsWith(m[1]!.toLowerCase().slice(0, 3)))
  const mm = String(index + 1).padStart(2, "0")
  if (m[2]) return `${m[2]}-${mm}`
  const year = Number(today.slice(0, 4))
  return `${index + 1 < Number(today.slice(5, 7)) ? year + 1 : year}-${mm}`
}

function tripFrom(text: string, today: IsoDate): TripPlanRequest {
  const route = DESTINATION.exec(text)
  const typed = (route?.[1] ?? route?.[2])?.trim()
  const place = typed ? placeWords(typed) : null
  const fromTyped = ORIGIN.exec(text)?.[1]?.trim()
  const from = fromTyped ? placeWords(fromTyped) : null
  const nights = /\b(\d{1,2})\s*nights?\b/i.exec(text)
  const days = /\b(\d{1,2})\s*days?\b/i.exec(text)
  const people = /\b(\d)\s*(?:people|persons|travell?ers|adults|of us)\b/i.exec(text)
  const n = nights ? Number(nights[1]) : days ? Number(days[1]) - 1 : null
  const travellers = people ? Number(people[1]) : /\b(?:solo|alone|just me|by myself)\b/i.test(text) ? 1 : /\b(?:couple|two of us)\b/i.test(text) ? 2 : null
  const style = /\b(?:luxury|premium|five[- ]star|5[- ]star)\b/i.test(text)
    ? "luxury"
    : /\b(?:budget|cheap|backpack\w*)\b/i.test(text)
      ? "budget"
      : /\b(?:comfort\w*|mid[- ]range|four[- ]star|4[- ]star)\b/i.test(text)
        ? "comfort"
        : null
  return {
    kind: "trip",
    // A place the app's list doesn't have can't be looked up: it is asked again.
    destination: place && tripPlaceScope(place) ? place : null,
    origin: from && tripPlaceScope(from) ? from : null,
    month: monthIn(text, today),
    nights: n !== null && n >= 1 && n <= 30 ? n : null,
    travellers: travellers !== null && travellers >= 1 && travellers <= 9 ? travellers : null,
    style,
  }
}

/** A make and model the question names, from the app's list (the kind follows the make). */
function vehicleIn(text: string, kinds: readonly ("bike" | "car")[]): { item: "bike" | "car"; make: string; model: string | null } | null {
  const has = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(text)
  for (const item of kinds) {
    for (const [make, models] of Object.entries(VEHICLE_CATALOGUE[item])) {
      const model = models.find(has) ?? null
      if (model || has(make)) return { item, make, model }
    }
  }
  return null
}

/** A main use the question names: "for my office commute", "for touring", "for the family", "my first bike". */
const USES: [RegExp, PurchaseUse][] = [
  [/\b(?:commut\w*|office|daily ride|city ride|in the city)\b/i, "commute"],
  [/\b(?:tour\w*|long rides?|road trips?|highway)\b/i, "touring"],
  [/\b(?:family|kids|children)\b/i, "family"],
  [/\b(?:first (?:bike|car|vehicle)|beginner|learner)\b/i, "first"],
]

const BUDGET_SCALES: Record<string, number> = { k: 3, thousand: 3, l: 5, lakh: 5, lakhs: 5, lac: 5, lacs: 5, cr: 7, crore: 7, crores: 7 }
const BUDGET_NUMBER = String.raw`(?:₹|rs\.?|inr)?\s?(\d[\d,]*(?:\.\d+)?)\s?(lakhs?|lacs?|l|k|thousand|crores?|cr)?\b`
/** "under 12 lakh", "below ₹1,50,000", "budget of 8 lakh", "12 lakh budget": the figure and its scale word. */
const BUDGET = new RegExp(
  `\\b(?:under|below|within|up ?to|less than|not more than|max(?:imum)?(?: of)?|budget(?: of| is)?)\\s+${BUDGET_NUMBER}|${BUDGET_NUMBER}\\s+(?:budget|max(?:imum)?)\\b`,
  "i",
)

/**
 * A budget the question names, in minor units (two decimals), worked out exactly; null when it
 * names none, or a bare number under 1,000 ("under 5" isn't a price). Shown in the budget field
 * for the person to check and correct.
 */
export function budgetIn(text: string): number | null {
  const m = BUDGET.exec(text)
  if (!m) return null
  const raw = (m[1] ?? m[3])!.replace(/,/g, "")
  const word = (m[2] ?? m[4])?.toLowerCase()
  const zeros = word ? BUDGET_SCALES[word]! : 0
  const [whole = "0", fraction = ""] = raw.split(".")
  if (fraction.length > zeros + 2) return null
  const minor = BigInt(whole + fraction.padEnd(zeros + 2, "0"))
  if (minor < 100_000n || minor > 10_000_000_000_000n) return null
  return Number(minor)
}

function purchaseFrom(text: string, today: IsoDate): PurchasePlanRequest | null {
  const named = ITEMS.find(([re]) => re.test(text))?.[1] ?? null
  const vehicle = named === "house" ? null : vehicleIn(text, named ? [named] : ["car", "bike"])
  const item = vehicle?.item ?? named
  if (!item) return null
  const base = { kind: "purchase" as const, item, make: vehicle?.make ?? null, model: vehicle?.model ?? null, month: monthIn(text, today), depositMinor: null }
  // A bike or car without a make gets a shortlist: its main use, if the question says it.
  return item === "house" || base.make !== null ? base : { ...base, use: USES.find(([re]) => re.test(text))?.[1] ?? null, budgetMinor: budgetIn(text) }
}

/** The plan a question asks for, with what it already says; null when it isn't one. */
export function detectPlan(question: string, today: IsoDate): PlanRequest | null {
  if (TRIP.test(question)) return tripFrom(question, today)
  // A plan with a route: a trip only when the place is one the app knows.
  if (PLAN_ROUTE.test(question)) {
    const trip = tripFrom(question, today)
    if (trip.destination !== null) return trip
  }
  if (PURCHASE.test(question)) return purchaseFrom(question, today)
  return null
}

export type IntakeQuestion =
  | { field: "destination" | "origin"; kind: "text"; label: string; hint: string; initial?: string }
  /** `hint`: what skipping it costs, shown beside it before and after a skip (the person still chooses). */
  | { field: "month"; kind: "month"; label: string; min: string; hint: string; skipped: string; initial?: string }
  | { field: "nights" | "travellers"; kind: "number"; label: string; min: number; max: number; hint?: string; initial?: string }
  | { field: "style"; kind: "choice"; label: string; options: { value: string; label: string }[] }
  | { field: "make" | "use"; kind: "choice"; label: string; options: { value: string; label: string }[] }
  | { field: "model"; kind: "model"; label: string }
  | { field: "depositMinor" | "budgetMinor"; kind: "amount"; label: string; hint: string; initial?: string }

const USE_CHOICES: Record<PurchaseUse, string> = { commute: "City commute", touring: "Touring", family: "Family", first: "First vehicle" }

const STYLE_LABELS: Record<(typeof TRIP_STYLES)[number], string> = { budget: "Budget", comfort: "Comfort (3–4 star)", luxury: "Luxury (5 star)" }

/** Whether the intake can offer a shortlist (a bike or car whose make the question didn't name). */
export const canShortlist = (draft: PlanRequest) => draft.kind === "purchase" && draft.item !== "house" && draft.make === null

const MONTH_WORDS = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]!.replace(/^./, (c) => c.toUpperCase())} ${month.slice(0, 4)}`
/** What the intake says beside a figure read from the question: it was read, as what, and can be changed. */
const readAs = (words: string) => `Read from your question as ${words}. Change it if that's wrong.`

/**
 * The questions for the fields still missing, and for every figure the question gave (month,
 * nights, travellers, budget), filled in with what was read and saying so, so a misreading can
 * be seen and corrected. A bike or car without a make asks for its main use and budget (a
 * shortlist), or, with `knowModel` ("I already know the model"), for the make and model.
 */
export function intakeQuestions(draft: PlanRequest, today: IsoDate, knowModel = false): IntakeQuestion[] {
  const out: IntakeQuestion[] = []
  const month = { field: "month", kind: "month", min: today.slice(0, 7), ...(draft.month ? { initial: draft.month } : {}) } as const
  const count = (n: number | null) => (n === null ? {} : { initial: String(n), hint: readAs(String(n)) })
  // The verdict is worked out for a month, and so are a trip's fares: skipping it quietly empties both, so it says so.
  const monthCost =
    draft.kind === "trip"
      ? { hint: "Skip it and the plan has no verdict and no transport estimate: both are worked out for the travel month.", skipped: "Skipped: the plan will have no verdict and no transport estimate." }
      : { hint: "Skip it and the plan has no verdict: it is worked out for the month you buy.", skipped: "Skipped: the plan will have no verdict." }
  if (draft.month) monthCost.hint = readAs(MONTH_WORDS(draft.month))
  if (draft.kind === "trip") {
    if (draft.destination === null) out.push({ field: "destination", kind: "text", label: "Where to?", hint: "A country, an Indian state or a city. Places not on the app's list can't be priced on the web." })
    // Always asked, filled in when the question named it, so it can be changed.
    out.push({ field: "origin", kind: "text", label: "Travelling from which city?", hint: "Flights and airlines are looked up from here. Skip it and transport shows no estimate.", ...(draft.origin ? { initial: draft.origin } : {}) })
    out.push({ ...month, ...monthCost, label: "Which month?" })
    out.push({ field: "nights", kind: "number", label: "How many nights?", min: 1, max: 30, ...count(draft.nights) })
    out.push({ field: "travellers", kind: "number", label: "How many travellers?", min: 1, max: 9, ...count(draft.travellers) })
    if (draft.style === null) out.push({ field: "style", kind: "choice", label: "What kind of stay?", options: TRIP_STYLES.map((s) => ({ value: s, label: STYLE_LABELS[s] })) })
    return out
  }
  if (canShortlist(draft) && !knowModel) {
    if (!draft.use) out.push({ field: "use", kind: "choice", label: "What will you mainly use it for?", options: PURCHASE_USES.map((u) => ({ value: u, label: USE_CHOICES[u] })) })
    const read = draft.budgetMinor ?? null
    out.push({
      field: "budgetMinor",
      kind: "amount",
      label: "What's your budget?",
      hint:
        read === null
          ? "Skip it and Roma works it out from your records: free money by the month after your other goals, plus savings and any trade-in."
          : readAs(formatMoney(read, { currency: "INR" })),
      ...(read === null ? {} : { initial: formatMoney(read, { currency: "INR" }).replace(/^[^\d]+/, "") }),
    })
  } else if (draft.item !== "house") {
    if (draft.make === null) out.push({ field: "make", kind: "choice", label: "Which make?", options: vehicleMakes(draft.item).map((m) => ({ value: m, label: m })) })
    if (draft.model === null) out.push({ field: "model", kind: "model", label: "Which model?" })
  }
  out.push({ ...month, ...monthCost, label: "When do you want to buy it?" })
  if (draft.depositMinor === null) out.push({ field: "depositMinor", kind: "amount", label: "Any trade-in or deposit?", hint: "What you'll put in from a trade-in or an existing deposit. Skip if none." })
  return out
}

/** Models of a make, for the model question. */
export const modelsOf = (item: "bike" | "car", make: string | null): readonly string[] => (make ? (VEHICLE_CATALOGUE[item][make] ?? []) : [])

/**
 * A month as typed: "2027-03" (the month picker), or typed where the browser shows a text box
 * (Safari): "03/2027", "3-2027", "March 2027", "Mar 27", or "March" (the next one). Null when
 * it isn't a month.
 */
export function parseMonth(raw: string, today: IsoDate): string | null {
  const text = raw.trim().toLowerCase()
  const iso = /^(\d{4})-(\d{1,2})$/.exec(text)
  const numeric = /^(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})$/.exec(text)
  const named = /^([a-z]{3,9})\.?(?:\s*,?\s*(\d{4}|\d{2}))?$/.exec(text)
  let year: number | null
  let index: number
  if (iso) [year, index] = [Number(iso[1]), Number(iso[2]) - 1]
  else if (numeric) [year, index] = [Number(numeric[2]), Number(numeric[1]) - 1]
  else if (named) {
    index = named[1]!.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(named[1]!)) : -1
    year = named[2] ? Number(named[2]) : null
  } else return null
  if (index < 0 || index > 11) return null
  if (year !== null && year < 100) year += 2000
  if (year === null) {
    const now = Number(today.slice(0, 4))
    year = index + 1 < Number(today.slice(5, 7)) ? now + 1 : now
  }
  return `${year}-${String(index + 1).padStart(2, "0")}`
}

/** What can't be used, named by its question, and why; or the plan. */
export type BuiltPlan = { plan: PlanRequest } | { error: string; field: string }

/**
 * The plan with each answer in. Every answer is checked here, so a message always names the
 * question and the reason; a skipped or empty answer is null.
 */
export function buildPlan(draft: PlanRequest, answers: Readonly<Record<string, string>>, skipped: ReadonlySet<string>, currency: string, today: IsoDate, knowModel = false): BuiltPlan {
  const plan: Record<string, unknown> = { ...draft }
  const questions = intakeQuestions(draft, today, knowModel)
  const fail = (q: IntakeQuestion, reason: string): BuiltPlan => ({ field: q.field, error: `${q.label} ${reason}` })
  for (const q of questions) {
    const raw = (answers[q.field] ?? "").trim()
    if (skipped.has(q.field) || raw === "") {
      plan[q.field] = null
      continue
    }
    if (q.kind === "number") {
      const n = Number(raw)
      if (!Number.isInteger(n) || n < q.min || n > q.max) return fail(q, `Enter a whole number from ${q.min} to ${q.max}, or skip it.`)
      plan[q.field] = n
    } else if (q.kind === "amount") {
      const parsed = parseAmount(raw, currency, { allowZero: true })
      if (!parsed.ok) return fail(q, parsed.error === "invalid" ? `Enter it in ${currency} as a number, such as 600000, or skip it.` : `${AMOUNT_ERROR_MESSAGES[parsed.error]}. Change it, or skip it.`)
      plan[q.field] = parsed.minor
    } else if (q.kind === "month") {
      const month = parseMonth(raw, today)
      if (month === null) return fail(q, `“${raw.slice(0, 20)}” isn't a month. Enter one like March 2027 or 2027-03, or skip it.`)
      if (month < q.min) return fail(q, "That month has passed. Choose this month or later, or skip it.")
      plan[q.field] = month
    } else if (q.kind === "text") {
      if (raw.length > 40) return fail(q, "Keep it to 40 characters, or skip it.")
      plan[q.field] = raw
    } else plan[q.field] = raw
  }
  // A known model's plan has no shortlist fields; a shortlist's has both (null when skipped).
  if (knowModel && plan.make) {
    delete plan.use
    delete plan.budgetMinor
  } else if (canShortlist(draft) && !knowModel) {
    plan.use ??= null
    plan.budgetMinor ??= null
  }
  // A model belongs to its make: a new make clears a model chosen for another.
  if (plan.kind === "purchase" && plan.item !== "house" && plan.make && plan.model && !modelsOf(plan.item as "bike" | "car", plan.make as string).includes(plan.model as string)) plan.model = null
  const parsed = planRequest.safeParse(plan)
  if (parsed.success) return { plan: parsed.data }
  // Not expected after the checks above; still named by its question, with the schema's reason.
  const issue = parsed.error.issues[0]!
  const field = String(issue.path[0] ?? "")
  const q = questions.find((x) => x.field === field)
  return { field, error: `${q?.label ?? "An answer"} This answer can't be used (${issue.message.toLowerCase()}). Change it, or skip it.` }
}

/** Web lookups left for the caller (roma_search_remaining): advice for the intake, read before the form is filled in. */
export const lookupsLeft = z.object({
  outcome: z.enum(["ok", "disabled", "monthly_cap", "daily_limit"]),
  credits: z.number().int().min(0),
  limitedBy: z.enum(["day", "month"]).nullable(),
})
export type LookupsLeft = z.infer<typeof lookupsLeft>

/** The most lookups a plan of this kind sends (run.ts): a trip's 8 (6 cost lines, airlines, hotels); a bike or car's 2; a house's none. */
export function lookupsNeeded(draft: PlanRequest): number {
  if (draft.kind === "trip") return 8
  return draft.item === "house" ? 0 : 2
}

/**
 * What the intake says before the form when the plan's lookups can't all run, or null when
 * they can (or nothing is known): the plan would otherwise spend the last ones and show
 * "No estimate".
 */
export function lookupsNotice(left: LookupsLeft | null, draft: PlanRequest): string | null {
  const needed = lookupsNeeded(draft)
  if (!left || needed === 0) return null
  const needs = `a ${draft.kind === "trip" ? "trip plan needs up to" : "plan needs"} ${needed}`
  if (left.outcome === "disabled") return `Web lookups are off right now; ${needs}.`
  if (left.credits >= needed) return null
  const month = left.limitedBy === "month"
  const count = left.credits === 0 ? "No web lookups" : `Only ${left.credits} web ${left.credits === 1 ? "lookup" : "lookups"}`
  return `${count} left ${month ? "this month" : "today"}; ${needs}. ${month ? "They reset on the 1st of next month." : "They reset at midnight in your time zone."}`
}
