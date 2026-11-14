import { describe, expect, it } from "vitest"
import type { UserClient } from "@fin-creador/api"
import type { ChatRun } from "./chat"
import type { LlmConfig } from "./config"
import { type BeginOutcome, type ChatDeps, type RomaDb, type RomaHistory, type TurnToRecord, handleChat } from "./handle"
import { MAX_TURNS, type StoredTurn } from "./history"
import { mockProvider } from "./llm/mock"
import { LlmError, type LlmProvider, NO_USAGE } from "./llm/types"
import { runPlan } from "./plan/run"
import { mockSearchProvider } from "./search/mock"

// The request flow with a fake ledger: what is reserved, settled and released. Mock provider only.

type Ledger = { begun: number; settled: { id: string; inputTokens: number; outputTokens: number; costUsd: number }[]; released: string[] }

function fakeDb(outcome: BeginOutcome = "ok"): RomaDb & { ledger: Ledger } {
  const ledger: Ledger = { begun: 0, settled: [], released: [] }
  return {
    ledger,
    async begin() {
      ledger.begun++
      return { outcome, requestId: outcome === "ok" ? "req-1" : null }
    },
    async settle(id, inputTokens, outputTokens, costUsd) {
      ledger.settled.push({ id, inputTokens, outputTokens, costUsd })
      return true
    },
    async release(id) {
      ledger.released.push(id)
      return true
    },
  }
}

// Fake conversation store: turns by conversation, what was recorded, and a failure switch.
const CONV = "c0000000-0000-4000-8000-000000000001"

function fakeHistory(stored: Record<string, StoredTurn[]> = {}, failRecords = 0): RomaHistory & { recorded: TurnToRecord[]; loads: string[] } {
  const recorded: TurnToRecord[] = []
  const loads: string[] = []
  let failures = failRecords
  return {
    recorded,
    loads,
    async load(id) {
      loads.push(id)
      return stored[id] ?? "missing"
    },
    async record(turn) {
      recorded.push(turn)
      if (failures-- > 0) return null
      return { conversationId: turn.conversationId ?? "c0000000-0000-4000-8000-0000000000ff", seq: (stored[turn.conversationId ?? ""]?.length ?? 0) + 1 }
    },
  }
}

const storedTurn = (seq: number, over: Partial<StoredTurn> = {}): StoredTurn => ({
  seq,
  question: `Question ${seq}`,
  answer: `Answer ${seq}`,
  asOf: "2026-11-04",
  periods: [{ start: "2026-10-01", end: "2026-10-31" }],
  tools: ["spending_for_period"],
  sentDescriptions: false,
  ...over,
})

const supabase = {
  rpc: async () => ({
    data: [{ currency: "INR", income_minor: 0, expense_minor: 50000, refund_minor: 0, income_count: 0, expense_count: 2, refund_count: 0, transfer_count: 0 }],
    error: null,
  }),
} as unknown as UserClient
const mockOn: LlmConfig = { status: "on", provider: "mock", model: "mock", apiKey: null }
const haikuOn: LlmConfig = { status: "on", provider: "anthropic", model: "claude-haiku-5-5", apiKey: "test-key-not-real" }

function deps(over: Partial<ChatDeps> = {}): ChatDeps & { db: ReturnType<typeof fakeDb>; history: ReturnType<typeof fakeHistory> } {
  return {
    signedIn: true,
    config: mockOn,
    db: fakeDb(),
    history: fakeHistory(),
    makeProvider: () => mockProvider(),
    loadContext: async () => ({ supabase, today: "2026-11-05", currency: "INR", descriptionsOk: false }),
    ...over,
  } as ChatDeps & { db: ReturnType<typeof fakeDb>; history: ReturnType<typeof fakeHistory> }
}

const ask = { question: "What did I spend this month?" }

