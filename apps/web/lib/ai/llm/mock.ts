import { type LlmProvider, type LlmRequest, type LlmResponse, NO_USAGE } from "./types"

// The mock provider: every automated test and the E2E server use it, so no test ever calls
// a paid API. A script decides each round's reply from the request; it costs nothing.

export type MockScript = (request: LlmRequest, round: number) => LlmResponse | Promise<LlmResponse>

export function mockProvider(script: MockScript = defaultScript): LlmProvider {
  let round = 0
  return {
    name: "mock",
    model: "mock",
    async complete(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
      signal.throwIfAborted()
      return script(request, round++)
    },
  }
}

export const mockText = (text: string): LlmResponse => ({ stop: "end", text, toolCalls: [], usage: NO_USAGE })

export const mockToolCall = (name: string, input: unknown, id = `call-${name}`): LlmResponse => ({
  stop: "tool_use",
  text: "",
  toolCalls: [{ id, name, input }],
  usage: NO_USAGE,
})

/**
 * The E2E script: asks spending_for_period for "last month" when the question says so,
 * otherwise "this month", then repeats the tool's own figures. Labelled as a test answer.
 */
const defaultScript: MockScript = (request) => {
  const last = request.messages.at(-1)
  if (last?.role === "tool_results") {
    const result = JSON.parse(last.results[0]?.content ?? "{}") as {
      period?: { from: string; to: string }
      spent?: string
      expense_count?: number
    }
    if (!result.period || !result.spent) return mockText("I couldn't load your spending. (Test answer.)")
    return mockText(
      `You spent ${result.spent} from ${result.period.from} to ${result.period.to}, across ${result.expense_count ?? 0} expenses. (Test answer.)`,
    )
  }
  const question = request.messages.find((m) => m.role === "user")
  const lastMonth = question?.role === "user" && /last month/i.test(question.text)
  return mockToolCall("spending_for_period", { period: lastMonth ? "last_month" : "this_month" })
}
