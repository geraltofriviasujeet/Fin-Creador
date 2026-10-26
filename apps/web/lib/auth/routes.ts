// Route access rules, applied in proxy.ts and re-checked on the server in the app layout.

import { rootCodeHandoff } from "./redirect"

/** Pages for signed-out users; signed-in users are sent into the app instead. */
export const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password"] as const

/** Needs the session created by a password-reset link. */
export const RECOVERY_PAGE = "/update-password"

/** Always reachable: the email/OAuth callback must work with or without a session. */
const PUBLIC_PREFIXES = ["/auth/"]

export type RouteKind = "auth" | "recovery" | "public" | "protected"

export function routeKind(pathname: string): RouteKind {
  if (AUTH_PAGES.some((p) => pathname === p)) return "auth"
  if (pathname === RECOVERY_PAGE) return "recovery"
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return "public"
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
  if (kind === "auth" && signedIn) return { redirectTo: "/" }
  if (kind === "recovery" && !signedIn) return { redirectTo: "/forgot-password?notice=link-expired" }
  return null
}
