import type { Metadata } from "next"
import { Suspense } from "react"
import { signInWithGoogleAction, signUpAction } from "@/app/(auth)/actions"
import { AuthCard, AuthLink } from "@/components/auth/auth-card"
import { AuthCardPending, SignedInGate } from "@/components/auth/signed-in-gate"
import { GoogleButton, OrDivider, SignUpForm } from "@/components/auth/auth-forms"

export const metadata: Metadata = { title: "Create account" }

export default function SignUpPage() {
  // Already signed in: the Continue card instead of the form (signed-in-gate.tsx).
  return (
    <Suspense fallback={<AuthCardPending />}>
      <SignedInGate page="/sign-up">
        <AuthCard
          title="Create your account"
          description="Track spending, income and goals in one place."
          footer={
            <>
              Already have an account? <AuthLink href="/sign-in">Sign in</AuthLink>
            </>
          }
        >
          <GoogleButton label="Sign up with Google" action={signInWithGoogleAction} />
          <OrDivider />
          <SignUpForm action={signUpAction} />
        </AuthCard>
      </SignedInGate>
    </Suspense>
  )
}
