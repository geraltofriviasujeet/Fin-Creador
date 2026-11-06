import type { DateRange } from "@fin-creador/domain"
import { type ChatHistory, NO_HISTORY } from "./history"
import { allowedNumbers, checkAnswer, checkSubjects, literalStrings } from "./output"
import { ROMA_SYSTEM_PROMPT, romaContext } from "./prompts/roma-system"
import { type CheckSubject, type FinanceTool, type Figure, type GoalCheck, type InputNeeded, type ToolContext, ToolError, toToolDef } from "./tools/types"
import {
  LlmError,
  type LlmMessage,
  type LlmProvider,
  type LlmToolResult,
  type LlmUsage,
  NO_USAGE,
  addUsage,
} from "./llm/types"

// One question, answered (Sprint 10.1; tools from 10.2): the model may call tools for up to MAX_ROUNDS calls
// within DEADLINE_MS; tool inputs are validated with Zod and run under the person's own RLS;
// the final text passes the output guard or is refused. From 10.3 the question comes with the
// conversation's recent turns as plain text and a summary (history.ts) in a third system block.
// Neither is a source of figures: the figure check accepts only numbers from this question's
// tool calls. The history part of the request is the same in every round of a question, so the
// model's thinking blocks stay valid when they are sent back (checked live, 2026-11-06).
// From 10.4 a goal check's verdict is computed in code: an answer that doesn't start with it
// (after passing the figure check) is replaced by the check's own code-built summary. Strings
// the tools returned (names with digits in them) are not read as figures.

export const MAX_ROUNDS = 4
export const DEADLINE_MS = 45_000
export const MAX_OUTPUT_TOKENS = 1_200

export type ChatFailure = "timeout" | "rounds" | "unavailable" | "rate_limited" | "rejected" | "refusal" | "max_tokens"

export type ChatResult =
  | {
      kind: "answer"
      text: string
      figures: Figure[]
      periods: DateRange[]
      descriptionsWithheld: boolean
      /** Goal checks made for this question (10.4). */
      checks: GoalCheck[]
      /** Tools that ran without error, in order (stored with the turn). */
      toolsRan: string[]
      descriptionsSent: boolean
    }
  /** `unmatched`: the numbers that failed the check (for the server's diagnostic only; never the answer text). */
  | { kind: "unverified"; unmatched: string[] }
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
  history?: ChatHistory
  maxRounds?: number
  deadlineMs?: number
}

