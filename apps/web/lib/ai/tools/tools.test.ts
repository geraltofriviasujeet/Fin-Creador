import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UserClient } from "@fin-creador/api"
import { allowedNumbers, checkAnswer } from "../output"
import { accountBalancesTool, netWorthTool } from "./balances"
import { incomeVsExpensesTool, savingsRateTool } from "./cash-flow"
import { categoryBreakdownTool } from "./categories"
import { loansAndCardsTool } from "./liabilities"
import { SEARCH_LIMIT, cleanDescription, searchTransactionsTool } from "./search"
import { type ToolContext, ToolError, toToolDef } from "./types"

// The 10.2 tools against a stand-in for the signed-in user's client. The page loaders behind
// account balances, net worth and loans have their own tests; here they are stubbed with the
// shapes they return, and the domain functions on top of them run for real.

const api = vi.hoisted(() => ({
  loadIncomeData: vi.fn(),
  loadNetWorthData: vi.fn(),
  loadLoansData: vi.fn(),
  buildLoansView: vi.fn(),
}))
vi.mock("@fin-creador/api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }))

type Calls = { name: string; args: unknown }[]

/** rpc answers by function name; from(table) answers every chain with that table's rows. */
function fakeClient(rpc: Record<string, unknown[] | null>, tables: Record<string, unknown[]> = {}, calls: Calls = []) {
  const query = (rows: unknown[] | undefined) => {
    const result = rows ? { data: rows, error: null } : { data: null, error: { code: "XX000", message: "down" } }
    const chain: Record<string, unknown> = { then: (resolve: (r: unknown) => unknown) => resolve(result) }
    for (const m of ["select", "eq", "in", "is", "order"]) chain[m] = () => chain
    return chain
  }
  return {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args })
      const rows = rpc[name]
      return rows ? { data: rows, error: null } : { data: null, error: { code: "XX000", message: "down" } }
    },
    from: (table: string) => query(tables[table]),
  } as unknown as UserClient
}

const TODAY = "2026-11-05"
const ctx = (supabase: UserClient, descriptionsOk = false): ToolContext => ({ supabase, today: TODAY, currency: "INR", descriptionsOk })

const summary = (income: number, expense: number, counts = { income: 0, expense: 0 }) => ({
  currency: "INR",
  income_minor: income,
  expense_minor: expense,
  refund_minor: 0,
  income_count: counts.income,
  expense_count: counts.expense,
  refund_count: 0,
  transfer_count: 0,
})

/** The answer the guard would let through, given this tool output. */
const passes = (text: string, out: { figures: Parameters<typeof allowedNumbers>[0]; dates?: string[] }) =>
  checkAnswer(text, allowedNumbers(out.figures, [TODAY, ...(out.dates ?? [])])).ok

beforeEach(() => vi.clearAllMocks())

describe("every tool", () => {
  const all = [incomeVsExpensesTool, savingsRateTool, categoryBreakdownTool, searchTransactionsTool, accountBalancesTool, netWorthTool, loansAndCardsTool]

  it("has a model-facing definition and refuses unknown input", () => {
    for (const tool of all) {
      expect(toToolDef(tool).inputSchema).toMatchObject({ type: "object" })
      expect(tool.input.safeParse({ period: "last_month", sql: "select 1" }).success).toBe(false)
    }
  })
})

