"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  type FormInput,
  type WriteResult,
  recordIncome,
  saveAccount,
  saveSource,
  setAccountArchived,
  updateCashOnHand,
  voidIncome,
} from "@fin-creador/api"
import { type FormState, readFields } from "@/lib/form-state"
import { createClient } from "@/lib/supabase/server"

// Thin wrappers around the shared writers in packages/api (also used by the mobile app).
// They run as the signed-in user (RLS); here we only add the web concerns: sign-in
// redirect, echoing typed values after an error, and refreshing the page.

async function client() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Fincome")
  return supabase
}

function toState(result: WriteResult, values?: Record<string, string>): FormState {
  if (result.status === "success") {
    revalidatePath("/income")
    return { status: "success", message: result.message }
  }
  return { status: "error", message: result.message, fieldErrors: result.fieldErrors, values }
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
  return toState(await saveAccount(await client(), input as FormInput), input)
}

export async function setAccountArchivedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { id = "", archived } = readFields(formData, ["id", "archived"])
  return toState(await setAccountArchived(await client(), { id, archived: archived === "true" }))
}

const SOURCE_FIELDS = ["name", "sourceType", "defaultAccountId"] as const

export async function saveSourceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, SOURCE_FIELDS)
  return toState(await saveSource(await client(), input), input)
}

const INCOME_FIELDS = ["amount", "sourceId", "accountId", "occurredOn", "note", "idempotencyKey"] as const

export async function recordIncomeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, INCOME_FIELDS)
  return toState(await recordIncome(await client(), input), input)
}

export async function updateCashOnHandAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["accountId", "amount"])
  return toState(await updateCashOnHand(await client(), input), input)
}

export async function voidIncomeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["transactionId", "reason"])
  return toState(await voidIncome(await client(), input), { reason: input.reason ?? "" })
}
