import { describe, expect, it } from "vitest"
import type { GoalProjection } from "@fin-creador/domain"
import type { UserClient } from "@fin-creador/api"
import type { LlmProvider, LlmRequest } from "../llm/types"
import { type SearchDb, WebSession } from "../search/session"
import type { SearchProvider, SearchResult } from "../search/types"
import { planVerdictCard, shortlistFigures } from "./format"
import { type PlanRecords, bandFor, runPlan } from "./run"
import { type PlanRequest, checkedPlanSchema } from "./types"

// A model shortlist (10.9 follow-up), run on fake listing pages, a fake model and fake records:
// two lookups with no budget figure, candidates found in code and kept to the budget, picks by
// id only, and a fit per model on the same projection.

const BIKES: SearchResult = {
  title: "Test bike prices",
  url: "https://bikes.example.test/",
  snippet: "Test data.",
  content:
    "Hero Splendor Plus Rs. 93,169 Onwards 97.2 cc, 70 kmpl commuter. TVS Radeon Rs. 70,303 109.7 cc. Royal Enfield Classic 350 Rs. 1,93,000 349 cc cruiser. " +
    "Bajaj Pulsar 150 helmet ₹1,200. Honda Shine 100 Rs. 68,000.",
}

function fakeSearch(pages: SearchResult[] = [BIKES]): SearchProvider & { queries: string[] } {
  const queries: string[] = []
  return {
    name: "fake",
    queries,
    async search(query) {
      queries.push(query)
      return pages
    },
  }
}

const db: SearchDb = { begin: async () => ({ outcome: "ok", credits: 8 }), settle: async () => true, release: async () => true }

