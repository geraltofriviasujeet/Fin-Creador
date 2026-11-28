import type { BudgetRow } from "@fin-creador/domain"
import { describe, expect, it } from "vitest"
import type { BorrowingDueRecord, BorrowingRecord, CardRecord } from "../cards/view"
import { type BudgetCategory, type GoalRecord, buildGoalsView } from "../goals/view"
import { buildInvestmentsView } from "../investments/view"
import { type DueRecord, type LoanRecord, type LoansData, buildLoansView } from "../loans/view"
import { type RecurringRule, buildRecurringView } from "../recurring/view"
import type { StatutoryDueRecord } from "../statutory/view"
import type { LedgerAccount, LedgerCategory } from "../transactions/types"
import { PLAN_BILL_CHIPS, PLAN_NEXT_DUES, PLAN_TOP_BUDGETS, PLAN_TOP_GOALS, planBills, planBudgets, planGoals, planInvestments, planLoans } from "./summary"

// Demo figures only. The summaries read the views the web pages build, so these build the
// views with the web's own builders and check that the Plan cards pick from them correctly.
const today = "2026-11-15"
const R = (rupees: number) => rupees * 100

// ---- Budgets and goals ------------------------------------------------------------------

const cat = (id: string, name: string): BudgetCategory => ({ id, name, icon: null, archived: false })
const budget = (categoryId: string, rupees: number, currency = "INR"): BudgetRow => ({ categoryId, effectiveFrom: "2026-11-01", amountMinor: R(rupees), currency })

function goalsView(over: { spending?: [string, number][]; budgets?: BudgetRow[]; goals?: GoalRecord[]; budgetMonth?: string } = {}) {
  return buildGoalsView({
    today,
    currency: "INR",
    goals: over.goals ?? [],
    budgetRows: over.budgets ?? [],
    categories: [cat("food", "Food"), cat("fuel", "Fuel"), cat("fun", "Fun"), cat("rent", "Rent"), cat("travel", "Travel")],
    spending: new Map((over.spending ?? []).map(([k, v]) => [k, R(v)])),
    ...(over.budgetMonth ? { budgetMonth: over.budgetMonth } : {}),
  })
}

describe("planBudgets", () => {
  it("is empty with no budgets: no total, nothing on top, mark still set", () => {
    const s = planBudgets(goalsView())
    expect(s).toMatchObject({ count: 0, total: null, top: [], overCount: 0, warningCount: 0, resetCount: 0, month: "2026-11-01" })
    expect(s.evenSpend).toBeCloseTo(15 / 30, 12)
  })

  it("puts over first, then nearly over (80% or more, the domain's level), then the most used", () => {
    const s = planBudgets(
      goalsView({
        budgets: [budget("food", 10_000), budget("fuel", 4_000), budget("fun", 2_000), budget("rent", 20_000), budget("travel", 5_000)],
        // Food 50%, Fuel 80% (warning), Fun 110% (over), Rent 100% (over), Travel 10%.
        spending: [["food", 5_000], ["fuel", 3_200], ["fun", 2_200], ["rent", 20_000], ["travel", 500]],
      }),
    )
    expect(PLAN_TOP_BUDGETS).toBe(3)
    expect(s.top.map((b) => [b.category.name, b.status?.level])).toEqual([["Fun", "over"], ["Rent", "over"], ["Fuel", "warning"]])
    expect([s.count, s.overCount, s.warningCount, s.resetCount]).toEqual([5, 2, 1, 0])
    // The total is the web's (the view's), not re-added here.
    expect(s.total).toEqual(goalsView({
      budgets: [budget("food", 10_000), budget("fuel", 4_000), budget("fun", 2_000), budget("rent", 20_000), budget("travel", 5_000)],
      spending: [["food", 5_000], ["fuel", 3_200], ["fun", 2_200], ["rent", 20_000], ["travel", 500]],
    }).total)
    expect(s.total).toMatchObject({ budgetMinor: R(41_000), spentMinor: R(30_900) })
  })

  it("leaves a budget in another currency off the bars and counts it to set again", () => {
    const s = planBudgets(goalsView({ budgets: [budget("food", 10_000), budget("travel", 500, "USD")], spending: [["food", 1_000]] }))
    expect(s.top.map((b) => b.category.name)).toEqual(["Food"])
    expect([s.count, s.resetCount]).toEqual([2, 1])
  })

  it("a later month has its mark at 0", () => {
    const s = planBudgets(goalsView({ budgets: [budget("food", 10_000)], budgetMonth: "2027-01-01" }))
    expect([s.month, s.evenSpend]).toEqual(["2027-01-01", 0])
  })
})

