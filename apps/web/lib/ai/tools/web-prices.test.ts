import { describe, expect, it } from "vitest"
import { z } from "zod"
import type { UserClient } from "@fin-creador/api"
import { formatMoney, goalProjection } from "@fin-creador/domain"
import { runChat } from "../chat"
import { ROMA_TOOLS, WEB_TOOLS } from "../handle"
import { type MockScript, mockProvider, mockText } from "../llm/mock"
import { NO_USAGE } from "../llm/types"
import { mockSearchProvider } from "../search/mock"
import { type SearchDb, WEB_NOTICES, WebSession } from "../search/session"
import type { SearchResult } from "../search/types"
import { webTripVerdict } from "./trip"
import { type FinanceTool, type GoalCheck, type ToolContext, toToolDef } from "./types"
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

describe("tool definitions sent to the provider", () => {
  // Anthropic refuses the whole request when one tool's input schema isn't an object at the top
  // (seen on dev, 2026-11-07: a union gave "input_schema.type: Field required"); the mock doesn't check.
  it("has an object at the top of every tool's input schema, with no union there", () => {
    for (const tool of [...ROMA_TOOLS, ...WEB_TOOLS]) {
      const schema = toToolDef(tool).inputSchema
      expect(schema, tool.name).toMatchObject({ type: "object" })
      expect(schema, tool.name).not.toHaveProperty("oneOf")
      expect(schema, tool.name).not.toHaveProperty("anyOf")
    }
  })

  it("still takes only one kind's fields in a lookup", () => {
    const input = WEB_TOOLS[0]!.input
    expect(input.safeParse(lookup("stay").input).success).toBe(true)
    expect(input.safeParse({ kind: "vehicle", vehicle: "car", make: "Tata", model: "Nexon", month: "2027-03" }).success).toBe(true)
    expect(input.safeParse({ ...lookup("stay").input, make: "Tata" }).success).toBe(false)
    expect(input.safeParse({ kind: "trip", destination: "Goa", month: "2027-01", cost_line: "stay" }).success).toBe(false)
    expect(input.safeParse({ kind: "vehicle", vehicle: "car", month: "2027-03" }).success).toBe(false)
  })
})

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
    expect(run.result.web?.totals).toEqual([{ currency: "INR", lines: 2, costLines: ["stay", "transport"], low: "36000", high: "36000" }])
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
      { currency: "INR", lines: 2, costLines: ["stay", "transport"], low: "30000", high: "36002" },
      { currency: "GBP", lines: 1, costLines: ["food"], low: "600", high: "600" },
    ])
  })
})

