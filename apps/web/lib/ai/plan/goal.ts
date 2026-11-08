import { type TRIP_COST_LINES, currencyMinorDigits, minorToInputString } from "@fin-creador/domain"
import { FOREIGN_COUNTRIES, INDIAN_STATES, normalizePlace, tripPlaceScope } from "@fin-creador/schemas"
import { decimalToMinor } from "../search/totals"
import type { CheckedPlan, PlanAmount, PlanLineName, PlanRequest } from "./types"

// "Add to my goals" (10.9 follow-up): a goal prefilled from a checked plan, in code. The values
// go into the normal goal form as its text fields, and the person changes anything before
// saving; nothing is saved from here. Each figure is the plan's own, in the profile currency:
// the higher end of a line's range (the one the verdict checks), or a minimum's figure. A line
// with no estimate leaves its field empty for the person to fill in.

export type GoalPrefill = {
  /** The goal form's fields, as text (goal-form.tsx). */
  values: Record<string, string>
  /** What the person should know about the prefill, in code's words. */
  notes: string[]
}

type TripCostLine = (typeof TRIP_COST_LINES)[number]

/** Where each trip plan line goes in a trip goal: the goal has no line for local travel or sightseeing. */
const TRIP_GOAL_LINE: Partial<Record<PlanLineName, TripCostLine>> = {
  transport: "transport",
  local_travel: "transport",
  stay: "stay",
  food: "food",
  sightseeing: "activities",
  buffer: "buffer",
}

/** The figure a line counts for, in minor units of `currency`; null when it has none in that currency. */
export function lineMinor(amounts: readonly PlanAmount[], currency: string): number | null {
  const a = amounts.find((x) => x.currency === currency)
  if (!a) return null
  return decimalToMinor(a.bound === "at_least" ? a.low : a.high, currencyMinorDigits(currency))
}

/** The plan's month as a goal's target date: its first day, or today when that has passed. */
export function targetDateOf(month: string | null, today: string): string {
  if (!month) return ""
  const first = `${month}-01`
  return first < today ? today : first
}

/** The listed name a place matches, from a list, or null. */
function listedIn(list: readonly string[], place: string): string | null {
  const key = normalizePlace(place)
  return list.find((name) => normalizePlace(name) === key) ?? null
}

export function goalFromPlan(plan: CheckedPlan, { currency, today }: { currency: string; today: string }): GoalPrefill {
  const request = plan.intake.request ?? null
  const amount = (minor: number | null) => (minor === null || minor === 0 ? "" : minorToInputString(minor, currency))
  const minorOf = (line: PlanLineName) => {
    const l = plan.lines.find((x) => x.line === line)
    return l ? lineMinor(l.amounts, currency) : null
  }
  const notes: string[] = []
  const foreign = plan.verdicts.totals.filter((t) => t.currency !== currency).map((t) => t.currency)
  if (foreign.length > 0) notes.push(`Figures in ${foreign.join(" and ")} aren't filled in: a goal is in ${currency}.`)
  const empty = plan.lines.filter((l) => l.from === "none").length
  if (empty > 0) notes.push(`${empty} ${empty === 1 ? "line has" : "lines have"} no estimate in the plan, so ${empty === 1 ? "its field is" : "their fields are"} left empty.`)
  if (plan.saved) notes.push(`The plan counted what is saved toward your goal “${plan.saved.goal}”. This adds a separate goal.`)
  if (!request) notes.push("This plan was made before plans kept their answers, so the month and any trade-in or deposit aren't filled in.")

  if (plan.kind === "trip") {
    const trip = request?.kind === "trip" ? request : null
    const costs: Partial<Record<TripCostLine, number>> = {}
    for (const l of plan.lines) {
      const goalLine = TRIP_GOAL_LINE[l.line]
      const minor = goalLine ? lineMinor(l.amounts, currency) : null
      if (goalLine && minor !== null) costs[goalLine] = (costs[goalLine] ?? 0) + minor
    }
    if (plan.lines.some((l) => l.line === "local_travel" && l.amounts.length > 0)) notes.push("Local travel is added to Transport: a trip goal has no line of its own for it.")
    const scope = trip?.destination ? tripPlaceScope(trip.destination) : null
    const place = trip?.destination && scope ? listedIn(scope === "domestic" ? INDIAN_STATES : FOREIGN_COUNTRIES, trip.destination) : null
    if (trip?.destination && !place) notes.push(`Choose the ${scope === "international" ? "country" : "state"} for ${trip.destination}: a trip goal is by ${scope === "international" ? "country" : "state"}.`)
    const values: Record<string, string> = {
      type: "trip",
      name: trip?.destination ? `Trip to ${trip.destination}` : plan.intake.title.replace(/^Plan: /, "").slice(0, 80),
      targetDate: targetDateOf(trip?.month ?? null, today),
      saved: "",
      scope: scope ?? "domestic",
      place: place ?? "",
      people: trip?.travellers ? String(trip.travellers) : "",
      days: trip?.nights ? String(trip.nights + 1) : "",
      travelMode: "",
      // Only the styles the stay line priced as hotels; a budget stay could be anything.
      stay: trip?.style === "comfort" || trip?.style === "luxury" ? "hotel" : "",
      payment: "cash",
    }
    for (const [line, minor] of Object.entries(costs)) values[`cost_${line}`] = amount(minor)
    return { values, notes }
  }

  const purchase = request?.kind === "purchase" ? request : null
  const item = purchase?.item ?? itemFromFields(plan)
  const deposit = purchase?.depositMinor ?? null
  const common = { name: purchaseName(purchase, item), targetDate: targetDateOf(purchase?.month ?? null, today), saved: amount(deposit), payment: "cash" }
  if (deposit) notes.push("Your trade-in or deposit is filled in as already saved.")
  if (item === "bike" || item === "car") {
    if (!purchase?.model) notes.push("Enter the model you're buying: a vehicle goal needs one.")
    return {
      values: { type: "vehicle", ...common, vehicle: item, condition: "new", make: purchase?.make ?? "", model: purchase?.model ?? "", price: amount(minorOf("price")), extras: amount(minorOf("extras")) },
      notes,
    }
  }
  if (item === "house") {
    notes.push("Enter the city: a house goal needs one.")
    return { values: { type: "house", ...common, purpose: "buy", city: "", price: amount(minorOf("price")) }, notes }
  }
  // An unknown item (an older plan without its answers): what it is for, and the plan's total.
  const total = lineMinor(plan.verdicts.totals, currency)
  return { values: { type: "other", ...common, description: plan.intake.title.replace(/^Plan: /, "").slice(0, 280), amount: amount(total) }, notes }
}

function purchaseName(r: Extract<PlanRequest, { kind: "purchase" }> | null, item: string | null): string {
  const named = r ? [r.make, r.model].filter(Boolean).join(" ") : ""
  return (named ? `Buy ${named}` : item === "house" ? "Buy a house" : item ? `Buy a ${item}` : "Purchase").slice(0, 80)
}

/** An older plan's item, from its "Buying" answer. */
function itemFromFields(plan: CheckedPlan): string | null {
  const value = plan.intake.fields.find((f) => f.label === "Buying")?.value ?? null
  return value === "bike" || value === "car" || value === "house" ? value : null
}
