import type { Metadata } from "next"
import { Suspense } from "react"
import { resendConfirmationAction, signInAction, signInWithGoogleAction } from "@/app/(auth)/actions"
import { AuthCard, AuthLink } from "@/components/auth/auth-card"
import { GoogleButton, OrDivider, SignInForm } from "@/components/auth/auth-forms"
import { FormMessage } from "@/components/ui/field"
import { IDLE_REASON, idleLimitFromEnv, idleLimitText } from "@/lib/auth/idle"

export const metadata: Metadata = { title: "Sign in" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to see where your money is going."
      footer={
        <>
          New to FinCreador? <AuthLink href="/sign-up">Create an account</AuthLink>
        </>
      }
    >
      <Suspense fallback={null}>
        <SignedOutReason searchParams={searchParams} />
      </Suspense>
      <GoogleButton label="Continue with Google" action={signInWithGoogleAction} />
      <OrDivider />
      <SignInForm action={signInAction} resendAction={resendConfirmationAction} />
    </AuthCard>
  )
}

/** Why the person was signed out. Only known reasons are shown; the URL can't inject text. */
async function SignedOutReason({ searchParams }: { searchParams: SearchParams }) {
  if ((await searchParams).reason !== IDLE_REASON) return null
  return (
    <div className="mb-5">
      <FormMessage tone="info">You were signed out after {idleLimitText(idleLimitFromEnv(process.env))} of inactivity, to keep your money private. Sign in again to continue.</FormMessage>
    </div>
  )
}
