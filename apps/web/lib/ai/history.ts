import { type DateRange, type IsoDate, addDays } from "@fin-creador/domain"

// Roma's conversation memory (Sprint 10.3), without the database. A new question is sent with
// the last RECENT_TURNS turns as plain text and a summary of the earlier ones, never the whole
// conversation. The summary is built here, deterministically: each earlier question with the
// tools and periods it used, and no answer text, so it carries no figures. Neither the summary
// nor earlier answers are a source of figures: the figure check accepts only numbers from tool
// calls made for the new question (chat.ts).

export const RECENT_TURNS = 3
/** A replayed answer is cut to this: enough to follow up on, bounded in tokens. */
export const MAX_REPLAYED_ANSWER_CHARS = 1_500
/** Earlier turns listed in the summary (the newest of them); older ones are only counted. */
export const MAX_SUMMARY_TURNS = 20
const MAX_SUMMARY_QUESTION_CHARS = 120
/** At most this many turns per conversation (ai_conversations_turns); then a new one starts. */
export const MAX_TURNS = 100

/** One stored turn (ai_messages), as the API route reads it. */
export type StoredTurn = {
  seq: number
  question: string
  answer: string
  asOf: IsoDate
  periods: DateRange[]
  tools: string[]
  sentDescriptions: boolean
}

export type ChatHistory = {
  /** The summary of turns before the recent ones, or null when there are none. */
  summary: string | null
  recent: { question: string; answer: string }[]
}

export const NO_HISTORY: ChatHistory = { summary: null, recent: [] }

export const WITHHELD_ANSWER = "(This answer quoted transaction descriptions, which are no longer shared, so it is left out.)"

/**
 * What a new question is sent with. `descriptionsOk` is the person's consent now: an answer
 * that quoted descriptions is left out once they have withdrawn it.
 */
export function buildHistory(turns: readonly StoredTurn[], descriptionsOk: boolean): ChatHistory {
  const ordered = [...turns].sort((a, b) => a.seq - b.seq)
  const recent = ordered.slice(-RECENT_TURNS)
  const earlier = ordered.slice(0, -RECENT_TURNS)
  return {
    summary: earlier.length > 0 ? summarize(earlier) : null,
    recent: recent.map((t) => ({
      question: t.question,
      answer: t.sentDescriptions && !descriptionsOk ? WITHHELD_ANSWER : cut(t.answer, MAX_REPLAYED_ANSWER_CHARS),
    })),
  }
}

function summarize(earlier: readonly StoredTurn[]): string {
  const listed = earlier.slice(-MAX_SUMMARY_TURNS)
  const unlisted = earlier.length - listed.length
  const lines = listed.map((t) => {
    const question = cut(t.question.replace(/\s+/g, " ").trim(), MAX_SUMMARY_QUESTION_CHARS)
    const tools = t.tools.length > 0 ? `tools: ${[...new Set(t.tools)].join(", ")}` : "no tools"
    const periods = t.periods.length > 0 ? `; periods: ${uniquePeriods(t.periods).map((p) => `${p.start} to ${p.end}`).join(", ")}` : ""
    return `- Turn ${t.seq} (asked on ${t.asOf}): "${question}" (${tools}${periods})`
  })
  return [
    "Earlier in this conversation (a summary of the questions only; it holds no figures). Figures in it or in earlier answers are not a source: call a tool again for any figure you state now.",
    ...(unlisted > 0 ? [`- ${unlisted} earlier ${unlisted === 1 ? "turn" : "turns"} not listed.`] : []),
    ...lines,
  ].join("\n")
}

function uniquePeriods(periods: readonly DateRange[]): DateRange[] {
  const seen = new Set<string>()
  return periods.filter((p) => {
    const key = `${p.start}/${p.end}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

// ---------------------------------------------------------------------------
// Date ranges to and from Postgres daterange (inclusive start, exclusive end once stored)
// ---------------------------------------------------------------------------

/** A period as a daterange literal: inclusive on both ends; Postgres stores it as [start, end+1). */
export const toDateRangeLiteral = (p: DateRange) => `[${p.start},${p.end}]`

/** A stored daterange ("[2026-10-01,2026-11-01)") as an inclusive period; null if it isn't one. */
export function fromDateRangeLiteral(literal: string): DateRange | null {
  const match = /^([[(])(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})([\])])$/.exec(literal)
  if (!match) return null
  const [, open, from, to, close] = match as unknown as [string, string, IsoDate, IsoDate, string]
  const start = open === "[" ? from : addDays(from, 1)
  const end = close === "]" ? to : addDays(to, -1)
  return start <= end ? { start, end } : null
}