describe("income_vs_expenses and savings_rate", () => {
  it("returns income, spent and net for the period, from transaction_summary", async () => {
    const calls: Calls = []
    const out = await incomeVsExpensesTool.run(ctx(fakeClient({ transaction_summary: [summary(8000000, 5650050, { income: 2, expense: 31 })] }, {}, calls)), {
      period: "last_month",
    })
    expect(calls[0]).toMatchObject({ name: "transaction_summary", args: { p_from: "2026-10-01", p_to: "2026-10-31" } })
    expect(out.data).toMatchObject({ period: { from: "2026-10-01", to: "2026-10-31" }, currency: "INR", income: "₹80,000", spent: "₹56,500.50", net: "₹23,499.50" })
    expect(out.period).toEqual({ start: "2026-10-01", end: "2026-10-31" })
    expect(passes("You earned ₹80,000 and spent ₹56,500.50, so ₹23,499.50 was left.", out)).toBe(true)
  })

  it("gives the Overview's savings rate, which the answer may quote", async () => {
    const out = await savingsRateTool.run(ctx(fakeClient({ transaction_summary: [summary(8000000, 6120000)] })), { period: "this_month" })
    expect(out.data).toMatchObject({ savings_rate: "23.5%", net: "₹18,800" })
    expect(out.figures[0]).toEqual({ label: "Savings rate", kind: "percent", bps: 2350 })
    expect(passes("Your savings rate is 23.5% this month.", out)).toBe(true)
    expect(passes("Your savings rate is 24% this month.", out)).toBe(false)
  })

  it("has no rate without income, and handles an empty period", async () => {
    const out = await savingsRateTool.run(ctx(fakeClient({ transaction_summary: [] })), { period: "this_month" })
    expect(out.data).toMatchObject({ savings_rate: null, income: "₹0", spent: "₹0" })
    expect(out.figures.some((f) => f.kind === "percent")).toBe(false)
  })

  it("says plainly when the figures can't be loaded, or the period is bad", async () => {
    await expect(incomeVsExpensesTool.run(ctx(fakeClient({ transaction_summary: null })), { period: "this_month" })).rejects.toBeInstanceOf(ToolError)
    await expect(savingsRateTool.run(ctx(fakeClient({})), { period: "custom", from: "2027-01-01", to: "2027-01-31" })).rejects.toThrow("future")
  })
})

describe("category_breakdown", () => {
  const cat = (id: string | null, minor: number) => ({ kind: "category", currency: "INR", bucket_start: null, category_id: id, income_minor: 0, expense_minor: minor })
  const names = [
    { id: "c1", name: "Food" },
    { id: "c2", name: "Rent" },
    { id: "c3", name: "Travel" },
  ]

  it("names the top categories, largest first, and notes other currencies", async () => {
    const rows = [cat("c1", 1200000), cat("c2", 2500000), cat("c3", -5000), { ...cat("c1", 9900), currency: "USD" }]
    const out = await categoryBreakdownTool.run(ctx(fakeClient({ dashboard_breakdown: rows }, { categories: names })), { period: "last_month" })
    expect(out.data).toMatchObject({
      categories: [
        { category: "Rent", spent: "₹25,000" },
        { category: "Food", spent: "₹12,000" },
      ],
      refunds_over_spending: [{ category: "Travel", net: "-₹50" }],
      other_currencies: ["USD"],
    })
    expect(JSON.stringify(out.data)).not.toContain("c1")
  })

  it("puts the rest under Everything else", async () => {
    const rows = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => cat(id, (i + 1) * 1000))
    const out = await categoryBreakdownTool.run(ctx(fakeClient({ dashboard_breakdown: rows }, { categories: [] })), { period: "this_year" })
    const listed = (out.data.categories as { category: string; spent: string }[]).map((c) => c.category)
    expect(listed).toHaveLength(6)
    expect(listed.at(-1)).toBe("Everything else")
  })

  it("says when nothing was spent", async () => {
    const out = await categoryBreakdownTool.run(ctx(fakeClient({ dashboard_breakdown: [] }, { categories: names })), { period: "this_month" })
    expect(out.data).toMatchObject({ categories: [], note: "No spending was recorded in this period." })
    expect(out.figures).toEqual([])
  })
})