describe("POST /api/ai/chat flow", () => {
  it("answers 401 to a signed-out caller and reserves nothing", async () => {
    const d = deps({ signedIn: false })
    expect(await handleChat(ask, d)).toMatchObject({ status: 401, body: { status: "error", code: "signed_out" } })
    expect(d.db.ledger.begun).toBe(0)
  })

  it("reserves nothing when Roma is off or the question is invalid", async () => {
    const off = deps({ config: { status: "off", reason: "not_enabled" } })
    expect((await handleChat(ask, off)).status).toBe(503)
    for (const body of [null, {}, { question: "  " }, { question: "x".repeat(501) }, { question: 42 }]) {
      const d = deps()
      expect(await handleChat(body, d)).toMatchObject({ status: 400, body: { code: "invalid" } })
      expect(d.db.ledger.begun).toBe(0)
    }
  })

  it.each([
    ["disabled", 503, "off"],
    ["not_enabled", 403, "not_enabled"],
    ["global_budget", 503, "global_budget"],
    ["user_budget", 429, "user_budget"],
    ["daily_limit", 429, "daily_limit"],
  ] as const)("a %s refusal from the database is passed on, with nothing to settle or release", async (outcome, status, code) => {
    const d = deps({ db: fakeDb(outcome) })
    expect(await handleChat(ask, d)).toMatchObject({ status, body: { code } })
    expect(d.db.ledger).toEqual({ begun: 1, settled: [], released: [] })
  })

  it("answers and settles a real call with its cost", async () => {
    const d = deps()
    const res = await handleChat(ask, d)
    expect(res).toMatchObject({
      status: 200,
      body: {
        status: "answer",
        figures: [{ label: "Spent", value: "₹500" }, { label: "Expenses", value: "2" }],
        periods: [{ from: "2026-11-01", to: "2026-11-05" }],
        basis: { records: true, knowledge: false },
      },
    })
    expect(d.db.ledger.settled).toEqual([{ id: "req-1", inputTokens: 0, outputTokens: 0, costUsd: 0 }])
    expect(d.db.ledger.released).toEqual([])
  })

  it("settles Haiku usage at its price", async () => {
    const run: ChatRun = {
      result: { kind: "answer", text: "I can't see that yet.", figures: [], periods: [], descriptionsWithheld: false, toolsRan: [], descriptionsSent: false, checks: [] },
      calls: 2,
      usage: { inputTokens: 3000, outputTokens: 600, cacheReadTokens: 1000, cacheWriteTokens: 0 },
      unknownCalls: 0,
    }
    const d = deps({ config: haikuOn, run: async () => run })
    await handleChat(ask, d)
    expect(d.db.ledger.settled).toEqual([{ id: "req-1", inputTokens: 4000, outputTokens: 600, costUsd: 0.00061 }])
  })

  it("releases the reservation when building the provider fails: no call was made", async () => {
    const d = deps({ makeProvider: () => { throw new Error("no provider") } })
    expect(await handleChat(ask, d)).toMatchObject({ status: 502, body: { code: "unavailable" } })
    expect(d.db.ledger).toEqual({ begun: 1, settled: [], released: ["req-1"] })
  })

  it("releases the reservation when the person's context can't be loaded", async () => {
    const d = deps({ loadContext: async () => null })
    await handleChat(ask, d)
    expect(d.db.ledger.released).toEqual(["req-1"])
    expect(d.db.ledger.settled).toEqual([])
  })

  it("releases the reservation when the loop sent nothing", async () => {
    const d = deps({ run: async () => ({ result: { kind: "failed", reason: "timeout" }, calls: 0, usage: NO_USAGE, unknownCalls: 0 }) })
    expect((await handleChat(ask, d)).status).toBe(504)
    expect(d.db.ledger.released).toEqual(["req-1"])
  })

  it("settles a call cut off at the deadline at a worst-case cost", async () => {
    const d = deps({ config: haikuOn, run: async () => ({ result: { kind: "failed", reason: "timeout" }, calls: 1, usage: NO_USAGE, unknownCalls: 1 }) })
    await handleChat(ask, d)
    expect(d.db.ledger.settled).toEqual([{ id: "req-1", inputTokens: 0, outputTokens: 0, costUsd: 0.0022 }])
  })

  it("settles, not releases, when an unverified answer is refused: the call was made", async () => {
    const d = deps({ run: async () => ({ result: { kind: "unverified", unmatched: ["398"] }, calls: 2, usage: NO_USAGE, unknownCalls: 0 }) })
    const res = await handleChat(ask, d)
    expect(res).toMatchObject({
      status: 422,
      body: {
        code: "unverified",
        message:
          "Roma's answer used 398, which she couldn't match to a figure from your records, so it isn't shown. Ask about one thing at a time and name the period, account, goal or trip details you mean.",
      },
    })
    expect(res.body).not.toHaveProperty("answer")
    expect(d.db.ledger.settled).toHaveLength(1)
    expect(d.db.ledger.released).toEqual([])
  })

  it("reports the unmatched numbers to the server diagnostic only, and names at most three to the person", async () => {
    const seen: (readonly string[])[] = []
    const d = deps({
      run: async () => ({ result: { kind: "unverified", unmatched: ["1", "2", "3", "4"] }, calls: 1, usage: NO_USAGE, unknownCalls: 0 }),
      onUnverified: (n) => seen.push(n),
    })
    const res = await handleChat(ask, d)
    expect(seen).toEqual([["1", "2", "3", "4"]])
    expect(res.body).toMatchObject({ message: expect.stringMatching(/^Roma's answer used 1, 2 and 3 and others, which she couldn't match/) })
  })

  it("falls back to the general message when no number is known", async () => {
    const d = deps({ run: async () => ({ result: { kind: "unverified", unmatched: [] }, calls: 1, usage: NO_USAGE, unknownCalls: 0 }) })
    expect((await handleChat(ask, d)).body).toMatchObject({ message: expect.stringContaining("Ask about one thing at a time") })
  })

  it("charges the worst case when the loop fails unexpectedly mid-way", async () => {
    const d = deps({ config: haikuOn, run: async () => { throw new Error("bug") } })
    expect((await handleChat(ask, d)).status).toBe(502)
    expect(d.db.ledger.settled).toEqual([{ id: "req-1", inputTokens: 0, outputTokens: 0, costUsd: 0.0088 }])
  })

  it("answers 502 without a reservation when the ledger can't be reached", async () => {
    const d = deps({ db: { ...fakeDb(), begin: async () => null } })
    expect((await handleChat(ask, d)).status).toBe(502)
  })

  it("formats rates and carries the descriptions notice when a search left them out (10.2)", async () => {
    const run: ChatRun = {
      result: {
        kind: "answer",
        text: "Your savings rate is 23.5%.",
        figures: [{ label: "Savings rate", kind: "percent", bps: 2350 }],
        periods: [],
        descriptionsWithheld: true,
        toolsRan: ["savings_rate"],
        descriptionsSent: false,
        checks: [],
      },
      calls: 2,
      usage: NO_USAGE,
      unknownCalls: 0,
    }
    const res = await handleChat(ask, deps({ run: async () => run }))
    expect(res).toMatchObject({ status: 200, body: { status: "answer", figures: [{ label: "Savings rate", value: "23.5%" }], descriptionsNotice: true } })
    const plain = await handleChat(ask, deps({ run: async () => ({ ...run, result: { ...run.result, descriptionsWithheld: false } as ChatRun["result"] }) }))
    expect(plain.body).not.toHaveProperty("descriptionsNotice")
  })

  describe("conversations (10.3)", () => {
    it("records an answered question as the first turn of a new conversation", async () => {
      const d = deps()
      const res = await handleChat(ask, d)
      expect(res.body).toMatchObject({ status: "answer", conversationId: "c0000000-0000-4000-8000-0000000000ff", saved: true })
      expect(d.history.recorded).toEqual([
        {
          requestId: "req-1",
          conversationId: null,
          question: "What did I spend this month?",
          answer: expect.stringContaining("You spent ₹500"),
          asOf: "2026-11-05",
          periods: [{ start: "2026-11-01", end: "2026-11-05" }],
          tools: ["spending_for_period"],
          sentDescriptions: false,
        },
      ])
    })

    it("sends the stored turns with a follow-up and records it in the same conversation", async () => {
      let seen: Parameters<NonNullable<ChatDeps["run"]>>[0] | undefined
      const d = deps({
        history: fakeHistory({ [CONV]: [1, 2, 3, 4].map((n) => storedTurn(n)) }),
        run: async (options) => {
          seen = options
          return {
            result: { kind: "answer", text: "I can't see that yet.", figures: [], periods: [], descriptionsWithheld: false, toolsRan: [], descriptionsSent: false, checks: [] },
            calls: 1,
            usage: NO_USAGE,
            unknownCalls: 0,
          }
        },
      })
      const res = await handleChat({ ...ask, conversationId: CONV }, d)
      expect(res.body).toMatchObject({ conversationId: CONV, saved: true })
      expect(seen?.history?.recent.map((t) => t.question)).toEqual(["Question 2", "Question 3", "Question 4"])
      expect(seen?.history?.summary).toContain('Turn 1 (asked on 2026-11-04): "Question 1"')
      expect(d.history.recorded[0]?.conversationId).toBe(CONV)
    })

    it("refuses a conversation that isn't the person's, before reserving anything", async () => {
      const d = deps()
      expect(await handleChat({ ...ask, conversationId: CONV }, d)).toMatchObject({ status: 404, body: { code: "conversation_missing" } })
      expect(d.db.ledger.begun).toBe(0)
    })

    it("answers 502 without a reservation when the turns can't be read", async () => {
      const d = deps({ history: { ...fakeHistory(), load: async () => null } })
      expect(await handleChat({ ...ask, conversationId: CONV }, d)).toMatchObject({ status: 502, body: { code: "unavailable" } })
      expect(d.db.ledger.begun).toBe(0)
    })

    it("refuses a conversation id that isn't a UUID", async () => {
      const d = deps()
      expect(await handleChat({ ...ask, conversationId: "1; drop" }, d)).toMatchObject({ status: 400, body: { code: "invalid" } })
      expect(d.history.loads).toEqual([])
    })

    it("carries a full conversation on in a new one", async () => {
      const d = deps({ history: fakeHistory({ [CONV]: Array.from({ length: MAX_TURNS }, (_, i) => storedTurn(i + 1)) }) })
      await handleChat({ ...ask, conversationId: CONV }, d)
      expect(d.history.recorded[0]?.conversationId).toBeNull()
    })

    it("retries a failed recording once with the same request id, then still shows the answer", async () => {
      const once = deps({ history: fakeHistory({}, 1) })
      expect((await handleChat(ask, once)).body).toMatchObject({ status: "answer", saved: true })
      expect(once.history.recorded.map((t) => t.requestId)).toEqual(["req-1", "req-1"])

      const twice = deps({ history: fakeHistory({}, 2) })
      expect((await handleChat(ask, twice)).body).toMatchObject({ status: "answer", saved: false, conversationId: null })
      expect(twice.history.recorded).toHaveLength(2)

      const throwing = deps({ history: { ...fakeHistory(), record: async () => { throw new Error("network") } } })
      expect((await handleChat(ask, throwing)).body).toMatchObject({ status: "answer", saved: false })
    })

    it("stores nothing for a refused answer", async () => {
      const d = deps({ run: async () => ({ result: { kind: "unverified", unmatched: [] }, calls: 2, usage: NO_USAGE, unknownCalls: 0 }) })
      await handleChat(ask, d)
      expect(d.history.recorded).toEqual([])
    })
  })
})

