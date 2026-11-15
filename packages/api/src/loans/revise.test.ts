import { describe, expect, it } from "vitest"
import { type RevisionItem, type RevisionTerms, loanHasHistory, revisionPreview } from "./revise"

// The same cases as supabase/tests/database/loan_revisions.test.sql, whose figures the
// database records in loan_revisions.

const emis = (from: number, to: number, over: Partial<RevisionItem> = {}): RevisionItem[] =>
  Array.from({ length: to - from + 1 }, (_, k) => ({ kind: "loan_emi", seq: from + k, status: "pending", amountDueMinor: 56000, hasPayment: false, ...over }))

const terms = (over: Partial<RevisionTerms>): RevisionTerms => ({
  outstandingMinor: 0,
  remainingMonths: 0,
  firstDueDate: "2027-01-05",
  moratoriumMonths: 0,
  moratoriumInterest: null,
  moratoriumMonthlyInterestMinor: 0,
  emiMinor: 0,
  ...over,
})

describe("revisionPreview", () => {
  it("no payments: the owner's education loan, amount taken ₹8,000 → ₹6,000, all 60 EMIs rebuilt", () => {
    const p = revisionPreview(
      { openingOutstandingMinor: 800000, trackingStartedOn: "2026-10-06", owedMinor: 800000, items: emis(1, 60, { amountDueMinor: 17000 }) },
      terms({ outstandingMinor: 600000, remainingMonths: 60, emiMinor: 12748 }),
    )
    expect(p).toEqual({ hasHistory: false, owedBeforeMinor: 800000, owedAfterMinor: 600000, rebuilt: 60 })
  })

  it("payments recorded: owed moves by the difference; 20 EMIs take the new amount, 2 past the new count go", () => {
    const items = [...emis(1, 2, { status: "paid", hasPayment: true }), ...emis(3, 24)]
    const p = revisionPreview(
      { openingOutstandingMinor: 1200000, trackingStartedOn: "2026-11-15", owedMinor: 1112000, items },
      terms({ outstandingMinor: 1100000, remainingMonths: 22, emiMinor: 52000 }),
    )
    expect(p).toEqual({ hasHistory: true, owedBeforeMinor: 1112000, owedAfterMinor: 1012000, rebuilt: 22 })
  })

  it("payments recorded: more EMIs are added after the last one", () => {
    const items = [...emis(1, 1, { status: "paid", hasPayment: true }), ...emis(2, 12)]
    const p = revisionPreview({ openingOutstandingMinor: 500000, trackingStartedOn: "2026-11-15", owedMinor: 460000, items }, terms({ outstandingMinor: 500000, remainingMonths: 15, emiMinor: 56000 }))
    expect(p.rebuilt).toBe(3)
  })

  it("no payments, interest paid monthly: moratorium months from the day the loan was added count", () => {
    // Months of a 6-month moratorium before a first EMI on 5 May 2027: 5 Nov 2026 to 5 Apr 2027;
    // the loan was added on 15 Nov 2026, so 5 are pending.
    const p = revisionPreview(
      { openingOutstandingMinor: 500000, trackingStartedOn: "2026-11-15", owedMinor: 500000, items: [] },
      terms({ outstandingMinor: 400000, remainingMonths: 60, firstDueDate: "2027-05-05", moratoriumMonths: 6, moratoriumInterest: "pay_monthly", moratoriumMonthlyInterestMinor: 3333, emiMinor: 8500 }),
    )
    expect(p.rebuilt).toBe(65)
  })

  it("payments recorded, interest paid monthly: pending moratorium months take the new interest", () => {
    const items: RevisionItem[] = [
      { kind: "loan_interest", seq: 1, status: "paid", amountDueMinor: 4166, hasPayment: true },
      { kind: "loan_interest", seq: 2, status: "pending", amountDueMinor: 4166, hasPayment: false },
      ...emis(1, 60, { amountDueMinor: 10624 }),
    ]
    const p = revisionPreview(
      { openingOutstandingMinor: 500000, trackingStartedOn: "2026-11-15", owedMinor: 500000, items },
      terms({ outstandingMinor: 400000, remainingMonths: 60, moratoriumMonths: 2, moratoriumInterest: "pay_monthly", moratoriumMonthlyInterestMinor: 3333, emiMinor: 8500 }),
    )
    expect(p).toMatchObject({ hasHistory: true, owedAfterMinor: 400000, rebuilt: 61 })
  })
})

describe("loanHasHistory", () => {
  it("a payment, even a voided one, or an instalment settled without one, is history", () => {
    expect(loanHasHistory(emis(1, 3))).toBe(false)
    expect(loanHasHistory([...emis(1, 3), { kind: "loan_emi", seq: 0, status: "before_tracking", amountDueMinor: 1, hasPayment: false }])).toBe(false)
    expect(loanHasHistory([...emis(1, 3), ...emis(4, 4, { hasPayment: true })])).toBe(true)
    expect(loanHasHistory([...emis(1, 3), ...emis(4, 4, { status: "paid" })])).toBe(true)
  })
})