export async function runChat({
  provider,
  tools,
  context,
  question,
  history = NO_HISTORY,
  maxRounds = MAX_ROUNDS,
  deadlineMs = DEADLINE_MS,
}: Options): Promise<ChatRun> {
  const deadline = Date.now() + deadlineMs
  const toolDefs = tools.map(toToolDef)
  const system = [ROMA_SYSTEM_PROMPT, romaContext(context), ...(history.summary ? [history.summary] : [])]
  const messages: LlmMessage[] = [
    ...history.recent.flatMap((t): LlmMessage[] => [
      { role: "user", text: t.question },
      { role: "assistant", text: t.answer, toolCalls: [] },
    ]),
    { role: "user", text: question },
  ]
  const figures: Figure[] = []
  const periods: DateRange[] = []
  const found: Found = { dates: [], descriptionsWithheld: false, descriptionsSent: false, toolsRan: [], checks: [], literals: [], needs: [], subjects: [], subjectText: [] }
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
        results.push(await runTool(tools, context, call.id, call.name, call.input, figures, periods, found))
      }
      messages.push({ role: "tool_results", results })
      continue
    }

    if (response.stop === "refusal") return done({ kind: "failed", reason: "refusal" })
    if (response.stop === "max_tokens") return done({ kind: "failed", reason: "max_tokens" })
    if (response.stop !== "end") return done({ kind: "failed", reason: "rejected" })

    // A tool that needs more from the person (and no check that ran anyway): its own question,
    // built in code, replaces whatever the model wrote.
    if (found.needs.length > 0 && found.checks.length === 0) {
      return done({
        kind: "answer",
        text: [...new Set(found.needs.map((n) => n.question))].join("\n\n"),
        figures: [],
        periods: [],
        descriptionsWithheld: false,
        checks: [],
        toolsRan: found.toolsRan,
        descriptionsSent: found.descriptionsSent,
      })
    }

    const dates = [context.today, ...periods.flatMap((p) => [p.start, p.end]), ...found.dates]
    const check = checkAnswer(response.text, allowedNumbers(figures, dates), found.literals)
    if (!check.ok) return done(check.reason === "unverified" ? { kind: "unverified", unmatched: check.unmatched ?? [] } : { kind: check.reason })

    // A goal or trip answer about something the person didn't ask about: refused, and a summary
    // built in code is shown instead (10.5).
    const said = [question, ...history.recent.map((t) => t.question), history.summary ?? ""].join("\n")
    const subject = checkSubjects(check.text, said, found.subjects, found.subjectText.join("\n"))
    if (!subject.ok) {
      return done({
        kind: "answer",
        text: offSubjectText(subject.checked, subject.goals),
        figures: [],
        periods: [],
        descriptionsWithheld: false,
        checks: [],
        toolsRan: found.toolsRan,
        descriptionsSent: found.descriptionsSent,
      })
    }
    return done({
      kind: "answer",
      text: withVerdict(check.text, found.checks),
      figures,
      periods,
      descriptionsWithheld: found.descriptionsWithheld,
      checks: found.checks,
      toolsRan: found.toolsRan,
      descriptionsSent: found.descriptionsSent,
    })
  }
  return done({ kind: "failed", reason: "rounds" })
}

/** What tools found besides figures and periods. */
type Found = {
  dates: string[]
  descriptionsWithheld: boolean
  descriptionsSent: boolean
  toolsRan: string[]
  checks: GoalCheck[]
  literals: string[]
  needs: InputNeeded[]
  subjects: CheckSubject[]
  /** The results of the tools that had a subject, for the subject check. */
  subjectText: string[]
}

/** Shown instead of an answer about a goal or trip the person didn't ask about. */
export function offSubjectText(checked: string, goals: readonly string[]): string {
  const yours = goals.length === 0 ? "You have no goals yet." : `Your goals are: ${goals.join(", ")}.`
  return `Roma's answer was about ${checked}, which isn't what you asked about, so it isn't shown. ${yours} Name the goal you mean, or for a new trip say where you want to go, domestic or international, the month, how many nights and how many people.`
}

/** The answer, when it starts with a verdict a goal check computed; otherwise the checks' own summaries. */
export function withVerdict(text: string, checks: readonly GoalCheck[]): string {
  if (checks.length === 0 || checks.some((c) => text.startsWith(c.verdict))) return text
  return checks.map((c) => c.summary).join("\n\n")
}

async function runTool(
  tools: readonly FinanceTool[],
  context: ToolContext,
  callId: string,
  name: string,
  rawInput: unknown,
  figures: Figure[],
  periods: DateRange[],
  found: Found,
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
    if (output.dates) found.dates.push(...output.dates)
    if (output.descriptionsWithheld) found.descriptionsWithheld = true
    if (output.descriptionsSent) found.descriptionsSent = true
    if (output.check) found.checks.push(output.check)
    if (output.needs) found.needs.push(output.needs)
    if (output.subject) {
      found.subjects.push(output.subject)
      found.subjectText.push(JSON.stringify(output.data))
    }
    found.literals.push(...literalStrings(output.data), ...literalStrings(output.figures.map((f) => f.label)))
    found.toolsRan.push(tool.name)
    return { callId, content: JSON.stringify(output.data) }
  } catch (error) {
    if (error instanceof ToolError) return fail(error.message)
    return fail("The figures couldn't be loaded.")
  }
}