describe("search_transactions", () => {
  const entry = (i: number, note: string | null) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    type: "expense",
    amount_minor: 45000 + i,
    currency: "INR",
    occurred_on: `2026-10-${String(10 + (i % 20)).padStart(2, "0")}`,
    account_id: "acc-1",
    counter_account_id: null,
    category_id: "c1",
    voided_at: null,
    replaces_id: null,
    refund_of_id: null,
    note,
    payment_mode: "upi",
    created_at: "2026-10-10T10:00:00.123456+00:00",
    void_reason: null,
  })
  const tables = { categories: [{ id: "c1", name: "Food" }], accounts: [{ id: "acc-1", name: "HDFC Savings" }] }

  it("asks for at most 20 entries and sends names, never IDs or digits of accounts", async () => {
    const calls: Calls = []
    const out = await searchTransactionsTool.run(ctx(fakeClient({ list_transactions: [entry(1, "Swiggy")] }, tables, calls), true), {
      period: "last_month",
      query: "swiggy",
      type: "expense",
    })
    expect(calls[0]).toMatchObject({ name: "list_transactions", args: { p_limit: SEARCH_LIMIT, p_query: "swiggy", p_type: "expense", p_from: "2026-10-01" } })
    expect(out.data.entries).toEqual([
      { date: "2026-10-11", type: "expense", amount: "₹450.01", currency: "INR", category: "Food", account: "HDFC Savings", to_account: null, description: "Swiggy" },
    ])
    expect(JSON.stringify(out.data)).not.toMatch(/acc-1|00000000-/)
    expect(out.dates).toEqual(["2026-10-11"])
    expect(out.descriptionsWithheld).toBe(false)
    expect(passes("On 2026-10-11 you paid ₹450.01 at Swiggy.", out)).toBe(true)
  })

  it("leaves descriptions out until the person agrees, and says so", async () => {
    const out = await searchTransactionsTool.run(ctx(fakeClient({ list_transactions: [entry(1, "Swiggy"), entry(2, null)] }, tables)), { period: "last_month" })
    expect((out.data.entries as { description: unknown }[]).map((e) => e.description)).toEqual([null, null])
    expect(JSON.stringify(out)).not.toContain("Swiggy")
    expect(out.descriptionsWithheld).toBe(true)
    expect(out.data.note).toContain("Descriptions are not shared")
  })

  it("doesn't ask when no entry has a description", async () => {
    const out = await searchTransactionsTool.run(ctx(fakeClient({ list_transactions: [entry(1, null)] }, tables)), { period: "last_month" })
    expect(out.descriptionsWithheld).toBe(false)
  })

  it("says when more matched than were shown, and when nothing matched", async () => {
    const full = Array.from({ length: SEARCH_LIMIT }, (_, i) => entry(i, null))
    const many = await searchTransactionsTool.run(ctx(fakeClient({ list_transactions: full }, tables)), { period: "this_year" })
    expect(many.data).toMatchObject({ shown: 20, more_not_shown: true })
    const none = await searchTransactionsTool.run(ctx(fakeClient({ list_transactions: [] }, tables)), { period: "this_year" })
    expect(none.data).toMatchObject({ entries: [], shown: 0, more_not_shown: false, note: "No entries match." })
  })

  it("finds a category by name, and refuses one that doesn't exist", async () => {
    const calls: Calls = []
    await searchTransactionsTool.run(ctx(fakeClient({ list_transactions: [] }, tables, calls)), { period: "this_month", category: "food" })
    expect(calls[0]?.args).toMatchObject({ p_category_id: "c1" })
    await expect(searchTransactionsTool.run(ctx(fakeClient({ list_transactions: [] }, tables)), { period: "this_month", category: "Pets" })).rejects.toThrow(
      "There is no category called Pets.",
    )
  })

  it("cleans every description again: long digit runs, emails and UPI handles go", () => {
    expect(cleanDescription("Paid ravi.k@okicici for dinner")).toBe("Paid for dinner")
    expect(cleanDescription("Rent to me@example.com ref 123456789")).toBe("Rent to ref")
    expect(cleanDescription("Card 4111 1111 1111 1234 at Amazon")).toBe("Card at Amazon")
    expect(cleanDescription("Table for 4 at 8pm")).toBe("Table for 4 at 8pm")
    expect(cleanDescription("  98765  ")).toBeNull()
    expect(cleanDescription("x".repeat(200))).toHaveLength(80)
  })
})

