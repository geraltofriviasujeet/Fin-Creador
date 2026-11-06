import { describe, expect, it } from "vitest"
import type { UserClient } from "@fin-creador/api"
import { runChat } from "./chat"
import { buildHistory } from "./history"
import { type MockScript, mockProvider, mockText, mockToolCall } from "./llm/mock"
import { LlmError, type LlmProvider } from "./llm/types"
import { spendingTool } from "./tools/spending"
import type { FinanceTool, ToolContext } from "./tools/types"

// The chat loop on the mock provider only: no test calls a paid API.

const supabase = {
  rpc: async () => ({
    data: [{ currency: "INR", income_minor: 0, expense_minor: 1234550, refund_minor: 0, income_count: 0, expense_count: 17, refund_count: 0, transfer_count: 0 }],
    error: null,
  }),
} as unknown as UserClient
const context: ToolContext = { supabase, today: "2026-11-05", currency: "INR", descriptionsOk: false }
const tools = [spendingTool as FinanceTool]
const ask = (script: MockScript, extra: Partial<Parameters<typeof runChat>[0]> = {}) =>
  runChat({ provider: mockProvider(script), tools, context, question: "What did I spend last month?", ...extra })

describe("Roma's chat loop", () => {
  it("calls the tool, then shows an answer whose numbers all match the tool result", async () => {
    const run = await runChat({ provider: mockProvider(), tools, context, question: "What did I spend last month?" })
    expect(run.result).toMatchObject({
      kind: "answer",
      text: "You spent ₹12,345.50 from 2026-10-01 to 2026-10-31, across 17 expenses. (Test answer.)",
      periods: [{ start: "2026-10-01", end: "2026-10-31" }],
    })
    expect(run.calls).toBe(2)
  })

  it("sends the persona prompt, today's context and the tool definition", async () => {
    let seen: Parameters<MockScript>[0] | undefined
    await ask((req) => {
      seen = req
      return mockText("I can't see that yet.")
    })
    expect(seen?.system[0]).toContain("You are Roma")
    expect(seen?.system[1]).toBe("Today is 2026-11-05 in the person's own time zone. Their currency is INR.")
    expect(seen?.tools.map((t) => t.name)).toEqual(["spending_for_period"])
    expect(seen?.tools[0]?.inputSchema).toMatchObject({ type: "object", additionalProperties: false })
  })

  it("refuses the answer when a number can't be verified, and never shows it", async () => {
    const run = await ask((_req, round) =>
      round === 0 ? mockToolCall("spending_for_period", { period: "last_month" }) : mockText("You spent ₹12,345.50, or about ₹398 a day."),
    )
    // Only the number that failed is carried (for the server diagnostic), never the answer text.
    expect(run.result).toEqual({ kind: "unverified", unmatched: ["398"] })
    expect(JSON.stringify(run.result)).not.toContain("a day")
  })

  it("refuses a figure stated without any tool call", async () => {
    const run = await ask(() => mockText("You spent ₹9,000 last month."))
    expect(run.result).toEqual({ kind: "unverified", unmatched: ["9000"] })
  })

  it("refuses a praise opener", async () => {
    const run = await ask(() => mockText("Great question! I can't see that yet."))
    expect(run.result).toEqual({ kind: "tone" })
  })

  it("stops after four rounds", async () => {
    const run = await ask(() => mockToolCall("spending_for_period", { period: "last_month" }))
    expect(run.result).toEqual({ kind: "failed", reason: "rounds" })
    expect(run.calls).toBe(4)
  })

  it("stops at the deadline and counts a cut-off call as possibly billed", async () => {
    const slow: LlmProvider = {
      name: "mock",
      model: "mock",
      complete: (_req, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new LlmError("timeout", "unknown", "stopped")))
        }),
    }
    const run = await runChat({ provider: slow, tools, context, question: "What did I spend?", deadlineMs: 20 })
    expect(run.result).toEqual({ kind: "failed", reason: "timeout" })
    expect(run).toMatchObject({ calls: 1, unknownCalls: 1 })
  })

  it("gives the model a plain error for bad tool input or an unknown tool, never running it", async () => {
    let lastResult = ""
    await ask((req, round) => {
      const last = req.messages.at(-1)
      if (last?.role === "tool_results") lastResult = last.results.map((r) => `${r.isError}:${r.content}`).join("|")
      if (round === 0) return { ...mockToolCall("spending_for_period", { period: "forever" }), toolCalls: [
        { id: "a", name: "spending_for_period", input: { period: "forever" } },
        { id: "b", name: "run_sql", input: { sql: "select 1" } },
      ] }
      return mockText("I couldn't load that.")
    })
    expect(lastResult).toContain("true:")
    expect(lastResult).toContain("Invalid input")
    expect(lastResult).toContain("There is no tool called run_sql.")
  })

  it("reports a provider refusal and a provider error", async () => {
    expect((await ask(() => ({ ...mockText(""), stop: "refusal" }))).result).toEqual({ kind: "failed", reason: "refusal" })
    const failing: LlmProvider = { name: "mock", model: "mock", complete: async () => { throw new LlmError("rate_limited", "no", "429") } }
    const run = await runChat({ provider: failing, tools, context, question: "?" })
    expect(run).toMatchObject({ result: { kind: "failed", reason: "rate_limited" }, calls: 1, unknownCalls: 0 })
  })

  it("lets an answer quote a found entry's date, and reports descriptions left out (10.2)", async () => {
    const finder: FinanceTool = {
      name: "search_transactions",
      description: "test",
      input: spendingTool.input,
      run: async () => ({
        data: { entries: [{ date: "2026-10-17", amount: "₹450" }] },
        figures: [{ label: "2026-10-17 · Food", kind: "money", minor: 45000, currency: "INR" }],
        dates: ["2026-10-17"],
        descriptionsWithheld: true,
      }),
    }
    const run = await runChat({
      provider: mockProvider((_req, round) => (round === 0 ? mockToolCall("search_transactions", { period: "last_month" }) : mockText("You paid ₹450 on 2026-10-17."))),
      tools: [finder],
      context,
      question: "When did I last order food?",
    })
    expect(run.result).toMatchObject({ kind: "answer", text: "You paid ₹450 on 2026-10-17.", descriptionsWithheld: true })
  })

  describe("with conversation history (10.3)", () => {
    const history = buildHistory(
      [
        { seq: 1, question: "What did I spend in September?", answer: "You spent ₹38,500 in September.", asOf: "2026-11-01", periods: [{ start: "2026-09-01", end: "2026-09-30" }], tools: ["spending_for_period"], sentDescriptions: false },
        { seq: 2, question: "And in October?", answer: "You spent ₹42,000 in October.", asOf: "2026-11-01", periods: [{ start: "2026-10-01", end: "2026-10-31" }], tools: ["spending_for_period"], sentDescriptions: false },
        { seq: 3, question: "Thanks", answer: "Ask again any time.", asOf: "2026-11-01", periods: [], tools: [], sentDescriptions: false },
        { seq: 4, question: "Was October higher?", answer: "I can't see that yet.", asOf: "2026-11-01", periods: [], tools: [], sentDescriptions: false },
      ],
      false,
    )

    it("never takes a figure from history: one quoted from an earlier answer is refused", async () => {
      const run = await ask(() => mockText("You spent ₹42,000 in October."), { history })
      expect(run.result).toEqual({ kind: "unverified", unmatched: ["42000"] })
    })

    it("never takes a figure from history: one beside a fresh tool figure is still refused", async () => {
      const run = await ask(
        (_req, round) =>
          round === 0 ? mockToolCall("spending_for_period", { period: "last_month" }) : mockText("You spent ₹12,345.50 last month, against ₹38,500 in September."),
        { history },
      )
      expect(run.result).toEqual({ kind: "unverified", unmatched: ["38500"] })
    })

    it("accepts the same follow-up once the figure comes from this question's tool call", async () => {
      const run = await ask(
        (_req, round) => (round === 0 ? mockToolCall("spending_for_period", { period: "last_month" }) : mockText("You spent ₹12,345.50 last month.")),
        { history },
      )
      expect(run.result).toMatchObject({ kind: "answer", text: "You spent ₹12,345.50 last month.", toolsRan: ["spending_for_period"], descriptionsSent: false })
    })

    it("sends recent turns as plain text and the summary as a third system block, unchanged between rounds", async () => {
      const seen: Parameters<MockScript>[0][] = []
      await ask(
        (req, round) => {
          seen.push(structuredClone(req))
          return round === 0 ? mockToolCall("spending_for_period", { period: "last_month" }) : mockText("You spent ₹12,345.50 last month.")
        },
        { history, question: "And last month?" },
      )
      const [first, second] = seen
      expect(first?.system).toHaveLength(3)
      expect(first?.system[2]).toContain('Turn 1 (asked on 2026-11-01): "What did I spend in September?" (tools: spending_for_period; periods: 2026-09-01 to 2026-09-30)')
      expect(first?.system[2]).not.toContain("38,500")
      expect(first?.messages).toEqual([
        { role: "user", text: "And in October?" },
        { role: "assistant", text: "You spent ₹42,000 in October.", toolCalls: [] },
        { role: "user", text: "Thanks" },
        { role: "assistant", text: "Ask again any time.", toolCalls: [] },
        { role: "user", text: "Was October higher?" },
        { role: "assistant", text: "I can't see that yet.", toolCalls: [] },
        { role: "user", text: "And last month?" },
      ])
      // Append-only within a question: the second round starts with exactly what the first sent.
      expect(second?.system).toEqual(first?.system)
      expect(second?.messages.slice(0, first?.messages.length)).toEqual(first?.messages)
    })
  })
})
