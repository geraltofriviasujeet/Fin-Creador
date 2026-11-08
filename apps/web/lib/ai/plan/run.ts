import { z } from "zod"
import { type GoalProjection, TRIP_LOOKBACK_MONTHS, currencyMinorDigits, formatMoney } from "@fin-creador/domain"
import { tripPlaceScope } from "@fin-creador/schemas"
import { DEADLINE_MS } from "../chat"
import { LlmError, type LlmMessage, type LlmProvider, type LlmUsage, NO_USAGE, addUsage } from "../llm/types"
import type { WebLookupInput } from "../search/query"
import type { LookupDepth, LookupOutcome, LookupRefusal } from "../search/session"
import { addDecimals, compareDecimals, decimalToMinor, multiplyDecimal } from "../search/totals"
import type { SearchResult } from "../search/types"
import { type Bound, type PriceCandidate, SCALES, plain, scaleUp, siteOf, verifyWebFigure } from "../search/verify"
import { VERDICT_WORDS, monthName } from "../tools/goals"
import type { ToolContext, TotalBound } from "../tools/types"
import { webTotal } from "../web-format"
import { lineWords } from "./format"
import { type Mention, type PriceUnit, SUBJECT_WORDS, aboutPage, aboutPrice, dishesIn, placesIn, shoppingIn, unitAt } from "./context"
import { NAMES_PER_KIND, carrierCandidates, hotelCandidates, listingHotelAt, nameKey, priceAt } from "./names"
import { RATES_ON, RATES_SOURCE, canConvert, convertDecimal, rateWords } from "./rates"
import type { CheckedPlan, PlanAmount, PlanLine, PlanLineName, PlanNames, PlanPrice, PlanRequest, PlanSignal, PlanVerdict } from "./types"

// One plan, run (10.9). In order:
//   1. The person's records: the records-only verdict, any matching goal's cost lines and
//      what is saved toward it, and a projection to check the plan's total with (records.ts).
//   2. Lookups, sent by code (the intake gave every input), all at once: one per cost line
//      a goal doesn't already cover, plus route carriers and hotels for a trip. A line whose
//      field was skipped isn't looked up: it is "no estimate", and the plan still runs.
//   3. One model round: the model picks, by id, the prices and names that fit each line. A
//      trip line's price is offered only when code found what it is for next to it (the
//      airline, the hotel, the kind of meal, the mode, the place or tour); the rest are dropped
//      and counted on the line. Hotels named with a rate join the stay line as its prices. It
//      writes no prose and never types an amount or a name; every pick is checked again in
//      code against its own page. If the round fails or the deadline comes first, the plan is
//      still returned: lines from goals stay, looked-up lines become "no estimate" with the
//      pages found, and the credits spent are settled by the caller (never a failed plan
//      after spending them).
//   4. Lines, totals, buffer and both verdicts, worked out in code; the chat answer is
//      written here from the same checked plan as the modal and the PDF.

/** The model's round gets what is left before the deadline, less this for the rest. */
const MARGIN_MS = 2_000
/** The round's output. Thinking is asked off (it spent 3,000 tokens before the pick when on); this is room for the picks alone. */
export const PICK_OUTPUT_TOKENS = 2_000
/** Prices kept per line (the stored plan allows 6). */
const PRICES_PER_LINE = 6
/** Prices offered to the model per line, after code's screening. */
const OFFERED_PER_LINE = 12
/** Lines whose pages are listings and tariff tables (a price per hotel card, per car): read deeper, screened in code. */
const DEEP_LINES = new Set<Lookup["line"]>(["stay", "food", "local_travel", "hotels"])
const DEEP: LookupDepth = { perPage: 60, total: 150 }
export const BUFFER_PERCENT = 10

export type PlanRecords = {
  /** The records-only verdict (trip_check or goal_projection's own words), or why there is none. */
  records: PlanVerdict
  /** A matching goal's cost lines, profile currency minor units, already scaled to this plan. */
  goal: { name: string; lines: Partial<Record<PlanLineName, number>>; how: string } | null
  /** Already saved toward the matching goal (purchase). */
  saved: { goal: string; minor: number } | null
  /** The same projection as the records' verdict, on another target; null without a month. */
  project: ((targetMinor: number) => GoalProjection) | null
  /** Assumptions the records' verdict rests on. */
  assumptions: string[]
  /** A trip's past trip to compare with: one travel run as spent; null with none; "unreadable" when it couldn't be read. Absent for a purchase. */
  pastTrip?: { from: string; to: string; days: number; travelMinor: number; similar: boolean } | null | "unreadable"
}

export type PlanDeps = {
  ctx: ToolContext
  provider: LlmProvider
  records: (request: PlanRequest) => Promise<PlanRecords>
  deadlineMs?: number
}

export type PlanRun = {
  plan: CheckedPlan
  answer: string
  calls: number
  usage: LlmUsage
  /** Calls that failed after they may have been sent. */
  unknownCalls: number
  /** What the model round did: picked, or why nothing was picked. */
  picked: "picked" | "timeout" | "failed" | "no_candidates"
}

type Lookup = { line: PlanLineName | "carriers" | "hotels"; input: WebLookupInput }
type Skip = { line: PlanLineName; how: string }


const REFUSALS: Record<LookupRefusal, string> = {
  unlisted_place: "That place isn't on the app's list, so it wasn't looked up.",
  unlisted_item: "That model isn't on the app's list, so it wasn't looked up.",
  line_not_for_scope: "This line doesn't apply to this trip.",
  private: "This lookup couldn't be made.",
  unsafe: "This lookup couldn't be made.",
  off: "Web lookups are off right now.",
  monthly_cap: "Web lookups are used up for this month.",
  daily_limit: "You've used your web lookups for today. This is FinCreador's own daily limit, not the search provider's, and it resets at midnight in your time zone.",
  question_limit: "This plan's web lookups were used up before this line.",
  failed: "The lookup couldn't be completed.",
  timeout: "The lookup took too long and was skipped.",
}

const NOT_CHECKED = "The prices found couldn't be checked in time, so none is used. The pages found are listed."
const NONE_PICKED = "No price on the pages found could be confirmed for this line."
const NO_WEB = "Web lookups are off right now, so this line wasn't looked up."

