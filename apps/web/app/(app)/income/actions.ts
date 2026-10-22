"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { ledgerErrorMessage } from "@fin-creador/api"
import { localDateInTimeZone } from "@fin-creador/domain"
import { accountFormSchema, incomeFormSchema, sourceFormSchema, voidFormSchema } from "@fin-creador/schemas"
import { type FormState, readFields, validate } from "@/lib/form-state"
import { createClient } from "@/lib/supabase/server"

// Every write runs as the signed-in user: RLS, column grants and the database triggers
// enforce ownership and the money rules; these actions validate first so users get
// field-level messages, and map database errors to friendly ones.

async function context() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Fincome")
  const { data: profile } = await supabase
    .from("profiles")
    .select("currency, time_zone")
    .eq("id", auth.user.id)
    .maybeSingle()
  const timeZone = profile?.time_zone ?? "UTC"
  return { supabase, today: localDateInTimeZone(new Date(), timeZone) }
}

function dbError(error: { code?: string; message?: string }, values: Record<string, string>, dateField?: string): FormState {
  const m = ledgerErrorMessage(error, { dateField })
  return {
    status: "error",
    message: m.field ? "Please fix the highlighted fields." : m.message,
    fieldErrors: m.field ? { [m.field]: m.message } : undefined,
    values,
  }
}

const done = (message: string): FormState => {
  revalidatePath("/income")
  return { status: "success", message }
}

const ACCOUNT_FIELDS = [
  "id",
  "kind",
  "bankType",
  "bankName",
  "otherBankName",
  "name",
  "institution",
  "last4",
  "currency",
  "openingBalance",
  "openingBalanceDate",
] as const

export async function saveAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ACCOUNT_FIELDS)
  const { supabase, today } = await context()
  const result = validate(accountFormSchema({ today }), input, ACCOUNT_FIELDS)
  if (!result.ok) return result.state

  const a = result.data
  const columns = {
    bank_type: a.bankType,
    name: a.name,
    institution: a.institution,
    last4: a.last4,
    currency: a.currency,
    opening_balance_minor: a.openingBalanceMinor,
    opening_balance_date: a.openingBalanceDate,
  }

  if (input.id) {
    const { data, error } = await supabase.from("accounts").update(columns).eq("id", input.id).select("id").maybeSingle()
    if (error) return dbError(error, input, "openingBalanceDate")
    if (!data) return { status: "error", message: "We couldn't find that account.", values: input }
    return done("Account updated.")
  }

  const { error } = await supabase.from("accounts").insert({ kind: a.kind, ...columns })
  if (error) return dbError(error, input, "openingBalanceDate")
  return done("Account added.")
}

export async function setAccountArchivedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { id = "", archived } = readFields(formData, ["id", "archived"])
  const { supabase } = await context()
  const archive = archived === "true"
  const { data, error } = await supabase
    .from("accounts")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id")
    .maybeSingle()
  if (error || !data) return { status: "error", message: "We couldn't update that account. Please try again." }
  return done(archive ? "Account archived." : "Account restored.")
}

const SOURCE_FIELDS = ["name", "sourceType", "defaultAccountId"] as const

export async function saveSourceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, SOURCE_FIELDS)
  const result = validate(sourceFormSchema, input, SOURCE_FIELDS)
  if (!result.ok) return result.state
  const { supabase } = await context()
  const s = result.data
  const { error } = await supabase
    .from("categories")
    .insert({ kind: "income", name: s.name, source_type: s.sourceType, default_account_id: s.defaultAccountId })
  if (error) return dbError(error, input)
  return done("Source added.")
}

const INCOME_FIELDS = ["amount", "sourceId", "accountId", "occurredOn", "note", "idempotencyKey"] as const

export async function recordIncomeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, INCOME_FIELDS)
  const { supabase, today } = await context()

  // The amount is parsed in the account's currency (decimal places differ by currency).
  const { data: account } = input.accountId
    ? await supabase.from("accounts").select("currency").eq("id", input.accountId).maybeSingle()
    : { data: null }

  const result = validate(incomeFormSchema({ today, currency: account?.currency ?? "INR" }), input, INCOME_FIELDS)
  if (!result.ok) return result.state
  if (!account) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: { accountId: "Choose where it was received" }, values: input }
  }

  const i = result.data
  const { error } = await supabase.rpc("record_income", {
    p_account_id: i.accountId,
    p_category_id: i.sourceId,
    p_amount_minor: i.amountMinor,
    p_occurred_on: i.occurredOn,
    p_idempotency_key: i.idempotencyKey,
    p_note: i.note ?? undefined,
  })
  if (error) return dbError(error, input, "occurredOn")
  return done("Income saved.")
}

export async function voidIncomeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["transactionId", "reason"])
  const result = validate(voidFormSchema, input, ["reason"])
  if (!result.ok) return result.state
  const { supabase } = await context()
  const { error } = await supabase.rpc("void_income", {
    p_transaction_id: result.data.transactionId,
    p_reason: result.data.reason ?? undefined,
  })
  if (error) return dbError(error, { reason: input.reason ?? "" })
  return done("Income voided.")
}
