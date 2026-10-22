"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
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

  const p = result.data
  // Only the columns the migration grants UPDATE on; RLS restricts the row to the caller.
  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: p.displayName,
      phone: p.phone,
      country: p.country,
      currency: p.currency,
      time_zone: p.timeZone,
    })
    .eq("id", auth.user.id)
    .select("id")
    .maybeSingle()

  if (error?.code === "22023") {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: { timeZone: "Unknown time zone" }, values: input }
  }
  if (error || !data) {
    return { status: "error", message: "We couldn’t save your profile. Please try again.", values: input }
  }

  revalidatePath("/", "layout") // the sidebar shows the display name
  return { status: "success", message: "Profile saved.", values: input }
}