describe("account_balances", () => {
  const account = (over: Record<string, unknown>) => ({
    id: "a",
    kind: "bank",
    bankType: "savings",
    name: "HDFC Savings",
    label: "HDFC Savings ··4821",
    last4: "4821",
    institution: "HDFC",
    currency: "INR",
    openingBalanceMinor: 1000000,
    openingBalanceDate: "2026-01-01",
    inflowMinor: 500000,
    outflowMinor: 200000,
    archived: false,
    lastActivityAt: "2026-11-01T00:00:00Z",
    ...over,
  })

  it("gives each active account by name and Total available, never the last four digits", async () => {
    api.loadIncomeData.mockResolvedValue({
      ok: true,
      data: {
        currency: "INR",
        timeZone: "Asia/Kolkata",
        today: TODAY,
        sources: [],
        entries: [],
        accounts: [
          account({}),
          account({ id: "b", kind: "cash", bankType: null, name: "Wallet", last4: null, openingBalanceMinor: 250000, inflowMinor: 0, outflowMinor: 0 }),
          account({ id: "c", name: "Chase", currency: "USD", last4: "1111" }),
          account({ id: "d", name: "Old account", archived: true }),
        ],
      },
    })
    const out = await accountBalancesTool.run(ctx(fakeClient({})), {})
    expect(out.data).toMatchObject({
      as_of: TODAY,
      total_available: "₹15,500",
      cash_in_hand: "₹2,500",
      accounts: [
        { name: "HDFC Savings", kind: "bank", balance: "₹13,000", in_total: true },
        { name: "Chase", kind: "bank", balance: "$13,000", in_total: false },
        { name: "Wallet", kind: "cash", balance: "₹2,500", in_total: true },
      ],
    })
    expect(JSON.stringify(out)).not.toMatch(/4821|1111|Old account/)
  })

  it("handles no accounts, and a failed load", async () => {
    api.loadIncomeData.mockResolvedValue({ ok: true, data: { currency: "INR", timeZone: "Asia/Kolkata", today: TODAY, sources: [], entries: [], accounts: [] } })
    const out = await accountBalancesTool.run(ctx(fakeClient({})), {})
    expect(out.data).toMatchObject({ total_available: "₹0", accounts: [], note: "The person has no active accounts." })
    api.loadIncomeData.mockResolvedValue({ ok: false, reason: "unavailable" })
    await expect(accountBalancesTool.run(ctx(fakeClient({})), {})).rejects.toBeInstanceOf(ToolError)
  })
})

describe("net_worth", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    currency: "INR",
    today: TODAY,
    accounts: {
      accounts: [
        { id: "a", kind: "bank", name: "HDFC", currency: "INR", balanceMinor: 5000000, archived: false },
        { id: "l", kind: "loan", name: "Car loan", currency: "INR", balanceMinor: -2000000, archived: false },
      ],
      pendingCapitalised: [],
    },
    investments: { holdings: [], deposits: [{ name: "SBI", currency: "INR", valueMinor: 1000000, matured: false }] },
    statutory: [],
    ...over,
  })

  it("gives the Overview's net worth with its lines", async () => {
    api.loadNetWorthData.mockResolvedValue({ ok: true, timeZone: "Asia/Kolkata", data: input() })
    const out = await netWorthTool.run(ctx(fakeClient({})), {})
    expect(out.data).toMatchObject({ net_worth: "₹40,000", assets: "₹60,000", liabilities: "₹20,000", could_not_load: [] })
    expect((out.data.lines as { line: string }[]).map((l) => l.line)).toEqual(["Total available", "Fixed deposits", "Loans (card EMIs included)"])
    expect(passes("Your net worth is ₹40,000: ₹60,000 in assets less ₹20,000 owed.", out)).toBe(true)
  })

  it("gives no total when a part failed, and says which", async () => {
    api.loadNetWorthData.mockResolvedValue({ ok: true, timeZone: "Asia/Kolkata", data: input({ investments: null }) })
    const out = await netWorthTool.run(ctx(fakeClient({})), {})
    expect(out.data).toMatchObject({ net_worth: null, could_not_load: [expect.any(String)] })
    expect(out.figures.map((f) => f.label)).not.toContain("Net worth")
  })
})

