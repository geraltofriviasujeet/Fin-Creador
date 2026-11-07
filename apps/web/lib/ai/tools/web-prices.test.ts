import { describe, expect, it } from "vitest"
import { z } from "zod"
import type { UserClient } from "@fin-creador/api"
import { formatMoney, goalProjection } from "@fin-creador/domain"
import { runChat } from "../chat"
import { ROMA_TOOLS, WEB_TOOLS } from "../handle"
import { type MockScript, mockProvider, mockText } from "../llm/mock"
import { NO_USAGE } from "../llm/types"
import { mockSearchProvider } from "../search/mock"
import { type SearchDb, WEB_NOTICES, WebSession, lookupsLine } from "../search/session"
import type { SearchResult } from "../search/types"
import { webTripVerdict } from "./trip"
import { type FinanceTool, type GoalCheck, NO_LOOKUPS, type ToolContext, toToolDef } from "./types"
import { webTotal } from "../web-format"
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

// The prices found in code in RESULTS: w1 ₹4,500 and w2 ₹30,000 (hotels), w3 ₹9,000 (flights).
const hotel = { id: "w1", label: "Mid-range hotel", per: "night", cost_line: "stay" }
const flight = { id: "w3", label: "Return flight", per: "person", cost_line: "transport" }

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
      if (round === 1) return call({ id: "f", name: "web_price_figures", input: { figures: [hotel, flight, { ...flight, id: "w99", label: "Made up" }] } })
      return mockText("Web estimates, to check at the source: about ₹4,500 a night (hotels.example.test) and ₹9,000 a person for flights (flights.example.test), ₹36,000 for 4 nights and 2 travellers.")
    })
    expect(run.result).toMatchObject({ kind: "answer" })
    if (run.result.kind !== "answer") return
    expect(run.result.web?.figures.map((f) => [f.label, f.value, f.site])).toEqual([
      ["Mid-range hotel", "4500", "hotels.example.test"],
      ["Return flight", "9000", "flights.example.test"],
    ])
    // 4,500 × 4 nights + 9,000 × 2 travellers; the flight is a "from" price, so the total is a minimum.
    expect(run.result.web?.totals).toEqual([{ currency: "INR", lines: 2, costLines: ["stay", "transport"], low: "36000", high: "36000", bound: "at_least" }])
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