describe("web lookups spent on a question with no answer shown (10.8)", () => {
  const search: NonNullable<ChatDeps["search"]> = {
    db: { begin: async () => ({ outcome: "ok", credits: 3 }), settle: async () => true, release: async () => true },
    makeProvider: () => mockSearchProvider(() => [{ title: "Test data", url: "https://hotels.example.test/goa", snippet: "Test data. Rooms ₹4,500 a night." }]),
    loadTerms: async () => ({ terms: { names: [], phrases: [] }, countryCode: "IN" }),
  }
  const lookupThen = (result: ChatRun["result"]): ChatDeps["run"] => async (options) => {
    await options.context.web!.lookup({ kind: "trip", destination: "Goa", month: "2027-01", nights: 4, travellers: 2, cost_line: "stay" }, new AbortController().signal)
    return { result, calls: 2, usage: NO_USAGE, unknownCalls: 0 }
  }

  it("says the lookup was used when the answer is refused", async () => {
    const res = await handleChat(ask, deps({ search, run: lookupThen({ kind: "unverified", unmatched: ["7350"] }) }))
    expect(res.body).toMatchObject({ code: "unverified" })
    expect(res.body.status === "error" && res.body.message).toMatch(/ 1 web lookup ran for this question and counts toward your allowance\.$/)
  })

  it("says nothing about lookups when none ran", async () => {
    const res = await handleChat(ask, deps({ search, run: async () => ({ result: { kind: "failed", reason: "rejected" }, calls: 1, usage: NO_USAGE, unknownCalls: 0 }) }))
    expect(res.body).toMatchObject({ code: "unavailable", message: "Roma couldn't answer just now. Try again in a moment." })
  })
})

