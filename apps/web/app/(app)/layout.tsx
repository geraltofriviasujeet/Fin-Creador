import type * as React from "react"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { loadBellReminders } from "@fin-creador/api"
import { AppShell } from "@/components/shell/app-shell"
import { Onboarding } from "@/components/onboarding/tour"
import { IdleGuard } from "@/components/shell/idle-guard"
import { idleLimitFromEnv } from "@/lib/auth/idle"
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
    .select("display_name, tour_done_at")
    .eq("id", data.user.id)
    .maybeSingle()

  // The bell's reminders stream in after the page (in-app only, Sprint 8a).
  const reminders = loadBellReminders(supabase).catch(() => null)

  return (
    <>
      <AppShell user={{ name: profile?.display_name ?? null, email: data.user.email ?? "" }} reminders={reminders}>
        {children}
      </AppShell>
      {/* First sign-in welcome and tour (and Settings → Replay the tour). Not when the profile couldn't load. */}
      <Onboarding show={profile !== null && profile.tour_done_at === null} />
      {/* Signs out after 2 hours without activity (across tabs), with a warning first. */}
      <IdleGuard signedInAt={data.user.last_sign_in_at ?? null} limitMs={idleLimitFromEnv(process.env)} />
    </>
  )
}