/** What the plan asks for, lookups and skipped lines. */
function lookupsFor(request: PlanRequest, goalLines: Partial<Record<PlanLineName, number>>, today: string): { lookups: Lookup[]; skips: Skip[] } {
  const lookups: Lookup[] = []
  const skips: Skip[] = []
  const skipped = (line: PlanLineName, fields: string[]) => skips.push({ line, how: `No estimate: ${fields.join(" and ")} ${fields.length === 1 ? "was" : "were"} skipped.` })

  if (request.kind === "trip") {
    const needs: Record<Exclude<PlanLineName, "buffer" | "price" | "extras">, (keyof typeof request)[]> = {
      transport: ["destination", "origin", "month"],
      stay: ["destination", "month", "style"],
      food: ["destination"],
      local_travel: ["destination"],
      sightseeing: ["destination"],
      shopping: ["destination"],
    }
    const WORDS: Partial<Record<keyof typeof request, string>> = { destination: "the destination", origin: "where you travel from", month: "the month", style: "the travel style" }
    const base = {
      kind: "trip" as const,
      destination: request.destination ?? "",
      // Fields a query doesn't use are only placeholders here: totals use the request's own.
      month: request.month ?? today.slice(0, 7),
      nights: request.nights ?? 1,
      travellers: request.travellers ?? 1,
    }
    const COST_LINE = { transport: "transport", stay: "stay", food: "food", local_travel: "local_travel", sightseeing: "activities", shopping: "shopping" } as const
    for (const line of Object.keys(needs) as (keyof typeof needs)[]) {
      if ((goalLines[line] ?? 0) > 0) continue
      const missing = needs[line].filter((f) => request[f] === null)
      if (missing.length > 0) skipped(line, missing.map((f) => WORDS[f]!))
      else
        lookups.push({
          line,
          input: { ...base, cost_line: COST_LINE[line], ...(line === "stay" && request.style ? { style: request.style } : {}), ...(line === "transport" ? { origin: request.origin! } : {}) },
        })
    }
    if (request.destination !== null) {
      // Carriers for a route: only with the origin.
      if (request.origin !== null) lookups.push({ line: "carriers", input: { ...base, cost_line: "carriers", origin: request.origin } })
      lookups.push({ line: "hotels", input: { ...base, cost_line: "hotels", ...(request.style ? { style: request.style } : {}) } })
    }
    return { lookups, skips }
  }

  for (const line of ["price", "extras"] as const) {
    if ((goalLines[line] ?? 0) > 0) continue
    if (request.item === "house") {
      skips.push({ line, how: "No estimate: house prices aren't looked up on the web. A house goal with its price would give this line." })
      continue
    }
    if (request.make === null) {
      skipped(line, ["the make"])
      continue
    }
    lookups.push({
      line,
      input: {
        kind: "vehicle",
        vehicle: request.item,
        make: request.make,
        ...(request.model ? { model: request.model } : {}),
        month: request.month ?? today.slice(0, 7),
        line: line === "price" ? "price" : "insurance",
      },
    })
  }
  return { lookups, skips }
}

export const pickInput = z
  .object({
    lines: z
      .array(
        z
          .object({
            line: z.string().max(20),
            picks: z
              .array(z.object({ id: z.string().regex(/^w\d{1,3}$/), per: z.enum(["total", "night", "person", "person_night", "day_person", "day"]) }).strict())
              // As many as a lookup offers: more than are kept is trimmed after the checks, never a failed round.
              .max(12),
          })
          .strict(),
      )
      .max(9),
    carriers: z.array(z.string().regex(/^c\d{1,2}$/)).max(NAMES_PER_KIND),
    hotels: z.array(z.string().regex(/^h\d{1,2}$/)).max(NAMES_PER_KIND),
  })
  .strict()
type Picks = z.infer<typeof pickInput>

const PICK_TOOL = {
  name: "plan_pick",
  description:
    "Picks, by id, the prices that fit each cost line of the plan, with what each price covers as its page says (per), and the carriers and hotels that fit. Pick only what the page text shows is for this line and this place; pick nothing for a line when nothing fits. Never type an amount or a name.",
  inputSchema: (({ $schema: _s, ...rest }) => rest)(z.toJSONSchema(pickInput) as Record<string, unknown>),
}

const PICK_SYSTEM = [
  "You help build a cost plan. The app found prices and names on web pages, each with an id. Call the plan_pick tool once with the ids that fit each cost line, and the carriers and hotels that fit. A price fits a line only when its own text is clearly that cost for that place; 'for' is what the app found it is for, next to it on its page. Say what each price covers (per) exactly as its text says: total, night, person, person_night, day_person, or day (a day for the whole party, such as a car's day hire). 'unit' is what the app found written next to the price. If nothing fits, call plan_pick with empty lists. Write nothing else, and no tags.",
]

/** Time a second ask needs; with less left, a reply without the tool call ends the round. */
const RETRY_NEEDS_MS = 10_000

/**
 * The model's round: picks by id, or why there are none. A reply that ends without calling
 * plan_pick (it happens with thinking off) is asked once more, while the deadline allows.
 */
async function pick(
  provider: LlmProvider,
  brief: unknown,
  deadline: number,
): Promise<{ picks: Picks | null; outcome: PlanRun["picked"]; usage: LlmUsage; unknown: boolean; calls: number }> {
  const messages: LlmMessage[] = [{ role: "user", text: JSON.stringify(brief) }]
  let usage = NO_USAGE
  let calls = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now() - MARGIN_MS
    if (remaining <= 0) return { picks: null, outcome: "timeout", usage, unknown: false, calls }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), remaining)
    calls++
    try {
      const response = await provider.complete({ system: PICK_SYSTEM, messages, tools: [PICK_TOOL], maxOutputTokens: PICK_OUTPUT_TOKENS, thinking: "off" }, controller.signal)
      usage = addUsage(usage, response.usage)
      const call = response.toolCalls.find((c) => c.name === PICK_TOOL.name)
      if (call) {
        const parsed = pickInput.safeParse(call.input)
        return parsed.success ? { picks: parsed.data, outcome: "picked", usage, unknown: false, calls } : { picks: null, outcome: "failed", usage, unknown: false, calls }
      }
      if (response.stop !== "end" || deadline - Date.now() < RETRY_NEEDS_MS) return { picks: null, outcome: "failed", usage, unknown: false, calls }
      messages.push({ role: "assistant", text: response.text, toolCalls: [], providerContent: response.providerContent })
      messages.push({ role: "user", text: "Call plan_pick now with your picks. Write nothing else." })
    } catch (error) {
      // Aborted at the deadline, or failed: either way the plan goes on without picks.
      const timedOut = controller.signal.aborted || (error instanceof LlmError && error.kind === "timeout")
      const unknown = !(error instanceof LlmError) || error.billed === "unknown"
      return { picks: null, outcome: timedOut ? "timeout" : "failed", usage, unknown, calls }
    } finally {
      clearTimeout(timer)
    }
  }
  return { picks: null, outcome: "failed", usage, unknown: false, calls }
}

/** How many times a price counts for the plan, or null when a skipped field is needed. */
export function timesFor(per: PlanPrice["per"], nights: number | null, travellers: number | null): number | null {
  switch (per) {
    case "total":
      return 1
    case "night":
      return nights
    case "person":
      return travellers
    case "person_night":
      return nights === null || travellers === null ? null : nights * travellers
    case "day_person":
      return nights === null || travellers === null ? null : (nights + 1) * travellers
    case "day":
      return nights === null ? null : nights + 1
  }
}

