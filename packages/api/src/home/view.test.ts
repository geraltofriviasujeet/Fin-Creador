import { describe, expect, it } from "vitest"
import { type GoalRecord, buildGoalsView } from "../goals/view"
import { buildLoansView } from "../loans/view"
import type { RecurringRule } from "../recurring/view"
import type { LedgerAccount, LedgerCategory, TransactionsContext } from "../transactions/types"
import { HOME_COMING_UP_LIMIT, type HomeInput, type TodayEntry, buildHome, startOfTodayAccounts } from "./view"

// Worked examples from docs/sprint-plan.md, "Safe to spend rule (approved 2026-11-23)",
// through the Home builder (start-of-today balances, bills from recurring rules, goal plans).
const today = "2026-11-23" // Monday
const now = new Date("2026-11-23T06:30:00Z") // 12:00 in Asia/Kolkata
const R = (rupees: number) => rupees * 100

const account = (id: string, over: Partial<LedgerAccount> = {}): LedgerAccount => ({
  id, kind: "bank", bankType: "savings", label: id, currency: "INR", openingBalanceMinor: 0, openingBalanceDate: "2026-11-01",
  inflowMinor: 0, outflowMinor: 0, archived: false, ...over,
})
const category = (id: string, name: string, kind: LedgerCategory["kind"] = "expense"): LedgerCategory => ({
  id, kind, name, icon: id, archived: false, defaultAccountId: null, key: null,
})
const rule = (id: string, over: Partial<RecurringRule> = {}): RecurringRule => ({
  id, type: "expense", amountMinor: 0, currency: "INR", accountId: "savings", counterAccountId: null, categoryId: "bills",
  paymentMode: null, note: null, frequency: "monthly", startDate: "2026-01-01", endDate: null, archived: false, ...over,
})
const entry = (id: string, over: Partial<TodayEntry>): TodayEntry => ({
  id, type: "expense", amountMinor: 0, currency: "INR", occurredOn: today, accountId: "savings", counterAccountId: null,
  categoryId: "food", voided: false, recurringRuleId: null, ...over,
})
const goal = (over: Partial<GoalRecord> = {}): GoalRecord => ({
  id: "emergency", type: "emergency", name: "Emergency fund", targetMinor: R(12_000), savedMinor: R(8_000), currency: "INR", // ₹4,000 left over two months: ₹2,000 a month
  targetDate: "2026-12-15", details: {}, archivedAt: null, createdAt: "2026-01-01T00:00:00Z", ...over,
})

const categories = [category("bills", "Bills"), category("food", "Food"), category("rent", "Rent"), category("salary", "Salary", "income")]
const salary = rule("salary", { type: "income", amountMinor: R(85_000), categoryId: "salary", note: "Salary" })
// Electricity 25 Nov, phone 28 Nov, internet 30 Nov; October's are paid.
const monthlyBills = [
  rule("electricity", { amountMinor: R(2_400), startDate: "2026-01-25", note: "Electricity" }),
  rule("phone", { amountMinor: R(600), startDate: "2026-01-28", note: "Phone" }),
  rule("internet", { amountMinor: R(1_000), startDate: "2026-01-30", note: "Internet" }),
]
const paidOctober = { electricity: "2026-10-25", phone: "2026-10-28", internet: "2026-10-30" }

function input({
  accounts,
  rules,
  posted = {},
  todayEntries = [],
  goals = [goal()],
  spending = new Map<string, number>(),
  hasEntries = true,
}: {
  accounts: LedgerAccount[]
  rules: RecurringRule[]
  posted?: Record<string, string>
  todayEntries?: TodayEntry[]
  goals?: GoalRecord[]
  spending?: Map<string, number>
  hasEntries?: boolean
}): HomeInput {
  const context: TransactionsContext = {
    today, currency: "INR", timeZone: "Asia/Kolkata", accounts, loanAccounts: [], cardAccounts: [], categories,
    lastExpenseAccountId: null, hasEntries,
  }
  return {
    now,
    name: "Asha Rao",
    context,
    recurring: {
      rules,
      progress: new Map(Object.entries(posted).map(([id, d]) => [id, { lastPostedOn: d, lastSkippedOn: null }])),
    },
    loans: buildLoansView({ today, currency: "INR", loans: [], dueItems: [], payments: [], accounts: [] }),
    goals: buildGoalsView({ today, currency: "INR", goals, budgetRows: [], categories: [], spending }),
    spending,
    todayEntries,
  }
}