describe("detailed plans (10.9)", () => {
  const ledger: string[] = []
  const search: NonNullable<ChatDeps["search"]> = {
    db: {
      begin: async (_r, _p, plan) => (ledger.push(`begin:${plan ? "plan" : "question"}`), { outcome: "ok", credits: 8 }),
      settle: async (_r, credits) => (ledger.push(`settle:${credits}`), true),
      release: async () => (ledger.push("release"), true),
    },
    // A rate with the hotel it is for: a price without one isn't offered to the model (10.9).
    makeProvider: () => mockSearchProvider(() => [{ title: "Test data", url: "https://hotels.example.test/goa", snippet: "Test data. Rooms at the Sea Breeze Hotel are ₹4,500 a night." }]),
    loadTerms: async () => ({ terms: { names: [], phrases: [] }, countryCode: "IN" }),
  }
  const records = async () => ({ records: { verdict: "Too early to say.", summary: "Too early to say. Test records." }, goal: null, saved: null, project: null, assumptions: [] })
  const hanging: LlmProvider = {
    name: "mock",
    model: "mock",
    complete: (_r, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new LlmError("timeout", "unknown", "cut off")))),
  }
  const goa = { kind: "trip", destination: "Goa", origin: "Delhi", month: "2027-01", nights: 4, travellers: 2, style: "comfort" } as const

  it("answers a plan when the model's round hangs: the plan comes back, is stored, and the lookups' credits are settled", async () => {
    ledger.length = 0
    const d = deps({
      search,
      config: haikuOn,
      makeProvider: () => hanging,
      runPlan: (r, ctx, provider) => runPlan(r, { ctx, provider, records, deadlineMs: 2_600 }),
    })
    const res = await handleChat({ question: "Plan my trip to Goa", plan: goa }, d)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: "answer", saved: true, plan: { kind: "trip", verdicts: { records: { verdict: "Too early to say." } } } })
    expect(ledger).toEqual(["begin:plan", "settle:8"])
    // The model call may have been sent: charged at the worst case for one call, never released.
    expect(d.db.ledger.settled).toHaveLength(1)
    expect(d.db.ledger.settled[0]!.costUsd).toBeGreaterThan(0)
    expect(d.history.recorded[0]).toMatchObject({ tools: ["trip_plan"], periods: [], plan: { v: 1, kind: "trip" } })
    expect(res.body.status === "answer" && res.body.answer).toMatch(/^Plan: trip from Delhi to Goa in January 2027\. 0 of 6 cost lines have an estimate\./)
  })

  it("saves a plan that made no model call (nothing to pick): the request is settled at nothing, never released", async () => {
    const d = deps({ runPlan: (r, ctx, provider) => runPlan(r, { ctx, provider, records }) })
    const res = await handleChat({ question: "Plan my trip", plan: { ...goa, destination: null } }, d)
    expect(res.body).toMatchObject({ status: "answer", saved: true })
    expect(d.db.ledger.released).toEqual([])
    expect(d.db.ledger.settled).toEqual([{ id: "req-1", inputTokens: 0, outputTokens: 0, costUsd: 0 }])
  })

  it("refuses a plan request with a field it doesn't know", async () => {
    const res = await handleChat({ question: "Plan my trip", plan: { ...goa, budget: 5 } }, deps({ search }))
    expect(res.body).toMatchObject({ code: "invalid" })
  })
})

