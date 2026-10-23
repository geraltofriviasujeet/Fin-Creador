"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  INVALID_TIME_ZONE_CODE,
  type WriteResult,
  profileUpdateColumns,
  saveExpenseCategory,
  setExpenseCategoryArchived,
} from "@fin-creador/api"
import { profileUpdateSchema } from "@fin-creador/schemas"
import { type FormState, readFields, validate } from "@/lib/form-state"
import { createClient } from "@/lib/supabase/server"

const FIELDS = ["displayName", "phone", "country", "currency", "timeZone"] as const

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, FIELDS)
  const result = validate(profileUpdateSchema, input, FIELDS)
  if (!result.ok) return result.state

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Fsettings")

  // Only the columns the migration grants UPDATE on; RLS restricts the row to the caller.
  const { data, error } = await supabase
    .from("profiles")
    .update(profileUpdateColumns(result.data))
    .eq("id", auth.user.id)
    .select("id")
    .maybeSingle()

  if (error?.code === INVALID_TIME_ZONE_CODE) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: { timeZone: "Unknown time zone" }, values: input }
  }
  if (error || !data) {
    return { status: "error", message: "We couldn’t save your profile. Please try again.", values: input }
  }

  revalidatePath("/", "layout") // the sidebar shows the display name
  return { status: "success", message: "Profile saved.", values: input }
}

// Expense categories: thin wrappers around the shared writers in packages/api (RLS applies).

async function signedInClient() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Fsettings")
  return supabase
}

function categoryState(result: WriteResult, values?: Record<string, string>): FormState {
  if (result.status === "success") {
    revalidatePath("/settings")
    revalidatePath("/transactions")
    return { status: "success", message: result.message }
  }
  return { status: "error", message: result.message, fieldErrors: result.fieldErrors, values }
}

export async function saveExpenseCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["id", "name", "icon"])
  return categoryState(await saveExpenseCategory(await signedInClient(), input), input)
}

export async function setExpenseCategoryArchivedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { id = "", archived } = readFields(formData, ["id", "archived"])
  return categoryState(await setExpenseCategoryArchived(await signedInClient(), { id, archived: archived === "true" }))
}