// Example 1: ₹38,500 savings (₹1,200 spent from it today) and ₹3,500 cash.
const example1 = () =>
  input({
    accounts: [account("savings", { label: "HDFC Savings", openingBalanceMinor: R(38_500), outflowMinor: R(1_200) }), account("cash", { kind: "cash", bankType: null, label: "Cash", openingBalanceMinor: R(3_500) })],
    rules: [salary, ...monthlyBills],
    posted: paidOctober,
    todayEntries: [entry("lunch", { amountMinor: R(1_200) })],
  })

describe("buildHome: Safe to spend", () => {
  it("example 1: ₹4,500 a day until 1 Dec, ₹3,300 left today", () => {
    const home = buildHome(example1())
    expect(home.safe.kind).toBe("daily")
    if (home.safe.kind !== "daily") return
    expect(home.safe.moneyLeftMinor).toBe(R(42_000)) // start of today: today's ₹1,200 is not subtracted
    expect(home.safe.billsMinor).toBe(R(4_000))
    expect(home.safe.goalSavingMinor).toBe(R(2_000))
    expect(home.safe.nextIncomeDate).toBe("2026-12-01")
    expect(home.safe.days).toBe(8)
    expect(home.safe.dailyMinor).toBe(R(4_500))
    expect(home.safe.leftTodayMinor).toBe(R(3_300))
    expect(home.safe.shortAccounts).toEqual([])
  })

  it("example 1 with no income date: ₹36,000 money left this month", () => {
    const home = buildHome({ ...example1(), recurring: { rules: monthlyBills, progress: example1().recurring.progress } })
    expect(home.safe.kind).toBe("month")
    expect(home.safe.availableMinor).toBe(R(36_000))
  })

  it("example 5: ₹0 a day, ₹3,000 short before 1 Dec, HDFC Savings named with the rent", () => {
    const home = buildHome(
      input({
        accounts: [account("savings", { label: "HDFC Savings", openingBalanceMinor: R(9_000) })],
        rules: [salary, rule("rent", { amountMinor: R(12_000), startDate: "2026-01-28", categoryId: "rent" })],
        posted: { rent: "2026-10-28" },
        goals: [],
      }),
    )
    if (home.safe.kind !== "daily") throw new Error("expected a daily figure")
    expect(home.safe.dailyMinor).toBe(0)
    expect(home.safe.shortMinor).toBe(R(3_000))
    expect(home.safe.shortAccounts).toEqual([
      expect.objectContaining({ accountName: "HDFC Savings", bill: expect.objectContaining({ name: "Rent", dueDate: "2026-11-28" }), shortAfterBillMinor: R(3_000) }),
    ])
  })

  it("payday: salary posted from the rule today counts in money left", () => {
    const home = buildHome(
      input({
        accounts: [account("savings", { openingBalanceMinor: R(6_200), inflowMinor: R(85_000), outflowMinor: R(500) })],
        rules: [{ ...salary, startDate: "2026-01-23" }],
        todayEntries: [entry("pay", { type: "income", amountMinor: R(85_000), categoryId: "salary", recurringRuleId: "salary" }), entry("tea", { amountMinor: R(500) })],
        goals: [],
      }),
    )
    if (home.safe.kind !== "daily") throw new Error("expected a daily figure")
    expect(home.safe.moneyLeftMinor).toBe(R(91_200))
    expect(home.safe.paydayPending).toBe(false)
  })

  it("payday: salary entered by hand to the same source also counts; another source does not", () => {
    const base = {
      accounts: [account("savings", { openingBalanceMinor: R(6_200), inflowMinor: R(85_000) })],
      rules: [{ ...salary, startDate: "2026-01-23" }],
      goals: [],
    }
    const bySource = buildHome(input({ ...base, todayEntries: [entry("pay", { type: "income", amountMinor: R(85_000), categoryId: "salary" })] }))
    const other = buildHome(input({ ...base, todayEntries: [entry("gift", { type: "income", amountMinor: R(85_000), categoryId: "gift" })] }))
    expect(bySource.safe.moneyLeftMinor).toBe(R(91_200))
    expect(other.safe.moneyLeftMinor).toBe(R(6_200))
    expect(other.safe.kind === "daily" && other.safe.paydayPending).toBe(true)
  })
})

