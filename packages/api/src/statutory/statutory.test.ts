import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { loanErrorMessage } from "../loans/errors"
import { type LoansData, buildLoansView } from "../loans/view"
import { loadPaymentContext, payDueItem } from "../loans/writers"
import { type StatutoryData, type StatutoryDueRecord, statutoryBadgeText } from "./view"
import { addStatutoryDue, editStatutoryDue, statutoryErrorMessage } from "./writers"

const TODAY = "2026-10-28"
const KEY = "e8000000-0000-4000-8000-0000000000e1"
const DUE = "f8000000-0000-4000-8000-0000000000e1"
const ITEM = "f8000000-0000-4000-8000-0000000000e2"
const FINE = "f8000000-0000-4000-8000-0000000000e3"
const FINE_ITEM = "f8000000-0000-4000-8000-0000000000e4"
const BANK = "a8000000-0000-4000-8000-0000000000e1"
const BANK_ACCOUNT = { id: BANK, name: "HDFC Savings", currency: "INR", balanceMinor: 1_00_000_00, openingBalanceDate: "2026-01-01" }

type DbError = { code: string; message: string; details?: string }
type Rpc = { fn: string; args: Record<string, unknown> }

/** Answers selects from `rows` (applying eq / in / is filters) and records RPCs. */
function fakeClient(rows: Record<string, Record<string, unknown>[]>, rpcAnswer: (call: Rpc) => { data: unknown; error: DbError | null } = () => ({ data: { id: "new" }, error: null })) {
  const rpcs: Rpc[] = []
  const from = (table: string) => {
    let result = [...(rows[table] ?? [])]
    const builder = {
      select: () => builder,
      eq: (c: string, v: unknown) => ((result = result.filter((r) => r[c] === v)), builder),
      in: (c: string, v: unknown[]) => ((result = result.filter((r) => v.includes(r[c]))), builder),
      is: (c: string, v: unknown) => ((result = result.filter((r) => (r[c] ?? null) === v)), builder),
      gt: (c: string, v: number) => ((result = result.filter((r) => (r[c] as number) > v)), builder),
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(resolve),
    }
    return builder
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "user_local_today") return { data: TODAY, error: null }
      rpcs.push({ fn, args })
      return rpcAnswer({ fn, args })
    },
    from,
  }
  return { client: client as unknown as UserClient, rpcs }
}

const ROWS = {
  profiles: [{ id: "user-1", currency: "INR" }],
  accounts: [{ id: BANK, kind: "bank", name: "HDFC Savings", currency: "INR", opening_balance_date: "2026-01-01", opening_balance_minor: 1_00_000_00, archived_at: null }],
  account_balances: [],
  statutory_dues: [
    { id: DUE, due_type: "income_tax", currency: "INR" },
    { id: FINE, due_type: "fine", currency: "INR" },
  ],
  due_items: [
    { id: ITEM, kind: "statutory_due", loan_id: null, card_statement_id: null, borrowing_id: null, statutory_due_id: DUE, currency: "INR" },
    { id: FINE_ITEM, kind: "statutory_due", loan_id: null, card_statement_id: null, borrowing_id: null, statutory_due_id: FINE, currency: "INR" },
  ],
  statutory_due_progress: [
    { due_item_id: ITEM, paid_minor: 20_000_00, left_minor: 30_000_00 },
    { due_item_id: FINE_ITEM, paid_minor: 0, left_minor: 1_000_00 },
  ],
}

const due = (extra: Partial<StatutoryDueRecord> = {}): StatutoryDueRecord => ({
  id: DUE,
  dueType: "income_tax",
  description: "Advance tax",
  vehicleKind: null,
  issuedState: null,
  issuedCity: null,
  currency: "INR",
  amountMinor: 50_000_00,
  dueDate: "2026-10-29",
  payFromAccountId: BANK,
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...extra,
})

