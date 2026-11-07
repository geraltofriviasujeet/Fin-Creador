import { describe, expect, it } from "vitest"
import type { GoalProjection } from "@fin-creador/domain"
import type { UserClient } from "@fin-creador/api"
import { LlmError, type LlmProvider, type LlmRequest } from "../llm/types"
import { type SearchDb, WebSession } from "../search/session"
import type { SearchProvider, SearchResult } from "../search/types"
import { type PlanRecords, runPlan } from "./run"
import { type PlanRequest, checkedPlanSchema } from "./types"

// A plan, run on fake pages, a fake model and fake records: what code works out, what a skipped
// field does, and the fallback when the model's round hangs (the plan still comes back).

const page = (title: string, snippet: string): SearchResult => ({ title, url: `https://${title.toLowerCase().replace(/[^a-z]+/g, "-")}.example.test/`, snippet })

/** One page per query, by the words the query template uses. */
const PAGES: [RegExp, SearchResult][] = [
  [/^flight ticket price from Delhi to Goa/, page("Goa flights", "Delhi to Goa flights cost ₹4,200 per person one way on average. Seat selection from ₹5 per person.")],
  [/hotel price per night/, page("Goa hotels", "Rooms at Novotel Goa Resort & Spa in Candolim cost ₹4,500 a night in January.")],
  [/daily food cost/, page("Goa food", "Street food meals in Goa cost about ₹800 per person per day; try the fish curry and bebinca.")],
  [/local taxi hire/, page("Goa taxis", "An app cab (Uber or Ola) in Goa costs ₹2,000 per day.")],
  [/tours and activities/, page("Goa tours", "The Dudhsagar Falls tour costs ₹1,500 per person. Basilica of Bom Jesus and Fort Aguada are free to visit.")],
  [/what to buy in/, page("Goa shopping", "Goa is known for cashew nuts, spices and feni; a bottle costs ₹3,000.")],
  [/^airlines flying from Delhi to Goa/, page("Goa airlines", "IndiGo, Air India Express and Akasa Air fly to Goa daily. SpiceJet also operates the route.")],
  [
    /hotels and resorts/,
    page(
      "Goa luxury stays",
      "Best Hotels in Goa: Taj Exotica Resort & Spa is a 5-star resort in Benaulim with rooms from ₹18,000 a night. Novotel Goa Resort & Spa, a 4-star hotel, costs ₹9,500 per night. Goa Booking.com Hotel deals on 5-star stays. The Taj Exotica Resort & Spa Goa is a 5-star favourite.",
    ),
  ],
  [/on road price/, page("Creta price", "The Hyundai Creta on road price in India is ₹14.5 lakh for the base model.")],
  [/insurance price/, page("Creta insurance", "Hyundai Creta insurance costs ₹45,000 for the first year.")],
]

function fakeSearch(): SearchProvider & { queries: string[] } {
  const queries: string[] = []
  return {
    name: "fake",
    queries,
    async search(query) {
      queries.push(query)
      return PAGES.filter(([re]) => re.test(query)).map(([, r]) => r)
    },
  }
}

function fakeDb() {
  const calls: string[] = []
  const db: SearchDb = {
    async begin(_r, _p, plan) {
      calls.push(`begin:${plan ? "plan" : "question"}`)
      return { outcome: "ok", credits: 8 }
    },
    async settle(_r, credits) {
      calls.push(`settle:${credits}`)
      return true
    },
    async release() {
      calls.push("release")
      return true
    },
  }
  return { db, calls }
}

const PER: Record<string, string> = { transport: "person", stay: "night", food: "day_person", local_travel: "night", sightseeing: "person", shopping: "total", price: "total", extras: "total" }

/** Picks every price of every line with the basis its page states, and every name. */
function pickingModel(override?: (brief: Brief) => unknown): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = []
  return {
    name: "fake",
    model: "fake",
    requests,
    async complete(request) {
      requests.push(request)
      const brief = JSON.parse((request.messages[0] as { text: string }).text) as Brief
      const input = override?.(brief) ?? {
        lines: brief.lines.map((l) => ({ line: l.line, picks: l.prices.map((p) => ({ id: p.id, per: PER[l.line] })) })),
        carriers: brief.carriers.map((c) => c.id),
        hotels: brief.hotels.map((h) => h.id),
      }
      return { stop: "tool_use", text: "", toolCalls: [{ id: "t1", name: "plan_pick", input }], usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
}
type Brief = { lines: { line: string; prices: { id: string }[] }[]; carriers: { id: string }[]; hotels: { id: string; name: string }[] }

/** A model that never answers: it waits until its round is cut off at the deadline. */
const hangingModel: LlmProvider = {
  name: "fake",
  model: "fake",
  complete: (_request, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new LlmError("timeout", "unknown", "cut off")))),
}

