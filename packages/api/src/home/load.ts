import { allPages } from "../all-pages"
import { buildGoalsView, loadGoalsData } from "../goals"
import type { UserClient } from "../income/client"
import { buildLoansView, loadLoansData } from "../loans"
import { loadRecurringData } from "../recurring"
import { loadTransactionsContext } from "../transactions/load"
import { type HomeData, type TodayEntry, buildHome } from "./view"

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

  const [recurring, loans, goals, profile, todayRows] = await Promise.all([
    loadRecurringData(supabase),
    loadLoansData(supabase),
    loadGoalsData(supabase),
    supabase.from("profiles").select("display_name").maybeSingle(),
    // Every row dated today (voided ones too): the same rows account_balances reads, so the
    // start-of-today balance is exact.
    allPages((from, to) =>
      supabase
        .from("transactions")
        .select("id, type, amount_minor, currency, occurred_on, account_id, counter_account_id, category_id, voided_at, recurring_rule_id")
        .eq("occurred_on", today)
        .order("id")
        .range(from, to),
    ),
  ])
  if (!recurring.ok || !loans.ok || !goals.ok || profile.error || !todayRows) {
    const signedOut = [loans, goals].some((r) => !r.ok && r.reason === "unauthenticated")
    return { ok: false, reason: signedOut ? "unauthenticated" : "unavailable" }
  }

  const todayEntries: TodayEntry[] = todayRows.map((t) => ({
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
  }))

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
      todayEntries,
    }),
  }
}