describe("a total fed by a bound", () => {
  const trip = { nights: 4, travellers: 2 }
  const price = (value: string, cost_line: string, bound?: "from" | "up_to") => ({
    label: "x",
    amount: value,
    scale: "none" as const,
    value,
    currency: "INR",
    per: "total" as const,
    cost_line,
    source_url: "https://a.example.test",
    quote: "x",
    site: "a.example.test",
    title: "x",
    ...(bound ? { bound } : {}),
  })

  it("is a minimum when any price feeding it is a 'from' price, a maximum for 'up to', neither for both", () => {
    expect(webTotals([price("9000", "transport", "from"), price("4000", "stay")], trip)[0]).toMatchObject({ low: "13000", high: "13000", bound: "at_least" })
    expect(webTotals([price("9000", "transport", "up_to"), price("4000", "stay")], trip)[0]).toMatchObject({ bound: "at_most" })
    expect(webTotals([price("9000", "transport", "from"), price("4000", "stay", "up_to")], trip)[0]).toMatchObject({ bound: "mixed" })
    expect(webTotals([price("9000", "transport"), price("4000", "stay")], trip)[0]).not.toHaveProperty("bound")
    // Only the currency the bound is in.
    const two = webTotals([price("9000", "transport", "from"), { ...price("60", "stay"), currency: "USD" }], trip)
    expect(two.map((t) => [t.currency, t.bound ?? null])).toEqual([["INR", "at_least"], ["USD", null]])
  })

  it("is written as 'at least' its low end or 'at most' its high end, never as an estimate", () => {
    const total = { currency: "INR", low: "13000", high: "18000" }
    expect(webTotal(total)).toBe("INR 13,000 to 18,000")
    expect(webTotal({ ...total, bound: "at_least" })).toBe("at least INR 13,000")
    expect(webTotal({ ...total, bound: "at_most" })).toBe("at most INR 18,000")
    expect(webTotal({ ...total, bound: "mixed" })).toBe('INR 13,000 to 18,000 (mixes "from" and "up to" prices: neither a minimum nor a maximum)')
  })

  it("makes the web-assisted line a minimum, checked at that minimum, and fills its placeholder as one", async () => {
    // A stand-in for trip_check: six months of ₹10,000 net, travel in January 2027 (₹30,000 free).
    const months = Array.from({ length: 6 }, () => ({ incomeMinor: 20_000_00, expenseMinor: 10_000_00 }))
    const money = (minor: number) => formatMoney(minor, { currency: "INR" })
    const seen: number[] = []
    const tripStandIn: FinanceTool<Record<string, never>> = {
      name: "trip_check",
      description: "Test stand-in.",
      input: z.object({}).strict(),
      async run() {
        const check: GoalCheck = {
          kind: "trip",
          goal: "Goa",
          verdict: "No estimate from your records.",
          summary: "No estimate from your records.",
          assumptions: [],
          withTarget: (targetMinor, costLines, bound) => {
            seen.push(targetMinor)
            const projection = goalProjection({ today: "2026-11-06", targetMinor, savedMinor: 0, targetDate: "2027-01-01", months, claims: [], otherGoals: [] })
            return webTripVerdict(projection, { targetMinor, costLines, travelMonth: "2027-01-01", money, webOnly: true, bound })
          },
        }
        return { data: { verdict: check.verdict }, figures: [], check }
      },
    }
    // w1 ₹4,500 a night (hotel) and w3 "from ₹9,000" a person (flight): at least ₹36,000.
    const run = await runChat({
      provider: mockProvider((_req, round) => {
        if (round === 0) return call({ id: "t", name: "trip_check", input: {} })
        if (round === 1) return call(lookup("stay"), lookup("transport"))
        if (round === 2) return call({ id: "f", name: "web_price_figures", input: { figures: [hotel, flight] } })
        return mockText("No estimate from your records. Flights and a hotel come to {web:total_inr} (example.test).")
      }),
      tools: [tripStandIn as FinanceTool, ...WEB_TOOLS],
      context: contextWith(),
      question: "Can I afford Goa? Check web prices too.",
    })
    expect(run.result.kind).toBe("answer")
    if (run.result.kind !== "answer") return
    expect(run.result.text).toBe("No estimate from your records. Flights and a hotel come to at least INR 36,000 (example.test).")
    expect(seen).toEqual([36_000_00])
    expect(run.result.checks[0]!.web?.summary).toBe(
      'No. Web-only estimate: it rests entirely on web prices, with no basis in your records. The web prices kept add up to at least ₹36,000, a minimum because some prices are "from" prices, for stay, travel only, not the whole trip. At your current rate that wouldn\'t be covered by January 2027. Saving ₹2,000 more a month would cover it. At your current rate it is reached in February 2027.',
    )
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
        if (round === 2) return call({ id: "f", name: "web_price_figures", input: { figures: [hotel] } })
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

// What the lookups did, in the trip check's assumptions (10.8, the Goa question on dev: a credit
// spent, nothing shown, and "No outside prices are looked up." still there).
describe("the assumptions line about outside prices", () => {
  const tripWithLine: FinanceTool<Record<string, never>> = {
    name: "trip_check",
    description: "Test stand-in.",
    input: z.object({}).strict(),
    async run() {
      const check: GoalCheck = { kind: "trip", goal: "Goa", verdict: "Yes.", summary: "Yes. A trip to Goa fits from your records.", assumptions: ["Past prices, not adjusted for price rises.", NO_LOOKUPS] }
      return { data: { verdict: "Yes." }, figures: [], check }
    },
  }
  const trip = { id: "t", name: "trip_check", input: {} }
  const figures = (...f: unknown[]) => ({ id: "f", name: "web_price_figures", input: { figures: f } })
  const ANSWER = "Yes. A trip to Goa fits from your records."
  const chat = (rounds: ReturnType<typeof call>[], tools: FinanceTool[] = [tripWithLine as FinanceTool, ...WEB_TOOLS]) =>
    runChat({
      provider: mockProvider((_req, round) => rounds[round] ?? mockText(ANSWER)),
      tools,
      context: contextWith(),
      question: "Can I afford Goa? Check web prices too.",
    })
  const lineOf = (run: Awaited<ReturnType<typeof chat>>) => (run.result.kind === "answer" ? run.result.checks[0]!.assumptions[1] : null)

  it("keeps the line when no lookup ran", async () => {
    const run = await chat([call(trip)])
    expect(lineOf(run)).toBe("No outside prices were looked up.")
    expect(run.result).not.toHaveProperty("webNotices")
  })

  it("says a lookup ran and nothing could be confirmed when every reported price was dropped", async () => {
    const run = await chat([call(trip), call(lookup("stay")), call(figures({ ...hotel, id: "w99" }))])
    expect(lineOf(run)).toBe(
      "1 web lookup ran for this question and counts toward your allowance, but no price from it could be confirmed at its source, so none is shown. This answer uses your own records only.",
    )
    expect(run.result).not.toHaveProperty("web")
  })

  it("says lookups ran and none was used when no price was reported", async () => {
    const run = await chat([call(trip), call(lookup("stay"), lookup("transport"))])
    expect(lineOf(run)).toBe(
      "2 web lookups ran for this question and count toward your allowance, but no price from them was used, so none is shown. This answer uses your own records only.",
    )
  })

  it("says prices are shown separately, and how many were dropped, when some were kept", async () => {
    const run = await chat([call(trip), call(lookup("stay"), lookup("transport")), call(figures(hotel, { ...flight, id: "w99" }))])
    expect(lineOf(run)).toBe(
      "2 web lookups ran for this question. Prices confirmed at their source are shown separately as web estimates; they don't change this verdict. 1 other price couldn't be confirmed at the source and isn't shown.",
    )
    expect(run.result.kind === "answer" && run.result.web?.figures).toHaveLength(1)
  })

  it("with no trip check, a spent lookup that shows nothing is a notice", async () => {
    const run = await chat([call(lookup("stay"))], WEB_TOOLS as FinanceTool[])
    expect(run.result).toMatchObject({ kind: "answer", webNotices: [lookupsLine(1, 0, { figures: 0, dropped: 0 })] })
  })

  it("is null when no lookup was sent", () => {
    expect(lookupsLine(0, 0, { figures: 3, dropped: 3 })).toBeNull()
  })
})

// The model picks prices found in code by id and never types an amount (10.8, after 2 in 5 live
// Goa runs spent their lookups and showed nothing because typed prices failed the check).
describe("prices picked by id", () => {
  it("hands the model the prices found in code, with ids, and no page text", async () => {
    let seen: { prices?: unknown; results?: unknown } = {}
    await ask((req, round) => {
      const last = req.messages.at(-1)
      if (last?.role === "tool_results") seen = JSON.parse(last.results[0]!.content)
      return round === 0 ? call(lookup("stay")) : mockText("No web prices used.")
    })
    expect(seen.results).toBeUndefined()
    expect(seen.prices).toEqual([
      { id: "w1", site: "hotels.example.test", currency: "INR", text: "Test data. Mid-range rooms cost about ₹4,500 per night. Luxury suites ₹30,000." },
      { id: "w2", site: "hotels.example.test", currency: "INR", text: "Test data. Mid-range rooms cost about ₹4,500 per night. Luxury suites ₹30,000." },
      { id: "w3", site: "flights.example.test", currency: "INR", text: "Test data. Return flights from ₹9,000 per person.", bound: "from" },
    ])
  })

  it("keeps both ends of a range when one is picked, and offers the range placeholder", async () => {
    const ranged = [{ title: "Test data", url: "https://stay.example.test/goa", snippet: "Test data. A 3-star stay in Calangute is about $40 to $60 a night." }]
    const context = contextWith(mockSearchProvider(() => ranged))
    let figures: { kept: { write: string }[]; ranges: { write: string }[] } | undefined
    let seenRange: unknown
    const run = await ask((req, round) => {
      const last = req.messages.at(-1)
      const content = last?.role === "tool_results" ? JSON.parse(last.results[0]!.content) : {}
      if (round === 0) return call(lookup("stay"))
      if (round === 1) {
        seenRange = content.prices
        return call({ id: "f", name: "web_price_figures", input: { figures: [{ id: "w2", label: "3-star stay", per: "night", cost_line: "stay" }] } })
      }
      figures = content
      return mockText("A 3-star stay is {web:1} to {web:2} a night (stay.example.test).")
    }, context)
    expect(seenRange).toMatchObject([
      { id: "w1", range: "w1 to w2" },
      { id: "w2", range: "w1 to w2" },
    ])
    expect(figures?.kept.map((k) => k.write)).toEqual(["{web:2}", "{web:1}"])
    expect(figures?.ranges).toEqual([{ write: "{web:1} to {web:2}", label: "3-star stay", per: "night" }])
    expect(run.result).toMatchObject({ kind: "answer", text: "A 3-star stay is USD 40 to USD 60 a night (stay.example.test)." })
    // 4 nights: USD 160 to 240.
    expect(run.result.kind === "answer" && run.result.web?.totals).toEqual([{ currency: "USD", lines: 1, costLines: ["stay"], low: "160", high: "240" }])
  })

  it("keeps a price found in two lookups under one id", async () => {
    const context = contextWith()
    await ask((_req, round) => (round === 0 ? call(lookup("stay"), lookup("transport")) : mockText("No web prices used.")), context)
    expect([...context.web!.candidates.keys()]).toEqual(["w1", "w2", "w3"])
  })

  it("refuses a typed amount: the input takes ids only", async () => {
    const run = await ask((req, round) => {
      if (round === 0) return call(lookup("stay"))
      if (round === 1) return call({ id: "f", name: "web_price_figures", input: { figures: [{ ...hotel, amount: "4,000" }] } })
      const last = req.messages.at(-1)
      return mockText(last?.role === "tool_results" && last.results[0]!.isError ? "No web prices used." : "Kept.")
    })
    expect(run.result).toMatchObject({ kind: "answer", text: "No web prices used." })
    expect(run.result).not.toHaveProperty("web")
  })

  it("drops an id no lookup gave, and keeps the rest", async () => {
    const run = await ask((_req, round) => {
      if (round === 0) return call(lookup("stay"))
      if (round === 1) return call({ id: "f", name: "web_price_figures", input: { figures: [hotel, { ...hotel, id: "w9", label: "Invented" }] } })
      return mockText("About ₹4,500 a night (hotels.example.test).")
    })
    expect(run.result.kind === "answer" && run.result.web?.figures.map((f) => f.label)).toEqual(["Mid-range hotel"])
  })

  it("lets the answer quote a kept lakh price as written and in full, and shows every price kept this question", async () => {
    const cars = [{ title: "Test data", url: "https://cars.example.test/creta", snippet: "Test data. Ex-showroom from ₹11.11 Lakh; top trim ₹20.5 lakh." }]
    const run = await ask((_req, round) => {
      if (round === 0) return call({ id: "l", name: "web_price_lookup", input: { kind: "vehicle", vehicle: "car", make: "Hyundai", model: "Creta", month: "2027-03" } })
      if (round === 1) return call({ id: "f1", name: "web_price_figures", input: { figures: [{ id: "w1", label: "Base trim", per: "total", cost_line: "vehicle" }] } })
      if (round === 2) return call({ id: "f2", name: "web_price_figures", input: { figures: [{ id: "w2", label: "Top trim", per: "total", cost_line: "vehicle" }] } })
      return mockText("Web estimates: ₹11.11 lakh (₹11,11,000) for the base trim and ₹20.5 lakh for the top trim (cars.example.test).")
    }, contextWith(mockSearchProvider(() => cars)))
    expect(run.result).toMatchObject({ kind: "answer" })
    expect(run.result.kind === "answer" && run.result.web?.figures.map((f) => [f.label, f.value])).toEqual([
      ["Base trim", "1111000"],
      ["Top trim", "2050000"],
    ])
  })
})
