import { z } from "zod"
import { WEB_TRIP_LINES, type WebLookupFields, toLookup, webLookupInput } from "../search/query"
import { addDecimals, compareDecimals, multiplyDecimal } from "../search/totals"
import { type KeptWebFigure, verifyWebFigure } from "../search/verify"
import { type FinanceTool, ToolError, type WebBlock, type WebTotal } from "./types"

// Web lookups (Sprint 10.8): web_price_lookup searches one cost line from a template built in
// code (search/query.ts) and hands the model the prices found in the results in code, each with
// an id (search/verify.ts priceCandidates); web_price_figures takes the ids the model picks, with
// its labels, and never an amount typed by the model. Each picked price is checked again against
// its result as a backstop (verifyWebFigure). Totals are worked out here, per currency,
// never converted. Both results are untrusted text: none of it can be quoted as a figure
// unless a kept figure or a total carries it (chat.ts doesn't treat their strings as names).
// The verdict stays the records-only one from trip_check or goal_projection.

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
        prices: outcome.prices.map((p) => ({ id: p.id, site: p.site, currency: p.currency, text: p.quote })),
        next:
          outcome.prices.length > 0
            ? "Pick each price you use with web_price_figures by its id, with a short label, what it covers (per) and its cost line. Never type an amount and never convert a currency."
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
export function webTotals(kept: readonly (KeptWebFigure & { cost_line: string })[], trip: { nights: number; travellers: number } | undefined): WebTotal[] {
  const lines = new Map<string, { currency: string; low: string; high: string }>()
  for (const f of kept) {
    const times = timesFor(f.per, trip)
    if (times === null) continue
    const amount = multiplyDecimal(f.value, times)
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
  return [...byCurrency.entries()].map(([currency, c]) => ({ currency, lines: c.lines, costLines: c.costLines, low: addDecimals(...c.low), high: addDecimals(...c.high) }))
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
    for (const f of input.figures) {
      const found = ctx.web.candidates.get(f.id)
      if (!found) {
        dropped.push({ label: f.label, reason: "unknown_id" })
        continue
      }
      // The backstop: the amount comes from code, and is still checked against its own result.
      const { currency, amount, scale, source_url, quote } = found
      const checked = verifyWebFigure({ label: f.label, amount, currency, scale, per: f.per, source_url, quote }, ctx.web.results)
      if (!checked.ok) dropped.push({ label: f.label, reason: checked.reason })
      else if (!kept.some((k) => k.id === f.id && k.per === f.per && k.cost_line === f.cost_line)) kept.push({ ...checked.figure, id: f.id, cost_line: f.cost_line })
    }
    ctx.web.reported.figures += input.figures.length
    ctx.web.reported.dropped += dropped.length
    const trip = ctx.web.trips.at(-1)
    const totals = webTotals(kept, trip)
    const web: WebBlock = {
      figures: kept.map((f) => ({ label: f.label, amount: f.amount, scale: f.scale, value: f.value, currency: f.currency, per: f.per, site: f.site, url: f.source_url })),
      totals,
      ...(trip ? { trip } : {}),
    }
    return {
      data: {
        kept: web.figures.map(({ label, value, currency, per, site }) => ({ label, value, currency, per, site })),
        dropped,
        totals: totals.map((t) => ({ currency: t.currency, cost_lines: t.lines, from: t.low, to: t.high })),
        ...(trip ? { for_trip: trip } : {}),
        note: "These are web estimates, not the person's records. The verdict stays the one from their records.",
      },
      figures: [],
      untrusted: true,
      web,
    }
  },
}
