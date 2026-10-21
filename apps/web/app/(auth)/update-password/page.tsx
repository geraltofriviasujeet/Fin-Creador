import type { Metadata } from "next"
import { updatePasswordAction } from "@/app/(auth)/actions"
import { AuthCard } from "@/components/auth/auth-card"
import { UpdatePasswordForm } from "@/components/auth/auth-forms"

export const metadata: Metadata = { title: "Choose a new password" }

export default function UpdatePasswordPage() {
  return (
    <AuthCard title="Choose a new password" description="You’ll use it the next time you sign in.">
      <UpdatePasswordForm action={updatePasswordAction} />
    </AuthCard>
  )
}
