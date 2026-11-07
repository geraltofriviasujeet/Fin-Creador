import { z } from "zod"
import { WEB_TRIP_LINES, type WebLookupFields, toLookup, webLookupInput } from "../search/query"
import { addDecimals, compareDecimals, multiplyDecimal } from "../search/totals"
import { type Bound, type KeptWebFigure, type PriceCandidate, verifyWebFigure } from "../search/verify"
import { webPriceKey, webTotalKey } from "../placeholders"
import { type FinanceTool, type TotalBound, ToolError, type WebBlock, type WebTotal } from "./types"

// Web lookups (Sprint 10.8): web_price_lookup searches one cost line from a template built in
// code (search/query.ts) and hands the model the prices found in the results in code, each with
// an id (search/verify.ts priceCandidates); web_price_figures takes the ids the model picks, with
// its labels, and never an amount typed by the model. Each picked price is checked again against
// its result as a backstop (verifyWebFigure). Totals are worked out here, per currency,
// never converted. Both results are untrusted text: none of it can be quoted as a figure
// unless a kept figure or a total carries it (chat.ts doesn't treat their strings as names).
// The verdict stays the records-only one from trip_check or goal_projection.
// A range found in a result (search/verify.ts) has two ids that know each other: keeping either
// end keeps both, with the same label and basis, and the result offers the range placeholder
// ("{web:12} to {web:13}"). A "from" or "up to" price carries that bound to the model and screen.

export const webPriceLookupTool: FinanceTool<WebLookupFields> = {
  name: "web_price_lookup",
  description:
    "Looks up current prices on the web for one cost line of a trip (a listed destination) or for a listed vehicle. Only when the person asks what something would cost and their records can't say, or they ask for web prices. At most 3 per question. It returns the prices found in the results, each with an id. Then pick the ones you use with web_price_figures.",
  input: webLookupInput,
  async run(ctx, fields) {
    if (!ctx.web) throw new ToolError("Web lookups are off. Answer from the person's records only.")
    const input = toLookup(fields)
    const outcome = await ctx.web.lookup(input, AbortSignal.timeout(10_000))
    if (!outcome.ok) {
      const why: Record<typeof outcome.reason, string> = {
        unlisted_place: "That place isn't on the app's list, so it can't be looked up.",
        unlisted_item: "That vehicle isn't on the app's list, so it can't be looked up.",
        line_not_for_scope: "That cost line doesn't apply to this trip.",
        private: "This lookup can't be made.",
        unsafe: "This lookup can't be made.",
        off: "Web lookups are off. Answer from the person's records only.",
        monthly_cap: "Web lookups are used up for this month. Answer from the person's records only.",
        daily_limit: "The person has used today's web lookups. Answer from their records only.",
        question_limit: "No more web lookups for this question.",
        failed: "The lookup failed. Answer without it.",
        timeout: "The lookup took too long. Answer without it.",
      }
      return { data: { looked_up: false, reason: why[outcome.reason] }, figures: [], untrusted: true }
    }
    return {
      data: {
        looked_up: outcome.subject,
        ...(input.kind === "trip" ? { cost_line: input.cost_line, nights: input.nights, travellers: input.travellers } : {}),
        prices: outcome.prices.map((p) => ({
          id: p.id,
          site: p.site,
          currency: p.currency,
          text: p.quote,
          ...(p.rangeWith ? { range: p.range!.side === "low" ? `${p.id} to ${p.rangeWith}` : `${p.rangeWith} to ${p.id}` } : {}),
          ...(p.bound ? { bound: p.bound } : {}),
        })),
        next:
          outcome.prices.length > 0
            ? "Pick each price you use with web_price_figures by its id, with a short label, what it covers (per) and its cost line. Never type an amount and never convert a currency. A price may be stated only after web_price_figures keeps it, by its placeholder; an amount seen in a result but not kept must not be written. A range is kept whole by picking either end; a bound (from, up to) must be said with it."
            : "No prices were found in these results.",
      },
      figures: [],
      untrusted: true,
    }
  },
}

