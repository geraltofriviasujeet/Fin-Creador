import type * as React from "react"
import { Logo } from "@/components/brand/logo"

// Three-row grid: the card sits in the middle row, so it is centred on its own
// (not as part of logo + card + footer); the logo hugs the card from the row above.
// Rows are minmax(auto, 1fr), so on short screens nothing is pushed off-screen.
// Top/bottom padding respect the notch / home-indicator safe areas (viewportFit: cover).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-rows-[1fr_auto_1fr] justify-items-center px-4 pt-[max(3rem,calc(env(safe-area-inset-top)+1.5rem))] pb-[max(3rem,calc(env(safe-area-inset-bottom)+1.5rem))]">
      <div className="flex items-end pb-8">
        <Logo tone="onLight" />
      </div>
      <main className="w-full max-w-110">{children}</main>
      <p className="max-w-110 pt-8 text-center text-xs text-muted-foreground">
        Your financial data stays private to your account.
      </p>
    </div>
  )
}
