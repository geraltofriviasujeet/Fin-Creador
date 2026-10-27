import { type DueKind, type DueStatus, type LoanRateKind, type LoanStartMode, type LoanType, type MoratoriumInterest, type ReminderReason, MONEY_ACCOUNT_KINDS } from "@fin-creador/domain"
import { type UserClient, userToday } from "../income/client"
import { loadShortTermData } from "../cards/load"
import { type LoansData, buildLoansView } from "./view"
import { accountBalances } from "./writers"

// Loads what the Loans & Liabilities page, the bell and the Overview "Due soon" card need, as
// the signed-in user (RLS: only their own rows).

export type LoansDataLoad = { ok: true; data: LoansData } | { ok: false; reason: "unauthenticated" | "unavailable" }

/** PostgREST returns at most 1,000 rows a request (max_rows); a long loan has up to 480 instalments. */
const PAGE = 1000

async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error || !data) return null
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}

export async function loadLoansData(supabase: UserClient): Promise<LoansDataLoad> {
  const day = await userToday(supabase)
  if (!day.ok) return day
  const [profile, loans, items, payments, accounts, shortTerm] = await Promise.all([
    supabase.from("profiles").select("currency").eq("id", day.userId).maybeSingle(),
    supabase
      .from("loans")
      .select(
        "id, account_id, loan_type, type_other, lender, nickname, currency, sanctioned_minor, disbursed_minor, rate_bps, rate_kind, tenure_months, start_mode, opening_outstanding_minor, instalment_months, first_due_date, moratorium_months, moratorium_interest, capitalised_minor, emi_estimate_minor, emi_minor, tracking_started_on, archived_at, created_at, card_id",
      )
      .order("created_at"),
    allPages((from, to) =>
      supabase
        .from("due_items")
        .select("id, kind, loan_id, seq, due_date, amount_due_minor, status, planned_on, planned_account_id")
        .not("loan_id", "is", null)
        .order("due_date")
        .order("id")
        .range(from, to),
    ),
    allPages((from, to) =>
      supabase
        .from("due_payments")
        .select("id, due_item_id, account_id, paid_on, principal_minor, interest_minor, fees_minor, capitalised_minor")
        .is("voided_at", null)
        .order("id")
        .range(from, to),
    ),
    supabase.from("accounts").select("id, name, currency, opening_balance_date").in("kind", [...MONEY_ACCOUNT_KINDS]).is("archived_at", null).order("created_at"),
    loadShortTermData(supabase),
  ])
  if (profile.error || !profile.data || loans.error || !loans.data || !items || !payments || accounts.error || !accounts.data || !shortTerm) {
    return { ok: false, reason: "unavailable" }
  }
  const balances = await accountBalances(supabase, [...loans.data.map((l) => l.account_id), ...accounts.data.map((a) => a.id)])
  if (!balances) return { ok: false, reason: "unavailable" }
  return {
    ok: true,
    data: {
      today: day.today,
      currency: profile.data.currency,
      loans: loans.data.map((l) => ({
        id: l.id,
        accountId: l.account_id,
        loanType: l.loan_type as LoanType,
        typeOther: l.type_other,
        lender: l.lender,
        nickname: l.nickname,
        currency: l.currency,
        sanctionedMinor: l.sanctioned_minor,
        disbursedMinor: l.disbursed_minor,
        rateBps: l.rate_bps,
        rateKind: l.rate_kind as LoanRateKind,
        tenureMonths: l.tenure_months,
        startMode: l.start_mode as LoanStartMode,
        openingOutstandingMinor: l.opening_outstanding_minor,
        instalmentMonths: l.instalment_months,
        firstDueDate: l.first_due_date,
        moratoriumMonths: l.moratorium_months,
        moratoriumInterest: l.moratorium_interest as MoratoriumInterest | null,
        capitalisedMinor: l.capitalised_minor,
        emiEstimateMinor: l.emi_estimate_minor,
        emiMinor: l.emi_minor,
        trackingStartedOn: l.tracking_started_on,
        archivedAt: l.archived_at,
        createdAt: l.created_at,
        balanceMinor: balances.get(l.account_id) ?? 0,
        cardId: l.card_id,
      })),
      dueItems: items.flatMap((d) =>
        d.loan_id
          ? [
              {
                id: d.id,
                kind: d.kind as DueKind,
                loanId: d.loan_id,
                seq: d.seq,
                dueDate: d.due_date,
                amountDueMinor: d.amount_due_minor,
                status: d.status as DueStatus,
                plannedOn: d.planned_on,
                plannedAccountId: d.planned_account_id,
              },
            ]
          : [],
      ),
      payments: payments.map((p) => ({
        id: p.id,
        dueItemId: p.due_item_id,
        accountId: p.account_id,
        paidOn: p.paid_on,
        principalMinor: p.principal_minor,
        interestMinor: p.interest_minor,
        feesMinor: p.fees_minor,
        capitalisedMinor: p.capitalised_minor,
      })),
      accounts: accounts.data.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency,
        balanceMinor: balances.get(a.id) ?? 0,
        openingBalanceDate: a.opening_balance_date,
      })),
      shortTerm: shortTerm.data,
      shortTermHistory: shortTerm.history,
    },
  }
}

/** One line in the bell: serialisable, no account names or digits. */
export type BellReminder = {
  id: string
  /** The loan, card or person owed. */
  name: string
  label: string
  dueDate: string | null
  amountMinor: number | null
  currency: string
  reason: ReminderReason | "statement"
  daysOverdue: number
}

/** The bell's reminders (the same list as Due soon), or null when they can't be loaded. */
export async function loadBellReminders(supabase: UserClient): Promise<BellReminder[] | null> {
  const data = await loadLoansData(supabase)
  if (!data.ok) return null
  return buildLoansView(data.data).reminders.map((r) => ({
    id: r.id,
    name: r.name,
    label: r.label,
    dueDate: r.dueDate,
    amountMinor: r.amountMinor,
    currency: r.currency,
    reason: r.reason,
    daysOverdue: r.daysOverdue,
  }))
}