const goal = (id: string, over: Partial<GoalRecord> = {}): GoalRecord => ({
  id, type: "other", name: id, targetMinor: R(50_000), savedMinor: R(10_000), currency: "INR", targetDate: "2027-06-01",
  details: {}, archivedAt: null, createdAt: "2026-01-01T00:00:00Z", ...over,
})

describe("planGoals", () => {
  it("keeps the Goals page's order and counts archived apart", () => {
    const v = goalsView({
      goals: [
        goal("Laptop", { targetDate: "2027-09-01" }), goal("Trip", { targetDate: "2027-01-01" }), goal("Bike", { targetDate: "2027-03-01" }),
        goal("Phone", { targetDate: "2027-02-01" }), goal("Old", { archivedAt: "2026-10-01T00:00:00Z" }),
      ],
    })
    const s = planGoals(v)
    expect(PLAN_TOP_GOALS).toBe(3)
    expect(s.top.map((g) => g.goal.name)).toEqual(v.active.slice(0, 3).map((g) => g.goal.name))
    expect(s.top.map((g) => g.goal.name)).toEqual(["Trip", "Phone", "Bike"])
    expect([s.count, s.archivedCount]).toEqual([4, 1])
  })
})

// ---- Loans & dues -------------------------------------------------------------------------

const BANK = { id: "bank", name: "HDFC Savings", currency: "INR", balanceMinor: R(50_000), openingBalanceDate: "2026-01-01" }

const loan = (id: string, over: Partial<LoanRecord> = {}): LoanRecord => ({
  id, accountId: `${id}-acct`, loanType: "vehicle", typeOther: null, lender: "SBI", nickname: id, currency: "INR",
  sanctionedMinor: R(48_000), disbursedMinor: R(48_000), rateBps: 0, rateKind: "fixed", tenureMonths: 24, startMode: "ongoing",
  openingOutstandingMinor: R(46_000), instalmentMonths: 24, firstDueDate: "2026-10-05", moratoriumMonths: 0, moratoriumInterest: null,
  capitalisedMinor: 0, emiEstimateMinor: R(2_000), emiMinor: R(2_000), trackingStartedOn: "2026-10-01", archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z", balanceMinor: -R(44_000), ...over,
})
const emi = (loanId: string, seq: number, dueDate: string, status: DueRecord["status"] = "pending"): DueRecord => ({
  id: `${loanId}-emi-${seq}`, kind: "loan_emi", loanId, seq, dueDate, amountDueMinor: R(2_000), status, plannedOn: null, plannedAccountId: null,
})

const card = (over: Partial<CardRecord> = {}): CardRecord => ({
  id: "card", accountId: "card-acct", issuer: "HDFC Bank", product: null, productOther: false, nickname: "Travel", currency: "INR",
  limitMinor: R(1_00_000), statementDay: 20, dueDay: 8, openingOwedMinor: R(6_000), trackingStartedOn: "2026-09-01", archivedAt: null,
  createdAt: "2026-09-01T00:00:00Z", balanceMinor: -R(9_000), hasEntries: true, ...over,
})
const statement = { id: "s1", cardId: "card", statementDate: "2026-10-20", dueDate: "2026-11-20", totalMinor: R(9_000), minimumMinor: R(500), emiIncludedMinor: 0, owedAtStatementMinor: R(9_000), differenceMinor: 0 }
const bill = { id: "bill", statementId: "s1", dueDate: "2026-11-20", amountDueMinor: R(9_000), minimumDueMinor: R(500), status: "pending" as const, plannedOn: null, plannedAccountId: null, paidMinor: 0 }

