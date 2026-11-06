import { describe, expect, it } from "vitest"
import type { UserClient } from "@fin-creador/api"
import { runChat } from "../chat"
import { WEB_TOOLS } from "../handle"
import { type MockScript, mockProvider, mockText } from "../llm/mock"
import { NO_USAGE } from "../llm/types"
import { mockSearchProvider } from "../search/mock"
import { type SearchDb, WebSession } from "../search/session"
import type { SearchResult } from "../search/types"
import type { ToolContext } from "./types"
import { timesFor, webTotals } from "./web-prices"

// Web lookups through the chat loop, on the mock model and mock search: no paid API, no credit.

const RESULTS: SearchResult[] = [
  { title: "Test data: hotels", url: "https://hotels.example.test/goa", snippet: "Test data. Mid-range rooms cost about ₹4,500 per night. Luxury suites ₹30,000." },
  { title: "Test data: flights", url: "https://flights.example.test/goa", snippet: "Test data. Return flights from ₹9,000 per person." },
]

const db: SearchDb = { begin: async () => ({ outcome: "ok", credits: 3 }), settle: async () => true, release: async () => true }

function contextWith(provider = mockSearchProvider(() => RESULTS)): ToolContext {
  const web = new WebSession({ provider, db, requestId: "r1", terms: { names: [], phrases: [] }, countryCode: "IN" })
  return { supabase: {} as UserClient, today: "2026-11-06", currency: "INR", descriptionsOk: false, web }
}

const lookup = (cost_line: string) => ({ id: `call-${cost_line}`, name: "web_price_lookup", input: { kind: "trip", destination: "Goa", month: "2027-01", nights: 4, travellers: 2, cost_line } })
const call = (...calls: { id: string; name: string; input: unknown }[]) => ({ stop: "tool_use" as const, text: "", toolCalls: calls, usage: NO_USAGE })

const hotel = { label: "Mid-range hotel", amount: "4,500", currency: "INR", per: "night", cost_line: "stay", source_url: "https://hotels.example.test/goa", quote: "Mid-range rooms cost about ₹4,500 per night" }
const flight = { label: "Return flight", amount: "9,000", currency: "INR", per: "person", cost_line: "transport", source_url: "https://flights.example.test/goa", quote: "Return flights from ₹9,000 per person" }

const ask = (script: MockScript, context = contextWith()) =>
  runChat({ provider: mockProvider(script), tools: WEB_TOOLS, context, question: "What would a Goa trip cost on the web?" })

describe("web lookups in Roma's answers", () => {
  it("keeps verified prices, works out the totals in code, and lets the answer quote them", async () => {
    const run = await ask((_req, round) => {
      if (round === 0) return call(lookup("stay"), lookup("transport"))
      if (round === 1) return call({ id: "f", name: "web_price_figures", input: { figures: [hotel, flight, { ...flight, label: "Made up", amount: "7,000", quote: "flights from ₹7,000" }] } })
      return mockText("Web estimates, to check at the source: about ₹4,500 a night (hotels.example.test) and ₹9,000 a person for flights (flights.example.test), ₹36,000 for 4 nights and 2 travellers.")
    })
    expect(run.result).toMatchObject({ kind: "answer" })
    if (run.result.kind !== "answer") return
    expect(run.result.web?.figures.map((f) => [f.label, f.value, f.site])).toEqual([
      ["Mid-range hotel", "4500", "hotels.example.test"],
      ["Return flight", "9000", "flights.example.test"],
    ])
    // 4,500 × 4 nights + 9,000 × 2 travellers.
    expect(run.result.web?.totals).toEqual([{ currency: "INR", lines: 2, low: "36000", high: "36000" }])
    // Web figures stay out of the records' figures.
    expect(run.result.figures).toEqual([])
  })

  it("refuses an answer quoting a number from a page that no kept figure carries", async () => {
    const run = await ask((_req, round) => {
      if (round === 0) return call(lookup("stay"))
      if (round === 1) return call({ id: "f", name: "web_price_figures", input: { figures: [hotel] } })
      return mockText("Rooms are about ₹4,500 a night; luxury suites ₹30,000.")
    })
    expect(run.result).toEqual({ kind: "unverified", unmatched: ["30000"] })
  })

  it("refuses an answer quoting the page before any figure is reported", async () => {
    const run = await ask((_req, round) => (round === 0 ? call(lookup("stay")) : mockText("Mid-range rooms cost about ₹4,500 per night.")))
    expect(run.result).toEqual({ kind: "unverified", unmatched: ["4500"] })
  })

  it("runs a round's lookups at the same time", async () => {
    let running = 0
    let most = 0
    const slow = mockSearchProvider(async () => {
      running++
      most = Math.max(most, running)
      await new Promise((r) => setTimeout(r, 20))
      running--
      return RESULTS
    })
    await ask((_req, round) => (round === 0 ? call(lookup("stay"), lookup("transport"), lookup("food")) : mockText("No web prices used.")), contextWith(slow))
    expect(most).toBe(3)
  })

  it("tells the model when web lookups are off", async () => {
    let seen = ""
    const context = { ...contextWith(), web: undefined }
    await ask((req, round) => {
      const last = req.messages.at(-1)
      if (last?.role === "tool_results") seen = last.results[0]?.content ?? ""
      return round === 0 ? call(lookup("stay")) : mockText("I can only answer from your records.")
    }, context)
    expect(seen).toContain("Web lookups are off")
  })
})

describe("web totals", () => {
  const trip = { nights: 4, travellers: 2 }
  const kept = (f: Partial<Parameters<typeof webTotals>[0][number]>) => ({
    label: "x",
    amount: "1",
    scale: "none" as const,
    value: "1",
    currency: "INR",
    per: "total" as const,
    cost_line: "stay",
    source_url: "https://a.example.test",
    quote: "x",
    site: "a.example.test",
    title: "x",
    ...f,
  })

  it("counts each basis by nights and travellers (N nights is N + 1 days)", () => {
    expect([timesFor("total", trip), timesFor("night", trip), timesFor("person", trip), timesFor("person_night", trip), timesFor("day_person", trip)]).toEqual([1, 4, 2, 8, 10])
    expect(timesFor("night", undefined)).toBeNull()
  })

  it("gives a range from each line's lowest and highest price, and never adds across currencies", () => {
    const totals = webTotals(
      [
        kept({ value: "3000", per: "night" }),
        kept({ value: "4500.50", per: "night" }),
        kept({ value: "9000", per: "person", cost_line: "transport" }),
        kept({ value: "60", currency: "GBP", per: "day_person", cost_line: "food" }),
      ],
      trip,
    )
    expect(totals).toEqual([
      { currency: "INR", lines: 2, low: "30000", high: "36002" },
      { currency: "GBP", lines: 1, low: "600", high: "600" },
    ])
  })
})
