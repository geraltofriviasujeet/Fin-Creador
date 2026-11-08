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
  [/^flight ticket price from Delhi to Goa/, page("Goa flights", "IndiGo flights from Delhi to Goa cost ₹4,200 per person one way; IndiGo seat selection from ₹5 per person.")],
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

function fakeSearch(pages = PAGES): SearchProvider & { queries: string[] } {
  const queries: string[] = []
  return {
    name: "fake",
    queries,
    async search(query) {
      queries.push(query)
      return pages.filter(([re]) => re.test(query)).map(([, r]) => r)
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

function setup(pages = PAGES) {
  const search = fakeSearch(pages)
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
    // Stay: the stay lookup's hotel and the hotels lookup's, one list, each hotel once.
    expect(by.stay!.amounts).toEqual([{ currency: "INR", low: "18000", high: "72000", bound: "at_least" }])
    expect(by.stay!.prices.map((p) => [p.about, p.amount])).toEqual([["Novotel Goa Resort & Spa", "4500"], ["Taj Exotica Resort & Spa", "18000"]])
    expect(by.stay!.mentions).toBeUndefined()
    expect(by.food!.amounts[0]!.high).toBe("8000") // ₹800 × 5 days × 2
    // "₹5 per person" for a flight is a misread: dropped, and the line says so.
    expect(by.transport!.prices).toHaveLength(1)
    expect(by.transport!.how).toMatch(/1 price outside ₹1,500 to ₹40,000 a person was dropped as implausible\.$/)
    // What each price is for, found next to it on its page.
    expect(by.food!.prices[0]!.about).toBe("street food")
    expect(by.food!.mentions!.map((m) => m.name)).toEqual(["fish curry", "bebinca"])
    expect(by.local_travel!.prices[0]!.about).toBe("app cab")
    expect(by.sightseeing!.prices[0]!.about).toBe("Dudhsagar Falls")
    expect(by.sightseeing!.mentions!.map((m) => m.name)).toEqual(["Dudhsagar Falls", "Basilica of Bom Jesus", "Fort Aguada"])
    // Shopping: never an amount, what the place is known for buying.
    expect(by.shopping).toMatchObject({ from: "not_estimated", amounts: [], prices: [] })
    expect(by.shopping!.mentions!.map((m) => m.name)).toEqual(["cashews", "spices", "feni"])
    expect(by.buffer).toMatchObject({ from: "worked_out", amounts: [{ currency: "INR", low: "4540", high: "9940", bound: "at_least" }] })
    expect(run.plan.verdicts.totals).toEqual([{ currency: "INR", low: "49940", high: "109340", bound: "at_least" }])
    expect(targets).toEqual([4_994_000])
    expect(run.answer).toMatch(/ 6 of 6 cost lines have an estimate\./)
    expect(run.plan.verdicts.web.summary).toBe(
      'No. With web estimates the plan adds up to at least ₹49,940 (a minimum: some prices are "from" prices). At your current rate that wouldn\'t be covered by January 2027.',
    )
    expect(run.plan.changes[0]).toMatch(/^Save ₹5,000(\.00)? more a month\.$/)
    // Every web line carries its page; names are only those found, each with where.
    expect(by.transport!.prices[0]).toMatchObject({ site: "goa-flights.example.test", per: "person" })
    expect(run.plan.carriers!.listed.map((c) => c.name)).toEqual(["Air India Express", "IndiGo", "Akasa Air", "SpiceJet"])
    expect(run.plan.hotels).toBeNull()
    expect(by.stay!.prices[1]).toMatchObject({ bound: "from", per: "night", site: "goa-luxury-stays.example.test" })
    expect(run.plan.assumptions.some((a) => /Hotels on the stay line are as listed .* not Roma's recommendation/.test(a))).toBe(true)
    expect(checkedPlanSchema.safeParse(run.plan).success).toBe(true)
    await web.finish()
    expect(calls).toEqual(["begin:plan", "settle:8"])
  })

  it("drops a price that doesn't say what it is for, and says how many; no other price, no estimate", async () => {
    const pages: typeof PAGES = [
      ...PAGES.filter(([re]) => !/flight ticket/.test(re.source)),
      [/^flight ticket price from Delhi to Goa/, page("Goa fares", "Return flights from Delhi to Goa cost ₹6,500 per person in January.")],
    ]
    const { ctx } = setup(pages)
    const provider = pickingModel()
    const run = await runPlan(goa, { ctx, provider, records: fakeRecords() })
    const brief = JSON.parse((provider.requests[0]!.messages[0] as { text: string }).text) as Brief
    expect(brief.lines.some((l) => l.line === "transport")).toBe(false)
    expect(run.plan.lines.find((l) => l.line === "transport")).toMatchObject({
      from: "none",
      how: "No estimate: 1 price found didn't say which airline it was for, so it wasn't used.",
      pages: [expect.objectContaining({ site: "goa-fares.example.test" })],
    })
  })

  it("uses prices in the plan's currency only: a line priced only in USD has no estimate, a mixed line says what it left out, one total", async () => {
    const pages: typeof PAGES = [
      ...PAGES.filter(([re]) => !/flight ticket|daily food/.test(re.source)),
      [/^flight ticket price from Delhi to Goa/, page("Goa fares", "IndiGo return flights from Delhi to Goa cost USD 598 per person.")],
      [/daily food cost/, page("Goa food", "Street food meals in Goa cost about ₹800 per person per day. A thali at a beach shack is USD 12 per person per day.")],
    ]
    const { ctx } = setup(pages)
    const provider = pickingModel()
    const run = await runPlan(goa, { ctx, provider, records: fakeRecords() })
    const brief = JSON.parse((provider.requests[0]!.messages[0] as { text: string }).text) as { lines: { line: string; prices: { currency: string }[] }[] }
    expect(brief.lines.flatMap((l) => l.prices.map((p) => p.currency))).not.toContain("USD")
    const by = Object.fromEntries(run.plan.lines.map((l) => [l.line, l]))
    expect(by.transport).toMatchObject({ from: "none", how: "No estimate: prices found only in USD. They aren't converted." })
    expect(by.food!.amounts).toEqual([{ currency: "INR", low: "8000", high: "8000" }])
    expect(by.food!.how).toMatch(/ 1 price in USD wasn't used \(never converted\)\.$/)
    expect(run.plan.verdicts.totals.map((t) => t.currency)).toEqual(["INR"])
    expect(run.plan.assumptions).toContain("Only prices in INR are used. A line priced only in another currency has no estimate: nothing is converted, as the app has no exchange-rate source.")
  })

  it("a budget plan looks up budget hotels by name: a rate joins the stay line, a hotel without one is listed on it", async () => {
    const pages: typeof PAGES = [
      ...PAGES.filter(([re]) => !/hotel/.test(re.source)),
      [/budget hotel price per night/, page("Goa budget rooms", "Rooms in Goa cost ₹1,800 a night.")],
      [/^budget hotels in Goa with prices/, page("Goa budget hotels", "Casa Anjuna Inn charges ₹2,200 a night. Sea Shell Guest Hotel is near Calangute beach, a short walk away from the market and the bus stand.")],
    ]
    const { search, ctx } = setup(pages)
    const run = await runPlan({ ...goa, style: "budget" }, { ctx, provider: pickingModel(), records: fakeRecords() })
    expect(search.queries).toContain("budget hotels in Goa with prices per night")
    const stay = run.plan.lines.find((l) => l.line === "stay")!
    expect(stay.prices.map((p) => [p.about, p.amount])).toEqual([["Casa Anjuna Inn", "2200"]])
    expect(stay.how).toMatch(/1 price found didn't say which hotel or property it was for, so it wasn't used\.$/)
    expect(stay.mentions!.map((m) => m.name)).toEqual(["Sea Shell Guest Hotel"])
    expect(checkedPlanSchema.safeParse(run.plan).success).toBe(true)
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
    expect(run.plan.hotels).toBeNull()
    expect(run.plan.lines.every((l) => l.from === (l.line === "shopping" ? "not_estimated" : "none"))).toBe(true)
  })
})

describe("a trip plan's verdict from both signals", () => {
  const projecting = (verdict: "yes" | "no" | "too_early") => () => ({ verdict, availableByTargetMinor: 3_000_000, extraMonthlyMinor: 500_000, reachMonth: "2027-04-01" }) as unknown as GoalProjection
  const april = { from: "2026-04-01", to: "2026-04-05", days: 5, travelMinor: 6_000_000, similar: true }

  it("money fails but the plan costs no more than the past trip: Not yet, the money is the constraint", async () => {
    const { ctx } = setup()
    const run = await runPlan(goa, { ctx, provider: pickingModel(), records: fakeRecords({ project: projecting("no"), pastTrip: april }) })
    const both = run.plan.verdicts.both!
    expect(both.verdict).toBe("Not yet.")
    expect(both.summary).toBe("The money is the constraint, not the trip: the plan costs no more than your past trip did, but there isn't enough free money by January 2027.")
    expect(both.money).toEqual({ met: "no", summary: "₹30,000 is free for it by January 2027 after your other goals (planned trips included), short of the plan's at least ₹49,940." })
    expect(both.past).toEqual({ met: "yes", summary: "The plan's at least ₹49,940 is at or below your Travel spending from 2026-04-01 to 2026-04-05 (5 days): ₹60,000, as spent. Who went and where isn't known." })
    expect(run.answer).toMatch(/The plan's verdict, from both signals: Not yet\. The money is the constraint/)
    expect(checkedPlanSchema.safeParse(run.plan).success).toBe(true)
  })

  it("both fail: No, with the past trip's figure and that it isn't of similar length", async () => {
    const { ctx } = setup()
    const run = await runPlan(goa, { ctx, provider: pickingModel(), records: fakeRecords({ project: projecting("no"), pastTrip: { ...april, days: 12, travelMinor: 2_000_000, similar: false } }) })
    const both = run.plan.verdicts.both!
    expect(both.verdict).toBe("No.")
    expect(both.summary).toBe("There isn't enough free money by January 2027. The plan costs more than your past trip did.")
    expect(both.past.summary).toMatch(/is above your Travel spending from 2026-04-01 to 2026-04-05 \(12 days\): ₹20,000, as spent\. Who went and where isn't known; no past trip of similar length was found, so this is the most recent\.$/)
  })

  it("money holds: Yes, whatever the past trip", async () => {
    const { ctx } = setup()
    const run = await runPlan(goa, { ctx, provider: pickingModel(), records: fakeRecords({ project: projecting("yes"), pastTrip: { ...april, travelMinor: 2_000_000 } }) })
    expect(run.plan.verdicts.both).toMatchObject({ verdict: "Yes.", summary: "There's enough free money by January 2027. The plan costs more than your past trip did.", money: { met: "yes" }, past: { met: "no" } })
  })

  it("no past trip or no money signal: says which can't be told", async () => {
    const { ctx } = setup()
    const none = await runPlan(goa, { ctx, provider: pickingModel(), records: fakeRecords({ project: projecting("no"), pastTrip: null }) })
    expect(none.plan.verdicts.both).toMatchObject({ verdict: "No.", past: { met: "unknown", summary: "No past trip to compare with: no Travel spending in your records in the last 24 months." } })
    const unread = await runPlan(goa, { ctx: setup().ctx, provider: pickingModel(), records: fakeRecords({ project: null, pastTrip: "unreadable" }) })
    expect(unread.plan.verdicts.both).toMatchObject({ verdict: "No verdict.", money: { met: "unknown" }, past: { met: "unknown", summary: "Your past travel spending couldn't be read just now." } })
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
    expect(run.plan.verdicts.both).toBeUndefined()
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