const targets: number[] = []
function fakeRecords(overrides: Partial<PlanRecords> = {}): () => Promise<PlanRecords> {
  return async () => ({
    records: { verdict: "No.", summary: "No. A 4-night domestic trip to Goa would cost about ₹40,000, estimated from your own records." },
    goal: null,
    saved: null,
    project: (targetMinor) => {
      targets.push(targetMinor)
      return { verdict: "no", extraMonthlyMinor: 500_000, reachMonth: "2027-04-01" } as GoalProjection
    },
    assumptions: [],
    ...overrides,
  })
}

const goa = { kind: "trip", destination: "Goa", origin: "Delhi", month: "2027-01", nights: 4, travellers: 2, style: "comfort" } satisfies PlanRequest

function setup() {
  const search = fakeSearch()
  const { db, calls } = fakeDb()
  const web = new WebSession({ provider: search, db, requestId: "r1", terms: { names: [], phrases: [] }, countryCode: "IN", plan: true })
  const ctx = { supabase: {} as UserClient, today: "2026-11-07", currency: "INR", descriptionsOk: false, web }
  return { search, calls, web, ctx }
}

describe("a trip plan", () => {
  it("looks up each line, scales the picked prices, drops misreads, adds a 10% buffer and checks the total", async () => {
    const { search, ctx, web, calls } = setup()
    targets.length = 0
    const run = await runPlan(goa, { ctx, provider: pickingModel(), records: fakeRecords() })
    expect(search.queries).toHaveLength(8)
    expect(run.picked).toBe("picked")
    expect(run.plan.assumptions.some((a) => a.startsWith("Prices in rupees outside a plausible range are dropped as misreads: transport ₹1,500 to ₹40,000 a person (international ₹8,000 to ₹2,00,000 a person)"))).toBe(true)
    const by = Object.fromEntries(run.plan.lines.map((l) => [l.line, l]))
    expect(by.transport!.amounts).toEqual([{ currency: "INR", low: "8400", high: "8400" }])
    expect(by.stay!.amounts[0]!.high).toBe("18000")
    expect(by.food!.amounts[0]!.high).toBe("8000") // ₹800 × 5 days × 2
    // "₹5 per person" for a flight is a misread: dropped, and the line says so.
    expect(by.transport!.prices).toHaveLength(1)
    expect(by.transport!.how).toMatch(/1 price outside ₹1,500 to ₹40,000 a person was dropped as implausible\.$/)
    // What each price is for, found next to it on its page.
    expect(by.stay!.prices[0]!.about).toBe("Novotel Goa Resort & Spa")
    expect(by.food!.prices[0]!.about).toBe("street food")
    expect(by.food!.mentions!.map((m) => m.name)).toEqual(["fish curry", "bebinca"])
    expect(by.local_travel!.prices[0]!.about).toBe("app cab")
    expect(by.sightseeing!.prices[0]!.about).toBe("Dudhsagar Falls")
    expect(by.sightseeing!.mentions!.map((m) => m.name)).toEqual(["Dudhsagar Falls", "Basilica of Bom Jesus", "Fort Aguada"])
    // Shopping: never an amount, what the place is known for buying.
    expect(by.shopping).toMatchObject({ from: "not_estimated", amounts: [], prices: [] })
    expect(by.shopping!.mentions!.map((m) => m.name)).toEqual(["cashews", "spices", "feni"])
    expect(by.buffer).toMatchObject({ from: "worked_out", amounts: [{ currency: "INR", low: "4540", high: "4540" }] })
    expect(run.plan.verdicts.totals).toEqual([{ currency: "INR", low: "49940", high: "49940" }])
    expect(targets).toEqual([4_994_000])
    expect(run.answer).toMatch(/ 6 of 6 cost lines have an estimate\./)
    expect(run.plan.verdicts.web.summary).toBe("No. With web estimates the plan adds up to ₹49,940. At your current rate that wouldn't be covered by January 2027.")
    expect(run.plan.changes[0]).toMatch(/^Save ₹5,000(\.00)? more a month\.$/)
    // Every web line carries its page; names are only those found, each with where.
    expect(by.transport!.prices[0]).toMatchObject({ site: "goa-flights.example.test", per: "person" })
    expect(run.plan.carriers!.listed.map((c) => c.name)).toEqual(["Air India Express", "IndiGo", "Akasa Air", "SpiceJet"])
    expect(run.plan.hotels!.listed).toEqual([
      expect.objectContaining({ name: "Taj Exotica Resort & Spa", stars: 5, rate: expect.objectContaining({ amount: "18,000".replace(",", ""), bound: "from", per: "night" }) }),
      expect.objectContaining({ name: "Novotel Goa Resort & Spa", stars: 4 }),
    ])
    expect(run.plan.hotels!.note).toMatch(/not Roma's recommendation/)
    expect(checkedPlanSchema.safeParse(run.plan).success).toBe(true)
    await web.finish()
    expect(calls).toEqual(["begin:plan", "settle:8"])
  })

  it("comes back when the model's round hangs: lookups kept as pages, every web line no estimate, credits settled", async () => {
    const { ctx, web, calls } = setup()
    const started = Date.now()
    const run = await runPlan(goa, { ctx, provider: hangingModel, records: fakeRecords(), deadlineMs: 2_600 })
    expect(Date.now() - started).toBeLessThan(2_600)
    expect(run.picked).toBe("timeout")
    expect(run.unknownCalls).toBe(1)
    const looked = run.plan.lines.filter((l) => l.line !== "buffer" && l.line !== "shopping")
    expect(looked.every((l) => l.from === "none" && /checked in time/.test(l.how) && l.pages.length === 1)).toBe(true)
    expect(run.plan.lines.find((l) => l.line === "buffer")!.from).toBe("none")
    expect(run.plan.carriers).toEqual({ listed: [], note: expect.stringMatching(/couldn't be checked in time/) })
    // The records' verdict is still there, and the plan is still a valid plan.
    expect(run.plan.verdicts.records.verdict).toBe("No.")
    expect(run.plan.verdicts.web.summary).toMatch(/^No web estimates/)
    expect(checkedPlanSchema.safeParse(run.plan).success).toBe(true)
    expect(run.plan.sources).toHaveLength(8)
    await web.finish()
    expect(calls).toEqual(["begin:plan", "settle:8"])
  })

  it("runs with skipped fields: the lines that need them are no estimate, the rest are looked up", async () => {
    const { search, ctx } = setup()
    const run = await runPlan({ ...goa, nights: null, style: null }, { ctx, provider: pickingModel(), records: fakeRecords() })
    expect(search.queries).toHaveLength(7) // no stay lookup
    const by = Object.fromEntries(run.plan.lines.map((l) => [l.line, l]))
    expect(by.stay).toMatchObject({ from: "none", how: "No estimate: the travel style was skipped." })
    expect(by.food).toMatchObject({ from: "none", how: "No estimate: the prices found need the number of nights, which was skipped." })
    expect(by.transport!.from).toBe("web")
    expect(run.plan.verdicts.web.summary).toMatch(/Lines with no estimate aren't included: stay, food, local travel\./)
    expect(run.plan.intake.fields.find((f) => f.label === "Nights")!.value).toBeNull()
  })

  it("keeps only ids the model was offered for that line, and only names that were found", async () => {
    const { ctx } = setup()
    const run = await runPlan(goa, {
      ctx,
      records: fakeRecords(),
      provider: pickingModel((brief) => {
        const stay = brief.lines.find((l) => l.line === "stay")!.prices[0]!.id
        return { lines: [{ line: "transport", picks: [{ id: stay, per: "person" }] }], carriers: ["c99"], hotels: [] }
      }),
    })
    expect(run.plan.lines.find((l) => l.line === "transport")).toMatchObject({ from: "none", how: expect.stringMatching(/could be confirmed/) })
    expect(run.plan.carriers!.listed).toEqual([])
    expect(run.plan.carriers!.note).toMatch(/none is suggested/)
  })

  it("without the origin: no flight lookup and no airlines, transport says why, the rest runs", async () => {
    const { search, ctx } = setup()
    const run = await runPlan({ ...goa, origin: null }, { ctx, provider: pickingModel(), records: fakeRecords() })
    expect(search.queries.some((q) => /flight|airlines/.test(q))).toBe(false)
    expect(search.queries).toHaveLength(6)
    expect(run.plan.lines.find((l) => l.line === "transport")).toMatchObject({ from: "none", how: "No estimate: where you travel from was skipped." })
    expect(run.plan.carriers!.note).toBe("No airlines looked up: where you travel from was skipped.")
    expect(run.plan.intake.fields.find((f) => f.label === "From")!.value).toBeNull()
  })

  it("asks once more when the model answers without calling the tool, then uses the picks", async () => {
    const { ctx } = setup()
    const picking = pickingModel()
    let first = true
    const provider: LlmProvider = {
      name: "fake",
      model: "fake",
      async complete(request, signal) {
        if (first) {
          first = false
          return { stop: "end", text: "I'll pick the ids that fit.", toolCalls: [], usage: { inputTokens: 1000, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } }
        }
        expect(request.messages.at(-1)).toMatchObject({ role: "user", text: "Call plan_pick now with your picks. Write nothing else." })
        expect(request.thinking).toBe("off")
        return picking.complete({ ...request, messages: [request.messages[0]!] }, signal)
      },
    }
    const run = await runPlan(goa, { ctx, provider, records: fakeRecords() })
    expect(run).toMatchObject({ picked: "picked", calls: 2 })
    expect(run.plan.lines.find((l) => l.line === "transport")!.from).toBe("web")
  })

  it("takes a trip goal's lines instead of looking them up", async () => {
    const { search, ctx } = setup()
    const run = await runPlan(goa, {
      ctx,
      provider: pickingModel(),
      records: fakeRecords({ goal: { name: "Goa 2027", lines: { transport: 1_000_000, stay: 2_000_000 }, how: "From your trip goal Goa 2027." } }),
    })
    expect(search.queries.some((q) => /^flight ticket price|hotel price per night/.test(q))).toBe(false)
    expect(run.plan.lines.find((l) => l.line === "transport")).toMatchObject({ from: "goal", amounts: [{ currency: "INR", low: "10000", high: "10000" }] })
  })

  it("says so when no destination is given: nothing is looked up and no names are suggested", async () => {
    const { search, ctx } = setup()
    const run = await runPlan({ ...goa, destination: null }, { ctx, provider: pickingModel(), records: fakeRecords() })
    expect(search.queries).toHaveLength(0)
    expect(run.calls).toBe(0)
    expect(run.plan.hotels!.note).toBe("No 4- and 5-star hotels or resorts looked up: the destination was skipped.")
    expect(run.plan.lines.every((l) => l.from === (l.line === "shopping" ? "not_estimated" : "none"))).toBe(true)
  })
})

describe("a purchase plan", () => {
  it("prices the vehicle and its first-year insurance, takes off the deposit and says what is saved", async () => {
    const { search, ctx } = setup()
    targets.length = 0
    const run = await runPlan(
      { kind: "purchase", item: "car", make: "Hyundai", model: "Creta", month: "2027-03", depositMinor: 10_000_000 },
      { ctx, provider: pickingModel(), records: fakeRecords({ saved: { goal: "New car", minor: 20_000_000 } }) },
    )
    expect(search.queries).toHaveLength(2)
    expect(run.plan.verdicts.totals).toEqual([{ currency: "INR", low: "1495000", high: "1495000" }])
    expect(targets).toEqual([139_500_000])
    expect(run.plan.saved).toEqual({ goal: "New car", minor: 20_000_000, currency: "INR" })
    expect(run.plan.verdicts.web.summary).toMatch(/already saved toward New car/)
    expect(run.plan.carriers).toBeNull()
  })

  it("doesn't look up a house: its lines are no estimate without a goal", async () => {
    const { search, ctx } = setup()
    const run = await runPlan({ kind: "purchase", item: "house", make: null, model: null, month: "2028-01", depositMinor: null }, { ctx, provider: pickingModel(), records: fakeRecords() })
    expect(search.queries).toHaveLength(0)
    expect(run.plan.lines.map((l) => l.from)).toEqual(["none", "none"])
  })
})

describe("the stored plan", () => {
  it("has no key naming an account, IBAN, IFSC, card number or balance", async () => {
    const { ctx } = setup()
    const run = await runPlan(goa, { ctx, provider: pickingModel(), records: fakeRecords({ saved: { goal: "Goa", minor: 100 } }) })
    const keys: string[] = []
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          keys.push(k)
          walk(x)
        }
      }
    }
    walk(run.plan)
    expect(keys.filter((k) => /account|iban|ifsc|card_number|balance/i.test(k))).toEqual([])
    expect(JSON.stringify(run.plan).length).toBeLessThan(32_768)
  })
})