/** "from" prices make a minimum, "up to" ones a maximum; both kinds (or a mixed part), neither. */
function boundOf(bounds: ReadonlySet<Bound | TotalBound>): TotalBound | undefined {
  const kinds = new Set([...bounds].map((b) => (b === "from" ? "at_least" : b === "up_to" ? "at_most" : b)))
  if (kinds.size === 0) return undefined
  if (kinds.size > 1 || kinds.has("mixed")) return "mixed"
  return [...kinds][0] as TotalBound
}

/** A line's amount per currency: its lowest and highest kept price, times nights and travellers. */
export function lineAmounts(prices: readonly PlanPrice[], nights: number | null, travellers: number | null): PlanAmount[] {
  const by = new Map<string, { low: string; high: string; bounds: Set<Bound> }>()
  for (const p of prices) {
    const times = timesFor(p.per, nights, travellers)
    if (times === null) continue
    const { currency, value: each } = effective(p)
    const value = multiplyDecimal(each, times)
    const have = by.get(currency)
    if (!have) by.set(currency, { low: value, high: value, bounds: new Set(p.bound ? [p.bound] : []) })
    else {
      if (compareDecimals(value, have.low) < 0) have.low = value
      if (compareDecimals(value, have.high) > 0) have.high = value
      if (p.bound) have.bounds.add(p.bound)
    }
  }
  return [...by].map(([currency, a]) => {
    const bound = boundOf(a.bounds)
    return { currency, low: a.low, high: a.high, ...(bound ? { bound } : {}) }
  })
}

/** A kept price's full amount ("7.4" lakh is "740000"). */
const valueOf = (p: PlanPrice) => scaleUp(p.amount, SCALES[p.scale])

/** What a kept price counts as: its converted figure when it has one, else its own. */
const effective = (p: PlanPrice) => (p.converted ? { currency: p.converted.currency, value: p.converted.amount } : { currency: p.currency, value: valueOf(p) })

/** The price with its figure in `currency` beside it, when found in another; null with no rate. */
export function converted(p: PlanPrice, currency: string): PlanPrice | null {
  if (p.currency === currency) return p
  const amount = convertDecimal(valueOf(p), p.currency, currency)
  return amount === null ? null : { ...p, converted: { currency, amount } }
}

/** Minor units as a decimal string ("12345" paise is "123.45"). */
export function minorToDecimal(minor: number, currency: string): string {
  const digits = currencyMinorDigits(currency)
  const s = String(minor).padStart(digits + 1, "0")
  return digits === 0 ? s : `${s.slice(0, -digits)}.${s.slice(-digits)}`.replace(/\.?0+$/, "")
}

/** Amounts added up per currency, bounds carried. */
export function addAmounts(amounts: readonly PlanAmount[]): PlanAmount[] {
  const by = new Map<string, { low: string[]; high: string[]; bounds: Set<TotalBound> }>()
  for (const a of amounts) {
    const have = by.get(a.currency) ?? { low: [], high: [], bounds: new Set() }
    have.low.push(a.low)
    have.high.push(a.high)
    if (a.bound) have.bounds.add(a.bound)
    by.set(a.currency, have)
  }
  return [...by].map(([currency, a]) => {
    const bound = boundOf(a.bounds)
    return { currency, low: addDecimals(...a.low), high: addDecimals(...a.high), ...(bound ? { bound } : {}) }
  })
}

/** BUFFER_PERCENT of an amount, in minor units rounded up. */
function bufferOf(a: PlanAmount): PlanAmount {
  const digits = currencyMinorDigits(a.currency)
  const pct = (d: string) => minorToDecimal(Math.ceil((decimalToMinor(d, digits) * BUFFER_PERCENT) / 100), a.currency)
  return { currency: a.currency, low: pct(a.low), high: pct(a.high), ...(a.bound ? { bound: a.bound } : {}) }
}

const toPrice = (c: PriceCandidate, per: PlanPrice["per"], about?: string): PlanPrice => ({
  amount: c.amount,
  scale: c.scale as PlanPrice["scale"],
  currency: c.currency,
  per,
  ...(c.bound ? { bound: c.bound } : {}),
  ...(about ? { about } : {}),
  site: c.site,
  url: c.source_url,
})

/**
 * Plausible ranges per cost line (whole rupees): a price outside its line's range is dropped as
 * a misread ("INR 5 a person" for a flight). A price is checked after any conversion, scaled
 * to the range's unit for this plan (a person, a night, a person a day), in exact minor units.
 * A plan in another currency isn't range-checked.
 */
export const SANITY: Partial<Record<PlanLineName, { low: number; high: number; unit: "person" | "night" | "person_day"; international?: { low: number; high: number } }>> = {
  transport: { low: 1_500, high: 40_000, unit: "person", international: { low: 8_000, high: 200_000 } },
  stay: { low: 600, high: 60_000, unit: "night" },
  food: { low: 200, high: 10_000, unit: "person_day" },
  local_travel: { low: 100, high: 10_000, unit: "person_day" },
  sightseeing: { low: 200, high: 20_000, unit: "person" },
}
const UNIT_WORDS = { person: "a person", night: "a night", person_day: "a person a day" } as const

/** A line's range for this trip, or null when it has none. */
function rangeFor(line: PlanLineName, international: boolean) {
  const r = SANITY[line]
  if (!r) return null
  const { low, high } = international && r.international ? r.international : r
  return { low, high, unit: r.unit }
}

const rangeWords = (r: { low: number; high: number; unit: keyof typeof UNIT_WORDS }) =>
  `${formatMoney(r.low * 100, { currency: "INR" })} to ${formatMoney(r.high * 100, { currency: "INR" })} ${UNIT_WORDS[r.unit]}`

/** Whether a price, scaled to the range's unit, is inside it; true when it can't be checked. */
export function inRange(p: PlanPrice, r: { low: number; high: number; unit: keyof typeof UNIT_WORDS }, nights: number | null, travellers: number | null): boolean {
  const { currency, value } = effective(p)
  if (currency !== "INR") return true
  const times = timesFor(p.per, nights, travellers)
  const units = r.unit === "person" ? travellers : r.unit === "night" ? nights : nights === null || travellers === null ? null : (nights + 1) * travellers
  if (times === null || units === null) return true
  const total = decimalToMinor(multiplyDecimal(value, times), 2)
  return total >= r.low * 100 * units && total <= r.high * 100 * units
}

type Screened = {
  prices: (PriceCandidate & { id: string })[]
  about: Map<string, string>
  /** The unit written next to each price, when one is. */
  units: Map<string, PriceUnit | undefined>
  noSubject: number
  foreign: Map<string, number>
  wrongUnit: Map<PriceUnit | "none", number>
}