describe("the records' verdict and the web-assisted line", () => {
  // Six months of ₹10,000 net; the trip is in January 2027, so Nov, Dec and Jan: ₹30,000 free.
  const months = Array.from({ length: 6 }, () => ({ incomeMinor: 20_000_00, expenseMinor: 10_000_00 }))
  const project = (targetMinor: number) =>
    goalProjection({ today: "2026-11-06", targetMinor, savedMinor: 0, targetDate: "2027-01-01", months, claims: [], otherGoals: [] })
  const money = (minor: number) => formatMoney(minor, { currency: "INR" })

  // A stand-in for trip_check: the records estimate ₹20,000 (Yes.); the same projection takes a web total.
  const tripStandIn: FinanceTool<Record<string, never>> = {
    name: "trip_check",
    description: "Test stand-in.",
    input: z.object({}).strict(),
    async run() {
      const records = project(20_000_00)
      const check: GoalCheck = {
        kind: "trip",
        goal: "Goa",
        verdict: records.verdict === "yes" ? "Yes." : "No.",
        summary: "Yes. A trip to Goa would cost about ₹20,000 from your records.",
        assumptions: [],
        withTarget: (targetMinor, costLines) => webTripVerdict(project(targetMinor), { targetMinor, costLines, travelMonth: "2027-01-01", money }),
      }
      return { data: { verdict: check.verdict }, figures: [{ label: "Trip estimate", kind: "money", minor: 20_000_00, currency: "INR" }], check }
    },
  }

  it("keeps the records' Yes. when web prices would make it No., and shows both", async () => {
    const run = await runChat({
      provider: mockProvider((_req, round) => {
        if (round === 0) return call({ id: "t", name: "trip_check", input: {} })
        if (round === 1) return call(lookup("stay"), lookup("transport"))
        if (round === 2) return call({ id: "f", name: "web_price_figures", input: { figures: [hotel, flight] } })
        return mockText("Yes. From your records the trip costs about ₹20,000. Web estimates come to ₹36,000 (hotels.example.test, flights.example.test); check the source.")
      }),
      tools: [tripStandIn as FinanceTool, ...WEB_TOOLS],
      context: contextWith(),
      question: "Can I afford Goa? Check web prices too.",
    })
    expect(run.result.kind).toBe("answer")
    if (run.result.kind !== "answer") return
    // The answer still opens with the records' verdict, and the check's verdict is unchanged.
    expect(run.result.text.startsWith("Yes.")).toBe(true)
    expect(run.result.checks).toHaveLength(1)
    expect(run.result.checks[0]!.verdict).toBe("Yes.")
    // ₹36,000 against ₹30,000 free by January: the web-assisted line says No., apart.
    expect(run.result.checks[0]!.web).toEqual({
      verdict: "No.",
      summary:
        "No. The web prices kept add up to ₹36,000 for stay, travel only, not the whole trip. At your current rate that wouldn't be covered by January 2027. Saving ₹2,000 more a month would cover it. At your current rate it is reached in February 2027.",
    })
  })

  it("gives no web-assisted line from a total in another currency (never converted)", async () => {
    const pounds = [{ title: "Test data", url: "https://uk.example.test/", snippet: "Test data. Rooms about £60 per night." }]
    const run = await runChat({
      provider: mockProvider((_req, round) => {
        if (round === 0) return call({ id: "t", name: "trip_check", input: {} })
        if (round === 1) return call(lookup("stay"))
        if (round === 2) return call({ id: "f", name: "web_price_figures", input: { figures: [{ ...hotel, amount: "60", currency: "GBP", source_url: "https://uk.example.test/", quote: "Rooms about £60 per night" }] } })
        return mockText("Yes. From your records the trip costs about ₹20,000.")
      }),
      tools: [tripStandIn as FinanceTool, ...WEB_TOOLS],
      context: contextWith(mockSearchProvider(() => pounds)),
      question: "Can I afford Goa? Check web prices too.",
    })
    expect(run.result.kind === "answer" && run.result.checks[0]!.web).toBe(undefined)
    expect(run.result.kind === "answer" && run.result.web?.totals).toEqual([{ currency: "GBP", lines: 1, costLines: ["stay"], low: "240", high: "240" }])
  })

  it("says plainly when the month's web lookups are used up, and answers from the records", async () => {
    const capped: SearchDb = { ...db, begin: async () => ({ outcome: "monthly_cap", credits: 0 }) }
    const web = new WebSession({ provider: mockSearchProvider(() => RESULTS), db: capped, requestId: "r1", terms: { names: [], phrases: [] }, countryCode: "IN" })
    const run = await runChat({
      provider: mockProvider((_req, round) => (round === 0 ? call(lookup("stay")) : mockText("I can only answer from your records this time."))),
      tools: WEB_TOOLS,
      context: { ...contextWith(), web },
      question: "What would a Goa hotel cost?",
    })
    expect(run.result).toMatchObject({ kind: "answer", webNotices: [WEB_NOTICES.monthly_cap] })
    expect(WEB_NOTICES.monthly_cap).toBe("Web lookups are used up for this month (they reset on the 1st). This answer uses your own records only.")
  })

  it("says plainly when the person's lookups for today are used up", async () => {
    const capped: SearchDb = { ...db, begin: async () => ({ outcome: "daily_limit", credits: 0 }) }
    const web = new WebSession({ provider: mockSearchProvider(() => RESULTS), db: capped, requestId: "r1", terms: { names: [], phrases: [] }, countryCode: "IN" })
    const run = await runChat({
      provider: mockProvider((_req, round) => (round === 0 ? call(lookup("stay")) : mockText("I can only answer from your records this time."))),
      tools: WEB_TOOLS,
      context: { ...contextWith(), web },
      question: "What would a Goa hotel cost?",
    })
    expect(run.result).toMatchObject({ kind: "answer", webNotices: [WEB_NOTICES.daily_limit] })
  })
})
