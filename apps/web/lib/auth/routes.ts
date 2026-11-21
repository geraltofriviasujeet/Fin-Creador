// Route access rules, applied in proxy.ts and re-checked on the server in the app layout.

import { rootCodeHandoff } from "./redirect"

/** Pages for signed-out users; signed-in users are sent into the app instead. */
export const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password"] as const

/**
 * Auth pages that a signed-in visitor still reaches: they show a "Continue as" card (the page
 * checks the session on the server) instead of the form, so a shared browser is never carried
 * silently into someone else's account. The other auth pages still redirect.
 */
export const CONTINUE_PAGES: readonly string[] = ["/sign-in", "/sign-up"]

/** Needs the session created by a password-reset link. */
export const RECOVERY_PAGE = "/update-password"

/** Always reachable: the email/OAuth callback must work with or without a session. */
const PUBLIC_PREFIXES = ["/auth/"]

/**
 * JSON endpoints (Roma's POST /api/ai/chat): never redirected to the sign-in page. Each
 * handler checks the user itself and answers a signed-out caller with 401 JSON.
 */
const API_PREFIXES = ["/api/"]

/**
 * Pages whose server actions answer a signed-out caller themselves instead of being redirected
 * to sign-in, so the page keeps what's on screen (the statement import's review). Opt-in: every
 * other protected page and action still redirects. Those actions check the user and run under
 * RLS as the caller.
 */
const SIGNED_OUT_ACTION_PAGES = ["/loans-liabilities/import"] as const

export function answersSignedOutAction(pathname: string, method: string, isServerAction: boolean): boolean {
  return method === "POST" && isServerAction && SIGNED_OUT_ACTION_PAGES.some((p) => pathname === p)
}

export type RouteKind = "auth" | "recovery" | "public" | "api" | "protected"

export function routeKind(pathname: string): RouteKind {
  if (AUTH_PAGES.some((p) => pathname === p)) return "auth"
  if (pathname === RECOVERY_PAGE) return "recovery"
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return "public"
  if (API_PREFIXES.some((p) => pathname.startsWith(p))) return "api"
  return "protected"
}

export type RouteDecision = { redirectTo: string } | null

/**
 * Where to redirect, given the path and whether a session exists. `search` is kept so
 * the user returns to the same page after signing in.
 */
export function decideRoute(
  pathname: string,
  search: string,
  signedIn: boolean
): RouteDecision {
  const handoff = rootCodeHandoff(pathname, search)
  if (handoff) return { redirectTo: handoff }
  const kind = routeKind(pathname)
  if (kind === "protected" && !signedIn) {
    const next = `${pathname}${search}`
    return { redirectTo: next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}` }
  }
  if (kind === "auth" && signedIn && !CONTINUE_PAGES.includes(pathname)) return { redirectTo: "/" }
  if (kind === "recovery" && !signedIn) return { redirectTo: "/forgot-password?notice=link-expired" }
  return null
}