/** Per-day lines: a price is used only when it is written as per day. */
const DAY_LINES = new Set<PlanLineName>(["food", "local_travel"])
/** A stay price written per km, hour, trip or month isn't a night's. */
const NOT_A_NIGHT = new Set<PriceUnit>(["km", "hour", "trip", "month", "outstation", "add_on"])

/** Whether a price's unit fits its line; a line without a unit rule takes any. */
function unitFits(line: PlanLineName, unit: PriceUnit | undefined): boolean {
  if (DAY_LINES.has(line)) return unit === "day"
  if (line === "stay") return !unit || !NOT_A_NIGHT.has(unit)
  return true
}

/** The hotel nearest before a price on its own page (a listing's card), from the page's full text. */
function listingHotel(p: PriceCandidate, results: readonly SearchResult[], destination: string | null): string | undefined {
  const r = results.find((x) => x.url === p.source_url)
  for (const text of r ? [r.snippet, r.content ?? ""] : []) {
    const t = plain(text)
    const i = t.indexOf(p.quote)
    if (i >= 0) return listingHotelAt(t, i + priceAt(p.quote, p.amount), destination)
  }
  return undefined
}

/**
 * A line's prices that can be used: in the plan's currency or one with a rate (rates.ts; others
 * are counted, never used), and with what each is for (context.ts): from the price's own
 * words, else from its page's title and address (a taxi firm's page, a hotel's own page); one
 * with neither isn't offered. A range's ends share what they are for. A purchase line needs no
 * subject: its lookup names it.
 */
export function screenPrices(
  line: PlanLineName,
  prices: readonly (PriceCandidate & { id: string })[],
  currency: string,
  destination: string | null = null,
  results: readonly SearchResult[] = [],
): Screened {
  const foreign = new Map<string, number>()
  for (const p of prices) if (!canConvert(p.currency, currency)) foreign.set(p.currency, (foreign.get(p.currency) ?? 0) + 1)
  const mine = prices.filter((p) => canConvert(p.currency, currency))
  // The unit written next to each price (a range's ends share it); a per-km or per-trip fare is never a day's.
  const units = new Map(mine.map((p) => [p.id, unitAt(p.quote, p.amount)]))
  for (const p of mine) if (!units.get(p.id) && p.rangeWith && units.get(p.rangeWith)) units.set(p.id, units.get(p.rangeWith))
  const wrongUnit = new Map<PriceUnit | "none", number>()
  const fitting = mine.filter((p) => {
    const unit = units.get(p.id)
    if (unitFits(line, unit)) return true
    wrongUnit.set(unit ?? "none", (wrongUnit.get(unit ?? "none") ?? 0) + 1)
    return false
  })
  if (!SUBJECT_WORDS[line]) return { prices: fitting.slice(0, OFFERED_PER_LINE), about: new Map(), units, noSubject: 0, foreign, wrongUnit }
  const about = new Map<string, string>()
  for (const p of fitting) {
    // Stay: the hotel in the price's own card first (a listing names it just before its rate), then its quote, then its page.
    const a =
      (line === "stay" ? listingHotel(p, results, destination) : undefined) ?? aboutPrice(line, p.quote, p.amount) ?? aboutPage(line, p.title, p.source_url, destination)
    if (a) about.set(p.id, a)
  }
  for (const p of fitting) if (!about.has(p.id) && p.rangeWith && about.has(p.rangeWith)) about.set(p.id, about.get(p.rangeWith)!)
  const kept = fitting.filter((p) => about.has(p.id))
  return { prices: kept.slice(0, OFFERED_PER_LINE), about, units, noSubject: fitting.length - kept.length, foreign, wrongUnit }
}

const UNIT_WORDS_SHORT: Record<PriceUnit | "none", string> = { km: "per km", hour: "per hour", trip: "per trip", month: "per month", night: "per night", day: "per day", outstation: "outstation (intercity)", add_on: "an add-on charge", none: "no unit given" }

/** " 3 prices weren't per day (2 per km, 1 per trip), so they weren't used." */
function unitWords(line: PlanLineName, wrong: ReadonlyMap<PriceUnit | "none", number>): string {
  const n = [...wrong.values()].reduce((a, b) => a + b, 0)
  if (n === 0) return ""
  const parts = [...wrong].map(([u, c]) => `${c} ${UNIT_WORDS_SHORT[u]}`).join(", ")
  return ` ${n} ${n === 1 ? "price wasn't" : "prices weren't"} ${line === "stay" ? "per night" : "per day"} (${parts}), so ${n === 1 ? "it wasn't" : "they weren't"} used.`
}

/** "USD" or "USD and JPY". */
const currencyList = (codes: readonly string[]) => (codes.length === 1 ? codes[0]! : `${codes.slice(0, -1).join(", ")} and ${codes.at(-1)}`)

