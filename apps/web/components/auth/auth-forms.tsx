"use client"

import Link from "next/link"
import { useActionState } from "react"
import { PASSWORD_MIN_LENGTH } from "@fin-creador/schemas"
import { Button } from "@/components/ui/button"
import { FormMessage, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { type FormState, initialFormState } from "@/lib/form-state"

type Action = (state: FormState, formData: FormData) => Promise<FormState>

function StateMessage({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null
  return <FormMessage tone={state.status}>{state.message}</FormMessage>
}

function SubmitButton({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? busy : idle}
    </Button>
  )
}

export function SignInForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, initialFormState)
  return (
    <form action={formAction} noValidate className="grid gap-4">
      <StateMessage state={state} />
      <TextField
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <TextField
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password}
        labelAside={
          <Link href="/forgot-password" className="rounded text-xs font-semibold text-ink underline underline-offset-4 hover:no-underline">
            Forgot password?
          </Link>
        }
      />
      <SubmitButton pending={pending} idle="Sign in" busy="Signing in…" />
    </form>
  )
}

export function SignUpForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, initialFormState)
  return (
    <form action={formAction} noValidate className="grid gap-4">
      <StateMessage state={state} />
      <TextField
        name="displayName"
        label="Your name"
        autoComplete="name"
        required
        defaultValue={state.values?.displayName}
        error={state.fieldErrors?.displayName}
      />
      <TextField
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <TextField
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        required
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        error={state.fieldErrors?.password}
      />
      <SubmitButton pending={pending} idle="Create account" busy="Creating account…" />
    </form>
  )
}

export function ForgotPasswordForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, initialFormState)
  return (
    <form action={formAction} noValidate className="grid gap-4">
      <StateMessage state={state} />
      <TextField
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <SubmitButton pending={pending} idle="Send reset link" busy="Sending…" />
    </form>
  )
}

export function UpdatePasswordForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, initialFormState)
  return (
    <form action={formAction} noValidate className="grid gap-4">
      <StateMessage state={state} />
      <TextField
        name="password"
        type="password"
        label="New password"
        autoComplete="new-password"
        required
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        error={state.fieldErrors?.password}
      />
      <TextField
        name="confirmPassword"
        type="password"
        label="Confirm new password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirmPassword}
      />
      <SubmitButton pending={pending} idle="Update password" busy="Updating…" />
    </form>
  )
}

/** Google OAuth entry point. Wired to Supabase in Step 3. */
export function GoogleButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className="w-full"
      onClick={() => toast.info("Google sign-in isn’t connected yet.")}
    >
      <GoogleIcon />
      {label}
    </Button>
  )
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
      <path fill="#4285F4" d="M23.5 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.55-5.17 3.55-8.74Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44A11.97 11.97 0 0 0 1.27 6.6l4 3.1C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  )
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-line" />
      or
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}
