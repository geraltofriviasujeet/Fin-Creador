import type * as React from "react"
import { headers } from "next/headers"
import { Card } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { OVERVIEW_HREF } from "@/components/shell/nav-items"
import { avatarInitials, maskEmail } from "@/lib/auth/identity"
import { createClient } from "@/lib/supabase/server"
import { cn } from "cn"

/**
 * /sign-in and /sign-up for someone already signed in (lib/auth/routes.ts CONTINUE_PAGES): a
 * "Continue as" card instead of the form, decided on the server so the form never flashes.
 * Signed out (or when the session can't be read), the page's form is rendered as before.
 */
export async function SignedInGate({ page, children }: { page: "/sign-in" | "/sign-up"; children: React.ReactNode }) {
  // The form's own sign-in (a server action) re-renders this page with the new session. Keep
  // the form there, so it can finish with its full page load into the app (and the welcome)
  // instead of being swapped for this card mid-sign-in. Presentation only: not authorisation.
  if ((await headers()).has("next-action")) return children

  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return children

  // RLS limits this to the user's own row.
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", data.user.id).maybeSingle()
  return <ContinueCard name={profile?.display_name?.trim() || null} email={data.user.email ?? ""} page={page} />
}

/**
 * "Continue" is a link into the app, not a sign-in: it sets no welcome cookie, so the welcome
 * carousel doesn't show. "Not you?" is the plain sign-out post (a full page load, see
 * app/auth/sign-out/route.ts), which comes back to this page signed out, with the form.
 */
function ContinueCard({ name, email, page }: { name: string | null; email: string; page: string }) {
  const masked = maskEmail(email)
  return (
    <Card className="grid gap-6 p-6 shadow-raised md:p-8" data-testid="continue-card">
      <div className="grid gap-1.5">
        <h1 className="text-2xl font-semibold tracking-(--fc-tracking-heading)">You’re already signed in</h1>
        <p className="text-sm text-muted-foreground">Pick up where you left off.</p>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas p-3">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-chip-peach text-sm font-bold text-ink"
        >
          {avatarInitials(name, email)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{name ?? masked}</p>
          {name && <p className="truncate text-sm text-muted-foreground">{masked}</p>}
        </div>
      </div>

      <div className="grid gap-3">
        {/* A plain link (full page load), like every other way into the app from these pages. */}
        <a href={OVERVIEW_HREF} className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}>
          Continue to FinCreador
        </a>
        <form method="post" action="/auth/sign-out">
          <input type="hidden" name="to" value={page} />
          <button type="submit" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "w-full")}>
            Not you? Sign out
          </button>
        </form>
      </div>
    </Card>
  )
}

/** While the session is checked: the card's frame, never the form (so it can't flash). */
export function AuthCardPending() {
  return (
    <Card aria-busy="true" aria-label="Loading" className="grid gap-6 p-6 shadow-raised md:p-8">
      <div className="grid gap-2">
        <span className="h-7 w-48 rounded bg-canvas" />
        <span className="h-4 w-64 max-w-full rounded bg-canvas" />
      </div>
      <span className="h-10 w-full rounded-lg bg-canvas" />
      <span className="h-10 w-full rounded-lg bg-canvas" />
    </Card>
  )
}
