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
