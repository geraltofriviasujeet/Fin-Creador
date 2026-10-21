import type * as React from "react"
import { AppShell } from "@/components/shell/app-shell"

// user stays null until Supabase sessions are wired (Sprint 1 Step 3).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell user={null}>{children}</AppShell>
}
