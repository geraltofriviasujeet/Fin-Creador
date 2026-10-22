import { isSafePublicKey } from "@fin-creador/api";
import { z } from "zod";

// Public configuration only: EXPO_PUBLIC_ values are embedded in the app bundle, so a
// secret must never be placed here. The publishable-key check refuses Supabase secret
// keys and service-role JWTs outright.

const publicEnvSchema = z.object({
  supabaseUrl: z.url({ message: "EXPO_PUBLIC_SUPABASE_URL must be a URL" }),
  supabasePublishableKey: z
    .string({ message: "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing" })
    .min(1, "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing")
    .refine(
      isSafePublicKey,
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be the publishable (or anon) key, never a secret or service-role key"
    ),
  webUrl: z
    .url({ message: "EXPO_PUBLIC_WEB_URL must be a URL" })
    .transform((url) => url.replace(/\/+$/, "")),
});

export type PublicEnv = z.output<typeof publicEnvSchema>;

export type EnvResult = { ok: true; env: PublicEnv } | { ok: false; problems: string[] };

let cached: EnvResult | undefined;

/** Read lazily; problems name the variable only, values are never echoed. */
export function readPublicEnv(): EnvResult {
  cached ??= parsePublicEnv({
    // Literal process.env references so Expo can inline them at build time.
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    webUrl: process.env.EXPO_PUBLIC_WEB_URL,
  });
  return cached;
}

export function parsePublicEnv(raw: Record<string, string | undefined>): EnvResult {
  const result = publicEnvSchema.safeParse(raw);
  if (result.success) return { ok: true, env: result.data };
  return { ok: false, problems: [...new Set(result.error.issues.map((i) => i.message))] };
}

export function getPublicEnv(): PublicEnv {
  const result = readPublicEnv();
  if (!result.ok) throw new Error(`Invalid public environment: ${result.problems.join("; ")}`);
  return result.env;
}
