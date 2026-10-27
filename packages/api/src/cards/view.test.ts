import { describe, expect, it } from "vitest"
import { type LoansData, buildLoansView } from "../loans/view"
import { type CardRecord, type ShortTermData, cardBadgeText } from "./view"

const TODAY = "2026-10-28"
const BANK = { id: "bank", name: "HDFC Savings", currency: "INR", balanceMinor: 50_000_00, openingBalanceDate: "2026-01-01" }

const card = (extra: Partial<CardRecord> = {}): CardRecord => ({
  id: "card",
  accountId: "card-acct",
  issuer: "HDFC Bank",
  nickname: "Travel",
  currency: "INR",
  limitMinor: 1_00_000_00,
  statementDay: 20,
  dueDay: 8,
  openingOwedMinor: 6_000_00,
  trackingStartedOn: "2026-09-01",
  archivedAt: null,
  createdAt: "2026-09-01T00:00:00Z",
  balanceMinor: -9_000_00,
  hasEntries: true,
  ...extra,
})

const statement = { id: "s1", cardId: "card", statementDate: "2026-10-20", dueDate: "2026-11-08", totalMinor: 10_000_00, minimumMinor: 500_00, emiIncludedMinor: 1_000_00, owedAtStatementMinor: 8_000_00, differenceMinor: 1_000_00 }
const bill = { id: "bill", statementId: "s1", dueDate: "2026-10-29", amountDueMinor: 9_000_00, minimumDueMinor: 500_00, status: "pending" as const, plannedOn: null, plannedAccountId: null, paidMinor: 0 }

function data(short: Partial<ShortTermData> = {}, extra: Partial<LoansData> = {}): LoansData {
  return {
    today: TODAY,
    currency: "INR",
    loans: [],
    dueItems: [],
    payments: [],
    accounts: [BANK],
    shortTerm: {
      cards: [card()],
      statements: [statement],
      bills: [bill],
      borrowings: [],
      borrowingDues: [],
      liabilityPayments: [],
      accountNames: {},
      expenseCategories: [],
      ...short,
    },
    ...extra,
  }
}

describe("cards", () => {
  it("shows owed, limit used, the latest bill and a Due reminder for tomorrow", () => {
    const view = buildLoansView(data())
    const c = view.shortTerm!.cards[0]!
    expect([c.name, c.owedMinor, c.utilisation, c.badge, c.latestBill?.payDefaultMinor]).toEqual(["Travel", 9_000_00, { bps: 900, level: "ok" }, "due", 9_000_00])
    expect(view.reminders.map((r) => [r.source, r.label, r.reason, r.amountMinor])).toEqual([["card", "Card bill", "due_tomorrow", 9_000_00]])
    expect(view.shortTerm!.totalOwedMinor).toBe(9_000_00)
  })

  it("stops reminders once the minimum is paid, with a Minimum paid badge", () => {
    const view = buildLoansView(data({ bills: [{ ...bill, paidMinor: 500_00 }], cards: [card({ balanceMinor: -8_500_00 })] }))
    const c = view.shortTerm!.cards[0]!
    expect([c.badge, cardBadgeText(c), c.latestBill?.payDefaultMinor]).toEqual(["minimum_paid", "Minimum paid", 8_500_00])
    expect(view.reminders).toEqual([])
  })

  it("names what is left on a part-paid bill closed through Pay bill", () => {
    const view = buildLoansView(
      data(
        { bills: [{ ...bill, status: "paid", paidMinor: 200_00, minimumDueMinor: null }], cards: [card({ balanceMinor: -8_800_00 })] },
        { payments: [{ id: "p1", dueItemId: "bill", accountId: "bank", paidOn: TODAY, principalMinor: 200_00, interestMinor: 0, feesMinor: 0, capitalisedMinor: 0 }] },
      ),
    )
    const c = view.shortTerm!.cards[0]!
    expect([c.badge, cardBadgeText(c)]).toEqual(["part_paid", "Part-paid, ₹8,800 left"])
    expect(c.payments.map((p) => [p.kind, p.accountName, p.principalMinor])).toEqual([["bill", "HDFC Savings", 200_00]])
    expect(c.statements[0]!.deletable).toBe(false)
    expect(c.hasHistory).toBe(true)
  })

  it("warns at 80% of the limit and reminds to add a statement after the statement day", () => {
    const view = buildLoansView(data({ statements: [], bills: [], cards: [card({ balanceMinor: -85_000_00, statementDay: 25 })] }, { today: "2026-10-26" }))
    const c = view.shortTerm!.cards[0]!
    expect([c.utilisation.level, c.statementToAdd, c.badge]).toEqual(["high", "2026-10-25", "no_bill"])
    expect(view.reminders.map((r) => [r.label, r.reason, r.amountMinor])).toEqual([["Add your Travel statement", "statement", null]])
  })

  it("keeps archived cards apart, without reminders", () => {
    const view = buildLoansView(data({ cards: [card({ archivedAt: "2026-10-27T00:00:00Z", balanceMinor: 0 })] }))
    expect(view.shortTerm!.cards).toEqual([])
    expect(view.shortTerm!.archivedCards.map((c) => c.card.id)).toEqual(["card"])
    expect(view.reminders).toEqual([])
  })
})

describe("borrowing", () => {
  const borrowing = {
    id: "b1",
    accountId: "b1-acct",
    lender: "Ravi",
    currency: "INR",
    borrowedMinor: 20_000_00,
    receivedOn: "2026-10-01",
    receiptAccountId: "bank",
    archivedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    balanceMinor: -15_000_00,
  }

  it("shows what is still owed, and an overdue reminder", () => {
    const view = buildLoansView(
      data({
        cards: [],
        statements: [],
        bills: [],
        borrowings: [borrowing],
        borrowingDues: [{ id: "d1", borrowingId: "b1", dueDate: "2026-10-25", amountDueMinor: 20_000_00, status: "pending", plannedOn: null, plannedAccountId: null }],
        liabilityPayments: [{ id: "r1", liabilityAccountId: "b1-acct", accountId: "bank", paidOn: "2026-10-10", principalMinor: 5_000_00, interestMinor: 100_00 }],
      }),
    )
    const b = view.shortTerm!.borrowings[0]!
    expect([b.owedMinor, b.repaidMinor, b.badge, b.receiptAccountName, b.hasRepayments]).toEqual([15_000_00, 5_000_00, "overdue", "HDFC Savings", true])
    expect(view.reminders.map((r) => [r.name, r.reason, r.daysOverdue, r.amountMinor])).toEqual([["Ravi", "overdue", 3, 15_000_00]])
  })

  it("is repaid once nothing is owed, without reminders", () => {
    const view = buildLoansView(
      data({
        cards: [],
        statements: [],
        bills: [],
        borrowings: [{ ...borrowing, balanceMinor: 0 }],
        borrowingDues: [{ id: "d1", borrowingId: "b1", dueDate: "2026-10-25", amountDueMinor: 20_000_00, status: "paid", plannedOn: null, plannedAccountId: null }],
      }),
    )
    expect(view.shortTerm!.borrowings[0]!.badge).toBe("repaid")
    expect(view.reminders).toEqual([])
  })
})
