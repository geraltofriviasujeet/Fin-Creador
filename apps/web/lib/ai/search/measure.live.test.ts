import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { type WebLookupInput, buildQuery } from "./query"
import { tavilyProvider } from "./tavily"
import type { SearchResult } from "./types"
import { pricesIn } from "./verify"

// The snippet measurement (Sprint 10.8 gate before the UI): how often a real price is in a
// result's snippet, and in its page text. Spends about 50 Tavily credits, so it runs only by
// hand: MEASURE_SEARCH=1 npx vitest run apps/web/lib/ai/search/measure.live.test.ts
// Never in CI. The key is read from apps/web/.env.local and never printed; only counts are.
// MEASURE_OUT=<file> writes the queries and results for inspection (outside the repo).

const run = process.env.MEASURE_SEARCH === "1" && !process.env.CI

function keyFromEnvLocal(): string {
  const text = readFileSync(join(__dirname, "../../../.env.local"), "utf8")
  const line = text.split("\n").find((l) => l.startsWith("TAVILY_API_KEY="))
  const key = line?.slice("TAVILY_API_KEY=".length).trim().replace(/^["']|["']$/g, "")
  if (!key) throw new Error("TAVILY_API_KEY is not set in apps/web/.env.local")
  return key
}

const NO_TERMS = { names: [], phrases: [] }
const trip = (destination: string, cost_line: "transport" | "stay" | "food" | "activities" | "visa", month = "2027-01"): WebLookupInput => ({
  kind: "trip",
  destination,
  month,
  nights: 4,
  travellers: 2,
  cost_line,
})

const DOMESTIC = ["Goa", "Shimla", "Kerala", "Jaipur", "Leh", "Udaipur", "Sikkim", "Varanasi", "Andaman", "Amritsar"]
const ABROAD = ["Thailand", "Vietnam", "Japan", "Singapore", "Indonesia", "Sri Lanka", "Nepal", "France", "Maldives", "UAE"]

export const MEASURE_INPUTS: WebLookupInput[] = [
  ...DOMESTIC.flatMap((d) => [trip(d, "stay"), trip(d, "transport")]),
  ...ABROAD.flatMap((d) => [trip(d, "stay"), trip(d, "transport")]),
  trip("Goa", "food"),
  trip("Thailand", "food"),
  trip("Japan", "food"),
  trip("Kerala", "activities"),
  trip("Vietnam", "activities"),
  trip("Thailand", "visa"),
  trip("Japan", "visa"),
  trip("France", "visa"),
  { kind: "vehicle", vehicle: "car", make: "Hyundai", model: "Creta", month: "2027-03" },
  { kind: "vehicle", vehicle: "car", make: "Tata", model: "Nexon", month: "2027-03" },
]

async function usage(key: string): Promise<unknown> {
  const r = await fetch("https://api.tavily.com/usage", { headers: { authorization: `Bearer ${key}` } })
  return r.ok ? r.json() : `usage endpoint ${r.status}`
}

describe.skipIf(!run)("Tavily snippet measurement (live, by hand only)", () => {
  it("measures how often a price is in the snippet", { timeout: 300_000 }, async () => {
    const key = keyFromEnvLocal()
    const provider = tavilyProvider({ apiKey: key })
    const before = await usage(key)
    const rows: { query: string; ms: number; error?: string; results: SearchResult[]; snippet: boolean; page: boolean }[] = []

    for (let i = 0; i < MEASURE_INPUTS.length; i += 3) {
      const batch = MEASURE_INPUTS.slice(i, i + 3)
      await Promise.all(
        batch.map(async (input) => {
          const built = buildQuery(input, NO_TERMS, "IN")
          if (!built.ok) throw new Error(`no query for ${JSON.stringify(input)}: ${built.reason}`)
          const start = Date.now()
          try {
            const results = await provider.search(built.query, new AbortController().signal)
            rows.push({
              query: built.query,
              ms: Date.now() - start,
              results,
              snippet: results.some((r) => pricesIn(r.snippet).length > 0),
              page: results.some((r) => pricesIn(r.snippet).length > 0 || pricesIn(r.content ?? "").length > 0),
            })
          } catch (error) {
            rows.push({ query: built.query, ms: Date.now() - start, error: String(error), results: [], snippet: false, page: false })
          }
        }),
      )
    }

    const after = await usage(key)
    const ok = rows.filter((r) => !r.error)
    const ms = ok.map((r) => r.ms).sort((a, b) => a - b)
    const allResults = ok.flatMap((r) => r.results)
    const summary = {
      queries: rows.length,
      failed: rows.length - ok.length,
      withPriceInSnippet: ok.filter((r) => r.snippet).length,
      withPriceInSnippetOrPage: ok.filter((r) => r.page).length,
      resultsWithPageText: allResults.filter((r) => r.content).length,
      results: allResults.length,
      resultSnippetsWithPrice: allResults.filter((r) => pricesIn(r.snippet).length > 0).length,
      medianMs: ms[Math.floor(ms.length / 2)],
      p90Ms: ms[Math.floor(ms.length * 0.9)],
      maxMs: ms.at(-1),
      usageBefore: before,
      usageAfter: after,
    }
    console.warn(JSON.stringify(summary, null, 2))
    if (process.env.MEASURE_OUT) writeFileSync(process.env.MEASURE_OUT, JSON.stringify({ summary, rows }, null, 2))
    expect(ok.length).toBeGreaterThan(0)
  })
})
