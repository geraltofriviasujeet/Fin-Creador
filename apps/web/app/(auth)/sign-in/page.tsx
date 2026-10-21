import type { Metadata } from "next"
import { resendConfirmationAction, signInAction, signInWithGoogleAction } from "@/app/(auth)/actions"
import { AuthCard, AuthLink } from "@/components/auth/auth-card"
import { GoogleButton, OrDivider, SignInForm } from "@/components/auth/auth-forms"

export const metadata: Metadata = { title: "Sign in" }

export default function SignInPage() {
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to see where your money is going."
      footer={
        <>
          New to Fin Creador? <AuthLink href="/sign-up">Create an account</AuthLink>
        </>
      }
    >
      <GoogleButton label="Continue with Google" action={signInWithGoogleAction} />
      <OrDivider />
      <SignInForm action={signInAction} resendAction={resendConfirmationAction} />
    </AuthCard>
  )
}
