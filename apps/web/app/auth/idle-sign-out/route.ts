import { type NextRequest, NextResponse } from "next/server"
import { IDLE_REASON } from "@/lib/auth/idle"
import { safeNextPath } from "@/lib/auth/redirect"
import { createClient } from "@/lib/supabase/server"

// Sign-out after 2 hours of inactivity (Sprint 10a). The idle guard posts a form here from
// every open tab; this really ends the session with Supabase Auth (signOut revokes this
// session's refresh token and clears the cookies), then shows why on the sign-in page.
// Under /auth/, so it works with or without a session (a second tab finds none: fine).
// POST from this site only, so another site can't sign people out. `next` is untrusted.

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return new NextResponse(null, { status: 403 })

  const form = await request.formData().catch(() => null)
  const raw = form?.get("next")
  const next = safeNextPath(typeof raw === "string" ? raw : null, "")

  const supabase = await createClient()
  // "local": this browser's session only; the person's other devices stay signed in.
  await supabase.auth.signOut({ scope: "local" })

  const to = new URL("/sign-in", request.url)
  to.searchParams.set("reason", IDLE_REASON)
  if (next && next !== "/") to.searchParams.set("next", next)
  return NextResponse.redirect(to, 303)
}
