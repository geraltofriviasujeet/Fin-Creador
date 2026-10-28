import type { DueStatus, StatutoryType } from "@fin-creador/domain"
import type { VehicleKind } from "@fin-creador/schemas"
import type { UserClient } from "../income/client"
import type { StatutoryData } from "./view"

// Loads statutory dues, their due items and payments for Loans & Liabilities, the bell and the
// Overview, as the signed-in user (RLS: only their rows).

export async function loadStatutoryData(supabase: UserClient): Promise<StatutoryData | null> {
  const [dues, items, history] = await Promise.all([
    supabase
      .from("statutory_dues")
      .select("id, due_type, description, vehicle_kind, issued_state, issued_city, currency, amount_minor, due_date, pay_from_account_id, archived_at, created_at")
      .order("due_date"),
    supabase
      .from("due_items")
      .select("id, statutory_due_id, due_date, amount_due_minor, status, planned_on, planned_account_id, pay_from_account_id")
      .eq("kind", "statutory_due"),
    supabase.from("due_payments").select("id, due_item_id, account_id, paid_on, principal_minor, interest_minor, voided_at").eq("allows_parts", true),
  ])
  if (dues.error || items.error || history.error) return null
  const payments = history.data.filter((p) => p.voided_at === null)
  const touched = [
    ...new Set([
      ...payments.map((p) => p.account_id),
      ...items.data.flatMap((i) => [i.planned_account_id, i.pay_from_account_id].filter((v): v is string => !!v)),
    ]),
  ]
  const names = touched.length ? await supabase.from("accounts").select("id, name").in("id", touched) : { data: [], error: null }
  if (names.error) return null
  return {
    dues: dues.data.map((d) => ({
      id: d.id,
      dueType: d.due_type as StatutoryType,
      description: d.description,
      vehicleKind: d.vehicle_kind as VehicleKind | null,
      issuedState: d.issued_state,
      issuedCity: d.issued_city,
      currency: d.currency,
      amountMinor: d.amount_minor,
      dueDate: d.due_date,
      payFromAccountId: d.pay_from_account_id,
      archivedAt: d.archived_at,
      createdAt: d.created_at,
    })),
    items: items.data.flatMap((i) =>
      i.statutory_due_id
        ? [
            {
              id: i.id,
              statutoryDueId: i.statutory_due_id,
              dueDate: i.due_date,
              amountDueMinor: i.amount_due_minor,
              status: i.status as DueStatus,
              plannedOn: i.planned_on,
              plannedAccountId: i.planned_account_id,
              payFromAccountId: i.pay_from_account_id,
            },
          ]
        : [],
    ),
    payments: payments.map((p) => ({
      id: p.id,
      dueItemId: p.due_item_id,
      accountId: p.account_id,
      paidOn: p.paid_on,
      principalMinor: p.principal_minor,
      interestMinor: p.interest_minor,
    })),
    everPaidItemIds: [...new Set(history.data.map((p) => p.due_item_id))],
    accountNames: Object.fromEntries((names.data ?? []).map((a) => [a.id, a.name])),
  }
}
