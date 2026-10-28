import { type BankType, LIABILITY_KIND_LABELS, type LiabilityKind, isLiabilityKind, isMoneyAccountKind } from "@fin-creador/domain"
import { type UserClient, userToday } from "../income/client"
import { accountLabel } from "../income/load"
import type { AccountLabel, LedgerAccount, LedgerCategory, TransactionsContext } from "./types"

export type TransactionsContextLoad =
  | { ok: true; data: TransactionsContext }
  | { ok: false; reason: "unauthenticated" | "unavailable" }

/**
 * Accounts (with balances), categories and "today" for the Transactions screens, read as
 * the signed-in user (RLS applies). Creates the default categories on first use if
 * sign-up could not.
 */
export async function loadTransactionsContext(supabase: UserClient): Promise<TransactionsContextLoad> {
  const day = await userToday(supabase)
  if (!day.ok) return day

  const loadCategories = () =>
    supabase.from("categories").select("id, kind, name, icon, source_type, default_account_id, key, archived_at").order("name")

  const [profileRes, accountsRes, balancesRes, firstCategories, lastExpenseRes, anyEntryRes, cardsRes] = await Promise.all([
    supabase.from("profiles").select("currency, time_zone").eq("id", day.userId).maybeSingle(),
    supabase
      .from("accounts")
      .select("id, kind, bank_type, name, last4, currency, opening_balance_minor, opening_balance_date, archived_at")
      .order("created_at"),
    supabase.from("account_balances").select("account_id, inflow_minor, outflow_minor"),
    loadCategories(),
    supabase
      .from("transactions")
      .select("account_id")
      .eq("type", "expense")
      .is("voided_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("transactions").select("id").limit(1).maybeSingle(),
    supabase.from("credit_cards").select("account_id, limit_minor"),
  ])
  if (profileRes.error || !profileRes.data || accountsRes.error || balancesRes.error || firstCategories.error || lastExpenseRes.error || anyEntryRes.error || cardsRes.error) {
    return { ok: false, reason: "unavailable" }
  }

  let categoryRows = firstCategories.data
  const missing = (kind: string) => !categoryRows.some((c) => c.kind === kind)
  if (missing("expense") || missing("income")) {
    // Lazy fallback: sign-up seeding never blocks sign-up, so it may not have run.
    await Promise.all([
      missing("expense") ? supabase.rpc("ensure_my_expense_categories") : null,
      missing("income") ? supabase.rpc("ensure_my_income_sources") : null,
    ])
    const retry = await loadCategories()
    if (retry.error) return { ok: false, reason: "unavailable" }
    categoryRows = retry.data
  }

  const balances = new Map(balancesRes.data.map((b) => [b.account_id, b]))
  // Liability accounts (loans, cards, borrowing) only label the entries posted to them; they
  // are never in pickers, balances or Total available.
  const loanAccounts: AccountLabel[] = accountsRes.data
    .filter((a) => isLiabilityKind(a.kind))
    .map((a) => ({ id: a.id, label: `${accountLabel(a)} (${LIABILITY_KIND_LABELS[a.kind as LiabilityKind]})`, archived: a.archived_at !== null }))
  const ledgerAccount = (a: (typeof accountsRes.data)[number], label: string): LedgerAccount => {
    const b = balances.get(a.id)
    return {
      id: a.id,
      kind: a.kind as LedgerAccount["kind"],
      bankType: (a.bank_type as BankType | null) ?? null,
      label,
      currency: a.currency,
      openingBalanceMinor: a.opening_balance_minor,
      openingBalanceDate: a.opening_balance_date,
      inflowMinor: b?.inflow_minor ?? 0,
      outflowMinor: b?.outflow_minor ?? 0,
      archived: a.archived_at !== null,
    }
  }
  const accounts: LedgerAccount[] = accountsRes.data.filter((a) => isMoneyAccountKind(a.kind)).map((a) => ledgerAccount(a, accountLabel(a)))
  const limits = new Map(cardsRes.data.map((c) => [c.account_id, c.limit_minor]))
  const cardAccounts: LedgerAccount[] = accountsRes.data
    .filter((a) => a.kind === "card")
    .map((a) => ({ ...ledgerAccount(a, `${a.name} (card)`), limitMinor: limits.get(a.id) }))

  const categories: LedgerCategory[] = categoryRows.map((c) => ({
    id: c.id,
    kind: c.kind as LedgerCategory["kind"],
    name: c.name,
    icon: (c.kind === "expense" ? c.icon : c.source_type) ?? "other",
    archived: c.archived_at !== null,
    defaultAccountId: c.default_account_id,
    key: c.key === "membership" || c.key === "subscription" ? c.key : null,
  }))

  return {
    ok: true,
    data: {
      today: day.today,
      currency: profileRes.data.currency,
      timeZone: profileRes.data.time_zone,
      accounts,
      loanAccounts,
      cardAccounts,
      categories,
      // Capitalised loan interest is an expense on a loan account: never offered as a default.
      lastExpenseAccountId: accounts.some((a) => a.id === lastExpenseRes.data?.account_id) ? (lastExpenseRes.data?.account_id ?? null) : null,
      hasEntries: anyEntryRes.data !== null,
    },
  }
}
