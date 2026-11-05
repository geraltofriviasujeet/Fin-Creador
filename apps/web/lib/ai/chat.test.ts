import { describe, expect, it } from "vitest"
import type { UserClient } from "@fin-creador/api"
import { runChat } from "./chat"
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
const context: ToolContext = { supabase, today: "2026-11-05", currency: "INR" }
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
    expect(run.result).toEqual({ kind: "unverified" })
    expect(JSON.stringify(run.result)).not.toContain("398")
  })

  it("refuses a figure stated without any tool call", async () => {
    const run = await ask(() => mockText("You spent ₹9,000 last month."))
    expect(run.result).toEqual({ kind: "unverified" })
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
})
