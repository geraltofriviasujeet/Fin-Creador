import { describe, expect, it } from "vitest"
import { type RefundCandidate, refundCandidateLabel, refundOptions, suggestRefundLinks } from "./refunds"

// Synthetic purchases only.
const candidate = (over: Partial<RefundCandidate>): RefundCandidate => ({
  id: "p", date: "2026-10-10", amountMinor: 50_000, leftMinor: 50_000, categoryId: "cat-shop", note: "SHOE STORE", ...over,
})

describe("suggestRefundLinks", () => {
  const purchases = [
    candidate({ id: "newer", date: "2026-10-12" }),
    candidate({ id: "older", date: "2026-10-01" }),
    candidate({ id: "part", date: "2026-10-05", amountMinor: 80_000, leftMinor: 30_000 }),
  ]

  it("suggests the newest purchase on or before the refund with exactly the refund left, each once", () => {
    const lines = [
      { date: "2026-10-20", amountMinor: 50_000 },
      { date: "2026-10-21", amountMinor: 50_000 },
      { date: "2026-10-22", amountMinor: 50_000 },
    ]
    expect(suggestRefundLinks(lines, purchases)).toEqual(["newer", "older", null])
  })

  it("never suggests a purchase dated after the refund, or a partial refund", () => {
    expect(suggestRefundLinks([{ date: "2026-10-11", amountMinor: 50_000 }], purchases)).toEqual(["older"])
    expect(suggestRefundLinks([{ date: "2026-10-20", amountMinor: 30_000 }], purchases)).toEqual([null])
  })

  it("takes refunds in date order, whatever order the statement lists them", () => {
    const lines = [
      { date: "2026-10-21", amountMinor: 50_000 },
      { date: "2026-10-11", amountMinor: 50_000 },
    ]
    expect(suggestRefundLinks(lines, purchases)).toEqual(["newer", "older"])
  })
})

describe("refundOptions and refundCandidateLabel", () => {
  it("offers purchases on or before the refund with enough left, and always the chosen one", () => {
    const purchases = [candidate({ id: "a" }), candidate({ id: "late", date: "2026-10-30" }), candidate({ id: "small", leftMinor: 100 })]
    expect(refundOptions({ date: "2026-10-20", amountMinor: 2_000 }, purchases, "").map((c) => c.id)).toEqual(["a"])
    expect(refundOptions({ date: "2026-10-20", amountMinor: 2_000 }, purchases, "small").map((c) => c.id)).toEqual(["a", "small"])
  })

  it("names the purchase by its note (else its category) and says what is left when part is refunded", () => {
    expect(refundCandidateLabel(candidate({}), () => "Shopping", "INR")).toBe("10 Oct 2026 · SHOE STORE · ₹500")
    expect(refundCandidateLabel(candidate({ note: null, leftMinor: 20_000 }), () => "Shopping", "INR")).toBe("10 Oct 2026 · Shopping · ₹500 (₹200 left)")
  })
})
