import { z } from "zod"
import { isSafePublicKey } from "@fin-creador/api"

// Public configuration only. These values are inlined into the browser bundle, so a
// secret must never be placed here: the publishable-key check below refuses Supabase
// secret keys and service-role JWTs outright.

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
