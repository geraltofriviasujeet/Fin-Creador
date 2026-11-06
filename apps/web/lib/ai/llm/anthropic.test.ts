import { describe, expect, it } from "vitest"
import { anthropicProvider } from "./anthropic"
import { LlmError, type LlmRequest } from "./types"

// The Anthropic adapter against recorded responses through the SDK's fetch option: no network,
// no real key, nothing billed.

type Sent = { url: string; body: Record<string, unknown>; headers: Headers }

function recorded(responses: { status: number; body: unknown; headers?: Record<string, string> }[]) {
  const sent: Sent[] = []
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")), headers: new Headers(init?.headers) })
    const next = responses.shift()
    if (!next) throw new Error("No recorded response left")
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json", ...next.headers } })
  }) as typeof globalThis.fetch
  return { fetch, sent }
}

const message = (content: unknown[], stop_reason: string, usage = { input_tokens: 1200, output_tokens: 80 }) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-haiku-5-5",
  content,
  stop_reason,
  stop_sequence: null,
  usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 300, ...usage },
})

const request: LlmRequest = {
  system: ["You are Roma.", "Today is 2026-11-05."],
  messages: [{ role: "user", text: "What did I spend last month?" }],
  tools: [{ name: "spending_for_period", description: "Spending.", inputSchema: { type: "object", properties: {} } }],
  maxOutputTokens: 1200,
}

describe("Anthropic adapter", () => {
  it("sends the model, system blocks, tools and low effort, and maps a tool call and usage", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-1" }
    const toolUse = { type: "tool_use", id: "toolu_1", name: "spending_for_period", input: { period: "last_month" } }
    const { fetch, sent } = recorded([{ status: 200, body: message([thinking, toolUse], "tool_use") }])
    const provider = anthropicProvider({ apiKey: "test-key-not-real", model: "claude-haiku-5-5", fetch })

    const res = await provider.complete(request, new AbortController().signal)

    expect(sent[0]?.url).toMatch(/\/v1\/messages$/)
    expect(sent[0]?.headers.get("authorization")).toContain("test-key-not-real")
    expect(sent[0]?.body).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 1200,
      system: [
        { type: "text", text: "You are Roma." },
        { type: "text", text: "Today is 2026-11-05." },
      ],
      messages: [{ role: "user", content: "What did I spend last month?" }],
      tools: [{ name: "spending_for_period", description: "Spending.", input_schema: { type: "object", properties: {} } }],
      output_config: { effort: "low" },
    })
    expect(sent[0]?.body).not.toHaveProperty("tool_choice")
    expect(res).toMatchObject({
      stop: "tool_use",
      toolCalls: [{ id: "toolu_1", name: "spending_for_period", input: { period: "last_month" } }],
      usage: { inputTokens: 1200, outputTokens: 80, cacheReadTokens: 300, cacheWriteTokens: 0 },
    })
    expect(res.providerContent).toEqual([thinking, toolUse])
  })

  it("passes the assistant turn back unchanged (thinking included) and sends tool results", async () => {
    const turn = [{ type: "thinking", thinking: "", signature: "sig-1" }, { type: "tool_use", id: "toolu_1", name: "spending_for_period", input: {} }]
    const { fetch, sent } = recorded([{ status: 200, body: message([{ type: "text", text: "You spent ₹500." }], "end_turn") }])
    const provider = anthropicProvider({ apiKey: "test-key-not-real", model: "claude-haiku-5-5", fetch })

    const res = await provider.complete(
      {
        ...request,
        messages: [
          ...request.messages,
          { role: "assistant", text: "", toolCalls: [{ id: "toolu_1", name: "spending_for_period", input: {} }], providerContent: turn },
          { role: "tool_results", results: [{ callId: "toolu_1", content: '{"spent":"₹500"}' }] },
        ],
      },
      new AbortController().signal,
    )
    expect(sent[0]?.body.messages).toEqual([
      { role: "user", content: "What did I spend last month?" },
      { role: "assistant", content: turn },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"spent":"₹500"}' }] },
    ])
    expect(res).toMatchObject({ stop: "end", text: "You spent ₹500.", toolCalls: [] })
  })

  it("maps a refusal and running out of output", async () => {
    const { fetch } = recorded([
      { status: 200, body: message([], "refusal") },
      { status: 200, body: message([{ type: "text", text: "You sp" }], "max_tokens") },
    ])
    const provider = anthropicProvider({ apiKey: "test-key-not-real", model: "claude-haiku-5-5", fetch })
    expect((await provider.complete(request, new AbortController().signal)).stop).toBe("refusal")
    expect((await provider.complete(request, new AbortController().signal)).stop).toBe("max_tokens")
  })

  it("maps an error answer to an unbilled LlmError, without the key in the message", async () => {
    const error = { type: "error", error: { type: "invalid_request_error", message: "bad" } }
    const { fetch } = recorded([{ status: 400, body: error }])
    const provider = anthropicProvider({ apiKey: "test-key-not-real", model: "claude-haiku-5-5", fetch })
    const failure = await provider.complete(request, new AbortController().signal).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(LlmError)
    expect(failure).toMatchObject({ kind: "rejected", billed: "no" })
    expect(String((failure as Error).message)).not.toContain("test-key")
  })

  it("maps a rate limit (retried once) to rate_limited", async () => {
    const error = { type: "error", error: { type: "rate_limit_error", message: "slow down" } }
    const { fetch, sent } = recorded([
      { status: 429, body: error, headers: { "retry-after-ms": "0" } },
      { status: 429, body: error, headers: { "retry-after-ms": "0" } },
    ])
    const provider = anthropicProvider({ apiKey: "test-key-not-real", model: "claude-haiku-5-5", fetch })
    await expect(provider.complete(request, new AbortController().signal)).rejects.toMatchObject({ kind: "rate_limited", billed: "no" })
    expect(sent).toHaveLength(2)
  })

  it("maps a call stopped at the deadline to a possibly billed timeout", async () => {
    const { fetch } = recorded([{ status: 200, body: message([], "end_turn") }])
    const provider = anthropicProvider({ apiKey: "test-key-not-real", model: "claude-haiku-5-5", fetch })
    const controller = new AbortController()
    controller.abort()
    await expect(provider.complete(request, controller.signal)).rejects.toMatchObject({ kind: "timeout", billed: "unknown" })
  })
})
