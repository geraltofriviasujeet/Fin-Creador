// Route access rules, applied in proxy.ts and re-checked on the server in the app layout.

/** Pages for signed-out users; signed-in users are sent into the app instead. */
export const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password"] as const

/** Needs the session created by a password-reset link. */
export const RECOVERY_PAGE = "/update-password"

/** Always reachable: the email/OAuth callback must work with or without a session. */
const PUBLIC_PREFIXES = ["/auth/"]

/**
 * Development-only prototypes on in-memory demo data (no Supabase reads or writes). Open
 * without a session in `next dev` so they can be reviewed and screenshotted; protected
 * (and 404) in production builds.
 */
const DEV_PUBLIC_PAGES = ["/dev/transactions"]

const isProduction = () => process.env.NODE_ENV === "production"

export type RouteKind = "auth" | "recovery" | "public" | "protected"

export function routeKind(pathname: string, production = isProduction()): RouteKind {
  if (AUTH_PAGES.some((p) => pathname === p)) return "auth"
  if (pathname === RECOVERY_PAGE) return "recovery"
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return "public"
  if (!production && DEV_PUBLIC_PAGES.includes(pathname)) return "public"
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
  signedIn: boolean,
  production = isProduction()
): RouteDecision {
  const kind = routeKind(pathname, production)
  if (kind === "protected" && !signedIn) {
    const next = `${pathname}${search}`
    return { redirectTo: next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}` }
  }
  if (kind === "auth" && signedIn) return { redirectTo: "/" }
  if (kind === "recovery" && !signedIn) return { redirectTo: "/forgot-password?notice=link-expired" }
  return null
}
