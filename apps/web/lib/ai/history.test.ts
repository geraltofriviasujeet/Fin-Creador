import { describe, expect, it } from "vitest"
import {
  MAX_REPLAYED_ANSWER_CHARS,
  MAX_SUMMARY_TURNS,
  NO_HISTORY,
  RECENT_TURNS,
  type StoredTurn,
  WITHHELD_ANSWER,
  answerBasis,
  buildHistory,
  fromDateRangeLiteral,
  toDateRangeLiteral,
} from "./history"
import { basisLabels } from "./wording"

// Roma's conversation memory (10.3): what a new question is sent with, built in code.

const turn = (seq: number, over: Partial<StoredTurn> = {}): StoredTurn => ({
  seq,
  question: `Question ${seq}`,
  answer: `You spent ₹${seq},000.`,
  asOf: "2026-11-05",
  periods: [{ start: "2026-10-01", end: "2026-10-31" }],
  tools: ["spending_for_period"],
  sentDescriptions: false,
  ...over,
})

describe("buildHistory", () => {
  it("sends nothing for a new conversation", () => {
    expect(buildHistory([], true)).toEqual(NO_HISTORY)
  })

  it(`sends the last ${RECENT_TURNS} turns as text and summarizes the earlier ones, in turn order`, () => {
    const history = buildHistory([turn(5), turn(1), turn(3), turn(2), turn(4)], true)
    expect(history.recent).toEqual([
      { question: "Question 3", answer: "You spent ₹3,000." },
      { question: "Question 4", answer: "You spent ₹4,000." },
      { question: "Question 5", answer: "You spent ₹5,000." },
    ])
    expect(history.summary?.split("\n").slice(1)).toEqual([
      '- Turn 1 (asked on 2026-11-05): "Question 1" (tools: spending_for_period; periods: 2026-10-01 to 2026-10-31)',
      '- Turn 2 (asked on 2026-11-05): "Question 2" (tools: spending_for_period; periods: 2026-10-01 to 2026-10-31)',
    ])
  })

  it("is deterministic and holds no answer text, so no figure", () => {
    const turns = Array.from({ length: 8 }, (_, i) => turn(i + 1))
    expect(buildHistory(turns, true)).toEqual(buildHistory([...turns].reverse(), true))
    const summary = buildHistory(turns, true).summary ?? ""
    expect(summary).not.toContain("₹")
    expect(summary).toContain("not a source")
  })

  it("lists each tool once and each period once, and says when a turn used no tool", () => {
    const history = buildHistory(
      [
        turn(1, {
          tools: ["spending_for_period", "spending_for_period", "net_worth"],
          periods: [{ start: "2026-09-01", end: "2026-09-30" }, { start: "2026-09-01", end: "2026-09-30" }, { start: "2026-10-01", end: "2026-10-31" }],
        }),
        turn(2, { tools: [], periods: [] }),
        turn(3),
        turn(4),
        turn(5),
      ],
      true,
    )
    expect(history.summary).toContain("(tools: spending_for_period, net_worth; periods: 2026-09-01 to 2026-09-30, 2026-10-01 to 2026-10-31)")
    expect(history.summary).toContain('- Turn 2 (asked on 2026-11-05): "Question 2" (no tools)')
  })

  it(`lists at most ${MAX_SUMMARY_TURNS} earlier turns and counts the rest`, () => {
    const turns = Array.from({ length: MAX_SUMMARY_TURNS + RECENT_TURNS + 2 }, (_, i) => turn(i + 1))
    const lines = buildHistory(turns, true).summary?.split("\n") ?? []
    expect(lines[1]).toBe("- 2 earlier turns not listed.")
    expect(lines[2]).toContain("Turn 3 ")
    expect(lines).toHaveLength(MAX_SUMMARY_TURNS + 2)
  })

  it("folds and cuts long questions in the summary, and cuts long replayed answers", () => {
    const history = buildHistory(
      [turn(1, { question: `Where   did\nit go ${"x".repeat(200)}` }), turn(2), turn(3), turn(4, { answer: "y".repeat(5000) })],
      true,
    )
    expect(history.summary).toContain(`"Where did it go ${"x".repeat(103)}…"`)
    expect(history.recent.at(-1)?.answer).toHaveLength(MAX_REPLAYED_ANSWER_CHARS)
    expect(history.recent.at(-1)?.answer.endsWith("…")).toBe(true)
  })

  it("leaves out an answer that quoted descriptions once consent is withdrawn, and keeps it while given", () => {
    const turns = [turn(1, { answer: "You paid Sharma Stores ₹450.", sentDescriptions: true })]
    expect(buildHistory(turns, false).recent[0]?.answer).toBe(WITHHELD_ANSWER)
    expect(buildHistory(turns, true).recent[0]?.answer).toBe("You paid Sharma Stores ₹450.")
  })
})

describe("date ranges", () => {
  it("writes inclusive periods and reads back what Postgres stores", () => {
    expect(toDateRangeLiteral({ start: "2026-10-01", end: "2026-10-31" })).toBe("[2026-10-01,2026-10-31]")
    expect(fromDateRangeLiteral("[2026-10-01,2026-11-01)")).toEqual({ start: "2026-10-01", end: "2026-10-31" })
    expect(fromDateRangeLiteral("[2024-02-29,2024-03-01)")).toEqual({ start: "2024-02-29", end: "2024-02-29" })
    expect(fromDateRangeLiteral("(2025-12-31,2026-01-01]")).toEqual({ start: "2026-01-01", end: "2026-01-01" })
  })

  it("rejects anything that isn't a closed range of dates", () => {
    for (const bad of ["empty", "[2026-10-01,)", "[2026-10-01,2026-10-01)", "2026-10-01", ""]) {
      expect(fromDateRangeLiteral(bad)).toBeNull()
    }
  })
})

describe("answerBasis and the answer's chips", () => {
  it("follows the tools that ran, never claiming records no records tool read", () => {
    const chips = (tools: string[]) => basisLabels(answerBasis(tools))
    expect(chips(["knowledge_search"])).toEqual(["From the knowledge base"])
    expect(chips(["spending_for_period"])).toEqual(["From your records"])
    expect(chips(["savings_rate", "knowledge_search"])).toEqual(["From your records", "From the knowledge base"])
    expect(chips(["trip_plan"])).toEqual(["From your records"])
    expect(chips(["web_price_lookup", "web_price_figures"])).toEqual([])
    expect(chips([])).toEqual([])
  })
})
