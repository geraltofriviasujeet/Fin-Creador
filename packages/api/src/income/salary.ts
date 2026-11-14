import type { UserClient } from "./client"

// Salary entries for Roma's tax estimate (10.6e): income entries in the person's salary
// categories (source type "salary", archived ones too, so past entries still count), read as the
// signed-in user (RLS). Voided entries and versions an edit replaced are left out.

export type SalaryEntry = { occurredOn: string; amountMinor: number; currency: string }

export async function loadSalaryEntries(supabase: UserClient, range: { from: string; to: string }): Promise<{ ok: true; entries: SalaryEntry[] } | { ok: false }> {
  const categories = await supabase.from("categories").select("id").eq("kind", "income").eq("source_type", "salary")
  if (categories.error) return { ok: false }
  if (categories.data.length === 0) return { ok: true, entries: [] }
  const [entries, replaced] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, amount_minor, currency, occurred_on")
      .eq("type", "income")
      .in("category_id", categories.data.map((c) => c.id))
      .is("voided_at", null)
      .gte("occurred_on", range.from)
      .lte("occurred_on", range.to),
    supabase.from("transactions").select("replaces_id").eq("type", "income").not("replaces_id", "is", null),
  ])
  if (entries.error || replaced.error) return { ok: false }
  const old = new Set(replaced.data.map((r) => r.replaces_id))
  return {
    ok: true,
    entries: entries.data.filter((e) => !old.has(e.id)).map((e) => ({ occurredOn: e.occurred_on, amountMinor: e.amount_minor, currency: e.currency })),
  }
}
