import { describe, expect, it } from "vitest"
import { CARD_MAX_BYTES, shownCard, toStoredCard } from "./stored-sources"
import type { GoalCheck } from "./tools/types"

// The check card kept with a turn (10.7a, 20261115120000_roma_turn_card.sql): checked before
// writing and again before showing, mirroring the database's checks.

const whatIf: GoalCheck = {
  kind: "what_if",
  goal: "Assam trip",
  verdict: "Reached in May 2028 (19 months).",
  caveat: "Your records show nothing free a month today; this assumes you find the extra ₹5,000.",
  summary: "Not stored.",
  assumptions: ["Only INR entries are counted."],
  lines: ["Savings only: no investment returns, no interest and no inflation."],
  comparison: { before: "As it is", after: "₹5,000 a month", rows: [{ label: "Reached in", before: "not reached", after: "May 2028 (19 months)" }] },
}
const figures = [{ label: "Assam trip: target", value: "₹95,000" }]

describe("the stored check card", () => {
  it("keeps a what-if card and its figures, without the summary, and shows it back as it was", () => {
    const card = toStoredCard([whatIf], figures)
    expect(card).toStrictEqual({
      kind: "what_if",
      goal: "Assam trip",
      verdict: whatIf.verdict,
      caveat: whatIf.caveat,
      assumptions: whatIf.assumptions,
      lines: whatIf.lines,
      comparison: whatIf.comparison,
      figures,
    })
    const { summary: _, ...shown } = whatIf
    expect(shownCard(JSON.parse(JSON.stringify(card)))).toStrictEqual({ check: shown, figures })
  })

  it("keeps a goal check as kind goal and shows it without a kind, as the answer did", () => {
    const card = toStoredCard([{ goal: "Car", verdict: "Yes.", summary: "s", assumptions: [] }], [])
    expect(card).toStrictEqual({ kind: "goal", goal: "Car", verdict: "Yes.", assumptions: [] })
    expect(shownCard(card)).toStrictEqual({ check: { goal: "Car", verdict: "Yes.", assumptions: [] }, figures: [] })
  })

  it("keeps a trip check's web line, but not its web hook", () => {
    const trip: GoalCheck = { kind: "trip", goal: "Goa", verdict: "Yes.", summary: "s", assumptions: [], withTarget: () => ({ verdict: "x", summary: "y" }), web: { verdict: "Yes.", summary: "With web estimates.", webOnly: true } }
    expect(toStoredCard([trip], [])).toStrictEqual({ kind: "trip", goal: "Goa", verdict: "Yes.", assumptions: [], web: { verdict: "Yes.", summary: "With web estimates.", webOnly: true } })
  })

  it("keeps nothing for no check, several checks, or a card too large", () => {
    expect(toStoredCard([], figures)).toBeNull()
    expect(toStoredCard([whatIf, whatIf], figures)).toBeNull()
    expect(toStoredCard([{ ...whatIf, assumptions: ["x".repeat(CARD_MAX_BYTES)] }], figures)).toBeNull()
  })

  it("keeps at most 40 figures", () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ label: `F${i}`, value: "1" }))
    expect(toStoredCard([whatIf], many)?.figures).toHaveLength(40)
  })

  it("shows nothing for a stored value that no longer parses", () => {
    const card = toStoredCard([whatIf], figures)!
    for (const bad of [{}, [], null, "x", { ...card, kind: "tax" }, { ...card, summary: "x" }, { ...card, kind: "goal" }, { ...card, verdict: undefined }, { ...card, comparison: null }]) {
      expect(shownCard(bad)).toBeNull()
    }
  })
})
