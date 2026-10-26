"use server"

import { redirect } from "next/navigation"
import {
  forgotPasswordSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
} from "@fin-creador/schemas"
import { SIGN_UP_CHECK_EMAIL, authErrorMessage, isExistingAccountError } from "@fin-creador/api"
import { authCallbackUrl, safeNextPath } from "@/lib/auth/redirect"
import { getPublicEnv } from "@/lib/env"
import { type FormState, pick, readFields, validate } from "@/lib/form-state"
import { createClient } from "@/lib/supabase/server"

// All auth runs server-side with the publishable key and the user's cookies.
// Messages never reveal whether an email is registered.

function callbackUrl(next: string) {
  return authCallbackUrl(getPublicEnv().siteUrl, next)
}

function errorState(error: { code?: string; status?: number }, values: Record<string, string>): FormState {
  const m = authErrorMessage(error)
  return {
    status: "error",
    message: m.message,
    fieldErrors: m.field ? { [m.field]: m.message } : undefined,
    code: m.code,
    values,
  }
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["email", "password", "next"])
  const result = validate(signInSchema, input, ["email"])
  if (!result.ok) return result.state

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(result.data)
  if (error) return errorState(error, pick(input, ["email"]))

  redirect(safeNextPath(input.next))
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["displayName", "email", "password"])
  const echo = ["displayName", "email"] as const
  const result = validate(signUpSchema, input, echo)
  if (!result.ok) return result.state

  const { displayName, email, password } = result.data
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // display_name is read by the profiles sign-up trigger.
    options: { data: { display_name: displayName }, emailRedirectTo: callbackUrl("/") },
  })
  // An already-registered email gets exactly the same answer as a new one (no enumeration).
  const checkEmail: FormState = { status: "success", message: SIGN_UP_CHECK_EMAIL, values: pick(input, echo) }
  if (error) return isExistingAccountError(error) ? checkEmail : errorState(error, pick(input, echo))

  // Email confirmation off: signed in immediately.
  if (data.session) redirect("/")

  // Confirmation on (an unconfirmed existing email also lands here).
  return checkEmail
}

export async function resendConfirmationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["email"])
  const result = validate(forgotPasswordSchema, input, ["email"])
  if (!result.ok) return result.state

  const supabase = await createClient()
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: result.data.email,
    options: { emailRedirectTo: callbackUrl("/") },
  })
  if (error && (error.status === 429 || error.code?.startsWith("over_"))) return errorState(error, input)

  return { status: "success", message: "If that email still needs confirming, we’ve sent a new link." }
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["email"])
  const result = validate(forgotPasswordSchema, input, ["email"])
  if (!result.ok) return result.state

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(result.data.email, {
    redirectTo: callbackUrl("/update-password"),
  })
  // Only rate limits are surfaced; anything else gets the same answer as success.
  if (error && (error.status === 429 || error.code?.startsWith("over_"))) return errorState(error, input)

  return {
    status: "success",
    message: "If an account exists for that email, we’ve sent a link to reset your password.",
    values: pick(input, ["email"]),
  }
}

export async function updatePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readFields(formData, ["password", "confirmPassword"])
  const result = validate(updatePasswordSchema, input, [])
  if (!result.ok) return result.state

  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) {
    return { status: "error", message: "Your reset link has expired. Request a new one from the sign-in page." }
  }

  const { error } = await supabase.auth.updateUser({ password: result.data.password })
  if (error) return errorState(error, {})

  redirect("/?notice=password-updated")
}

export async function signInWithGoogleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const next = safeNextPath(readFields(formData, ["next"]).next)
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl(next) },
  })
  if (error || !data.url) return { status: "error", message: "Couldn’t start Google sign-in. Please try again." }

  redirect(data.url)
}

export async function signOutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/sign-in?notice=signed-out")
}