export async function runPlan(request: PlanRequest, deps: PlanDeps): Promise<PlanRun> {
  const deadline = Date.now() + (deps.deadlineMs ?? DEADLINE_MS)
  const { ctx } = deps
  const { currency, today } = ctx
  const web = ctx.web ?? null
  const money = (minor: number) => formatMoney(minor, { currency })

  // 1. Records. A failure to read them leaves the plan without a records verdict, never without a plan.
  let records: PlanRecords
  try {
    records = await deps.records(request)
  } catch {
    records = { records: { verdict: "No verdict.", summary: "No verdict from your records: they couldn't be read just now." }, goal: null, saved: null, project: null, assumptions: [] }
  }
  const goalLines = records.goal?.lines ?? {}

  // 2. Lookups, all at once; each search stops at its own time-out.
  const { lookups, skips } = lookupsFor(request, goalLines, today)
  const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now() - MARGIN_MS))
  const outcomes: { lookup: Lookup; outcome: LookupOutcome | null }[] = await Promise.all(
    lookups.map(async (lookup) => ({ lookup, outcome: web ? await web.lookup(lookup.input, signal, DEEP_LINES.has(lookup.line) ? DEEP : undefined) : null })),
  )
  const found = (line: Lookup["line"]) => outcomes.find((o) => o.lookup.line === line)?.outcome ?? null
  const carrierNames = (() => {
    const o = found("carriers")
    return o?.ok ? carrierCandidates(o.results) : []
  })()
  const hotelNames = (() => {
    const o = found("hotels")
    return o?.ok ? hotelCandidates(o.results, o.prices, request.kind === "trip" ? request.destination : null, request.kind !== "trip" || request.style !== "budget") : []
  })()
  const screened = new Map<PlanLineName, Screened>()
  for (const o of outcomes) {
    if (o.lookup.line !== "carriers" && o.lookup.line !== "hotels" && o.lookup.line !== "shopping" && o.outcome?.ok) screened.set(o.lookup.line, screenPrices(o.lookup.line, o.outcome.prices, currency, request.kind === "trip" ? request.destination : null, o.outcome.results))
  }

  // 3. The model's round, only when there is something to pick.
  const brief = {
    plan: request,
    lines: [...screened]
      .filter(([, s]) => s.prices.length > 0)
      .map(([line, s]) => ({
        line,
        prices: s.prices.map((p) => ({ id: p.id, site: p.site, currency: p.currency, text: p.quote, ...(s.about.has(p.id) ? { for: s.about.get(p.id) } : {}), ...(s.units.get(p.id) ? { unit: s.units.get(p.id) } : {}), ...(p.bound ? { bound: p.bound } : {}) })),
      })),
    carriers: carrierNames.map(({ id, name, site, quote }) => ({ id, name, site, text: quote })),
    hotels: hotelNames.map(({ id, name, site, quote, stars }) => ({ id, name, site, stars, text: quote })),
  }
  const anything = brief.lines.length + brief.carriers.length + brief.hotels.length > 0
  const round = anything ? await pick(deps.provider, brief, deadline) : { picks: null, outcome: "no_candidates" as const, usage: NO_USAGE, unknown: false, calls: 0 }
  const { calls } = round

  // 4. Lines, from the goal, the checked picks, or no estimate.
  const destination = request.kind === "trip" ? request.destination : null
  const international = destination !== null && tripPlaceScope(destination) === "international"
  const nights = request.kind === "trip" ? request.nights : null
  const travellers = request.kind === "trip" ? request.travellers : null
  const results = web?.results ?? []
  const keptPrice = (line: PlanLineName, id: string, picked: PlanPrice["per"]): PlanPrice | null => {
    const s = screened.get(line)
    if (!s?.prices.some((p) => p.id === id)) return null
    const c = web!.candidates.get(id)
    if (!c) return null
    // A per-day line's price is written per day (screenPrices): counted per day, whatever the
    // model said; a day for each traveller (food) or for the party (a car's day hire).
    const per = DAY_LINES.has(line) && picked !== "day" && picked !== "day_person" ? (line === "food" ? "day_person" : "day") : picked
    // The check reads only the amount and its quote; "day" is the plan's own basis.
    const checked = verifyWebFigure({ label: line, amount: c.amount, currency: c.currency, scale: c.scale, per: per === "day" ? "total" : per, source_url: c.source_url, quote: c.quote }, results)
    return checked.ok ? converted(toPrice(c, per, s.about.get(id)), currency) : null
  }
  // A hotel's rate from the hotels lookup's own prices, checked against its page, with the hotel as what it is for.
  const keptHotelRate = (id: string, name: string): PlanPrice | null => {
    const o = found("hotels")
    const c = web?.candidates.get(id)
    if (!o?.ok || !c || !o.prices.some((p) => p.id === id)) return null
    const checked = verifyWebFigure({ label: "hotel", amount: c.amount, currency: c.currency, scale: c.scale, per: "night", source_url: c.source_url, quote: c.quote }, results)
    const rate = checked.ok ? converted(toPrice(c, "night", name), currency) : null
    return rate && inRange(rate, rangeFor("stay", international)!, 1, 1) ? rate : null
  }
  // Hotels the model picked: one list with the stay line. A rate makes a stay price; a hotel
  // without one is listed on the line as named, not priced.
  const hotelRates: PlanPrice[] = []
  const hotelsNamed: Mention[] = []
  for (const c of round.picks ? hotelNames.filter((h) => round.picks!.hotels.includes(h.id)) : []) {
    const rate = c.rateId ? keptHotelRate(c.rateId, c.name) : null
    if (rate) hotelRates.push(rate)
    hotelsNamed.push({ name: c.name, site: c.site, url: c.url })
  }
  const pagesOf = (o: LookupOutcome | null) => (o?.ok ? o.results.slice(0, 6).map((r) => ({ site: siteOf(r.url), url: r.url })) : [])

  const lineNames: PlanLineName[] = request.kind === "trip" ? ["transport", "stay", "food", "local_travel", "sightseeing", "shopping"] : ["price", "extras"]
  const lines: PlanLine[] = lineNames.map((line): PlanLine => {
    // Shopping is never estimated (a personal choice): what the place is known for buying, with sources.
    if (line === "shopping") {
      const o = found("shopping")
      const mentions = o?.ok ? shoppingIn(o.results) : []
      return {
        line,
        from: "not_estimated",
        amounts: [],
        how: `Not estimated: what you spend on shopping is your choice.${mentions.length > 0 ? " Known for buying, as listed on the pages found:" : ""}`,
        prices: [],
        pages: [],
        ...(mentions.length > 0 ? { mentions } : {}),
      }
    }
    const built = priceLine(line)
    // Named dishes (food) and well-known places (sightseeing) from the same lookup, priced or
    // not; hotels picked but not priced on the line (stay), each once.
    const o = found(line)
    const priced = new Set(built.prices.flatMap((p) => (p.about ? [nameKey(p.about, destination)] : [])))
    const mentions =
      line === "stay"
        ? hotelsNamed.filter((h) => !priced.has(nameKey(h.name, destination))).slice(0, 8)
        : o?.ok
          ? line === "food"
            ? dishesIn(o.results)
            : line === "sightseeing"
              ? placesIn(o.results)
              : []
          : []
    return mentions.length > 0 ? { ...built, mentions } : built
  })

  function priceLine(line: PlanLineName): PlanLine {
    const fromGoal = goalLines[line] ?? 0
    if (fromGoal > 0) {
      return { line, from: "goal", amounts: [{ currency, low: minorToDecimal(fromGoal, currency), high: minorToDecimal(fromGoal, currency) }], how: records.goal!.how, prices: [], pages: [] }
    }
    const skip = skips.find((s) => s.line === line)
    if (skip) return none(line, skip.how)
    if (!web) return none(line, NO_WEB)
    const o = found(line)
    const s = screened.get(line)
    // Why the line's own lookup gave no price, in words after "No estimate:"; null when it did.
    let why: string | null = null
    let checked: PlanPrice[] = []
    if (!o) why = NO_WEB
    else if (!o.ok) why = REFUSALS[o.reason]
    else if (o.prices.length === 0) why = "no price was found on the pages looked up."
    else if (!s || s.prices.length === 0) why = s && s.foreign.size > 0 && s.noSubject === 0 && s.wrongUnit.size === 0 ? `prices found only in ${currencyList([...s.foreign.keys()])}, which the app has no exchange rate for.` : ""
    else if (!round.picks) why = round.outcome === "timeout" ? NOT_CHECKED : "the prices found couldn't be checked, so none is used. The pages found are listed."
    else {
      const picks = round.picks.lines.find((l) => l.line === line)?.picks ?? []
      // A range is kept whole: picking one end keeps the other, with the same basis.
      const withRanges = [...picks]
      for (const p of picks) {
        const other = web.candidates.get(p.id)?.rangeWith
        if (other && !withRanges.some((x) => x.id === other)) withRanges.push({ id: other, per: p.per })
      }
      checked = withRanges.flatMap((p) => keptPrice(line, p.id, p.per) ?? [])
      if (checked.length === 0) why = NONE_PICKED
    }
    // Stay: the picked hotels' rates too, each hotel once.
    if (line === "stay") {
      const have = new Set(checked.flatMap((p) => (p.about ? [nameKey(p.about, destination)] : [])))
      checked = [...checked, ...hotelRates.filter((h) => !have.has(nameKey(h.about!, destination)))]
    }
    // Prices that didn't say what they were for, then misreads: dropped, and the line says how many.
    const noSubject = s?.noSubject ?? 0
    const subjectWords =
      noSubject === 0
        ? ""
        : ` ${noSubject} ${noSubject === 1 ? "price" : "prices"} found didn't say ${SUBJECT_WORDS[line]} ${noSubject === 1 ? "it was" : "they were"} for, so ${noSubject === 1 ? "it wasn't" : "they weren't"} used.`
    // Prices in a currency without a rate, when the line has its own (or other words say why it has none).
    const foreignCount = [...(s?.foreign.values() ?? [])].reduce((a, b) => a + b, 0)
    const foreignWords =
      foreignCount === 0 || why?.startsWith("prices found only in")
        ? ""
        : ` ${foreignCount} ${foreignCount === 1 ? "price" : "prices"} in ${currencyList([...s!.foreign.keys()])} ${foreignCount === 1 ? "wasn't" : "weren't"} used (no exchange rate).`
    const wrongUnitWords = s ? unitWords(line, s.wrongUnit) : ""
    const range = rangeFor(line, international)
    const inside = range ? checked.filter((p) => inRange(p, range, nights, travellers)) : checked
    const prices = inside.slice(0, PRICES_PER_LINE)
    const dropped = checked.length - inside.length
    const droppedWords = dropped === 0 || !range ? "" : ` ${dropped} ${dropped === 1 ? "price" : "prices"} outside ${rangeWords(range)} ${dropped === 1 ? "was" : "were"} dropped as implausible.`
    if (prices.length === 0) return none(line, `No estimate:${why ? ` ${why}` : ""}${foreignWords}${wrongUnitWords}${subjectWords}${droppedWords}`, pagesOf(o))
    const amounts = lineAmounts(prices, nights, travellers)
    if (amounts.length === 0) {
      const needs = [nights === null ? "nights" : null, travellers === null ? "travellers" : null].filter(Boolean).join(" and ")
      return { line, from: "none", amounts: [], how: `No estimate: the prices found need the number of ${needs}, which ${needs.includes(" and ") ? "were" : "was"} skipped.`, prices, pages: [] }
    }
    const sites = [...new Set(prices.map((p) => p.site))].join(", ")
    const from = [...new Set(prices.flatMap((p) => (p.converted ? [p.currency] : [])))]
    const convertedWords = from.length === 0 ? "" : ` Prices in ${currencyList(from)} are converted to ${currency}, approximately (the rate is in the assumptions).`
    return { line, from: "web", amounts, how: `${prices.length === 1 ? "A price" : `${prices.length} prices`} listed on ${sites}${scaling(prices, nights, travellers)}; the lowest to the highest.${convertedWords}${foreignWords}${wrongUnitWords}${subjectWords}${droppedWords}`, prices, pages: [] }
  }

  // The buffer: the goal's own, or BUFFER_PERCENT of the lines with an estimate, per currency.
  if (request.kind === "trip") {
    const fromGoal = goalLines.buffer ?? 0
    const estimated = lines.filter((l) => l.amounts.length > 0)
    if (fromGoal > 0) {
      lines.push({ line: "buffer", from: "goal", amounts: [{ currency, low: minorToDecimal(fromGoal, currency), high: minorToDecimal(fromGoal, currency) }], how: records.goal!.how, prices: [], pages: [] })
    } else if (estimated.length > 0) {
      lines.push({
        line: "buffer",
        from: "worked_out",
        amounts: addAmounts(estimated.flatMap((l) => l.amounts)).map(bufferOf),
        how: `${BUFFER_PERCENT}% of the lines above that have an estimate, worked out by the app, for costs not listed.`,
        prices: [],
        pages: [],
      })
    } else lines.push(none("buffer", "No estimate: no other line has an estimate to work it out from."))
  }

  // Airlines: only ids the model picked from the ones found.
  const carriers = ((): PlanNames | null => {
    if (request.kind !== "trip") return null
    const o = found("carriers")
    if (request.destination === null) return { listed: [], note: "No airlines looked up: the destination was skipped." }
    if (request.origin === null) return { listed: [], note: "No airlines looked up: where you travel from was skipped." }
    if (!o) return { listed: [], note: "No airlines looked up: web lookups are off right now." }
    if (!o.ok) return { listed: [], note: `No airlines could be confirmed: ${REFUSALS[o.reason]}` }
    if (carrierNames.length === 0) return { listed: [], note: "No airlines could be confirmed on the pages looked up, so none is suggested." }
    if (!round.picks) return { listed: [], note: "The airlines found couldn't be checked in time, so none is listed." }
    const listed = carrierNames.filter((c) => round.picks!.carriers.includes(c.id)).map((c) => ({ name: c.name, site: c.site, url: c.url })).slice(0, 6)
    return listed.length > 0
      ? { listed, note: "Listed on the pages found, not Roma's recommendation. Whether each flies this route in your month isn't checked." }
      : { listed: [], note: "No airlines on the pages found could be confirmed, so none is suggested." }
  })()

  // 5. Totals and verdicts.
  const totals = addAmounts(lines.flatMap((l) => l.amounts))
  const mine = totals.find((t) => t.currency === currency)
  const noEstimate = lines.filter((l) => l.from === "none").map((l) => lineWords(l.line).toLowerCase())
  const deposit = request.kind === "purchase" ? (request.depositMinor ?? 0) : 0
  const saved = records.saved
  const hasWeb = lines.some((l) => l.from === "web")
  const { web: webVerdict, changes, checked } = planVerdict({ request, records, mine, noEstimate, deposit, hasWeb, money, today })
  const both = request.kind === "trip" ? bothSignals({ request, records, web: webVerdict, checked, noEstimate, money }) : null

  // Every page used, and when nothing could be checked every page found: a spent lookup is never silent.
  const sources = uniqueSources([
    ...lines.flatMap((l) => [...l.prices.map(({ site, url }) => ({ site, url })), ...l.pages, ...(l.mentions ?? []).map(({ site, url }) => ({ site, url }))]),
    ...(carriers?.listed.map(({ site, url }) => ({ site, url })) ?? []),
    ...(round.picks ? [] : [...pagesOf(found("carriers")), ...pagesOf(found("hotels"))]),
  ])
  const plan: CheckedPlan = {
    v: 1,
    kind: request.kind,
    intake: { title: titleOf(request), fields: intakeFields(request, money) },
    lines,
    saved: saved ? { goal: saved.goal, minor: saved.minor, currency } : null,
    carriers,
    // Hotels are on the stay line (10.9 follow-up); older stored plans keep their own list.
    hotels: null,
    verdicts: { totals, records: records.records, web: webVerdict, ...(both ? { both } : {}) },
    changes,
    assumptions: planAssumptions(request, records, currency, [...new Set(lines.flatMap((l) => l.prices.flatMap((p) => (p.converted ? [p.currency] : []))))]),
    sources,
  }
  return { plan, answer: planAnswer(plan), calls, usage: round.usage, unknownCalls: round.unknown ? 1 : 0, picked: round.outcome }
}