describe("loans_and_cards", () => {
  const loan = { name: "Home loan", typeLabel: "Home loan", outstandingMinor: 250000000, badge: "due", loan: { currency: "INR", emiMinor: 2500000 }, next: { dueDate: "2026-11-10", amountMinor: 2500000 } }
  const card = {
    name: "Regalia",
    owedMinor: 1850000,
    creditMinor: 0,
    utilisation: { bps: 3700, level: "ok" },
    card: { currency: "INR", limitMinor: 5000000 },
    badge: "due",
    latestBill: { dueDate: "2026-11-20", amountDueMinor: 1500000, leftMinor: 1500000, minimumDueMinor: 75000, statement: { statementDate: "2026-11-01" } },
  }
  const borrowing = { name: "Ravi Kumar", owedMinor: 1000000, badge: "owed", due: { dueDate: "2026-12-01" }, borrowing: { lender: "Ravi Kumar", relationship: "friends", currency: "INR" } }

  it("lists loans, cards and money borrowed, without the lender's name", async () => {
    api.loadLoansData.mockResolvedValue({ ok: true, data: {} })
    api.buildLoansView.mockReturnValue({
      today: TODAY,
      currency: "INR",
      loans: [loan, { ...loan, name: "Closed one", badge: "closed" }],
      longTermOutstandingMinor: 250000000,
      shortTerm: { cards: [card], borrowings: [borrowing, { ...borrowing, badge: "repaid" }], totalOwedMinor: 2850000 },
    })
    const out = await loansAndCardsTool.run(ctx(fakeClient({})), {})
    expect(out.data).toMatchObject({
      loans_outstanding_not_card_emis: "₹25,00,000",
      cards_card_emis_and_borrowing_owed: "₹28,500",
      loans: [{ name: "Home loan", outstanding: "₹25,00,000", emi: "₹25,000", next_due: { date: "2026-11-10", amount: "₹25,000" }, status: "Due" }],
      cards: [{ name: "Regalia", owed: "₹18,500", limit_used: "37%", latest_bill: { due_date: "2026-11-20", minimum: "₹750" } }],
      borrowed: [{ name: "Borrowed from friends", owed: "₹10,000", return_by: "2026-12-01" }],
    })
    expect(JSON.stringify(out)).not.toContain("Ravi")
    expect(passes("Your Regalia card owes ₹18,500, 37% of its limit; the bill of ₹15,000 is due on 2026-11-20.", out)).toBe(true)
  })

  it("says when nothing is owed", async () => {
    api.loadLoansData.mockResolvedValue({ ok: true, data: {} })
    api.buildLoansView.mockReturnValue({ today: TODAY, currency: "INR", loans: [], longTermOutstandingMinor: 0, shortTerm: { cards: [], borrowings: [], totalOwedMinor: 0 } })
    const out = await loansAndCardsTool.run(ctx(fakeClient({})), {})
    expect(out.data).toMatchObject({ loans: [], cards: [], borrowed: [], note: "The person has no active loans, cards or money borrowed." })
  })

  it("fails plainly when the loans can't be loaded", async () => {
    api.loadLoansData.mockResolvedValue({ ok: false, reason: "unavailable" })
    await expect(loansAndCardsTool.run(ctx(fakeClient({})), {})).rejects.toBeInstanceOf(ToolError)
  })
})
