import type { Frequency } from "@fin-creador/domain"
import type { PaymentModeValue } from "@fin-creador/schemas"
import type { UserClient } from "../income/client"
import type { EntryType } from "../transactions/types"
import type { RecurringProgress, RecurringRule } from "./view"

export type RecurringData = { rules: RecurringRule[]; progress: Map<string, RecurringProgress> }

/** The signed-in user's recurring rules and their progress (RLS applies). */
export async function loadRecurringData(supabase: UserClient): Promise<{ ok: true; data: RecurringData } | { ok: false }> {
  const [rulesRes, progressRes] = await Promise.all([
    supabase
      .from("recurring_rules")
      .select("id, type, amount_minor, currency, account_id, counter_account_id, category_id, payment_mode, note, frequency, start_date, end_date, archived_at")
      .order("created_at"),
    supabase.from("recurring_rule_progress").select("rule_id, last_posted_on, last_skipped_on"),
  ])
  if (rulesRes.error || progressRes.error) return { ok: false }

  const rules: RecurringRule[] = rulesRes.data.map((r) => ({
    id: r.id,
    type: r.type as EntryType,
    amountMinor: r.amount_minor,
    currency: r.currency,
    accountId: r.account_id,
    counterAccountId: r.counter_account_id,
    categoryId: r.category_id,
    paymentMode: r.payment_mode as PaymentModeValue | null,
    note: r.note,
    frequency: r.frequency as Frequency,
    startDate: r.start_date,
    endDate: r.end_date,
    archived: r.archived_at !== null,
  }))
  const progress = new Map<string, RecurringProgress>(
    progressRes.data
      .filter((p): p is typeof p & { rule_id: string } => p.rule_id !== null)
      .map((p) => [p.rule_id, { lastPostedOn: p.last_posted_on, lastSkippedOn: p.last_skipped_on }])
  )
  return { ok: true, data: { rules, progress } }
}
