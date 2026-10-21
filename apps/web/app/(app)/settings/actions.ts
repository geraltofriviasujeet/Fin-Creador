"use server"

import { profileUpdateSchema } from "@fin-creador/schemas"
import { type FormState, pick, readFields, validate } from "@/lib/form-state"

const FIELDS = ["displayName", "phone", "country", "currency", "timeZone"] as const

// Validated with the shared schema now; persisted to `profiles` (RLS-protected)
// once the migration and sign-in land in Sprint 1 Steps 2–3.
export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, FIELDS)
  const result = validate(profileUpdateSchema, input, FIELDS)
  if (!result.ok) return result.state
  return {
    status: "info",
    message: "Looks good. Saving isn’t connected yet — profiles are stored once sign-in is set up.",
    values: pick(input, FIELDS),
  }
}
