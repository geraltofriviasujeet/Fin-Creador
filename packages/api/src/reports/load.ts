import {
  type AccountKind,
  type CashFlowReport,
  type FdCompounding,
  type IsoDate,
  type LiabilityKind,
  type NetWorth,
  type SeriesPoint,
  cashFlowReport,
  isLiabilityKind,
  isMoneyAccountKind,
  localDateInTimeZone,
  monthRange,
  netWorth,
  netWorthSeries,
  trendDates,
} from "@fin-creador/domain"
import { type UserClient, userToday } from "../income/client"
import { loadNetWorthData } from "../net-worth/load"
import { loadStatutoryData } from "../statutory/load"
import { buildStatutoryView } from "../statutory/view"

// Loads the Reports page (Sprint 8c) as the signed-in user (RLS: only their own rows).
//   Cash flow: one dashboard_breakdown call per month (the Overview's own reader, so a month
//   here equals that month on the Overview).
//   Trend: account_balances_at for every month-end and today in one call, plus loans, fixed
//   deposits and statutory dues; rules in packages/domain/src/reports.ts.

export type ReportsLoad<T> = { ok: true; data: T } | { ok: false; reason: "unauthenticated" | "unavailable" }

export type CashFlowData = { today: IsoDate; currency: string; report: CashFlowReport; otherCurrencies: string[] }

export async function loadCashFlow(supabase: UserClient, months: readonly IsoDate[]): Promise<ReportsLoad<CashFlowData>> {
  const day = await userToday(supabase)
  if (!day.ok) return day
  const profile = await supabase.from("profiles").select("currency").eq("id", day.userId).maybeSingle()
  if (profile.error || !profile.data) return { ok: false, reason: "unavailable" }
  const currency = profile.data.currency
  const results = await Promise.all(months.map((m) => supabase.rpc("dashboard_breakdown", { p_from: m, p_to: monthRange(m).end })))
  if (results.some((r) => r.error || !Array.isArray(r.data))) return { ok: false, reason: "unavailable" }
  const other = new Set<string>()
  const monthly = results.map((r, i) => {
    const rows = r.data ?? []
    for (const row of rows) if (row.currency !== currency && (row.income_minor > 0 || row.expense_minor > 0)) other.add(row.currency)
    const same = rows.filter((row) => row.currency === currency)
    const buckets = same.filter((row) => row.kind !== "category")
    return {
      month: months[i]!,
      incomeMinor: buckets.reduce((s, row) => s + row.income_minor, 0),
      expenseMinor: buckets.reduce((s, row) => s + row.expense_minor, 0),
      categories: same.filter((row) => row.kind === "category").map((row) => ({ categoryId: row.category_id, expenseMinor: row.expense_minor })),
    }
  })
  return { ok: true, data: { today: day.today, currency, report: cashFlowReport(monthly, day.today), otherCurrencies: [...other].sort() } }
}

export type TrendData = {
  today: IsoDate
  currency: string
  timeZone: string
  /** Shares, funds and ETFs left out of every point. */
  points: SeriesPoint[]
  /** Today with investments (the Overview card), or null when it couldn't load. */
  current: NetWorth | null
}

const localDate = (timestamp: string | null, timeZone: string): IsoDate | null => (timestamp ? localDateInTimeZone(new Date(timestamp), timeZone) : null)

export async function loadNetWorthTrend(supabase: UserClient, firstMonth: IsoDate): Promise<ReportsLoad<TrendData>> {
  const day = await userToday(supabase)
  if (!day.ok) return day
  const profile = await supabase.from("profiles").select("currency, time_zone").eq("id", day.userId).maybeSingle()
  if (profile.error || !profile.data) return { ok: false, reason: "unavailable" }
  const { currency, time_zone: timeZone } = profile.data
  const dates = trendDates(firstMonth, day.today)

  const [accounts, balances, loans, capitalised, deposits, statutory, current] = await Promise.all([
    supabase.from("accounts").select("id, kind, name, currency"),
    supabase.rpc("account_balances_at", { p_dates: dates }),
    supabase.from("loans").select("id, account_id, capitalised_minor").eq("moratorium_interest", "capitalise").gt("capitalised_minor", 0),
    supabase.from("due_payments").select("due_item_id, paid_on").gt("capitalised_minor", 0).is("voided_at", null),
    supabase.from("fixed_deposits").select("bank, label, principal_minor, rate_bps, compounding, start_date, maturity_date, archived_at"),
    loadStatutoryData(supabase),
    loadNetWorthData(supabase),
  ])
  if (accounts.error || balances.error || !Array.isArray(balances.data) || loans.error || capitalised.error || deposits.error || !statutory) {
    return { ok: false, reason: "unavailable" }
  }
  const itemIds = capitalised.data.map((p) => p.due_item_id)
  const items = itemIds.length ? await supabase.from("due_items").select("id, loan_id").in("id", itemIds) : { data: [], error: null }
  if (items.error) return { ok: false, reason: "unavailable" }
  const loanOfItem = new Map(items.data.map((i) => [i.id, i.loan_id]))
  const postedOn = new Map<string, IsoDate>()
  for (const p of capitalised.data) {
    const loanId = loanOfItem.get(p.due_item_id)
    if (loanId && (!postedOn.has(loanId) || p.paid_on < postedOn.get(loanId)!)) postedOn.set(loanId, p.paid_on)
  }

  const view = buildStatutoryView(statutory, { today: day.today, currency, accounts: [] })
  const names = new Map([...view.dues, ...view.archived].map((d) => [d.due.id, d.name]))
  const dueOfItem = new Map(statutory.items.map((i) => [i.id, i.statutoryDueId]))

  const points = netWorthSeries({
    currency,
    dates,
    accounts: accounts.data.flatMap((a) => (isMoneyAccountKind(a.kind) || isLiabilityKind(a.kind) ? [{ id: a.id, kind: a.kind as AccountKind | LiabilityKind, name: a.name, currency: a.currency }] : [])),
    balances: balances.data.map((b) => ({ asOf: b.as_of, accountId: b.account_id, balanceMinor: b.balance_minor })),
    capitalising: loans.data.map((l) => ({ accountId: l.account_id, minor: l.capitalised_minor, postedOn: postedOn.get(l.id) ?? null })),
    deposits: deposits.data.map((d) => ({
      name: d.label ? `${d.bank} · ${d.label}` : d.bank,
      currency: "INR", // Sprint 7: fixed deposits are in rupees only.
      deposit: { principalMinor: d.principal_minor, rateBps: d.rate_bps, compounding: d.compounding as FdCompounding, startDate: d.start_date, maturityDate: d.maturity_date },
      archivedOn: localDate(d.archived_at, timeZone),
    })),
    dues: statutory.dues.map((d) => ({
      name: names.get(d.id) ?? "Statutory due",
      currency: d.currency,
      amountMinor: d.amountMinor,
      addedOn: localDate(d.createdAt, timeZone)!,
      archivedOn: localDate(d.archivedAt, timeZone),
      payments: statutory.payments.filter((p) => dueOfItem.get(p.dueItemId) === d.id).map((p) => ({ paidOn: p.paidOn, minor: p.principalMinor })),
    })),
  })
  return { ok: true, data: { today: day.today, currency, timeZone, points, current: current.ok ? netWorth(current.data) : null } }
}
