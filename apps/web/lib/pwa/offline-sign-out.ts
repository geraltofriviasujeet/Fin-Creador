import { SNAPSHOT_IDB } from "./snapshot"
import { idbClear } from "./snapshot-idb"

// Signing out (Sprint 12b). Every Sign out form posts to /auth/sign-out (the idle sign-out to
// /auth/idle-sign-out); components/pwa/sign-out-guard.tsx and the idle guard call these first.
//
// Online: the offline snapshot is deleted, then the form posts as before (the server ends the
// session with Supabase Auth).
// Offline: the post can't reach the server, so this device signs itself out: the snapshot and
// the service worker's static-file cache are deleted, the Supabase session cookies are cleared
// (they are not httpOnly: @supabase/ssr's default), and the signed-out offline page shows. The
// session's access token is kept in this tab's sessionStorage only so the server-side sign-out
// can finish once the device is back online (finishPendingSignOut, on the sign-in page): it
// revokes that one session (scope "local", so a new sign-in on this device is never caught by
// it). If the tab is closed first, or the token has expired by then, the server session ends
// at its own expiry instead.

export const SIGN_OUT_PATHS = ["/auth/sign-out", "/auth/idle-sign-out"] as const

/** sessionStorage: the access token of a session signed out offline, until the server is told. */
export const PENDING_SIGN_OUT_KEY = "fincreador-pending-sign-out"

/** The page shown after an offline sign-out (the offline page in its signed-out state). */
export const SIGNED_OUT_OFFLINE_URL = "/offline?signed-out=1"

/** Supabase Auth's session cookies (`sb-<ref>-auth-token`, its chunks and the PKCE verifier). */
const AUTH_COOKIE = /^sb-[^=]+-auth-token(?:[.-][\w-]+)?$/

function cookies(cookieString: string): [string, string][] {
  return cookieString
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf("=")
      return at < 0 ? [part, ""] : [part.slice(0, at), part.slice(at + 1)]
    })
}

/** Names of the Supabase session cookies in a document.cookie string. */
export function authCookieNames(cookieString: string): string[] {
  return cookies(cookieString)
    .map(([name]) => name)
    .filter((name) => AUTH_COOKIE.test(name))
}

const fromBase64Url = (value: string) => {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

/**
 * The session's access token from the Supabase cookies (@supabase/ssr: one cookie, or chunks
 * `.0`, `.1`, …; the value "base64-" + base64url JSON, or plain JSON), or null.
 */
export function readAccessToken(cookieString: string): string | null {
  try {
    const all = new Map(cookies(cookieString).map(([name, value]) => [name, decodeURIComponent(value)]))
    const base = [...all.keys()].map((name) => /^(sb-[^=]+-auth-token)(?:\.0)?$/.exec(name)?.[1]).find(Boolean)
    if (!base) return null
    let raw = all.get(base) ?? ""
    if (!raw) for (let i = 0; all.has(`${base}.${i}`); i++) raw += all.get(`${base}.${i}`)
    const json = raw.startsWith("base64-") ? fromBase64Url(raw.slice("base64-".length)) : raw
    const token = (JSON.parse(json) as { access_token?: unknown }).access_token
    return typeof token === "string" && token.length > 0 ? token : null
  } catch {
    return null
  }
}

/** Deletes the offline snapshot, then runs `send` (the sign-out post), even if deleting failed. */
export async function clearSnapshotThen(send: () => void) {
  try {
    await idbClear(SNAPSHOT_IDB)
  } finally {
    send()
  }
}

/**
 * Signs this device out without a connection, then shows the signed-out offline page. The
 * precache (the offline page itself, its fonts and the icons: no personal data) stays, so
 * that page can show offline; every other cache goes.
 */
export async function signOutOffline() {
  const token = readAccessToken(document.cookie)
  try {
    if (token) window.sessionStorage.setItem(PENDING_SIGN_OUT_KEY, token)
  } catch {
    // Storage blocked: the server session ends at its own expiry.
  }
  await idbClear(SNAPSHOT_IDB)
  try {
    if ("caches" in window) {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => !key.startsWith("fincreador-precache-")).map((key) => caches.delete(key)))
    }
  } catch {
    // Cache Storage unavailable: nothing was cached.
  }
  for (const name of authCookieNames(document.cookie)) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
  window.location.replace(SIGNED_OUT_OFFLINE_URL)
}

/**
 * Finishes an offline sign-out on the server once online: revokes that session with Supabase
 * Auth (scope "local": only that session). Any answer from Auth ends the attempt (an expired
 * token can't be used again); a network failure keeps it for the next "online" event.
 */
export async function finishPendingSignOut(env: { supabaseUrl: string; supabasePublishableKey: string }): Promise<"done" | "none" | "later"> {
  let token: string | null = null
  try {
    token = window.sessionStorage.getItem(PENDING_SIGN_OUT_KEY)
  } catch {
    return "none"
  }
  if (!token) return "none"
  if (!navigator.onLine) return "later"
  try {
    await fetch(`${env.supabaseUrl}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: { apikey: env.supabasePublishableKey, Authorization: `Bearer ${token}` },
    })
  } catch {
    return "later"
  }
  try {
    window.sessionStorage.removeItem(PENDING_SIGN_OUT_KEY)
  } catch {
    // Nothing more to do.
  }
  return "done"
}
