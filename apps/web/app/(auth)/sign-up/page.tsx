import type { Metadata } from "next"
import { signInWithGoogleAction, signUpAction } from "@/app/(auth)/actions"
import { AuthCard, AuthLink } from "@/components/auth/auth-card"
import { GoogleButton, OrDivider, SignUpForm } from "@/components/auth/auth-forms"

export const metadata: Metadata = { title: "Create account" }

export default function SignUpPage() {
  return (
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
  )
}
