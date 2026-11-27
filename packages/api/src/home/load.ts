import { spendLimitPeriod } from "@fin-creador/domain"
import { allPages } from "../all-pages"
import { buildGoalsView, loadGoalsData } from "../goals"
import type { UserClient } from "../income/client"
import { buildLoansView, loadLoansData } from "../loans"
import { loadRecurringData } from "../recurring"
import { type SpendLimit, loadSpendLimit } from "../spend-limit/load"
import { loadTransactionsContext } from "../transactions/load"
import { type HomeData, type TodayEntry, buildHome } from "./view"

const ENTRY_COLUMNS =
  "id, type, amount_minor, currency, occurred_on, account_id, counter_account_id, category_id, voided_at, recurring_rule_id, due_payment_id, liability_payment_id"

type EntryRow = {
  id: string
  type: string
  amount_minor: number
  currency: string
  occurred_on: string
  account_id: string
  counter_account_id: string | null
  category_id: string | null
  voided_at: string | null
  recurring_rule_id: string | null
  due_payment_id: string | null
  liability_payment_id: string | null
}

const toEntry = (t: EntryRow): TodayEntry => ({
  id: t.id,
  type: t.type as TodayEntry["type"],
  amountMinor: t.amount_minor,
  currency: t.currency,
  occurredOn: t.occurred_on,
  accountId: t.account_id,
  counterAccountId: t.counter_account_id,
  categoryId: t.category_id,
  voided: t.voided_at !== null,
  recurringRuleId: t.recurring_rule_id,
  paymentId: t.due_payment_id ?? t.liability_payment_id,
})

/**
 * Every entry dated `today` (voided ones too): the same rows account_balances reads, so the
 * start-of-today balance is exact. Null when the read fails.
 */
export async function loadTodayEntries(supabase: UserClient, today: string): Promise<TodayEntry[] | null> {
  const rows = await allPages((from, to) =>
    supabase.from("transactions").select(ENTRY_COLUMNS).eq("occurred_on", today).order("id").range(from, to),
  )
  return rows?.map(toEntry) ?? null
}

export type SpendLimitInputs = { spendLimit: SpendLimit | null; earlierEntries: TodayEntry[] }

/**
 * The daily spend limit and the spending it needs from before today: expense and refund entries
 * (not voided) from the current period's first day to yesterday. Null when a read fails.
 */
export async function loadSpendLimitInputs(supabase: UserClient, today: string): Promise<SpendLimitInputs | null> {
  const limit = await loadSpendLimit(supabase)
  if (!limit.ok) return null
  if (!limit.data) return { spendLimit: null, earlierEntries: [] }
  let start: string
  try {
    start = spendLimitPeriod(limit.data, today).start
  } catch {
    return null // a row that breaks the table's rules: never show a figure from it
  }
  if (start >= today) return { spendLimit: limit.data, earlierEntries: [] }
  const rows = await allPages((from, to) =>
    supabase
      .from("transactions")
      .select(ENTRY_COLUMNS)
      .in("type", ["expense", "refund"])
      .is("voided_at", null)
      .gte("occurred_on", start)
      .lt("occurred_on", today)
      .order("id")
      .range(from, to),
  )
  return rows ? { spendLimit: limit.data, earlierEntries: rows.map(toEntry) } : null
}

export type HomeLoad = { ok: true; data: HomeData } | { ok: false; reason: "unauthenticated" | "unavailable" }

/**
 * Everything the phone's Home shows, read as the signed-in user (RLS applies), through the
 * loaders the web pages use. Any part failing fails the whole load: Safe to spend needs the
 * accounts, bills, loans and goals together, so a partial figure is never shown.
 */
export async function loadHomeData(supabase: UserClient, now: Date = new Date()): Promise<HomeLoad> {
  const context = await loadTransactionsContext(supabase)
  if (!context.ok) return context
  const { today } = context.data

  const [recurring, loans, goals, profile, todayRows, spendLimit] = await Promise.all([
    loadRecurringData(supabase),
    loadLoansData(supabase),
    loadGoalsData(supabase),
    supabase.from("profiles").select("display_name").maybeSingle(),
    loadTodayEntries(supabase, today),
    loadSpendLimitInputs(supabase, today),
  ])
  if (!recurring.ok || !loans.ok || !goals.ok || profile.error || !todayRows || !spendLimit) {
    const signedOut = [loans, goals].some((r) => !r.ok && r.reason === "unauthenticated")
    return { ok: false, reason: signedOut ? "unauthenticated" : "unavailable" }
  }

  return {
    ok: true,
    data: buildHome({
      now,
      name: profile.data?.display_name ?? null,
      context: context.data,
      recurring: recurring.data,
      loans: buildLoansView(loans.data),
      goals: buildGoalsView(goals.data),
      spending: goals.data.spending,
      todayEntries: todayRows,
      ...spendLimit,
    }),
  }
}
