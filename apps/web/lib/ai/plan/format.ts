import { currencyMinorDigits, formatMoney } from "@fin-creador/domain"
import { decimalToMinor } from "../search/totals"
import { webPrice } from "../web-format"
import type { PlanAmount, PlanLine, PlanLineName, PlanPrice } from "./types"

// How a checked plan's figures are written on screen and in the PDF (10.9): one wording for
// both, so the PDF says exactly what the modal says.

const money = (amount: string, currency: string) => formatMoney(decimalToMinor(amount, currencyMinorDigits(currency)), { currency })

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
  goal: "From your goal",
  web: "Web estimate",
  worked_out: "Worked out by the app",
  none: "No estimate",
  not_estimated: "Not estimated: your choice",
}

export const PLAN_NOT_LIVE = "Estimates, not quotes or bookings. Web prices are as pages listed them when the plan was made, not live fares or room rates."
export const PLAN_REOPENED = "Web prices may have changed since this plan was made. Make a new plan for today's prices."