function none(line: PlanLineName, how: string, pages: PlanLine["pages"] = []): PlanLine {
  return { line, from: "none", amounts: [], how, prices: [], pages }
}

function uniqueSources(list: readonly { site: string; url: string }[]) {
  const out: { site: string; url: string }[] = []
  for (const s of list) if (!out.some((o) => o.url === s.url)) out.push(s)
  return out.slice(0, 40)
}

/** How a line's prices were scaled, in words. */
function scaling(prices: readonly PlanPrice[], nights: number | null, travellers: number | null): string {
  const pers = new Set(prices.map((p) => p.per))
  const parts: string[] = []
  if ((pers.has("night") || pers.has("person_night")) && nights !== null) parts.push(`${nights} ${nights === 1 ? "night" : "nights"}`)
  if ((pers.has("day_person") || pers.has("day")) && nights !== null) parts.push(`${nights + 1} days`)
  if ((pers.has("person") || pers.has("person_night") || pers.has("day_person")) && travellers !== null) parts.push(`${travellers} ${travellers === 1 ? "traveller" : "travellers"}`)
  return parts.length > 0 ? `, times ${parts.join(" and ")}` : ""
}

export function titleOf(r: PlanRequest): string {
  if (r.kind === "trip") {
    const where = r.destination ?? "a trip"
    const when = r.month ? ` in ${monthName(`${r.month}-01`)}` : ""
    const from = r.origin && r.destination ? ` from ${r.origin}` : ""
    return `Plan: ${r.destination ? `trip${from} to ${where}` : where}${when}`
  }
  const what = r.item === "house" ? "a house" : [r.make, r.model].filter(Boolean).join(" ") || `a ${r.item}`
  return `Plan: buying ${what}${r.month ? ` in ${monthName(`${r.month}-01`)}` : ""}`
}

