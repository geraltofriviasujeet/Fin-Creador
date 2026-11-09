import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { DEADLINE_MS, MAX_OUTPUT_TOKENS } from "./chat"
import { anthropicProvider } from "./llm/anthropic"
import { ROMA_SYSTEM_PROMPT } from "./prompts/roma-system"
import type { WebLookupInput } from "./search/query"
import { type SearchDb, WebSession } from "./search/session"
import { tavilyProvider } from "./search/tavily"
import type { SearchProvider } from "./search/types"
import { priceCandidates } from "./search/verify"

// The 10.9 latency gate (before any plan UI): a full plan's time end to end, as the plan will
// run it. Code sends the 8 lookups at once (the intake gives every input, so the model doesn't
// choose them): the 10.8 cost lines through WebSession, and the plan's new lines, carriers and
// hotels as plain searches (their templates come with the plan). Then the two model rounds:
// pick prices and names by id, then write the summary. Spends 8 Tavily credits and 2 model
// calls per run, so it runs only by hand:
//   PLAN_LATENCY=1 npx vitest run apps/web/lib/ai/plan-latency.live.test.ts
// Never in CI. Keys are read from apps/web/.env.local and never printed; only timings are.
// PLAN_LATENCY_OUT=<file> writes each run's timings (outside the repo).

const run = process.env.PLAN_LATENCY === "1" && !process.env.CI

function envLocal(name: string): string {
  const text = readFileSync(join(__dirname, "../../.env.local"), "utf8")
  const line = text.split("\n").find((l) => l.startsWith(`${name}=`))
  const value = line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
  if (!value) throw new Error(`${name} is not set in apps/web/.env.local`)
  return value
}

const PLANS = [
  { destination: "Goa", from: "Delhi", abroad: false },
  { destination: "Kerala", from: "Mumbai", abroad: false },
  { destination: "Thailand", from: "Delhi", abroad: true },
  { destination: "Japan", from: "Bengaluru", abroad: true },
  { destination: "Jaipur", from: "Kolkata", abroad: false },
]

const db: SearchDb = { begin: async () => ({ outcome: "ok", credits: 8 }), settle: async () => true, release: async () => true }
const ms = (t: number) => Math.round(performance.now() - t)

describe.skipIf(!run)("Plan latency (live, by hand only)", () => {
  it("times 5 full plans", { timeout: 600_000 }, async () => {
    const search = tavilyProvider({ apiKey: envLocal("TAVILY_API_KEY") })
    const model = anthropicProvider({ apiKey: envLocal("ANTHROPIC_API_KEY"), model: envLocal("LLM_MODEL") })
    const rows = []
    for (const p of PLANS) {
      const t0 = performance.now()
      const web = new WebSession({ provider: search, db, requestId: `plan-${p.destination}`, terms: { names: [], phrases: [] }, countryCode: "IN" })
      const trip = (cost_line: "transport" | "stay" | "food" | "activities" | "visa"): WebLookupInput => ({
        kind: "trip", destination: p.destination, month: "2027-01", nights: 4, travellers: 2, cost_line,
      })
      const signal = AbortSignal.timeout(DEADLINE_MS)
      const plain = (q: string) => timed(search, q, signal)
      const lookups = await Promise.all([
        ...(["transport", "stay", "food", "activities"] as const).map(async (l) => {
          const t = performance.now()
          const out = await web.lookup(trip(l), signal)
          return { name: l, ms: ms(t), ok: out.ok, results: out.ok ? out.results.length : 0 }
        }),
        plain(`local taxi or cab hire per day in ${p.destination} price ${p.abroad ? "" : "INR"}`.trim()).then((r) => ({ name: "local_travel", ...r })),
        plain(`${p.destination} sightseeing entry tickets price`).then((r) => ({ name: "sightseeing", ...r })),
        plain(`airlines flying ${p.from} to ${p.destination} direct flights`).then((r) => ({ name: "carriers", ...r })),
        plain(`4 star 5 star hotels resorts ${p.destination} price per night`).then((r) => ({ name: "hotels", ...r })),
      ])
      const lookupMs = ms(t0)

      // Plan-sized model input: every price found, with its id and source, as the plan passes them.
      const prices = [...web.candidates].map(([id, c]) => ({ id, amount: c.amount, currency: c.currency, quote: c.quote, url: c.source_url }))
      const system = [ROMA_SYSTEM_PROMPT]
      const ask = `Trip plan: ${p.destination}, January 2027, 4 nights, 2 travellers. Prices found (by id):\n${JSON.stringify(prices)}`
      const t1 = performance.now()
      const pick = await model.complete({ system, messages: [{ role: "user", text: `${ask}\n\nFor each cost line list the ids you would keep, one line each.` }], tools: [], maxOutputTokens: MAX_OUTPUT_TOKENS }, signal)
      const pickMs = ms(t1)
      const t2 = performance.now()
      const write = await model.complete({
        system,
        messages: [
          { role: "user", text: `${ask}\n\nFor each cost line list the ids you would keep, one line each.` },
          { role: "assistant", text: pick.text, toolCalls: [] },
          { role: "user", text: "Now write the plan's short summary, using {web:N} placeholders for amounts." },
        ],
        tools: [],
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      }, signal)
      const writeMs = ms(t2)
      await web.finish()
      rows.push({
        destination: p.destination,
        totalMs: ms(t0),
        lookupMs,
        slowestLookup: lookups.reduce((a, b) => (b.ms > a.ms ? b : a)),
        lookupsOk: lookups.filter((l) => l.ok).length,
        pickMs,
        writeMs,
        inputTokens: pick.usage.inputTokens + write.usage.inputTokens,
        outputTokens: pick.usage.outputTokens + write.usage.outputTokens,
        sent: web.lookupsSent + 4,
        lookups,
      })
    }
    const totals = rows.map((r) => r.totalMs).sort((a, b) => a - b)
    const summary = {
      runs: rows.length,
      deadlineMs: DEADLINE_MS,
      medianMs: totals[Math.floor(totals.length / 2)],
      worstMs: totals.at(-1),
      perRun: rows.map(({ destination, totalMs, lookupMs, pickMs, writeMs, lookupsOk, slowestLookup, inputTokens, outputTokens }) => ({
        destination, totalMs, lookupMs, pickMs, writeMs, lookupsOk, slowest: `${slowestLookup.name} ${slowestLookup.ms}`, inputTokens, outputTokens,
      })),
    }
    console.warn(JSON.stringify(summary, null, 2))
    if (process.env.PLAN_LATENCY_OUT) writeFileSync(process.env.PLAN_LATENCY_OUT, JSON.stringify({ summary, rows }, null, 2))
    expect(rows).toHaveLength(PLANS.length)
  })
})

async function timed(search: SearchProvider, query: string, signal: AbortSignal) {
  const t = performance.now()
  try {
    const results = await search.search(query, signal)
    return { ms: ms(t), ok: true, results: results.length, prices: results.flatMap((r) => priceCandidates(r)).length }
  } catch {
    return { ms: ms(t), ok: false, results: 0, prices: 0 }
  }
}
