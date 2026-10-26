// Where to send a user after sign-in or an email link. `next` comes from the URL, so it
// is untrusted: only same-site paths are allowed, never another origin (open redirect).

export const DEFAULT_AFTER_SIGN_IN = "/"

const BASE = "https://same-site.invalid"

export function safeNextPath(raw: string | null | undefined, fallback = DEFAULT_AFTER_SIGN_IN): string {
  if (!raw) return fallback
  const value = raw.trim()
  // Must be an absolute path. Reject protocol-relative ("//evil", "/\evil") and anything
  // with a scheme or control characters before URL parsing normalises it.
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback
  if (/[\u0000-\u001f\\]/.test(value)) return fallback

  try {
    const url = new URL(value, BASE)
    if (url.origin !== BASE) return fallback
    // Don't bounce back into the auth callback.
    if (url.pathname.startsWith("/auth/")) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export const AUTH_CALLBACK_PATH = "/auth/callback"

/**
 * Absolute callback URL on the configured site, never the request host. It must match
 * Supabase's redirect allow list (`<site>/auth/callback**`); otherwise Supabase falls
 * back to the Site URL and the code arrives at `/?code=…` (handled in routes.ts).
 */
export function authCallbackUrl(siteUrl: string, next: string): string {
  return `${siteUrl.replace(/\/+$/, "")}${AUTH_CALLBACK_PATH}?next=${encodeURIComponent(safeNextPath(next))}`
}

// Supabase PKCE auth codes are UUIDs; allow a little slack but nothing URL-structural.
const AUTH_CODE = /^[A-Za-z0-9._~-]{1,256}$/

/**
 * A `?code=` that landed on the site root (Supabase's Site URL fallback) is handed to the
 * callback. Only the code is forwarded, to a fixed same-site path, so nothing in the
 * query can choose the destination.
 */
export function rootCodeHandoff(pathname: string, search: string): string | null {
  if (pathname !== "/") return null
  const code = new URLSearchParams(search).get("code")
  if (!code || !AUTH_CODE.test(code)) return null
  return `${AUTH_CALLBACK_PATH}?${new URLSearchParams({ code })}`
}
