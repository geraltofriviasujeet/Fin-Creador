// Guards the public client configuration (web and mobile bundles). A Supabase secret key
// or service-role JWT must never be shipped to a client, so both are refused outright.

/** Decodes a JWT payload without verifying it (only used to inspect the role claim). */
function jwtRole(token: string): string | undefined {
  const part = token.split(".")[1]
  if (!part) return undefined
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/")
    const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))
    const role: unknown = JSON.parse(json).role
    return typeof role === "string" ? role : undefined
  } catch {
    return undefined
  }
}

/** True only for a publishable key or a legacy anon JWT. */
export function isSafePublicKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return false
  if (key.split(".").length === 3) return jwtRole(key) === "anon" // legacy anon JWT only
  return key.startsWith("sb_publishable_")
}