const borrowing: BorrowingRecord = {
  id: "b1", accountId: "b1-acct", lender: "Ravi", relationship: "friends", reason: null, currency: "INR", borrowedMinor: R(20_000),
  amountToReturnMinor: R(20_000), returnOn: "2026-11-10", returnPlan: "once", instalmentCount: null, repayFromAccountId: "bank",
  receivedOn: "2026-10-01", receiptAccountId: "bank", archivedAt: null, createdAt: "2026-10-01T00:00:00Z", balanceMinor: -R(15_000),
}
const borrowingDue: BorrowingDueRecord = {
  id: "d1", borrowingId: "b1", seq: 0, dueDate: "2026-11-10", amountDueMinor: R(20_000), interestMinor: 0, payFromAccountId: "bank",
  remainingMinor: R(15_000), remainingInterestMinor: 0, remainingPrincipalMinor: R(15_000), status: "pending", plannedOn: null, plannedAccountId: null,
}

const tax = (over: Partial<StatutoryDueRecord> = {}): StatutoryDueRecord => ({
  id: "tax", dueType: "income_tax", description: "Advance tax", vehicleKind: null, issuedState: null, issuedCity: null, currency: "INR",
  amountMinor: R(5_000), dueDate: "2026-12-15", payFromAccountId: null, archivedAt: null, createdAt: "2026-10-01T00:00:00Z", ...over,
})
const taxItem = { id: "tax-item", statutoryDueId: "tax", dueDate: "2026-12-15", amountDueMinor: R(5_000), status: "pending" as const, plannedOn: null, plannedAccountId: null, payFromAccountId: null }

function loansData(over: Partial<LoansData> = {}): LoansData {
  return {
    today, currency: "INR", loans: [], dueItems: [], payments: [], accounts: [BANK],
    shortTerm: { cards: [], statements: [], bills: [], borrowings: [], borrowingDues: [], liabilityPayments: [], accountNames: {}, expenseCategories: [] },
    statutory: { dues: [], items: [], payments: [], everPaidItemIds: [], accountNames: {} },
    ...over,
  }
}

describe("planLoans", () => {
  it("is empty with nothing owed", () => {
    expect(planLoans(buildLoansView(loansData()))).toMatchObject({ next: [], empty: true, overdueCount: 0, shortTermOwedMinor: 0, statutoryDueMinor: 0 })
  })

  it("lists the next EMI, card bill, borrowing return and statutory due soonest first, overdue ones leading", () => {
    const view = buildLoansView(
      loansData({
        loans: [loan("Car loan")],
        dueItems: [emi("Car loan", 1, "2026-10-05", "paid"), emi("Car loan", 2, "2026-11-05"), emi("Car loan", 3, "2026-12-05")],
        shortTerm: {
          cards: [card()], statements: [statement], bills: [bill], borrowings: [borrowing], borrowingDues: [borrowingDue],
          liabilityPayments: [], accountNames: {}, expenseCategories: [],
        },
        statutory: { dues: [tax()], items: [taxItem], payments: [], everPaidItemIds: [], accountNames: {} },
      }),
    )
    const s = planLoans(view)
    expect(PLAN_NEXT_DUES).toBe(3)
    expect(s.next.map((d) => [d.source, d.name, d.label, d.dueDate, d.amountMinor, d.overdue])).toEqual([
      ["loan", "Car loan", "EMI 2", "2026-11-05", R(2_000), true],
      ["borrowing", "Ravi", "Return", "2026-11-10", R(15_000), true],
      ["card", "Travel", "Card bill", "2026-11-20", R(9_000), false],
    ])
    // The statutory due (15 Dec) is fourth: off the card, but counted.
    expect([s.loanCount, s.cardCount, s.borrowingCount, s.statutoryCount, s.overdueCount, s.empty]).toEqual([1, 1, 1, 1, 2, false])
    // Totals are the view's own.
    expect([s.longTermOutstandingMinor, s.shortTermOwedMinor, s.statutoryDueMinor]).toEqual([
      view.longTermOutstandingMinor, view.shortTerm!.totalOwedMinor, view.statutory!.totalDueMinor,
    ])
    expect(s.next[0]).toMatchObject({ dueItemId: "Car loan-emi-2", ownerId: "Car loan" })
  })

  it("leaves out paid bills, archived loans and a card EMI that is paid with its card's bill", () => {
    const cardEmi = loan("Phone EMI", { loanType: "credit_card_emi", cardId: "card" })
    const view = buildLoansView(
      loansData({
        loans: [cardEmi, loan("Old", { archivedAt: "2026-11-01T00:00:00Z" })],
        dueItems: [emi("Phone EMI", 1, "2026-11-08"), emi("Old", 1, "2026-11-09")],
        shortTerm: {
          cards: [card()], statements: [statement], bills: [{ ...bill, paidMinor: R(9_000), status: "paid" as const }], borrowings: [], borrowingDues: [],
          liabilityPayments: [], accountNames: {}, expenseCategories: [],
        },
      }),
    )
    expect(view.shortTerm!.cards[0]!.linkedLoanIds).toEqual(["Phone EMI"])
    const s = planLoans(view)
    expect(s.next).toEqual([])
    // A card EMI counts with the cards, not as a loan.
    expect(s.loanCount).toBe(0)
  })

  it("lists a card EMI that is not linked to a card on its own", () => {
    const view = buildLoansView(
      loansData({ loans: [loan("Phone EMI", { loanType: "credit_card_emi", cardId: null })], dueItems: [emi("Phone EMI", 1, "2026-11-08")] }),
    )
    expect(planLoans(view).next.map((d) => [d.name, d.label, d.overdue])).toEqual([["Phone EMI", "EMI 1", true]])
  })

  it("shows unknown totals as null when the cards or statutory part did not load", () => {
    const view = buildLoansView({ ...loansData(), shortTerm: undefined, statutory: undefined })
    expect(planLoans(view)).toMatchObject({ shortTermOwedMinor: null, statutoryDueMinor: null, cardCount: 0, statutoryCount: 0 })
  })
})

