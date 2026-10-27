// Transactions filters, shared by web (read from and written to the URL, so links, the back
// button and the topbar search work) and mobile. The filtering runs in the database
// (list_transactions, transaction_summary).
import type { TransactionFilters } from "./list"
import type { LedgerAccount, LedgerCategory, TransactionsContext } from "./types"
import { type DateRange, type IsoDate, isIsoDate, monthRange, previousMonthRange, yearRange } from "@fin-creador/domain"

export const TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfers" },
] as const
export type TypeTab = (typeof TYPE_TABS)[number]["value"]

export const PERIODS = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-year", label: "This year" },
  { value: "custom", label: "Custom range" },
] as const
export type Period = (typeof PERIODS)[number]["value"]

export type Filters = {
  type: TypeTab
  period: Period
  from: IsoDate
  to: IsoDate
  category: string
  account: string
  q: string
  showVoided: boolean
}

type Params = { get(name: string): string | null }

const oneOf = <T extends string>(values: readonly { value: T }[], v: string | null, fallback: T): T =>
  values.some((x) => x.value === v) ? (v as T) : fallback

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuidOrEmpty = (v: string | null) => (v && UUID.test(v) ? v : "")

export function readFilters(params: Params, today: IsoDate): Filters {
  const period = oneOf(PERIODS, params.get("period"), "this-month")
  const month = monthRange(today)
  const from = params.get("from") ?? ""
  const to = params.get("to") ?? ""
  return {
    type: oneOf(TYPE_TABS, params.get("type"), "all"),
    period,
    from: isIsoDate(from) ? from : month.start,
    to: isIsoDate(to) ? to : today,
    category: uuidOrEmpty(params.get("category")),
    account: uuidOrEmpty(params.get("account")),
    q: (params.get("q") ?? "").trim().slice(0, 100),
    showVoided: params.get("voided") === "1",
  }
}

/** Query string for a filter change; defaults are left out to keep URLs short. */
export function filtersToQuery(f: Filters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  if (f.type !== "all") p.set("type", f.type)
  if (f.period !== "this-month") p.set("period", f.period)
  if (f.period === "custom") {
    p.set("from", f.from)
    p.set("to", f.to)
  }
  if (f.category) p.set("category", f.category)
  if (f.account) p.set("account", f.account)
  if (f.q) p.set("q", f.q)
  if (f.showVoided) p.set("voided", "1")
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ""
}

/** The date range for the chosen period, in the user's calendar (today comes from the database in Phase 2). */
export function periodRange(f: Pick<Filters, "period" | "from" | "to">, today: IsoDate): DateRange {
  switch (f.period) {
    case "last-month":
      return previousMonthRange(today)
    case "this-year":
      return yearRange(today)
    case "custom":
      return f.from <= f.to ? { start: f.from, end: f.to } : { start: f.to, end: f.from }
    default:
      return monthRange(today)
  }
}

export function periodLabel(f: Pick<Filters, "period">): string {
  return PERIODS.find((p) => p.value === f.period)?.label ?? "This month"
}

/** The period before, for "from last month" trends; only month presets have one. */
export function previousPeriod(f: Pick<Filters, "period">, today: IsoDate): DateRange | null {
  if (f.period === "this-month") return previousMonthRange(today)
  if (f.period === "last-month") return previousMonthRange(previousMonthRange(today).start)
  return null
}

export type Lookup = { accounts: Map<string, Pick<LedgerAccount, "label" | "archived">>; categories: Map<string, LedgerCategory> }

/** Names for entries: money accounts and the loan accounts of loan payments. */
export function ledgerLookup(context: Pick<TransactionsContext, "accounts" | "loanAccounts" | "categories">): Lookup {
  return {
    accounts: new Map<string, Pick<LedgerAccount, "label" | "archived">>([
      ...context.accounts.map((a) => [a.id, a] as const),
      ...(context.loanAccounts ?? []).map((a) => [a.id, a] as const),
    ]),
    categories: new Map(context.categories.map((c) => [c.id, c])),
  }
}

/** The URL filters as the database functions take them. */
export function toApiFilters(f: Filters, range: DateRange): TransactionFilters {
  return {
    from: range.start,
    to: range.end,
    type: f.type === "all" ? null : f.type,
    categoryId: f.category || null,
    accountId: f.account || null,
    query: f.q || null,
    includeVoided: f.showVoided,
  }
}

export function hasActiveFilters(f: Filters): boolean {
  return f.type !== "all" || f.period !== "this-month" || Boolean(f.category || f.account || f.q) || f.showVoided
}

/** Group rows by date, keeping order. */
export function groupByDay<T extends { occurredOn: IsoDate }>(rows: readonly T[]): { date: IsoDate; rows: T[] }[] {
  const groups: { date: IsoDate; rows: T[] }[] = []
  for (const row of rows) {
    const last = groups.at(-1)
    if (last?.date === row.occurredOn) last.rows.push(row)
    else groups.push({ date: row.occurredOn, rows: [row] })
  }
  return groups
}
