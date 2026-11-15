import Anthropic from "@anthropic-ai/sdk"
import { LlmError, type LlmMessage, type LlmProvider, type LlmRequest, type LlmResponse, type LlmStop } from "./types"

// The Anthropic adapter: the only file that imports the Anthropic SDK. Server-side only
// (the key is read by config.ts from server environment variables).
//
// Thinking is adaptive (the model's default) at effort "low": short factual answers don't
// need more. Thinking blocks come back in `providerContent` and are passed back unchanged on
// the next round of the same question. Forced tool choice is not used (auto is the default).
// A round asked to run without thinking (plan picks, 10.9) gets it off where the model allows:
// "disabled" on Haiku 5.5 and Opus 5 at this effort, "between_tools" on Sonnet 5.5; Opus 5.5 and
// Fable 5.1 can't turn it off, so it stays adaptive at low effort there.

const CALL_TIMEOUT_MS = 20_000

type Options = {
  apiKey: string
  model: string
  /** Tests pass a fake fetch with recorded responses; production uses the global fetch. */
  fetch?: typeof globalThis.fetch
}

export function anthropicProvider({ apiKey, model, fetch }: Options): LlmProvider {
  const client = new Anthropic({ apiKey, fetch, timeout: CALL_TIMEOUT_MS, maxRetries: 1 })

  return {
    name: "anthropic",
    model,
    async complete(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
      let message: Anthropic.Message
      try {
        message = await client.messages.create(
          {
            model,
            max_tokens: request.maxOutputTokens,
            system: request.system.map((text) => ({ type: "text" as const, text })),
            messages: request.messages.map(toMessageParam),
            // Small talk (10.6c) is offered no tools: the field is left out.
            ...(request.tools.length > 0
              ? {
                  tools: request.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
                  })),
                }
              : {}),
            output_config: { effort: "low" },
            ...(request.thinking === "off" ? thinkingOff(model) : {}),
          },
          { signal },
        )
      } catch (error) {
        throw toLlmError(error)
      }

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
      const toolCalls = message.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }))
      return {
        stop: toStop(message.stop_reason),
        text,
        toolCalls,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        },
        providerContent: message.content,
      }
    },
  }
}

function toMessageParam(m: LlmMessage): Anthropic.MessageParam {
  switch (m.role) {
    case "user":
      return { role: "user", content: m.text }
    case "assistant": {
      // The provider's own blocks when we have them (thinking included), else rebuilt.
      if (Array.isArray(m.providerContent)) return { role: "assistant", content: m.providerContent as Anthropic.ContentBlockParam[] }
      const content: Anthropic.ContentBlockParam[] = []
      if (m.text) content.push({ type: "text", text: m.text })
      for (const c of m.toolCalls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input })
      return { role: "assistant", content }
    }
    case "tool_results":
      return {
        role: "user",
        content: m.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.callId, content: r.content, is_error: r.isError })),
      }
  }
}

function toStop(reason: Anthropic.StopReason | null): LlmStop {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end"
    case "tool_use":
      return "tool_use"
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens"
    case "refusal":
      return "refusal"
    default:
      return "other"
  }
}

// Most specific first. Messages carry the class only: never request content or the key.
function toLlmError(error: unknown): LlmError {
  if (error instanceof Anthropic.APIUserAbortError) return new LlmError("timeout", "unknown", "The call was stopped at the deadline")
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new LlmError("timeout", "unknown", "The provider timed out")
  if (error instanceof Anthropic.APIConnectionError) return new LlmError("unavailable", "unknown", "The provider could not be reached")
  if (error instanceof Anthropic.RateLimitError) return new LlmError("rate_limited", "no", "The provider is rate limiting")
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0
    return new LlmError(status >= 500 ? "unavailable" : "rejected", "no", `The provider answered ${status}`)
  }
  return new LlmError("unavailable", "unknown", "The provider call failed")
}

/** Thinking off for one request, in the form the model accepts; nothing where it can't be off. */
function thinkingOff(model: string): { thinking?: Anthropic.MessageCreateParams["thinking"] } {
  if (/^claude-(opus-5-5|fable|mythos)/.test(model)) return {}
  if (/^claude-sonnet-5-5/.test(model)) return { thinking: { type: "between_tools" } as unknown as Anthropic.MessageCreateParams["thinking"] }
  return { thinking: { type: "disabled" } }
}
