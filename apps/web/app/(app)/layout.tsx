import type * as React from "react"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { loadBellReminders } from "@fin-creador/api"
import { AppShell } from "@/components/shell/app-shell"
import { Onboarding } from "@/components/onboarding/tour"
import { IdleGuard } from "@/components/shell/idle-guard"
import { idleLimitFromEnv } from "@/lib/auth/idle"
import { welcomePending } from "@/lib/auth/welcome-cookie"
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
    <>
      <AppShell user={{ name: profile?.display_name ?? null, email: data.user.email ?? "" }} reminders={reminders}>
        {children}
      </AppShell>
      {/* The welcome after each sign-in, and the tour (and Settings → Replay the tour). Its own
          boundary: only it reads the welcome cookie. */}
      <Suspense fallback={null}>
        <WelcomeGate userId={data.user.id} />
      </Suspense>
      {/* Signs out after 2 hours without activity (across tabs), with a warning first. */}
      <IdleGuard signedInAt={data.user.last_sign_in_at ?? null} limitMs={idleLimitFromEnv(process.env)} />
    </>
  )
}

/**
 * Shows the welcome when this browser has just signed in (the welcome cookie) and the person
 * hasn't opted out (profiles.welcome_hidden_at). Not when the profile couldn't be read. Always
 * renders <Onboarding>, which also opens on Settings → Replay the tour.
 */
async function WelcomeGate({ userId }: { userId: string }) {
  let show = false
  if (await welcomePending()) {
    const supabase = await createClient()
    // RLS limits this to the user's own row.
    const { data, error } = await supabase.from("profiles").select("welcome_hidden_at").eq("id", userId).maybeSingle()
    show = !error && data !== null && data.welcome_hidden_at === null
  }
  return <Onboarding show={show} />
}