describe("startOfTodayAccounts", () => {
  it("takes today's posted entries back out, voided ones and other days untouched, transfers on both sides", () => {
    const accounts = [
      account("savings", { openingBalanceMinor: R(10_000), inflowMinor: R(2_000), outflowMinor: R(3_000) }),
      account("cash", { kind: "cash", bankType: null, openingBalanceMinor: R(500), inflowMinor: R(1_000) }),
      account("card", { kind: "card", bankType: null }),
    ]
    const rows = startOfTodayAccounts(accounts, [
      entry("atm", { type: "transfer", amountMinor: R(1_000), accountId: "savings", counterAccountId: "cash" }),
      entry("refund", { type: "refund", amountMinor: R(2_000) }),
      entry("void", { amountMinor: R(9_999), voided: true }),
    ])
    expect(rows.map((r) => [r.id, r.startOfTodayMinor])).toEqual([
      ["savings", R(10_000 + 2_000 - 3_000) - R(2_000) + R(1_000)],
      ["cash", R(500)],
    ])
  })

  it("an entry dated before the opening-balance date never counted, so it is not taken out", () => {
    const rows = startOfTodayAccounts([account("savings", { openingBalanceMinor: R(100), openingBalanceDate: "2026-11-24" })], [entry("x", { amountMinor: R(50) })])
    expect(rows[0]?.startOfTodayMinor).toBe(R(100))
  })
})

describe("buildHome: lists", () => {
  it("Coming up: unpaid bills soonest first, capped, with the account name", () => {
    const many = Array.from({ length: 7 }, (_, i) => rule(`b${i}`, { amountMinor: R(100), startDate: `2026-01-${String(24 + i).padStart(2, "0")}`, note: `Bill ${i}` }))
    const home = buildHome(input({ accounts: [account("savings", { label: "HDFC Savings" })], rules: [salary, ...many], goals: [] }))
    expect(home.comingUp).toHaveLength(HOME_COMING_UP_LIMIT)
    expect(home.comingUp[0]).toMatchObject({ name: "Bill 0", dueDate: "2026-11-24", accountName: "HDFC Savings", kind: "bill" })
    expect(home.comingUpMore).toBe(2)
  })

  it("Coming up leaves out paid, skipped and archived bills", () => {
    const home = buildHome(
      input({
        accounts: [account("savings")],
        rules: [
          salary,
          rule("paid", { startDate: "2026-01-25", amountMinor: R(1) }),
          rule("skipped", { startDate: "2026-01-26", amountMinor: R(1) }),
          rule("archived", { startDate: "2026-01-27", amountMinor: R(1), archived: true }),
          rule("open", { startDate: "2026-01-28", amountMinor: R(1) }),
        ],
        posted: { paid: "2026-11-25" },
        goals: [],
      }),
    )
    const progress = new Map([["skipped", { lastPostedOn: null, lastSkippedOn: "2026-11-26" }]])
    const withSkip = buildHome({ ...input({ accounts: [account("savings")], rules: [salary, rule("skipped", { startDate: "2026-01-26", amountMinor: R(1) })], goals: [] }), recurring: { rules: [salary, rule("skipped", { startDate: "2026-01-26", amountMinor: R(1) })], progress } })
    expect(home.comingUp.filter((b) => b.dueDate < "2026-12-01").map((b) => b.id)).toEqual(["skipped:2026-11-26", "open:2026-11-28"])
    expect(withSkip.comingUp.filter((b) => b.dueDate < "2026-12-01")).toEqual([])
  })

  it("Where it went: top categories by spending, with budgets; Your money: largest balance first", () => {
    const home = buildHome(
      input({
        accounts: [account("small", { openingBalanceMinor: R(10) }), account("big", { openingBalanceMinor: R(1_000) }), account("old", { openingBalanceMinor: R(5_000), archived: true })],
        rules: [],
        goals: [],
        spending: new Map([["food", R(300)], ["rent", R(12_000)], ["bills", R(0)]]),
      }),
    )
    expect(home.where.categories.map((c) => [c.name, c.spentMinor])).toEqual([["Rent", R(12_000)], ["Food", R(300)]])
    expect(home.where.spentMinor).toBe(R(12_300))
    expect(home.money.accounts.map((a) => a.id)).toEqual(["big", "small"])
    expect(home.money.totalMinor).toBe(R(1_010))
  })

  it("a new user (no account, no entry) is flagged for the first-run state", () => {
    const home = buildHome(input({ accounts: [], rules: [], goals: [], hasEntries: false }))
    expect(home.isNew).toBe(true)
    expect(home.safe.kind).toBe("month")
    expect(home.reminders).toEqual([])
  })
})
