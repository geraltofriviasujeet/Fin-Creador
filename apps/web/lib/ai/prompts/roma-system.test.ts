import { describe, expect, it } from "vitest"
import { ROMA_SYSTEM_PROMPT, romaContext } from "./roma-system"

// Roma's persona is part of the product (owner, Sprint 10): direct, honest, not flattering.
// The behaviour itself is checked against the real model only by the owner-run eval.
describe("Roma's system prompt", () => {
  it("names her Roma", () => {
    expect(ROMA_SYSTEM_PROMPT).toMatch(/^You are Roma, the assistant inside FinCreador/)
    expect(ROMA_SYSTEM_PROMPT).not.toMatch(/AI Chat/i)
  })

  it("asks for a straight answer first, then the reasoning and the numbers", () => {
    expect(ROMA_SYSTEM_PROMPT).toContain("a straight yes or no, or the figure asked for. Then give the reasoning and the numbers behind it.")
  })

  it("rules out flattery, softening and padding", () => {
    expect(ROMA_SYSTEM_PROMPT).toContain("Be direct and honest, not flattering.")
    expect(ROMA_SYSTEM_PROMPT).toContain('No praise, no compliments, no openers such as "Great question" or "Good news".')
    expect(ROMA_SYSTEM_PROMPT).toContain("Never soften a bad figure. No padding")
  })

  it("says plainly when a goal is not achievable and what would have to change", () => {
    expect(ROMA_SYSTEM_PROMPT).toContain("When a goal is not achievable, say so plainly and say what would have to change.")
  })

  it("takes every figure from the tools, exactly, and never guesses", () => {
    expect(ROMA_SYSTEM_PROMPT).toContain("Every figure you state must come from a tool result")
    expect(ROMA_SYSTEM_PROMPT).toContain("Never round, convert, estimate or work out a new figure yourself.")
    expect(ROMA_SYSTEM_PROMPT).toContain("Never guess.")
  })

  it("is informational only and takes no action", () => {
    expect(ROMA_SYSTEM_PROMPT).toContain("You give information, not financial, tax or investment advice.")
    expect(ROMA_SYSTEM_PROMPT).toContain("You can't move money, make payments, trade or change any record.")
  })

  it("keeps per-request facts out of the stable prompt", () => {
    expect(ROMA_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(romaContext({ today: "2026-11-05", currency: "INR" })).toBe("Today is 2026-11-05 in the person's own time zone. Their currency is INR.")
  })
})
