import { describe, expect, it } from "vitest"
import { type DueRecord, type LoanRecord, type LoansData, buildLoansView, reminderText } from "./view"

const TODAY = "2026-10-27"

function loan(over: Partial<LoanRecord> = {}): LoanRecord {
  return {
    id: "loan-1",
    accountId: "acc-loan-1",
    loanType: "personal",
    typeOther: null,
    lender: "HDFC Bank",
    nickname: null,
    currency: "INR",
    sanctionedMinor: 3_000_00,
    disbursedMinor: 3_000_00,
    rateBps: 1200,
    rateKind: "fixed",
    tenureMonths: 3,
    startMode: "ongoing",
    openingOutstandingMinor: 3_000_00,
    instalmentMonths: 3,
    firstDueDate: "2026-10-05",
    moratoriumMonths: 0,
    moratoriumInterest: null,
    capitalisedMinor: 0,
    emiEstimateMinor: 1_020_07,
    emiMinor: 1_020_07,
    trackingStartedOn: "2026-10-01",
    archivedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    balanceMinor: -3_000_00,
    ...over,
  }
}

const emi = (seq: number, dueDate: string, over: Partial<DueRecord> = {}): DueRecord => ({
  id: `due-${seq}`,
  kind: "loan_emi",
  loanId: "loan-1",
  seq,
  dueDate,
  amountDueMinor: 1_020_07,
  status: "pending",
  plannedOn: null,
  plannedAccountId: null,
  ...over,
})

const ITEMS = [emi(1, "2026-10-05"), emi(2, "2026-11-05"), emi(3, "2026-12-05")]
const BANK = { id: "bank", name: "Savings", currency: "INR", balanceMinor: 5_000_00, openingBalanceDate: "2026-01-01" }

function data(over: Partial<LoansData> = {}): LoansData {
  return { today: TODAY, currency: "INR", loans: [loan()], dueItems: ITEMS, payments: [], accounts: [BANK], ...over }
}

describe("buildLoansView", () => {
  it("shows an overdue EMI with the default split and a Due soon reminder", () => {
    const view = buildLoansView(data())
    const l = view.loans[0]!
    expect(l.name).toBe("HDFC Bank")
    expect(l.typeLabel).toBe("Personal loan")
    expect(l.badge).toBe("overdue")
    expect(l.next?.label).toBe("EMI 1")
    // One month's interest at 12% on 3,000.00 is 30.00; the rest of the EMI is principal.
    expect(l.next?.split).toEqual({ principalMinor: 990_07, interestMinor: 30_00, feesMinor: 0, totalMinor: 1_020_07 })
    expect(view.dueSoon.map((r) => [r.item.id, r.reason, r.daysOverdue])).toEqual([["due-1", "overdue", 22]])
    expect(view.totalOutstandingMinor).toBe(3_000_00)
    expect(l.nextShortfall).toBeNull()
  })

  it("is Paid when this month's EMI is paid, and shows the payment's parts", () => {
    const view = buildLoansView(
      data({
        loans: [loan({ balanceMinor: -2_009_93 })],
        dueItems: [emi(1, "2026-10-05", { status: "paid" }), ITEMS[1]!, ITEMS[2]!],
        payments: [{ id: "pay-1", dueItemId: "due-1", accountId: "bank", paidOn: "2026-10-05", principalMinor: 990_07, interestMinor: 30_00, feesMinor: 0, capitalisedMinor: 0 }],
      }),
    )
    const l = view.loans[0]!
    expect(l.badge).toBe("paid")
    expect(l.hasPayments).toBe(true)
    expect(l.items[0]).toMatchObject({ principalMinor: 990_07, interestMinor: 30_00, amountMinor: 1_020_07 })
    expect(l.next?.id).toBe("due-2")
    expect(view.dueSoon).toEqual([])
  })

  it("warns ahead of time when the planned account can't cover the EMI", () => {
    const view = buildLoansView(
      data({
        dueItems: [emi(1, "2026-10-05", { plannedOn: TODAY, plannedAccountId: "cash" }), ITEMS[1]!, ITEMS[2]!],
        accounts: [BANK, { id: "cash", name: "Cash in hand", currency: "INR", balanceMinor: 20_07, openingBalanceDate: "2026-01-01" }],
      }),
    )
    expect(view.loans[0]!.nextShortfall).toBe("You need ₹1,000 more in Cash in hand to pay this EMI")
    expect(view.loans[0]!.next?.plannedAccountName).toBe("Cash in hand")
  })

  it("closes a cleared loan: leftover EMIs are not needed and never remind", () => {
    const view = buildLoansView(data({ loans: [loan({ balanceMinor: 0 })] }))
    const l = view.loans[0]!
    expect(l.badge).toBe("closed")
    expect(l.next).toBeNull()
    expect(l.items.every((d) => d.notNeeded)).toBe(true)
    expect(view.dueSoon).toEqual([])
  })

  it("keeps archived loans apart, without reminders or warnings", () => {
    const view = buildLoansView(data({ loans: [loan({ archivedAt: "2026-10-20T00:00:00Z" })] }))
    expect(view.loans).toEqual([])
    expect(view.archived[0]!.nextShortfall).toBeNull()
    expect(view.dueSoon).toEqual([])
    expect(view.totalOutstandingMinor).toBe(0)
  })

  it("adds capitalised moratorium interest to the first EMI's owed amount until it is posted", () => {
    const view = buildLoansView(
      data({
        loans: [loan({ startMode: "starts_later", moratoriumMonths: 6, moratoriumInterest: "capitalise", capitalisedMinor: 180_00, firstDueDate: "2027-04-05" })],
        dueItems: [emi(1, "2027-04-05"), emi(2, "2027-05-05"), emi(3, "2027-06-05")],
      }),
    )
    const l = view.loans[0]!
    expect(l.badge).toBe("not_due_yet")
    expect(l.pendingCapitalisedMinor).toBe(180_00)
    // Interest on 3,180.00 at 12% for a month is 31.80.
    expect(l.next?.split?.interestMinor).toBe(31_80)
  })

  it("names the nickname first and Other by its description", () => {
    const view = buildLoansView(data({ loans: [loan({ nickname: "Car", loanType: "other", typeOther: "Family loan" })] }))
    expect(view.loans[0]!.name).toBe("Car")
    expect(view.loans[0]!.typeLabel).toBe("Family loan")
  })
})

describe("reminderText", () => {
  it("says why an item needs attention", () => {
    expect(reminderText({ reason: "overdue", daysOverdue: 1 })).toBe("Overdue by 1 day")
    expect(reminderText({ reason: "overdue", daysOverdue: 3 })).toBe("Overdue by 3 days")
    expect(reminderText({ reason: "due_tomorrow", daysOverdue: 0 })).toBe("Due tomorrow")
    expect(reminderText({ reason: "planned_today", daysOverdue: 0 })).toBe("You planned to pay today")
  })
})
