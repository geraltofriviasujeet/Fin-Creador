import "server-only"
import { redirect } from "next/navigation"
import {
  type BankType,
  type SourceType,
  localDateInTimeZone,
  minDate,
  previousMonthRange,
  yearRange,
} from "@fin-creador/domain"
import { createClient } from "@/lib/supabase/server"
import type { IncomeAccount, IncomeEntryItem, IncomePageData, IncomeSourceItem } from "@/lib/income/types"

export function accountLabel(a: { name: string; last4: string | null }) {
  return a.last4 ? `${a.name} ··${a.last4}` : a.name
}

/**
 * Loads everything the Income page needs, as the signed-in user (RLS applies).
 * Creates the default income sources on first use if sign-up could not.
 */
export async function loadIncomePage(): Promise<{ ok: true; data: IncomePageData } | { ok: false }> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Fincome")

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("currency, time_zone")
    .eq("id", auth.user.id)
    .maybeSingle()
  if (profileError || !profile) return { ok: false }

  const today = localDateInTimeZone(new Date(), profile.time_zone)
  const since = minDate(yearRange(today).start, previousMonthRange(today).start)

  const loadSources = () =>
    supabase
      .from("categories")
      .select("id, name, source_type, default_account_id, is_default, archived_at")
      .eq("kind", "income")
      .order("name")

  const [accountsRes, balancesRes, firstSources, entriesRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, kind, bank_type, name, institution, last4, currency, opening_balance_minor, opening_balance_date, archived_at, updated_at")
      .order("created_at"),
    supabase.from("account_balances").select("account_id, inflow_minor, outflow_minor, last_activity_at"),
    loadSources(),
    supabase
      .from("transactions")
      .select("id, amount_minor, currency, occurred_on, category_id, account_id, note, voided_at, void_reason")
      .eq("type", "income")
      .gte("occurred_on", since)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false }),
  ])
  if (accountsRes.error || balancesRes.error || firstSources.error || entriesRes.error) return { ok: false }

  let sourceRows = firstSources.data
  if (sourceRows.length === 0) {
    // Lazy fallback: sign-up seeding never blocks sign-up, so it may not have run.
    await supabase.rpc("ensure_my_income_sources")
    const retry = await loadSources()
    if (retry.error) return { ok: false }
    sourceRows = retry.data
  }

  const balances = new Map(balancesRes.data.map((b) => [b.account_id, b]))
  const accounts: IncomeAccount[] = accountsRes.data.map((a) => {
    const b = balances.get(a.id)
    return {
      id: a.id,
      kind: a.kind as IncomeAccount["kind"],
      bankType: (a.bank_type as BankType | null) ?? null,
      currency: a.currency,
      openingBalanceMinor: a.opening_balance_minor,
      openingBalanceDate: a.opening_balance_date,
      archived: a.archived_at !== null,
      inflowMinor: b?.inflow_minor ?? 0,
      outflowMinor: b?.outflow_minor ?? 0,
      name: a.name,
      institution: a.institution,
      last4: a.last4,
      label: accountLabel(a),
      lastActivityAt: b?.last_activity_at ?? a.updated_at,
    }
  })

  const sources: IncomeSourceItem[] = sourceRows.map((c) => ({
    id: c.id,
    name: c.name,
    sourceType: (c.source_type ?? "other") as SourceType,
    defaultAccountId: c.default_account_id,
    isDefault: c.is_default,
    archived: c.archived_at !== null,
  }))

  const entries: IncomeEntryItem[] = entriesRes.data.map((t) => ({
    id: t.id,
    amountMinor: t.amount_minor,
    currency: t.currency,
    occurredOn: t.occurred_on,
    sourceId: t.category_id ?? "",
    accountId: t.account_id,
    voided: t.voided_at !== null,
    note: t.note,
    voidReason: t.void_reason,
  }))

  return { ok: true, data: { currency: profile.currency, timeZone: profile.time_zone, today, accounts, sources, entries } }
}
