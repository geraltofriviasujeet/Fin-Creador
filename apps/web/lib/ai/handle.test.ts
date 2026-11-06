import { describe, expect, it } from "vitest"
import type { UserClient } from "@fin-creador/api"
import type { ChatRun } from "./chat"
import type { LlmConfig } from "./config"
import { type BeginOutcome, type ChatDeps, type RomaDb, handleChat } from "./handle"
import { mockProvider } from "./llm/mock"
import { NO_USAGE } from "./llm/types"

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

const supabase = {
  rpc: async () => ({
    data: [{ currency: "INR", income_minor: 0, expense_minor: 50000, refund_minor: 0, income_count: 0, expense_count: 2, refund_count: 0, transfer_count: 0 }],
    error: null,
  }),
} as unknown as UserClient
const mockOn: LlmConfig = { status: "on", provider: "mock", model: "mock", apiKey: null }
const haikuOn: LlmConfig = { status: "on", provider: "anthropic", model: "claude-haiku-5-5", apiKey: "test-key-not-real" }

function deps(over: Partial<ChatDeps> = {}): ChatDeps & { db: ReturnType<typeof fakeDb> } {
  return {
    signedIn: true,
    config: mockOn,
    db: fakeDb(),
    makeProvider: () => mockProvider(),
    loadContext: async () => ({ supabase, today: "2026-11-05", currency: "INR" }),
    ...over,
  } as ChatDeps & { db: ReturnType<typeof fakeDb> }
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
      body: { status: "answer", figures: [{ label: "Spent", value: "₹500" }, { label: "Expenses", value: "2" }], periods: [{ from: "2026-11-01", to: "2026-11-05" }] },
    })
    expect(d.db.ledger.settled).toEqual([{ id: "req-1", inputTokens: 0, outputTokens: 0, costUsd: 0 }])
    expect(d.db.ledger.released).toEqual([])
  })

  it("settles Haiku usage at its price", async () => {
    const run: ChatRun = {
      result: { kind: "answer", text: "I can't see that yet.", figures: [], periods: [] },
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
    const d = deps({ run: async () => ({ result: { kind: "unverified" }, calls: 2, usage: NO_USAGE, unknownCalls: 0 }) })
    const res = await handleChat(ask, d)
    expect(res).toMatchObject({ status: 422, body: { code: "unverified", message: expect.stringContaining("couldn't check a number") } })
    expect(res.body).not.toHaveProperty("answer")
    expect(d.db.ledger.settled).toHaveLength(1)
    expect(d.db.ledger.released).toEqual([])
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
})
