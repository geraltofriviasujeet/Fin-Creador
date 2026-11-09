import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildQuery } from "../search/query"
import { tavilyProvider } from "../search/tavily"
import type { SearchResult } from "../search/types"
import { modelCandidates } from "./candidates"
import { PURCHASE_SANITY } from "./run"

// How many model candidates the two shortlist lookups give (10.9 follow-up): a name from the
// catalogue paired with a usable price. Spends one Tavily credit a query (none with
// PLAN_REPLAY), so by hand only, with --silent=false to see the output:
// CANDIDATES_LIVE=1 PLAN_RECORD=<file outside the repo> npx vitest run apps/web/lib/ai/plan/candidates.live.test.ts --silent=false

const run = process.env.CANDIDATES_LIVE === "1" && !process.env.CI
const env = (name: string) => {
  const line = readFileSync(join(__dirname, "../../../.env.local"), "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
  return line!.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
}

describe.skipIf(!run)("model candidates from live lookups (by hand only)", () => {
  it("counts candidates with a name and a usable price", { timeout: 60_000 }, async () => {
    const replay = process.env.PLAN_REPLAY ? (JSON.parse(readFileSync(process.env.PLAN_REPLAY, "utf8")) as Record<string, SearchResult[]>) : null
    const recorded: Record<string, SearchResult[]> = {}
    const tavily = tavilyProvider({ apiKey: env("TAVILY_API_KEY") })
    const search = async (q: string) => (replay ? (replay[q] ?? []) : (recorded[q] = await tavily.search(q, AbortSignal.timeout(20_000), { country: "india" })))
    // Two queries in all: the use template for a bike, the band template for a car.
    const query = (q: ReturnType<typeof buildQuery>) => (q.ok ? q.query : "")
    const terms = { names: [], phrases: [] }
    const runs = [
      { item: "bike" as const, query: query(buildQuery({ kind: "models", vehicle: "bike", month: "2027-01", by: "use", use: "commute" }, terms, "IN")) },
      { item: "car" as const, query: query(buildQuery({ kind: "models", vehicle: "car", month: "2027-03", by: "band", band: "mid-range" }, terms, "IN")) },
    ]
    for (const r of runs) {
      const results = await search(r.query)
      const out = modelCandidates(results, r.item, PURCHASE_SANITY[r.item])
      console.warn(JSON.stringify({ query: r.query, pages: results.map((x) => x.url), named: out.named, kept: out.candidates.length, drops: out.drops }))
      for (const c of out.candidates) console.warn(`  ${c.id} ${c.make} ${c.model} | ${c.low}${c.high !== c.low ? `-${c.high}` : ""}${c.bound ? ` (${c.bound})` : ""}${c.exShowroom ? " ex-showroom" : ""} | ${c.facts.join(", ")} | ${c.site}`)
    }
    if (process.env.PLAN_RECORD && !replay) writeFileSync(process.env.PLAN_RECORD, JSON.stringify(recorded))
    expect(runs.length).toBe(2)
  })
})
