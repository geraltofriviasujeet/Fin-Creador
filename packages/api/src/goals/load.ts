import { monthRange } from "@fin-creador/domain"
import { type UserClient, userToday } from "../income/client"
import type { GoalsData } from "./view"

// Loads what the Goals page and the Overview cards need, as the signed-in user (RLS).
// This month's spending per category comes from dashboard_breakdown (Sprint 5), in the
// profile currency only.

export type GoalsDataLoad = { ok: true; data: GoalsData } | { ok: false; reason: "unauthenticated" | "unavailable" }

export async function loadGoalsData(supabase: UserClient): Promise<GoalsDataLoad> {
  const day = await userToday(supabase)
  if (!day.ok) return day
  const month = monthRange(day.today)
  const [profile, goals, budgets, categories, breakdown] = await Promise.all([
    supabase.from("profiles").select("currency").eq("id", day.userId).maybeSingle(),
    supabase
      .from("goals")
      .select("id, type, name, target_amount_minor, saved_amount_minor, currency, target_date, details, archived_at, created_at"),
    supabase.from("budgets").select("category_id, effective_from, amount_minor, currency"),
    supabase.from("categories").select("id, name, icon, archived_at").eq("kind", "expense").order("name"),
    supabase.rpc("dashboard_breakdown", { p_from: month.start, p_to: month.end }),
  ])
  if (profile.error || goals.error || budgets.error || categories.error || breakdown.error || !Array.isArray(breakdown.data)) {
    return { ok: false, reason: "unavailable" }
  }
  const currency = profile.data?.currency ?? "INR"
  const spending = new Map<string, number>()
  for (const row of breakdown.data) {
    if (row.kind === "category" && row.currency === currency && row.category_id) spending.set(row.category_id, row.expense_minor)
  }
  return {
    ok: true,
    data: {
      today: day.today,
      currency,
      goals: goals.data.map((g) => ({
        id: g.id,
        type: g.type,
        name: g.name,
        targetMinor: g.target_amount_minor,
        savedMinor: g.saved_amount_minor,
        currency: g.currency,
        targetDate: g.target_date,
        details: g.details,
        archivedAt: g.archived_at,
        createdAt: g.created_at,
      })),
      budgetRows: budgets.data.map((b) => ({
        categoryId: b.category_id,
        effectiveFrom: b.effective_from,
        amountMinor: b.amount_minor,
        currency: b.currency,
      })),
      categories: categories.data.map((c) => ({ id: c.id, name: c.name, icon: c.icon, archived: c.archived_at !== null })),
      spending,
    },
  }
}
