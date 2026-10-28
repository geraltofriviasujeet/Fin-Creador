import { type AccountKind, type IsoDate, type LiabilityKind, type NetWorthAccounts, type NetWorthInput, type NetWorthInvestments, type NetWorthDue, isLiabilityKind, isMoneyAccountKind } from "@fin-creador/domain"
import { type UserClient, userToday } from "../income/client"
import { buildInvestmentsView } from "../investments/view"
import { loadInvestmentsData } from "../investments/load"
import { loadStatutoryData } from "../statutory/load"
import { buildStatutoryView } from "../statutory/view"

// Loads what the Overview's Net worth card needs (Sprint 8e), as the signed-in user (RLS: only
// their own rows). Every account balance, liability accounts included, comes from ONE read of
// the account_balances view (no per-account liability_owed calls). Due items are not read: an
// unpaid EMI or card bill is already in its account's balance. Each part is loaded on its own,
// so one that fails leaves the others to show (netWorth then gives no total).

export type NetWorthLoad =
  | { ok: true; data: NetWorthInput; timeZone: string }
  | { ok: false; reason: "unauthenticated" | "unavailable" }

const INVESTMENTS_CURRENCY = "INR" // Sprint 7: holdings and fixed deposits are in rupees only.

async function loadAccountsPart(supabase: UserClient): Promise<NetWorthAccounts | null> {
  const [accounts, sums, loans, capitalisedPayments] = await Promise.all([
    supabase.from("accounts").select("id, kind, name, currency, opening_balance_minor, archived_at"),
    supabase.from("account_balances").select("account_id, inflow_minor, outflow_minor"),
    supabase.from("loans").select("id, account_id, capitalised_minor").eq("moratorium_interest", "capitalise").gt("capitalised_minor", 0).is("archived_at", null),
    supabase.from("due_payments").select("due_item_id").gt("capitalised_minor", 0).is("voided_at", null),
  ])
  if (accounts.error || sums.error || loans.error || capitalisedPayments.error) return null
  // Loans that already added their moratorium interest (a payment that posted it).
  const itemIds = capitalisedPayments.data.map((p) => p.due_item_id)
  const posted = itemIds.length ? await supabase.from("due_items").select("loan_id").in("id", itemIds) : { data: [], error: null }
  if (posted.error) return null
  const postedLoans = new Set(posted.data.map((d) => d.loan_id))

  const byId = new Map(sums.data.map((b) => [b.account_id, b]))
  return {
    accounts: accounts.data.flatMap((a) =>
      isMoneyAccountKind(a.kind) || isLiabilityKind(a.kind)
        ? [
            {
              id: a.id,
              kind: a.kind as AccountKind | LiabilityKind,
              name: a.name,
              currency: a.currency,
              balanceMinor: a.opening_balance_minor + (byId.get(a.id)?.inflow_minor ?? 0) - (byId.get(a.id)?.outflow_minor ?? 0),
              archived: a.archived_at !== null,
            },
          ]
        : [],
    ),
    pendingCapitalised: loans.data.filter((l) => !postedLoans.has(l.id)).map((l) => ({ accountId: l.account_id, minor: l.capitalised_minor })),
  }
}

async function loadInvestmentsPart(supabase: UserClient): Promise<NetWorthInvestments | null> {
  const load = await loadInvestmentsData(supabase)
  if (!load.ok) return null
  const view = buildInvestmentsView(load.data)
  return {
    holdings: view.groups.map((g) => ({
      name: g.instrument.name,
      currency: INVESTMENTS_CURRENCY,
      valueMinor: g.figures.valueMinor,
      priceDate: g.figures.valueMinor === null ? null : g.instrument.priceDate,
      priceAge: g.figures.valueMinor === null ? null : g.priceAge,
    })),
    deposits: view.deposits.map((d) => ({
      name: d.label ? `${d.bank} · ${d.label}` : d.bank,
      currency: INVESTMENTS_CURRENCY,
      valueMinor: d.figures.accruedValueMinor,
      matured: d.figures.matured,
    })),
  }
}

async function loadStatutoryPart(supabase: UserClient, ctx: { today: IsoDate; currency: string }): Promise<NetWorthDue[] | null> {
  const data = await loadStatutoryData(supabase)
  if (!data) return null
  return buildStatutoryView(data, { ...ctx, accounts: [] }).dues.map((d) => ({ name: d.name, currency: d.due.currency, leftMinor: d.leftMinor }))
}

export async function loadNetWorthData(supabase: UserClient): Promise<NetWorthLoad> {
  const day = await userToday(supabase)
  if (!day.ok) return day
  const profile = await supabase.from("profiles").select("currency, time_zone").eq("id", day.userId).maybeSingle()
  if (profile.error || !profile.data) return { ok: false, reason: "unavailable" }
  const currency = profile.data.currency
  const [accounts, investments, statutory] = await Promise.all([
    loadAccountsPart(supabase).catch(() => null),
    loadInvestmentsPart(supabase).catch(() => null),
    loadStatutoryPart(supabase, { today: day.today, currency }).catch(() => null),
  ])
  return { ok: true, timeZone: profile.data.time_zone, data: { currency, today: day.today, accounts, investments, statutory } }
}
