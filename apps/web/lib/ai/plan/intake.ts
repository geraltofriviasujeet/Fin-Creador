import { type IsoDate, monthStart } from "@fin-creador/domain"
import { VEHICLE_CATALOGUE, tripPlaceScope, vehicleMakes } from "@fin-creador/schemas"
import { TRIP_STYLES } from "../search/query"
import type { PlanRequest, PurchasePlanRequest, TripPlanRequest } from "./types"

// The plan intake (10.9), in code: a question that asks for a plan ("plan my trip to Goa",
// "can I buy a car") is recognised here, what it already says is filled in, and only the
// missing fields are asked, with questions written here, never by the model. Every question
// can be skipped: a skipped field stays null and the lines that need it are "no estimate".

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
const MONTH_WORD = new RegExp(`\\bin\\s+(${MONTHS.map((m) => `${m.slice(0, 3)}(?:${m.slice(3)})?`).join("|")})\\b(?:\\s+(\\d{4}))?`, "i")

const TRIP = /\b(?:plan|planning)\b[^.?!]*\b(?:trip|holiday|vacation|travel)\b|\b(?:trip|holiday|vacation)\b[^.?!]*\bplan\b/i
const PURCHASE = /\b(?:can i|could i|should i)\s+(?:afford|buy|get)\b|\bplan(?:ning)?\s+(?:to\s+buy|buying|for\s+(?:a|an|my)\s+new)\b/i
const ORIGIN = /\bfrom\s+([A-Za-z][A-Za-z .'-]{1,39}?)(?=\s+(?:to|in|for|with|on|this|next|over|during)\b|[,.?!]|$)/i
const DESTINATION = /\b(?:trip|holiday|vacation|travel(?:ling)?|go(?:ing)?|visit(?:ing)?)(?:\s+from\s+[A-Za-z .'-]{1,39}?)?\s+to\s+([A-Za-z][A-Za-z .'-]{1,39}?)(?=\s+(?:in|for|with|on|this|next|over|during)\b|[,.?!]|$)/i
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
  const place = DESTINATION.exec(text)?.[1]?.trim() ?? null
  const from = ORIGIN.exec(text)?.[1]?.trim() ?? null
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
  if (PURCHASE.test(question)) return purchaseFrom(question, today)
  return null
}

export type IntakeQuestion =
  | { field: "destination" | "origin"; kind: "text"; label: string; hint: string; initial?: string }
  | { field: "month"; kind: "month"; label: string; min: string }
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
  if (draft.kind === "trip") {
    if (draft.destination === null) out.push({ field: "destination", kind: "text", label: "Where to?", hint: "A country, an Indian state or a city. Places not on the app's list can't be priced on the web." })
    // Always asked, filled in when the question named it, so it can be changed.
    out.push({ field: "origin", kind: "text", label: "Travelling from which city?", hint: "Flights and airlines are looked up from here. Skip it and transport shows no estimate.", ...(draft.origin ? { initial: draft.origin } : {}) })
    if (draft.month === null) out.push({ ...month, label: "Which month?" })
    if (draft.nights === null) out.push({ field: "nights", kind: "number", label: "How many nights?", min: 1, max: 30 })
    if (draft.travellers === null) out.push({ field: "travellers", kind: "number", label: "How many travellers?", min: 1, max: 9 })
    if (draft.style === null) out.push({ field: "style", kind: "choice", label: "What kind of stay?", options: TRIP_STYLES.map((s) => ({ value: s, label: STYLE_LABELS[s] })) })
    return out
  }
  if (draft.item !== "house") {
    if (draft.make === null) out.push({ field: "make", kind: "choice", label: "Which make?", options: vehicleMakes(draft.item).map((m) => ({ value: m, label: m })) })
    if (draft.model === null) out.push({ field: "model", kind: "model", label: "Which model?" })
  }
  if (draft.month === null) out.push({ ...month, label: "When do you want to buy it?" })
  if (draft.depositMinor === null) out.push({ field: "depositMinor", kind: "amount", label: "Any trade-in or deposit?", hint: "What you'll put in from a trade-in or an existing deposit. Skip if none." })
  return out
}

/** Models of a make, for the model question. */
export const modelsOf = (item: "bike" | "car", make: string | null): readonly string[] => (make ? (VEHICLE_CATALOGUE[item][make] ?? []) : [])
