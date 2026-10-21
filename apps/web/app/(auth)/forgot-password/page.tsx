import type { Metadata } from "next"
import { forgotPasswordAction } from "@/app/(auth)/actions"
import { AuthCard, AuthLink } from "@/components/auth/auth-card"
import { ForgotPasswordForm } from "@/components/auth/auth-forms"

export const metadata: Metadata = { title: "Reset password" }

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we’ll send you a link to choose a new password."
      footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
    >
      <ForgotPasswordForm action={forgotPasswordAction} />
    </AuthCard>
  )
}