describe("knowledge base routing (10.6c)", () => {
  const passageRow = {
    chunk_id: "00000000-0000-4000-8000-000000000001",
    document_slug: "sip-explained",
    title: "What an SIP is and how it works",
    content_kind: "own",
    publisher: "FinCreador",
    based_on_publisher: "AMFI",
    source_url: null,
    read_more_url: null,
    link_permission_pending: true,
    financial_year: null,
    content: "An SIP invests a fixed amount at regular intervals.",
    similarity: 0.9,
  }
  function knowledge(rows = [passageRow]) {
    const embedded: { requestId: string; text: string }[] = []
    return {
      embedded,
      knowledge: {
        db: { match: async () => rows },
        minSimilarity: 0.8,
        makeEmbedder: (requestId: string) => async (text: string) => {
          embedded.push({ requestId, text })
          return Array(384).fill(0)
        },
      },
    }
  }
  const offered = (seen: string[][]) => (req: { tools: { name: string }[] }) => seen.push(req.tools.map((t) => t.name))

  it("gives a general question knowledge_search alone, embeds under the question's reservation, and returns the citations", async () => {
    const seen: string[][] = []
    const k = knowledge()
    const base = mockProvider()
    const d = deps({ ...k, makeProvider: () => ({ ...base, complete: (req, signal) => (offered(seen)(req), base.complete(req, signal)) }) })
    const res = await handleChat({ question: "What is an SIP?" }, d)
    expect(seen[0]).toEqual(["knowledge_search"])
    expect(k.embedded).toEqual([{ requestId: "req-1", text: "What is an SIP?" }])
    expect(res.body).toMatchObject({
      status: "answer",
      answer: "An SIP invests a fixed amount at regular intervals. [1] (Test answer.)\n\nGeneral information, not personal advice.",
      citations: [{ n: 1, title: "What an SIP is and how it works", source: "FinCreador explainer, based on AMFI", passage: "An SIP invests a fixed amount at regular intervals." }],
      basis: { records: false, knowledge: true },
    })
    expect(d.history.recorded[0]?.tools).toEqual(["knowledge_search"])
  })

  it("keeps the records tools only for the person's own money, offers no tools for small talk, and everything when both", async () => {
    const seen: string[][] = []
    const base = mockProvider()
    const d = () => deps({ ...knowledge(), makeProvider: () => ({ ...base, complete: (req, signal) => (offered(seen)(req), base.complete(req, signal)) }) })
    await handleChat({ question: "What did I spend this month?" }, d())
    await handleChat({ question: "hello" }, d())
    await handleChat({ question: "Is my savings rate good?" }, d())
    expect(seen[0]).not.toContain("knowledge_search")
    expect(seen[0]).toContain("spending_for_period")
    expect(seen.find((t) => t.length === 0)).toEqual([])
    expect(seen.at(-1)).toEqual(expect.arrayContaining(["spending_for_period", "savings_rate", "knowledge_search"]))
  })

  it("routes every question to the records when the knowledge base is off", async () => {
    const seen: string[][] = []
    const base = mockProvider()
    await handleChat({ question: "What is an SIP?" }, deps({ makeProvider: () => ({ ...base, complete: (req, signal) => (offered(seen)(req), base.complete(req, signal)) }) }))
    expect(seen[0]).toContain("spending_for_period")
    expect(seen[0]).not.toContain("knowledge_search")
  })

  it("says there is no vetted material when nothing is above the floor", async () => {
    const res = await handleChat({ question: "What is crypto staking?" }, deps(knowledge([])))
    expect(res.body).toMatchObject({ status: "answer", answer: "I don't have vetted material on this, so I won't answer it from general knowledge." })
    expect(JSON.stringify(res.body)).not.toContain("50,00,000")
  })
})