function data(statutory: Partial<StatutoryData> = {}): LoansData {
  return {
    today: TODAY,
    currency: "INR",
    loans: [],
    dueItems: [],
    payments: [],
    accounts: [BANK_ACCOUNT],
    statutory: {
      dues: [due()],
      items: [{ id: ITEM, statutoryDueId: DUE, dueDate: "2026-10-29", amountDueMinor: 50_000_00, status: "pending", plannedOn: null, plannedAccountId: null, payFromAccountId: BANK }],
      payments: [],
      everPaidItemIds: [],
      accountNames: {},
      ...statutory,
    },
  }
}

describe("statutory view and reminders", () => {
  it("an unpaid due: Due, everything left, a reminder the day before for the whole amount", () => {
    const view = buildLoansView(data())
    const d = view.statutory!.dues[0]!
    expect([d.name, d.badge, d.leftMinor, d.item.payFromAccountName, view.statutory!.totalDueMinor]).toEqual(["Income tax · Advance tax", "due", 50_000_00, "HDFC Savings", 50_000_00])
    expect(view.reminders.map((r) => [r.source, r.reason, r.amountMinor, r.label, r.statutoryDueId])).toEqual([["statutory", "due_tomorrow", 50_000_00, "Pay", DUE]])
  })

  it("part-paid: what is left on the badge and the reminder; interest does not count", () => {
    const view = buildLoansView(
      data({ payments: [{ id: "p1", dueItemId: ITEM, accountId: BANK, paidOn: TODAY, principalMinor: 20_000_00, interestMinor: 500_00 }] }),
    )
    const d = view.statutory!.dues[0]!
    expect([d.state, d.paidMinor, d.leftMinor, statutoryBadgeText(d), d.hasHistory, d.payments[0]?.accountName]).toEqual([
      "part_paid",
      20_000_00,
      30_000_00,
      "Part-paid, ₹30,000 left",
      true,
      "HDFC Savings",
    ])
    expect(view.reminders.map((r) => [r.amountMinor, r.label])).toEqual([[30_000_00, "Pay the rest"]])
  })

  it("overdue part-paid says what is left; paid and archived dues never remind", () => {
    const overdue = buildLoansView(
      data({
        dues: [due({ dueDate: "2026-10-20" })],
        items: [{ id: ITEM, statutoryDueId: DUE, dueDate: "2026-10-20", amountDueMinor: 50_000_00, status: "pending", plannedOn: null, plannedAccountId: null, payFromAccountId: null }],
        payments: [{ id: "p1", dueItemId: ITEM, accountId: BANK, paidOn: TODAY, principalMinor: 10_000_00, interestMinor: 0 }],
      }),
    )
    expect(statutoryBadgeText(overdue.statutory!.dues[0]!)).toBe("Overdue, ₹40,000 left")
    expect(overdue.reminders.map((r) => [r.reason, r.daysOverdue])).toEqual([["overdue", 8]])
    const archived = buildLoansView(
      data({
        dues: [due({ archivedAt: "2026-10-27T00:00:00Z" })],
        items: [{ id: ITEM, statutoryDueId: DUE, dueDate: "2026-10-29", amountDueMinor: 50_000_00, status: "paid", plannedOn: null, plannedAccountId: null, payFromAccountId: null }],
        payments: [{ id: "p1", dueItemId: ITEM, accountId: BANK, paidOn: TODAY, principalMinor: 50_000_00, interestMinor: 0 }],
      }),
    )
    expect([archived.statutory!.dues.length, archived.statutory!.archived.length, archived.reminders]).toEqual([0, 1, []])
  })
})