function intakeFields(r: PlanRequest, money: (minor: number) => string): CheckedPlan["intake"]["fields"] {
  if (r.kind === "trip") {
    return [
      { label: "Destination", value: r.destination },
      { label: "From", value: r.origin },
      { label: "Month", value: r.month ? monthName(`${r.month}-01`) : null },
      { label: "Nights", value: r.nights === null ? null : String(r.nights) },
      { label: "Travellers", value: r.travellers === null ? null : String(r.travellers) },
      { label: "Style", value: r.style },
    ]
  }
  return [
    { label: "Buying", value: r.item },
    { label: "Make", value: r.make },
    { label: "Model or class", value: r.model },
    { label: "When", value: r.month ? monthName(`${r.month}-01`) : null },
    { label: "Trade-in or deposit", value: r.depositMinor === null ? null : money(r.depositMinor) },
  ]
}

/** The second verdict: the same projection as the records' one, on the plan's total. */
function planVerdict(a: {
  request: PlanRequest
  records: PlanRecords
  mine: PlanAmount | undefined
  noEstimate: string[]
  deposit: number
  hasWeb: boolean
  money: (minor: number) => string
  today: string
}): { web: PlanVerdict; changes: string[]; checked: Checked | null } {
  const { request, records, mine, money } = a
  const none = (summary: string) => ({ web: { verdict: "No verdict.", summary }, changes: [], checked: null })
  if (!a.hasWeb) return none("No web estimates in this plan: no line could be priced from the web.")
  if (!mine) return none("No verdict with web estimates: no line is priced in your currency.")
  if (!records.project) return none(`No verdict with web estimates: ${request.month === null ? "the month was skipped, so there is no date to save by" : "there is nothing in your records to project from"}.`)

  const digits = currencyMinorDigits(mine.currency)
  const totalMinor = decimalToMinor(mine.bound === "at_least" ? mine.low : mine.high, digits)
  const target = Math.max(0, totalMinor - a.deposit)
  const p = records.project(target)
  const verdict = VERDICT_WORDS[p.verdict]
  const month = monthName(`${request.month}-01`)
  const amount =
    mine.bound === "at_least"
      ? `at least ${money(totalMinor)} (a minimum: some prices are "from" prices)`
      : mine.bound === "at_most"
        ? `at most ${money(totalMinor)} (a maximum: some prices are "up to" prices)`
        : mine.bound === "mixed"
          ? `${money(totalMinor)} (neither a minimum nor a maximum: "from" and "up to" prices are mixed)`
          : money(totalMinor)
  const range = mine.low !== mine.high && !mine.bound ? ` The lines range from ${webTotal(mine)}; the higher end is checked.` : ""
  const deposit = a.deposit > 0 ? ` Less your trade-in or deposit of ${money(a.deposit)}, ${money(target)} is needed.` : ""
  const missing = a.noEstimate.length > 0 ? ` Lines with no estimate aren't included: ${a.noEstimate.join(", ")}.` : ""
  const saved = records.saved ? ` ${money(records.saved.minor)} is already saved toward ${records.saved.goal}.` : ""
  let outcome: string
  if (p.verdict === "yes") outcome = `At your current rate that would be covered by ${month}.`
  else if (p.verdict === "no") outcome = `At your current rate that wouldn't be covered by ${month}.`
  else outcome = "There aren't enough months in your records to say."
  const changes: string[] = []
  if (p.verdict === "no") {
    if (p.extraMonthlyMinor !== null) changes.push(`Save ${money(p.extraMonthlyMinor)} more a month.`)
    if (p.reachMonth) changes.push(`${request.kind === "trip" ? "Go" : "Buy"} in ${monthName(p.reachMonth)} instead.`)
    if (request.kind === "trip") {
      if (request.style === "luxury" || request.style === "comfort") changes.push("Choose a simpler travel style: the stay line comes down.")
      if (request.nights !== null && request.nights > 1) changes.push("Fewer nights: stay, food and local travel come down.")
    } else if (a.deposit === 0) changes.push("A trade-in or deposit lowers what is needed.")
  }
  return {
    web: { verdict, summary: `${verdict} With web estimates the plan adds up to ${amount}.${range}${deposit}${saved}${missing} ${outcome}`.trim() },
    changes,
    checked: { projection: p, totalMinor, bound: mine.bound },
  }
}

