import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { connection } from "next/server"
import type { Database } from "@fin-creador/api"
import { getPublicEnv } from "@/lib/env"

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Uses the publishable key + the user's session cookies, so every query runs as the
 * signed-in user under RLS. There is deliberately no service-role client in the web app.
 */
export async function createClient() {
  // Auth state is per request and must never be prerendered or cached. supabase-js reads
  // Date.now() (session expiry), which Cache Components only allows after connection().
  await connection()
  const cookieStore = await cookies()
  const env = getPublicEnv()

  return createServerClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options)
        } catch {
          // Server Components cannot set cookies. Safe to ignore: proxy.ts refreshes the
          // session on every request, and actions/route handlers can set cookies.
        }
      },
    },
  })
}

/** The signed-in user (verified with Supabase Auth), or null. */
export async function getUser() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  return error ? null : data.user
}
