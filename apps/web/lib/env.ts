import { z } from "zod"

// Public configuration only. These values are inlined into the browser bundle, so a
// secret must never be placed here: the publishable-key check below refuses Supabase
// secret keys and service-role JWTs outright.

/** Decodes a JWT payload without verifying it (only used to inspect the role claim). */
function jwtRole(token: string): string | undefined {
  const part = token.split(".")[1]
  if (!part) return undefined
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"))
    const role: unknown = JSON.parse(json).role
    return typeof role === "string" ? role : undefined
  } catch {
    return undefined
  }
}

export function isSafePublicKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return false
  if (key.split(".").length === 3) return jwtRole(key) === "anon" // legacy anon JWT only
  return key.startsWith("sb_publishable_")
}

const publicEnvSchema = z.object({
  supabaseUrl: z.url({ message: "NEXT_PUBLIC_SUPABASE_URL must be a URL" }),
  supabasePublishableKey: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing")
    .refine(isSafePublicKey, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be the publishable (or anon) key, never a secret or service-role key"),
  siteUrl: z
    .url({ message: "NEXT_PUBLIC_SITE_URL must be a URL" })
    .transform((url) => url.replace(/\/+$/, "")),
})

export type PublicEnv = z.output<typeof publicEnvSchema>

let cached: PublicEnv | undefined

/** Read lazily (not at import) so builds without a .env file still succeed. */
export function getPublicEnv(): PublicEnv {
  cached ??= parsePublicEnv({
    // Literal process.env references so Next can inline them.
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  })
  return cached
}

export function parsePublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(raw)
  if (!result.success) {
    // Messages name the variable only; values are never echoed.
    throw new Error(`Invalid public environment: ${result.error.issues.map((i) => i.message).join("; ")}`)
  }
  return result.data
}