/** The plan total the projection checked, and how it came out. */
type Checked = { projection: GoalProjection; totalMinor: number; bound: PlanAmount["bound"] }

/**
 * A trip plan's verdict from both signals, in code:
 *   money: is there enough free money by the travel month, after other goals (the projection);
 *   past:  is the plan's total at or below the past trip it is compared with, as spent?
 * Yes when money holds; when only past holds, "Not yet.": the money is the constraint, not
 * the trip; both fail, No. Without the money signal, no verdict.
 */
function bothSignals(a: {
  request: Extract<PlanRequest, { kind: "trip" }>
  records: PlanRecords
  web: PlanVerdict
  checked: Checked | null
  noEstimate: string[]
  money: (minor: number) => string
}): NonNullable<CheckedPlan["verdicts"]["both"]> {
  const { request, checked, money } = a
  const month = request.month ? monthName(`${request.month}-01`) : null
  const figure = checked ? `${checked.bound === "at_least" ? "at least " : checked.bound === "at_most" ? "at most " : ""}${money(checked.totalMinor)}` : null
  const missing = a.noEstimate.length > 0 ? " Lines with no estimate aren't in the plan's figure." : ""

  let moneySignal: PlanSignal
  const p = checked?.projection
  const available = p?.availableByTargetMinor ?? null
  if (!p || p.verdict === "too_early") moneySignal = { met: "unknown", summary: p ? "There aren't enough months in your records to say." : a.web.summary }
  else if (p.verdict === "yes")
    moneySignal = { met: "yes", summary: available === null ? `At your current rate the plan's ${figure} would be covered by ${month}, after your other goals.` : `${money(available)} is free for it by ${month} after your other goals (planned trips included), enough for the plan's ${figure}.` }
  else
    moneySignal = { met: "no", summary: available === null ? `At your current rate the plan's ${figure} wouldn't be covered by ${month}, after your other goals.` : `${money(available)} is free for it by ${month} after your other goals (planned trips included), short of the plan's ${figure}.` }

  let past: PlanSignal
  const trip = a.records.pastTrip
  if (trip === "unreadable") past = { met: "unknown", summary: "Your past travel spending couldn't be read just now." }
  else if (!trip) past = { met: "unknown", summary: `No past trip to compare with: no Travel spending in your records in the last ${TRIP_LOOKBACK_MONTHS} months.` }
  else if (!checked) past = { met: "unknown", summary: `No plan figure in your currency to compare with your Travel spending from ${trip.from} to ${trip.to} (${money(trip.travelMinor)}).` }
  else {
    const met = checked.totalMinor <= trip.travelMinor
    const length = trip.similar ? "" : `; no past trip of similar length was found, so this is the most recent`
    past = {
      met: met ? "yes" : "no",
      summary: `The plan's ${figure} is ${met ? "at or below" : "above"} your Travel spending from ${trip.from} to ${trip.to} (${trip.days} ${trip.days === 1 ? "day" : "days"}): ${money(trip.travelMinor)}, as spent. Who went and where isn't known${length}.${missing}`,
    }
  }

  const pastWords = past.met === "yes" ? " The plan costs no more than your past trip did." : past.met === "no" ? " The plan costs more than your past trip did." : ""
  if (moneySignal.met === "yes") return { verdict: "Yes.", summary: `There's enough free money by ${month}.${pastWords}`, money: moneySignal, past }
  if (moneySignal.met === "no" && past.met === "yes")
    return { verdict: "Not yet.", summary: `The money is the constraint, not the trip: the plan costs no more than your past trip did, but there isn't enough free money by ${month}.`, money: moneySignal, past }
  if (moneySignal.met === "no") return { verdict: "No.", summary: `There isn't enough free money by ${month}.${pastWords}`, money: moneySignal, past }
  return { verdict: "No verdict.", summary: `No verdict without the free money by the travel month.${pastWords}`, money: moneySignal, past }
}

function planAssumptions(r: PlanRequest, records: PlanRecords, currency: string, convertedFrom: readonly string[]): string[] {
  const list = [
    "Estimates, not quotes or bookings. Web prices are as listed on the pages found when the plan was made, not live fares or room rates.",
    "The verdict from your records comes first; the one with web estimates never changes it.",
  ]
  if (r.kind === "trip") {
    list.push(`The buffer is ${BUFFER_PERCENT}% of the lines with an estimate, for costs not listed.`)
    list.push("Visa and travel insurance aren't included. Shopping isn't estimated: it is your choice.")
    list.push(
      "A web price is used only when its page says what it is for, next to it: the airline, the hotel or property, the kind of meal, the way of getting around, or the place or tour. Prices that don't are dropped, and each line says how many.",
    )
    list.push("Hotels on the stay line are as listed on the pages found, not Roma's recommendation; their rates are as listed, not live.")
    list.push(
      `Prices outside a plausible range in rupees (after any conversion) are dropped as misreads: ${(Object.keys(SANITY) as PlanLineName[])
        .map((l) => `${lineWords(l).toLowerCase()} ${rangeWords(rangeFor(l, false)!)}${SANITY[l]!.international ? ` (international ${rangeWords(rangeFor(l, true)!)})` : ""}`)
        .join("; ")}.`,
    )
  } else {
    list.push(r.item === "house" ? "Registration, stamp duty and loan costs aren't included." : "Loan interest isn't included; insurance and extras are the first year's.")
  }
  if (convertedFrom.length > 0)
    list.push(
      `Prices in ${currencyList(convertedFrom)} are converted to ${currency} at fixed rates of ${RATES_ON} (${rateWords([...convertedFrom, currency]).join("; ")}; ${RATES_SOURCE}${currency === "INR" ? "" : ", through rupees"}). Conversion is approximate: each such price shows its original amount beside it.`,
    )
  list.push(`A price in a currency the app has no exchange rate for isn't used.`)
  return [...list, ...records.assumptions].slice(0, 16)
}

/** The chat answer, written in code from the checked plan. */
export function planAnswer(plan: CheckedPlan): string {
  const priced = plan.lines.filter((l) => l.from !== "not_estimated")
  const estimated = priced.filter((l) => l.from !== "none").length
  const both = plan.verdicts.both
  return [
    `${plan.intake.title}. ${estimated} of ${priced.length} cost lines have an estimate.`,
    `From your records: ${plan.verdicts.records.summary}`,
    ...(both ? [`The plan's verdict, from both signals: ${both.verdict} ${both.summary}`] : []),
    `With web estimates: ${plan.verdicts.web.summary}`,
    "Open the plan for each cost line, how it was worked out and its sources. These are estimates, not quotes or bookings.",
  ].join("\n\n")
}
