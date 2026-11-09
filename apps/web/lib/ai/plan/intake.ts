import { AMOUNT_ERROR_MESSAGES, type IsoDate, monthStart, parseAmount } from "@fin-creador/domain"
import { VEHICLE_CATALOGUE, tripPlaceScope, vehicleMakes } from "@fin-creador/schemas"
import { TRIP_STYLES } from "../search/query"
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

function purchaseFrom(text: string, today: IsoDate): PurchasePlanRequest | null {
  const named = ITEMS.find(([re]) => re.test(text))?.[1] ?? null
  const vehicle = named === "house" ? null : vehicleIn(text, named ? [named] : ["car", "bike"])
  const item = vehicle?.item ?? named
  if (!item) return null
  return { kind: "purchase", item, make: vehicle?.make ?? null, model: vehicle?.model ?? null, month: monthIn(text, today), depositMinor: null }
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
  | { field: "month"; kind: "month"; label: string; min: string; hint: string; skipped: string }
  | { field: "nights" | "travellers"; kind: "number"; label: string; min: number; max: number }
  | { field: "style"; kind: "choice"; label: string; options: { value: string; label: string }[] }
  | { field: "make"; kind: "choice"; label: string; options: { value: string; label: string }[] }
  | { field: "model"; kind: "model"; label: string }
  | { field: "depositMinor"; kind: "amount"; label: string; hint: string }

const STYLE_LABELS: Record<(typeof TRIP_STYLES)[number], string> = { budget: "Budget", comfort: "Comfort (3–4 star)", luxury: "Luxury (5 star)" }

/** The questions for the fields still missing, and only those. */
export function intakeQuestions(draft: PlanRequest, today: IsoDate): IntakeQuestion[] {
  const out: IntakeQuestion[] = []
  const month = { field: "month", kind: "month", min: today.slice(0, 7) } as const
  // The verdict is worked out for a month, and so are a trip's fares: skipping it quietly empties both, so it says so.
  const monthCost =
    draft.kind === "trip"
      ? { hint: "Skip it and the plan has no verdict and no transport estimate: both are worked out for the travel month.", skipped: "Skipped: the plan will have no verdict and no transport estimate." }
      : { hint: "Skip it and the plan has no verdict: it is worked out for the month you buy.", skipped: "Skipped: the plan will have no verdict." }
  if (draft.kind === "trip") {
    if (draft.destination === null) out.push({ field: "destination", kind: "text", label: "Where to?", hint: "A country, an Indian state or a city. Places not on the app's list can't be priced on the web." })
    // Always asked, filled in when the question named it, so it can be changed.
    out.push({ field: "origin", kind: "text", label: "Travelling from which city?", hint: "Flights and airlines are looked up from here. Skip it and transport shows no estimate.", ...(draft.origin ? { initial: draft.origin } : {}) })
    if (draft.month === null) out.push({ ...month, ...monthCost, label: "Which month?" })
    if (draft.nights === null) out.push({ field: "nights", kind: "number", label: "How many nights?", min: 1, max: 30 })
    if (draft.travellers === null) out.push({ field: "travellers", kind: "number", label: "How many travellers?", min: 1, max: 9 })
    if (draft.style === null) out.push({ field: "style", kind: "choice", label: "What kind of stay?", options: TRIP_STYLES.map((s) => ({ value: s, label: STYLE_LABELS[s] })) })
    return out
  }
  if (draft.item !== "house") {
    if (draft.make === null) out.push({ field: "make", kind: "choice", label: "Which make?", options: vehicleMakes(draft.item).map((m) => ({ value: m, label: m })) })
    if (draft.model === null) out.push({ field: "model", kind: "model", label: "Which model?" })
  }
  if (draft.month === null) out.push({ ...month, ...monthCost, label: "When do you want to buy it?" })
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
export function buildPlan(draft: PlanRequest, answers: Readonly<Record<string, string>>, skipped: ReadonlySet<string>, currency: string, today: IsoDate): BuiltPlan {
  const plan: Record<string, unknown> = { ...draft }
  const questions = intakeQuestions(draft, today)
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