describe("statutory writers", () => {
  it("adds a fine with its details and no paying account", async () => {
    const { client, rpcs } = fakeClient(ROWS)
    const r = await addStatutoryDue(client, {
      dueType: "fine",
      amount: "1,000",
      dueDate: "2026-10-20",
      vehicleKind: "two_wheeler",
      issuedState: "Karnataka",
      issuedCity: "Bengaluru",
      idempotencyKey: KEY,
    })
    expect(r).toEqual({ status: "success", message: "Due added.", id: "new" })
    expect(rpcs[0]).toEqual({
      fn: "create_statutory_due",
      args: {
        p_idempotency_key: KEY,
        p_due_type: "fine",
        p_amount_minor: 1_000_00,
        p_due_date: "2026-10-20",
        p_description: undefined,
        p_vehicle_kind: "two_wheeler",
        p_issued_state: "Karnataka",
        p_issued_city: "Bengaluru",
        p_pay_from_account_id: undefined,
      },
    })
  })

  it("an edit keeps the amount at or above what is paid, before anything is sent", async () => {
    const { client, rpcs } = fakeClient(ROWS)
    const low = await editStatutoryDue(client, { statutoryDueId: DUE, amount: "19,999", dueDate: "2026-11-30", description: "Advance tax" })
    expect(low.status === "error" && low.fieldErrors).toEqual({ amount: "Enter at least what is already paid (₹20,000)" })
    expect(rpcs).toEqual([])
    const ok = await editStatutoryDue(client, { statutoryDueId: DUE, amount: "20,000", dueDate: "2026-11-30", description: "Advance tax", payFromAccountId: BANK })
    expect(ok.status).toBe("success")
    expect(rpcs[0]?.args).toMatchObject({ p_amount_minor: 20_000_00, p_due_date: "2026-11-30", p_pay_from_account_id: BANK })
  })

  it("pays a tax due with interest, at most what is left; a fine is one amount", async () => {
    const { client, rpcs } = fakeClient(ROWS, () => ({ data: { id: "pay" }, error: null }))
    const ctx = await loadPaymentContext(client, ITEM)
    expect(ctx.ok && [ctx.data.kind, ctx.data.outstandingMinor, ctx.data.interestAllowed]).toEqual(["statutory_due", 30_000_00, true])
    const over = await payDueItem(client, { dueItemId: ITEM, accountId: BANK, principal: "30,001", idempotencyKey: KEY })
    expect(over.status === "error" && over.fieldErrors).toEqual({ principal: "That's more than is still due (₹30,000)" })
    const r = await payDueItem(client, { dueItemId: ITEM, accountId: BANK, principal: "30,000", interest: "500", fees: "50", idempotencyKey: KEY })
    expect(r).toMatchObject({ status: "success", message: "Payment saved." })
    expect(rpcs[0]?.args).toMatchObject({ p_principal_minor: 30_000_00, p_interest_minor: 500_00, p_fees_minor: 0 })
    await payDueItem(client, { dueItemId: FINE_ITEM, accountId: BANK, principal: "1,000", interest: "100", idempotencyKey: KEY })
    expect(rpcs[1]?.args).toMatchObject({ p_principal_minor: 1_000_00, p_interest_minor: 0, p_fees_minor: 0 })
  })

  it("database errors read plainly", () => {
    expect(loanErrorMessage({ code: "FC052", details: "3000000" }, { currency: "INR" })).toEqual({ message: "That's more than is still due (₹30,000)", field: "principal" })
    expect(loanErrorMessage({ code: "FC054", details: "2000000" }, { currency: "INR" })).toEqual({ message: "Enter at least what is already paid (₹20,000)", field: "amount" })
    expect(loanErrorMessage({ code: "FC053" })).toEqual({ message: "This due is archived. Restore it first." })
    expect(statutoryErrorMessage({ code: "FC045", details: "100000" }, "INR")).toEqual({ message: "Archive it once it's fully paid: ₹1,000 still due." })
    expect(statutoryErrorMessage({ code: "FC050" }).message).toContain("can't be deleted")
    expect(statutoryErrorMessage({ code: "23514", message: 'violates check constraint "statutory_dues_description"' })).toEqual({
      message: "Leave out challan, vehicle and account numbers: no 4 or more digits in a row",
      field: "description",
    })
  })
})
