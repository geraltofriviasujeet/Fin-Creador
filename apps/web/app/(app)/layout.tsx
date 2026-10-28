import type * as React from "react"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { loadBellReminders } from "@fin-creador/api"
import { AppShell } from "@/components/shell/app-shell"
import { createClient } from "@/lib/supabase/server"

// Every page in this group needs a signed-in user. proxy.ts redirects first; this
// server-side check is the authoritative one (hidden UI is not authorisation).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AppShell user={null}>{null}</AppShell>}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  )
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect("/sign-in")

  // RLS limits this to the user's own row.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", data.user.id)
    .maybeSingle()

  // The bell's reminders stream in after the page (in-app only, Sprint 8a).
  const reminders = loadBellReminders(supabase).catch(() => null)

  return (
    <AppShell user={{ name: profile?.display_name ?? null, email: data.user.email ?? "" }} reminders={reminders}>
      {children}
    </AppShell>
  )
}
