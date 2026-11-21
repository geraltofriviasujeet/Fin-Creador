import { type NextRequest, NextResponse } from "next/server"
import { CONTINUE_PAGES } from "@/lib/auth/routes"
import { clearWelcome } from "@/lib/auth/welcome-cookie"
import { createClient } from "@/lib/supabase/server"

// Sign out (the Sign out buttons in the sidebar and Settings post a plain form here). A route
// handler, not a server action, so the browser does a full page load to the sign-in page and
// keeps none of the signed-out session's pages in its router cache: the next person to sign in
// on this tab never sees them. Ends the session with Supabase Auth (as before: default scope)
// and clears the welcome cookie. POST from this site only, so another site can't sign people out.

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return new NextResponse(null, { status: 403 })

  const supabase = await createClient()
  await supabase.auth.signOut()
  await clearWelcome()
  // "Not you? Sign out" on the Continue card comes back to the page it was on (sign-in or
  // sign-up, nothing else); every other sign-out lands on sign-in as before.
  const to = (await request.formData().catch(() => null))?.get("to")
  const page = typeof to === "string" && CONTINUE_PAGES.includes(to) ? to : "/sign-in"
  return NextResponse.redirect(new URL(`${page}?notice=signed-out`, request.url), 303)
}
