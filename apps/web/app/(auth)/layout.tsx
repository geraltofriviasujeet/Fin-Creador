import type * as React from "react"
import { Logo } from "@/components/brand/logo"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo tone="onLight" />
      <main className="w-full max-w-110">{children}</main>
      <p className="max-w-110 text-center text-xs text-muted-foreground">
        Your financial data stays private to your account.
      </p>
    </div>
  )
}
