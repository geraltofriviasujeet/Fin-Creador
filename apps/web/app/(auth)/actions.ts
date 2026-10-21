"use server"

import {
  forgotPasswordSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
} from "@fin-creador/schemas"
import { type FormState, pick, readFields, validate } from "@/lib/form-state"

// Inputs are validated with the shared schemas now. Supabase Auth calls replace the
// NOT_CONNECTED returns in Sprint 1 Step 3; nothing is stored or sent anywhere yet.
const NOT_CONNECTED = "Accounts aren’t connected yet. Sign-in will work once authentication is set up."

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["email", "password"])
  const result = validate(signInSchema, input, ["email"])
  if (!result.ok) return result.state
  return { status: "info", message: NOT_CONNECTED, values: pick(input, ["email"]) }
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["displayName", "email", "password"])
  const result = validate(signUpSchema, input, ["displayName", "email"])
  if (!result.ok) return result.state
  return { status: "info", message: NOT_CONNECTED, values: pick(input, ["displayName", "email"]) }
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["email"])
  const result = validate(forgotPasswordSchema, input, ["email"])
  if (!result.ok) return result.state
  return { status: "info", message: NOT_CONNECTED, values: pick(input, ["email"]) }
}

export async function updatePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["password", "confirmPassword"])
  const result = validate(updatePasswordSchema, input, [])
  if (!result.ok) return result.state
  return { status: "info", message: NOT_CONNECTED }
}
