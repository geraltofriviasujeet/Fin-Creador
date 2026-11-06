import type { DateRange } from "@fin-creador/domain"
import { allowedNumbers, checkAnswer } from "./output"
import { ROMA_SYSTEM_PROMPT, romaContext } from "./prompts/roma-system"
import { type FinanceTool, type Figure, type ToolContext, ToolError, toToolDef } from "./tools/types"
import {
  LlmError,
  type LlmMessage,
  type LlmProvider,
  type LlmToolResult,
  type LlmUsage,
  NO_USAGE,
  addUsage,
} from "./llm/types"

// One question, answered (Sprint 10.1): the model may call tools for up to MAX_ROUNDS calls
// within DEADLINE_MS; tool inputs are validated with Zod and run under the person's own RLS;
// the final text passes the output guard or is refused. No history is kept between questions.

export const MAX_ROUNDS = 4
export const DEADLINE_MS = 45_000
export const MAX_OUTPUT_TOKENS = 1_200

export type ChatFailure = "timeout" | "rounds" | "unavailable" | "rate_limited" | "rejected" | "refusal" | "max_tokens"

export type ChatResult =
  | { kind: "answer"; text: string; figures: Figure[]; periods: DateRange[] }
  | { kind: "unverified" }
  | { kind: "tone" }
  | { kind: "invalid" }
  | { kind: "failed"; reason: ChatFailure }

export type ChatRun = {
  result: ChatResult
  /** Calls sent to the provider (0 means nothing was sent: release the reservation). */
  calls: number
  /** Usage reported by the provider for the calls that returned. */
  usage: LlmUsage
  /** Calls that failed after possibly being sent: billed, but their usage is unknown. */
  unknownCalls: number
}

type Options = {
  provider: LlmProvider
  tools: readonly FinanceTool[]
  context: ToolContext
  question: string
  maxRounds?: number
  deadlineMs?: number
}

export async function runChat({ provider, tools, context, question, maxRounds = MAX_ROUNDS, deadlineMs = DEADLINE_MS }: Options): Promise<ChatRun> {
  const deadline = Date.now() + deadlineMs
  const toolDefs = tools.map(toToolDef)
  const system = [ROMA_SYSTEM_PROMPT, romaContext(context)]
  const messages: LlmMessage[] = [{ role: "user", text: question }]
  const figures: Figure[] = []
  const periods: DateRange[] = []
  let usage = NO_USAGE
  let calls = 0
  let unknownCalls = 0
  const done = (result: ChatResult): ChatRun => ({ result, calls, usage, unknownCalls })

  for (let round = 0; round < maxRounds; round++) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return done({ kind: "failed", reason: "timeout" })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), remaining)
    let response
    calls++
    try {
      response = await provider.complete({ system, messages, tools: toolDefs, maxOutputTokens: MAX_OUTPUT_TOKENS }, controller.signal)
    } catch (error) {
      if (!(error instanceof LlmError)) throw error
      if (error.billed === "unknown") unknownCalls++
      return done({ kind: "failed", reason: error.kind === "timeout" ? "timeout" : error.kind })
    } finally {
      clearTimeout(timer)
    }
    usage = addUsage(usage, response.usage)

    if (response.stop === "tool_use" && response.toolCalls.length > 0) {
      messages.push({ role: "assistant", text: response.text, toolCalls: response.toolCalls, providerContent: response.providerContent })
      const results: LlmToolResult[] = []
      for (const call of response.toolCalls) {
        results.push(await runTool(tools, context, call.id, call.name, call.input, figures, periods))
      }
      messages.push({ role: "tool_results", results })
      continue
    }

    if (response.stop === "refusal") return done({ kind: "failed", reason: "refusal" })
    if (response.stop === "max_tokens") return done({ kind: "failed", reason: "max_tokens" })
    if (response.stop !== "end") return done({ kind: "failed", reason: "rejected" })

    const dates = [context.today, ...periods.flatMap((p) => [p.start, p.end])]
    const check = checkAnswer(response.text, allowedNumbers(figures, dates))
    if (!check.ok) return done({ kind: check.reason })
    return done({ kind: "answer", text: check.text, figures, periods })
  }
  return done({ kind: "failed", reason: "rounds" })
}

async function runTool(
  tools: readonly FinanceTool[],
  context: ToolContext,
  callId: string,
  name: string,
  rawInput: unknown,
  figures: Figure[],
  periods: DateRange[],
): Promise<LlmToolResult> {
  const fail = (message: string): LlmToolResult => ({ callId, content: JSON.stringify({ error: message }), isError: true })
  const tool = tools.find((t) => t.name === name)
  if (!tool) return fail(`There is no tool called ${name}.`)
  const input = tool.input.safeParse(rawInput)
  if (!input.success) return fail(`Invalid input: ${input.error.issues.map((i) => i.message).join("; ")}`)
  try {
    const output = await tool.run(context, input.data)
    figures.push(...output.figures)
    if (output.period) periods.push(output.period)
    return { callId, content: JSON.stringify(output.data) }
  } catch (error) {
    if (error instanceof ToolError) return fail(error.message)
    return fail("The figures couldn't be loaded.")
  }
}
