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
 * The E2E script: "find …" asks search_transactions for this month and names the newest entry
 * (with its description when one was sent); anything else asks spending_for_period for "last
 * month" when the question says so, otherwise "this month", then repeats the tool's own
 * figures. Labelled as a test answer.
 */
const defaultScript: MockScript = (request) => {
  const last = request.messages.at(-1)
  if (last?.role === "tool_results") {
    const result = JSON.parse(last.results[0]?.content ?? "{}") as {
      period?: { from: string; to: string }
      spent?: string
      expense_count?: number
      entries?: { date: string; amount: string; description: string | null }[]
      shown?: number
    }
    if (result.entries) {
      const newest = result.entries[0]
      if (!newest) return mockText("I found no matching entries. (Test answer.)")
      const what = newest.description ? ` for ${newest.description}` : ""
      return mockText(`I found ${result.shown ?? 0} entries. The newest is ${newest.amount}${what} on ${newest.date}. (Test answer.)`)
    }
    if (!result.period || !result.spent) return mockText("I couldn't load your spending. (Test answer.)")
    return mockText(
      `You spent ${result.spent} from ${result.period.from} to ${result.period.to}, across ${result.expense_count ?? 0} expenses. (Test answer.)`,
    )
  }
  const question = request.messages.find((m) => m.role === "user")
  const text = question?.role === "user" ? question.text : ""
  if (/^find\b/i.test(text)) return mockToolCall("search_transactions", { period: "this_month" })
  return mockToolCall("spending_for_period", { period: /last month/i.test(text) ? "last_month" : "this_month" })
}