// ---- Bills that repeat ----------------------------------------------------------------------

const account: LedgerAccount = {
  id: "savings", kind: "bank", bankType: "savings", label: "HDFC Savings", currency: "INR", openingBalanceMinor: 0, openingBalanceDate: "2026-01-01",
  inflowMinor: 0, outflowMinor: 0, archived: false,
}
const bills: LedgerCategory = { id: "bills", kind: "expense", name: "Bills", icon: "bills", archived: false, defaultAccountId: null, key: null }
const rule = (id: string, startDate: string): RecurringRule => ({
  id, type: "expense", amountMinor: R(500), currency: "INR", accountId: "savings", counterAccountId: null, categoryId: "bills",
  paymentMode: null, note: id, frequency: "monthly", startDate, endDate: null, archived: false,
})

describe("planBills", () => {
  it("shows due items first, then coming up, up to the chip limit, with the rest counted", () => {
    // Due: the 10th and 12th (not posted this month). Coming up: the 16th to the 22nd.
    const rules = ["2026-01-10", "2026-01-12", "2026-01-16", "2026-01-17", "2026-01-18", "2026-01-19", "2026-01-20", "2026-01-22"].map((d, i) => rule(`r${i}`, d))
    const progress = new Map(rules.map((r) => [r.id, { lastPostedOn: `2026-10-${r.startDate.slice(8)}`, lastSkippedOn: null }]))
    const view = buildRecurringView({ rules, progress, accounts: [account], categories: [bills], today, currency: "INR" })
    const s = planBills(view)
    expect(PLAN_BILL_CHIPS).toBe(6)
    expect(s.chips.map((i) => i.date)).toEqual([...view.due, ...view.soon].slice(0, 6).map((i) => i.date))
    expect(s.chips.slice(0, 2).map((i) => [i.kind, i.date])).toEqual([["due", "2026-11-10"], ["due", "2026-11-12"]])
    expect([s.dueCount, s.more, s.attentionCount]).toEqual([2, view.due.length + view.soon.length - 6, 0])
  })
})

// ---- Investments ------------------------------------------------------------------------------

describe("planInvestments", () => {
  it("is empty with nothing held, and keeps the view's totals and categories", () => {
    const view = buildInvestmentsView({ today, holdings: [], deposits: [], instruments: new Map() })
    const s = planInvestments(view)
    expect(s).toMatchObject({ empty: true, holdingCount: 0, depositCount: 0, pricesAsOf: null })
    expect(s.totals).toBe(view.totals)
    expect(s.categories.map((c) => c.category)).toEqual(["shares", "funds", "etfs", "fds"])
  })
})