const figuresInput = z
  .object({
    figures: z
      .array(
        z
          .object({
            id: z.string().trim().regex(/^w\d{1,3}$/).describe("The price's id from web_price_lookup."),
            label: z.string().trim().min(1).max(80).describe("What the price is for, in a few words."),
            per: z.enum(["total", "night", "person", "person_night", "day_person"]).describe("What the amount covers, as the page says."),
            cost_line: z.enum([...WEB_TRIP_LINES, "vehicle"]).describe("The cost line this price is for ('vehicle' for a vehicle)."),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict()

export type WebFiguresInput = z.infer<typeof figuresInput>

/** How many times a price is counted for the trip (nights and travellers from the lookup), or null when it can't be said. */
export function timesFor(per: KeptWebFigure["per"], trip: { nights: number; travellers: number } | undefined): number | null {
  if (per === "total") return 1
  if (!trip) return null
  switch (per) {
    case "night":
      return trip.nights
    case "person":
      return trip.travellers
    case "person_night":
      return trip.nights * trip.travellers
    case "day_person":
      return (trip.nights + 1) * trip.travellers
  }
}

/**
 * Totals per currency, worked out in code: each cost line's lowest and highest kept price,
 * times nights and travellers as its basis says, added up. Lines priced in another currency
 * are totalled separately, never converted or added across currencies.
 */
export function webTotals(
  kept: readonly (KeptWebFigure & { cost_line: string; bound?: Bound })[],
  trip: { nights: number; travellers: number } | undefined,
): WebTotal[] {
  // A "from" price makes the total a minimum, an "up to" one a maximum; both, neither.
  const bounds = new Map<string, Set<Bound>>()
  const lines = new Map<string, { currency: string; low: string; high: string }>()
  for (const f of kept) {
    const times = timesFor(f.per, trip)
    if (times === null) continue
    const amount = multiplyDecimal(f.value, times)
    if (f.bound) bounds.set(f.currency, (bounds.get(f.currency) ?? new Set()).add(f.bound))
    const key = `${f.currency}:${f.cost_line}`
    const line = lines.get(key)
    if (!line) lines.set(key, { currency: f.currency, low: amount, high: amount })
    else {
      if (compareDecimals(amount, line.low) < 0) line.low = amount
      if (compareDecimals(amount, line.high) > 0) line.high = amount
    }
  }
  const byCurrency = new Map<string, { lines: number; costLines: string[]; low: string[]; high: string[] }>()
  for (const [key, line] of lines.entries()) {
    const c = byCurrency.get(line.currency) ?? { lines: 0, costLines: [], low: [], high: [] }
    c.lines++
    c.costLines.push(key.slice(line.currency.length + 1))
    c.low.push(line.low)
    c.high.push(line.high)
    byCurrency.set(line.currency, c)
  }
  return [...byCurrency.entries()].map(([currency, c]) => {
    const b = bounds.get(currency)
    const bound: TotalBound | null = !b ? null : b.size > 1 ? "mixed" : b.has("from") ? "at_least" : "at_most"
    return { currency, lines: c.lines, costLines: c.costLines, low: addDecimals(...c.low), high: addDecimals(...c.high), ...(bound ? { bound } : {}) }
  })
}

/** What the model is told about a total fed by a bound; its placeholder carries the words. */
const TOTAL_BOUND_NOTES: Record<TotalBound, string> = {
  at_least: "a minimum, not an estimate: a 'from' price feeds it. Its placeholder reads 'at least ...'; say it as a minimum.",
  at_most: "a maximum, not an estimate: an 'up to' price feeds it. Its placeholder reads 'at most ...'; say it as a maximum.",
  mixed: "neither a minimum nor a maximum: 'from' and 'up to' prices both feed it. Say so.",
}

/** The kept ranges, low end first, each with its placeholder pair. */
export function keptRanges(candidates: ReadonlyMap<string, PriceCandidate>, kept: readonly { id: string; label: string; per: string; cost_line: string }[]) {
  return kept.flatMap((k) => {
    const c = candidates.get(k.id)
    if (c?.range?.side !== "low" || !c.rangeWith) return []
    const high = kept.find((h) => h.id === c.rangeWith && h.per === k.per && h.cost_line === k.cost_line)
    return high ? [{ write: `{${webPriceKey(k.id)}} to {${webPriceKey(high.id)}}`, label: k.label, per: k.per }] : []
  })
}

export const webPriceFiguresTool: FinanceTool<WebFiguresInput> = {
  name: "web_price_figures",
  description:
    "Picks the web prices to use, by the ids web_price_lookup gave, each with a label, what it covers and its cost line. Returns the prices kept (all picked so far this question), any dropped and the totals worked out in code. Quote only kept prices and totals, as web estimates with their site.",
  input: figuresInput,
  async run(ctx, input) {
    if (!ctx.web) throw new ToolError("Web lookups are off. Answer from the person's records only.")
    const { kept } = ctx.web
    const dropped: { label: string; reason: string }[] = []
    // A range's other end goes with the end picked, labelled the same.
    const picks = [...input.figures]
    for (const f of input.figures) {
      const other = ctx.web.candidates.get(f.id)?.rangeWith
      if (other && !picks.some((p) => p.id === other)) picks.push({ ...f, id: other })
    }
    for (const f of picks) {
      const found = ctx.web.candidates.get(f.id)
      if (!found) {
        dropped.push({ label: f.label, reason: "unknown_id" })
        continue
      }
      // The backstop: the amount comes from code, and is still checked against its own result.
      const { currency, amount, scale, source_url, quote } = found
      const checked = verifyWebFigure({ label: f.label, amount, currency, scale, per: f.per, source_url, quote }, ctx.web.results)
      if (!checked.ok) dropped.push({ label: f.label, reason: checked.reason })
      else if (!kept.some((k) => k.id === f.id && k.per === f.per && k.cost_line === f.cost_line)) {
        kept.push({
          ...checked.figure,
          id: f.id,
          cost_line: f.cost_line,
          ...(found.bound ? { bound: found.bound } : {}),
          ...(found.rangeWith ? { rangeWith: found.rangeWith } : {}),
        })
      }
    }
    ctx.web.reported.figures += picks.length
    ctx.web.reported.dropped += dropped.length
    const trip = ctx.web.trips.at(-1)
    const totals = webTotals(kept, trip)
    const web: WebBlock = {
      figures: kept.map((f) => ({
        id: f.id,
        label: f.label,
        amount: f.amount,
        scale: f.scale,
        value: f.value,
        currency: f.currency,
        per: f.per,
        site: f.site,
        url: f.source_url,
        ...(f.bound ? { bound: f.bound } : {}),
      })),
      totals,
      ...(trip ? { trip } : {}),
    }
    return {
      data: {
        kept: web.figures.map(({ id, label, value, currency, per, site, bound }) => ({ write: `{${webPriceKey(id)}}`, label, value, currency, per, site, ...(bound ? { bound } : {}) })),
        ranges: keptRanges(ctx.web.candidates, kept),
        dropped,
        totals: totals.map((t) => ({
          write: `{${webTotalKey(t.currency)}}`,
          currency: t.currency,
          cost_lines: t.lines,
          from: t.low,
          to: t.high,
          ...(t.bound ? { is: TOTAL_BOUND_NOTES[t.bound] } : {}),
        })),
        ...(trip ? { for_trip: trip } : {}),
        note: "These are web estimates, not the person's records. The verdict stays the one from their records. Write each price or total you state as its `write` placeholder, never as an amount; a range as its `write` in ranges, and a bound with its word (from, up to).",
      },
      figures: [],
      untrusted: true,
      web,
    }
  },
}