/** Picks the ids given, or every model offered; records each brief. */
function model(pick?: (ids: string[]) => string[]): LlmProvider & { briefs: { models: { id: string; name: string }[] }[]; requests: LlmRequest[] } {
  const briefs: { models: { id: string; name: string }[] }[] = []
  const requests: LlmRequest[] = []
  return {
    name: "fake",
    model: "fake",
    briefs,
    requests,
    async complete(request) {
      requests.push(request)
      const brief = JSON.parse((request.messages[0] as { text: string }).text) as { models: { id: string; name: string }[] }
      briefs.push(brief)
      const ids = brief.models.map((m) => m.id)
      return { stop: "tool_use", text: "", toolCalls: [{ id: "t1", name: "plan_pick", input: { lines: [], carriers: [], hotels: [], models: pick ? pick(ids) : ids } }], usage: { inputTokens: 900, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
}

/** Free money of ₹1,00,000 by the month; a target fits when it is no more than that. */
function records(free = 10_000_000, overrides: Partial<PlanRecords> = {}): { targets: number[]; load: () => Promise<PlanRecords> } {
  const targets: number[] = []
  return {
    targets,
    load: async () => ({
      records: { verdict: "No verdict.", summary: "No estimate from your records: there's no bike goal to check against." },
      goal: null,
      saved: null,
      project: (t) => {
        targets.push(t)
        return { verdict: t <= free ? "yes" : "no", extraMonthlyMinor: t <= free ? null : 400_000, reachMonth: t <= free ? null : "2027-06-01", availableByTargetMinor: free } as unknown as GoalProjection
      },
      assumptions: [],
      ...overrides,
    }),
  }
}

const bike = { kind: "purchase", item: "bike", make: null, model: null, month: "2027-01", depositMinor: null, use: "commute", budgetMinor: null } satisfies PlanRequest

function setup(pages?: SearchResult[]) {
  const search = fakeSearch(pages)
  const web = new WebSession({ provider: search, db, requestId: "r1", terms: { names: [], phrases: [] }, countryCode: "IN", plan: true })
  const ctx = { supabase: {} as UserClient, today: "2026-11-09", currency: "INR", descriptionsOk: false, web }
  return { search, ctx, web }
}

describe("a model shortlist", () => {
  it("looks up by use and by band, with no amount in any query", async () => {
    const { search, ctx } = setup()
    await runPlan({ ...bike, budgetMinor: 15_000_000 }, { ctx, provider: model(), records: records().load })
    expect(search.queries).toEqual(["best city commute bikes in India January price list", "mid-range bikes price list India"])
    for (const q of search.queries) expect(q).not.toMatch(/\d|₹|rs\b|lakh/i)
  })

  it("keeps models within the budget, offers them by id, and lists only the ones picked", async () => {
    const { ctx } = setup()
    const m = model((ids) => ids.slice(0, 2))
    const run = await runPlan({ ...bike, budgetMinor: 10_000_000 }, { ctx, provider: m, records: records().load })
    // Classic 350 (₹1,93,000) is over a ₹1,00,000 budget; the helmet is no bike's price.
    expect(m.briefs[0]!.models.map((x) => x.name)).toEqual(["Hero Splendor Plus", "TVS Radeon", "Honda Shine 100"])
    expect(m.briefs[0]!.models.every((x) => /^m\d+$/.test(x.id))).toBe(true)
    const c = run.plan.candidates!
    expect(c.listed.map((x) => [x.make, x.model, x.low, x.site])).toEqual([
      ["Hero", "Splendor Plus", "93169", "bikes.example.test"],
      ["TVS", "Radeon", "70303", "bikes.example.test"],
    ])
    expect(c.budget).toEqual({ currency: "INR", minor: 10_000_000, from: "intake" })
    expect(c.note).toMatch(/^Listed on the pages found, not Roma's recommendation\./)
    expect(c.note).toMatch(/1 model was over the budget\.$/)
    expect(checkedPlanSchema.safeParse(run.plan).success).toBe(true)
    expect(run.plan.lines).toEqual([])
  })

  it("never lists an id the model made up", async () => {
    const { ctx } = setup()
    const run = await runPlan(bike, { ctx, provider: model(() => ["m9"]), records: records().load })
    expect(run.plan.candidates!.listed).toEqual([])
    expect(run.plan.candidates!.note).toBe(
      "No model on the pages found suits the main use, so none is suggested. 1 price was outside ₹30,000 to ₹15,00,000 and dropped as implausible; 1 model was over the budget.",
    )
  })

  it("checks each model's higher price on the projection and gives one verdict for the list", async () => {
    const { ctx } = setup()
    const r = records(9_000_000)
    const run = await runPlan({ ...bike, budgetMinor: 25_000_000, depositMinor: 500_000 }, { ctx, provider: model(), records: r.load })
    const fit = Object.fromEntries(run.plan.candidates!.listed.map((x) => [x.model, x.fit]))
    // ₹93,169 less a ₹5,000 trade-in: ₹88,169 fits ₹90,000 free; ₹1,93,000 doesn't.
    expect(fit["Splendor Plus"]).toEqual({ met: "yes", summary: "Fits: at your current rate its higher price of ₹93,169, less your ₹5,000 trade-in or deposit, is covered by January 2027, after your other goals." })
    expect(fit["Classic 350"]!.met).toBe("no")
    expect(fit["Classic 350"]!.summary).toMatch(/₹4,000 more a month would cover it\.$/)
    expect(r.targets).toContain(8_816_900)
    expect(run.plan.verdicts.web.verdict).toBe("Yes.")
    expect(run.plan.verdicts.web.summary).toBe("Yes. 3 of 4 models listed fit by January 2027 at each one's higher price, less your trade-in or deposit, after your other goals.")
    expect(planVerdictCard(run.plan)).toMatchObject({ status: "fits", headline: "3 of 4 models fit your current plan." })
    expect(shortlistFigures(run.plan, run.plan.candidates!)).toMatchObject({ range: "₹68,000 to ₹1,93,000", free: "₹90,000", fit: "3 of 4" })
  })

  it("works the budget out from the records when it is skipped, and says so", async () => {
    const { search, ctx } = setup()
    const run = await runPlan({ ...bike, depositMinor: 1_000_000 }, { ctx, provider: model(), records: records(8_000_000, { saved: { goal: "Bike", minor: 2_000_000 } }).load })
    // ₹80,000 free + ₹20,000 saved + ₹10,000 trade-in: ₹1,10,000, entry-level.
    expect(run.plan.candidates!.budget).toEqual({ currency: "INR", minor: 11_000_000, from: "records" })
    expect(search.queries[1]).toBe("entry-level bikes price list India")
    expect(run.plan.intake.fields.find((f) => f.label === "Budget")!.value).toBe("From your records")
  })

  it("with nothing within the budget, suggests nothing and says why", async () => {
    const { ctx } = setup()
    const m = model()
    const run = await runPlan({ ...bike, budgetMinor: 5_000_000 }, { ctx, provider: m, records: records().load })
    expect(m.requests).toHaveLength(0)
    expect(run.picked).toBe("no_candidates")
    expect(run.plan.candidates!.note).toMatch(/^No model listed on the pages found is priced within your budget of ₹50,000, so none is suggested\./)
    expect(planVerdictCard(run.plan).headline).toBe("No model could be suggested.")
  })

  it("without a month, lists models but gives no fit", async () => {
    const { ctx } = setup()
    const run = await runPlan({ ...bike, month: null, budgetMinor: 10_000_000 }, { ctx, provider: model(), records: records(0, { project: null }).load })
    expect(run.plan.candidates!.listed.every((c) => c.fit.met === "unknown" && c.fit.summary === "Not checked: the month was skipped.")).toBe(true)
    expect(run.plan.verdicts.web.verdict).toBe("No verdict.")
  })

  it("a car's implausible accessory price never reaches the list", async () => {
    const cars: SearchResult = { title: "Test car prices", url: "https://cars.example.test/", snippet: "Test data.", content: "Maruti Suzuki Swift seat covers ₹30,500. Tata Punch Rs. 5.75 - 10.77 Lakh ex-showroom." }
    const { ctx } = setup([cars])
    const run = await runPlan({ ...bike, item: "car", use: "family", budgetMinor: 120_000_000 }, { ctx, provider: model(), records: records(200_000_000).load })
    expect(run.plan.candidates!.listed.map((c) => c.model)).toEqual(["Punch"])
    expect(run.plan.candidates!.note).toMatch(/1 price was outside ₹2,00,000 to ₹2,00,00,000 and dropped as implausible\.$/)
  })
})

describe("price bands", () => {
  it("come from the budget in rupees, never another currency", () => {
    expect(bandFor("bike", 11_999_900, "INR")).toBe("entry-level")
    expect(bandFor("bike", 12_000_000, "INR")).toBe("mid-range")
    expect(bandFor("car", 200_000_000, "INR")).toBe("premium")
    expect(bandFor("car", 200_000_000, "USD")).toBeNull()
    expect(bandFor("car", null, "INR")).toBeNull()
  })
})
