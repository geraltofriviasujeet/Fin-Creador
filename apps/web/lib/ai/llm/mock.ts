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
 * figures. Labelled as a test answer. "Can I reach <goal>?" asks goal_projection and repeats its
 * code-built verdict summary (10.4). "Trip to <place>, <scope>, <YYYY-MM>, <n> nights, <n>
 * travellers" asks trip_check, optionally confirming one run: "; <from> to <to> was <scope>
 * for <n>, <travel|all_spending>" (10.5). "Web prices for a trip to <place>, <YYYY-MM>, <n>
 * nights, <n> travellers" (10.8) asks trip_check, then web_price_lookup for stay and transport,
 * then reports the mock search's two prices with web_price_figures, then repeats trip_check's
 * code-built summary. A plan's round (10.9, the plan_pick tool) picks each line's prices whose
 * text says "per night" (as a night) or "per person" (as a person), and no names; for a
 * purchase shortlist, every model offered (by id).
 */
const defaultScript: MockScript = (request) => {
  const plan = planScript(request)
  if (plan) return plan
  const last = request.messages.at(-1)
  const web = webScript(request)
  if (web) return web
  if (last?.role === "tool_results") {
    const result = JSON.parse(last.results[0]?.content ?? "{}") as {
      period?: { from: string; to: string }
      spent?: string
      expense_count?: number
      entries?: { date: string; amount: string; description: string | null }[]
      shown?: number
      verdict_summary?: string
    }
    if (result.verdict_summary) return mockText(`${result.verdict_summary} (Test answer.)`)
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
  // The new question is the last user message (earlier turns come first, from 10.3).
  const question = request.messages.filter((m) => m.role === "user").at(-1)
  const text = question?.role === "user" ? question.text : ""
  if (/^find\b/i.test(text)) return mockToolCall("search_transactions", { period: "this_month" })
  const goal = /^can i reach (.+?)\??$/i.exec(text.trim())
  if (goal) return mockToolCall("goal_projection", { goal: goal[1] })
  const trip = /^trip to (.+?), (domestic|international), (\d{4}-\d{2}), (\d+) nights, (\d+) travellers(?:; (\S+) to (\S+) was (domestic|international) for (\d+), (travel|all_spending))?$/i.exec(text.trim())
  if (trip) {
    const [, destination, scope, month, nights, travellers, from, to, runScope, runTravellers, basis] = trip
    return mockToolCall("trip_check", {
      destination,
      scope,
      month,
      nights: Number(nights),
      travellers: Number(travellers),
      ...(from ? { past_trips: [{ from, to, scope: runScope, travellers: Number(runTravellers), basis }] } : {}),
    })
  }
  return mockToolCall("spending_for_period", { period: /last month/i.test(text) ? "last_month" : "this_month" })
}

const WEB_TRIP = /^web prices for a trip to (.+?), (\d{4}-\d{2}), (\d+) nights, (\d+) travellers$/i

/** The 10.8 web flow, one step per round, from which tool the previous round called. */
function webScript(request: LlmRequest): LlmResponse | null {
  const question = request.messages.filter((m) => m.role === "user").at(-1)
  const trip = WEB_TRIP.exec(question?.role === "user" ? question.text.trim() : "")
  if (!trip) return null
  const [, destination, month, nights, travellers] = trip
  const tripInput = { destination, month, nights: Number(nights), travellers: Number(travellers) }
  const asked = request.messages.filter((m) => m.role === "assistant").flatMap((m) => (m.role === "assistant" ? m.toolCalls.map((c) => c.name) : []))
  const results = request.messages.filter((m) => m.role === "tool_results")
  if (!asked.includes("trip_check")) return mockToolCall("trip_check", tripInput)
  if (!asked.includes("web_price_lookup")) {
    const lookup = (cost_line: string) => ({ id: `call-${cost_line}`, name: "web_price_lookup", input: { kind: "trip", ...tripInput, cost_line } })
    return { stop: "tool_use", text: "", toolCalls: [lookup("stay"), lookup("transport")], usage: NO_USAGE }
  }
  if (!asked.includes("web_price_figures")) {
    // Picks the mock search's two prices by the ids the lookups gave; never types an amount.
    const prices = results.flatMap((m) => (m.role === "tool_results" ? m.results : [])).flatMap((r) => (JSON.parse(r.content) as { prices?: { id: string; text: string }[] }).prices ?? [])
    const idOf = (word: RegExp) => prices.find((p) => word.test(p.text))?.id ?? "w0"
    return mockToolCall("web_price_figures", {
      figures: [
        { id: idOf(/hotel/i), label: "Mid-range hotel", per: "night", cost_line: "stay" },
        { id: idOf(/flight/i), label: "Return flight", per: "person", cost_line: "transport" },
      ],
    })
  }
  const first = results[0]?.role === "tool_results" ? results[0].results[0]?.content : undefined
  const summary = (JSON.parse(first ?? "{}") as { verdict_summary?: string }).verdict_summary
  return mockText(`${summary ?? "I couldn't check this trip."} (Test answer.)`)
}

/** The plan round (10.9): picks by id from the brief, never typing an amount or a name. */
function planScript(request: LlmRequest): LlmResponse | null {
  if (!request.tools.some((t) => t.name === "plan_pick")) return null
  const first = request.messages[0]
  const brief = JSON.parse(first?.role === "user" ? first.text : "{}") as { lines?: { line: string; prices: { id: string; text: string }[] }[]; models?: { id: string }[] }
  if (brief.models) return mockToolCall("plan_pick", { lines: [], carriers: [], hotels: [], models: brief.models.map((m) => m.id) })
  const lines = (brief.lines ?? []).map((l) => ({
    line: l.line,
    picks: l.prices.flatMap((p) => (/per night/i.test(p.text) ? [{ id: p.id, per: "night" }] : /per person/i.test(p.text) ? [{ id: p.id, per: "person" }] : [])).slice(0, 1),
  }))
  return mockToolCall("plan_pick", { lines, carriers: [], hotels: [] })
}
