import { MONEY_ACCOUNT_KINDS, type StatutoryType, formatMoney } from "@fin-creador/domain"
import { type PayingAccount, firstFieldErrors, statutoryDueEditFormSchema, statutoryDueFormSchema } from "@fin-creador/schemas"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "../income/client"
import type { WriteResult } from "../income/types"
import type { FormInput } from "../income/writers"
import { loanErrorMessage } from "../loans/errors"

// Writes for statutory dues (Sprint 8d), shared by web and mobile, through the functions of
// migration 20261028230000 (RLS and grants apply; the database refuses any direct write).
// Paying, editing or voiding a payment and "Will pay later" go through the loan writers
// (payDueItem, editDuePayment, voidDuePayment, planDueItem): the same due items.

const FIX_FIELDS = "Please fix the highlighted fields."
const SIGNED_OUT = "Your session has ended. Please sign in again."
const UNAVAILABLE = "We couldn't load your accounts. Check your connection and try again."
const DUE_NOT_FOUND = "We couldn't find that due. Reload and try again."

export type StatutoryWriteResult = (WriteResult & { status: "error" }) | { status: "success"; message: string; id: string }

type DbError = { code?: string; message?: string; details?: string | null }

/** Database errors on dues as plain messages (FC045, FC050, FC053, FC054 and the shared ones). */
export function statutoryErrorMessage(error: DbError, currency?: string): { message: string; field?: string } {
  if (error.code === "FC045") {
    const left = Number(error.details)
    return { message: Number.isSafeInteger(left) && left > 0 && currency ? `Archive it once it's fully paid: ${formatMoney(left, { currency })} still due.` : "Archive it once it's fully paid." }
  }
  if (error.code === "FC050") return { message: "It has payments (voided ones too), so it can't be deleted. Archive it once it's paid." }
  if (error.code === "FC010") return { message: "Choose one of your bank, cash or other accounts.", field: "payFromAccountId" }
  if (error.code === "FC001") return { message: "That account is archived. Choose another.", field: "payFromAccountId" }
  if (error.code === "FC038") return { message: "Choose a bank, cash or other account.", field: "payFromAccountId" }
  if (error.code === "23514") {
    const text = error.message ?? ""
    if (text.includes("statutory_dues_description")) return { message: "Leave out challan, vehicle and account numbers: no 4 or more digits in a row", field: "description" }
    if (text.includes("statutory_dues_issued_state")) return { message: "Choose a state or union territory from the list", field: "issuedState" }
    if (text.includes("statutory_dues_issued_city")) return { message: "Choose a city from the list", field: "issuedCity" }
  }
  return loanErrorMessage(error, { currency })
}

function dbError(error: DbError, currency?: string): StatutoryWriteResult {
  const m = statutoryErrorMessage(error, currency)
  return m.field ? { status: "error", message: FIX_FIELDS, fieldErrors: { [m.field]: m.message } } : { status: "error", message: m.message }
}

async function profileCurrency(supabase: UserClient, userId: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("currency").eq("id", userId).maybeSingle()
  return data?.currency ?? null
}

/** Active bank, cash and other accounts (names only), for "Pay from". */
async function moneyAccounts(supabase: UserClient): Promise<PayingAccount[] | null> {
  const { data, error } = await supabase.from("accounts").select("id, name, currency, opening_balance_date").in("kind", [...MONEY_ACCOUNT_KINDS]).is("archived_at", null)
  if (error) return null
  return data.map((a) => ({ id: a.id, name: a.name, currency: a.currency, balanceMinor: 0, openingBalanceDate: a.opening_balance_date }))
}

/** Adds a due once per request key. Nothing is posted until it is paid. */
export async function addStatutoryDue(supabase: UserClient, input: FormInput): Promise<StatutoryWriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return { status: "error", message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const [currency, accounts] = await Promise.all([profileCurrency(supabase, day.userId), moneyAccounts(supabase)])
  if (!currency || !accounts) return { status: "error", message: UNAVAILABLE }
  const parsed = statutoryDueFormSchema({ currency, accounts }).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const d = parsed.data
  const { data, error } = await supabase.rpc("create_statutory_due", {
    p_idempotency_key: d.idempotencyKey,
    p_due_type: d.dueType,
    p_amount_minor: d.amountMinor,
    p_due_date: d.dueDate,
    p_description: d.description ?? undefined,
    p_vehicle_kind: d.vehicleKind ?? undefined,
    p_issued_state: d.issuedState ?? undefined,
    p_issued_city: d.issuedCity ?? undefined,
    p_pay_from_account_id: d.payFromAccountId ?? undefined,
  })
  if (error || !data) return dbError(error ?? {}, currency)
  return { status: "success", message: "Due added.", id: data.id }
}

/** Changes the amount (never below what is paid), due date, words, fine details and paying account. */
export async function editStatutoryDue(supabase: UserClient, input: FormInput): Promise<StatutoryWriteResult> {
  const [{ data: due, error }, accounts] = await Promise.all([
    supabase.from("statutory_dues").select("id, due_type, currency").eq("id", input.statutoryDueId ?? "").maybeSingle(),
    moneyAccounts(supabase),
  ])
  if (error || !accounts) return { status: "error", message: UNAVAILABLE }
  if (!due) return { status: "error", message: DUE_NOT_FOUND }
  const { data: items, error: itemError } = await supabase.from("due_items").select("id").eq("statutory_due_id", due.id)
  if (itemError) return { status: "error", message: UNAVAILABLE }
  const { data: progress, error: progressError } = await supabase.from("statutory_due_progress").select("paid_minor").in("due_item_id", items.map((i) => i.id))
  if (progressError) return { status: "error", message: UNAVAILABLE }
  const parsed = statutoryDueEditFormSchema({
    currency: due.currency,
    accounts,
    dueType: due.due_type as StatutoryType,
    paidMinor: progress[0]?.paid_minor ?? 0,
  }).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const d = parsed.data
  const { error: rpcError } = await supabase.rpc("update_statutory_due", {
    p_statutory_due_id: d.statutoryDueId,
    p_amount_minor: d.amountMinor,
    p_due_date: d.dueDate,
    p_description: d.description ?? undefined,
    p_vehicle_kind: d.vehicleKind ?? undefined,
    p_issued_state: d.issuedState ?? undefined,
    p_issued_city: d.issuedCity ?? undefined,
    p_pay_from_account_id: d.payFromAccountId ?? undefined,
  })
  if (rpcError) return dbError(rpcError, due.currency)
  return { status: "success", message: "Due saved.", id: d.statutoryDueId }
}

/** Archive (only once fully paid) or restore. */
export async function setStatutoryDueArchived(supabase: UserClient, input: { statutoryDueId: string; archived: boolean; currency?: string }): Promise<StatutoryWriteResult> {
  const { error } = await supabase.rpc("set_statutory_due_archived", { p_statutory_due_id: input.statutoryDueId, p_archived: input.archived })
  if (error) return dbError(error, input.currency)
  return { status: "success", message: input.archived ? "Due archived." : "Due restored.", id: input.statutoryDueId }
}

/** Deletes a due that was never paid (it can't be undone). */
export async function deleteStatutoryDue(supabase: UserClient, input: { statutoryDueId: string }): Promise<WriteResult> {
  const { error } = await supabase.rpc("delete_statutory_due", { p_statutory_due_id: input.statutoryDueId })
  if (error) return dbError(error)
  return { status: "success", message: "Due deleted." }
}
