import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"
import type { Database } from "@fin-creador/api"
import { answersSignedOutAction, decideRoute } from "@/lib/auth/routes"
import { getPublicEnv } from "@/lib/env"

/**
 * Runs on every page request (see proxy.ts): refreshes the Supabase session cookies and
 * applies the route rules. Pages re-check the user on the server, so this is not the
 * only line of defence.
 */
export async function updateSession(request: NextRequest) {
  const env = getPublicEnv()
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options)
        // Cache-Control etc. so CDNs never cache a response that carries auth cookies.
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value)
      },
    },
  })

  // getClaims() verifies the JWT (and refreshes it when needed). Do not put code
  // between createServerClient and this call.
  const { data } = await supabase.auth.getClaims()
  const signedIn = Boolean(data?.claims?.sub)

  const decision = decideRoute(request.nextUrl.pathname, request.nextUrl.search, signedIn)
  if (!decision) return response
  // The statement import's actions (opt-in, see answersSignedOutAction) answer "sign in again"
  // themselves, so the page keeps its review; everything else is redirected.
  if (!signedIn && answersSignedOutAction(request.nextUrl.pathname, request.method, request.headers.has("next-action"))) return response

  const redirect = NextResponse.redirect(new URL(decision.redirectTo, request.url))
  // Carry refreshed session cookies and cache headers onto the redirect.
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie)
  for (const key of ["cache-control", "expires", "pragma"]) {
    const value = response.headers.get(key)
    if (value) redirect.headers.set(key, value)
  }
  return redirect
}
