import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "../database.types"

/**
 * The signed-in user's Supabase client (publishable key + their session). Every query and
 * write below runs under RLS as that user; there is no service-role path.
 */
export type UserClient = SupabaseClient<Database>

export type Today = { ok: true; userId: string; today: string } | { ok: false; reason: "unauthenticated" | "unavailable" }

/**
 * The user's local date from the database (the same function its "no future dates" rules
 * use). Never falls back to the device clock: if this fails, callers must not save.
 */
export async function userToday(supabase: UserClient): Promise<Today> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false, reason: "unauthenticated" }
  const { data, error } = await supabase.rpc("user_local_today", { p_user_id: auth.user.id })
  if (error || typeof data !== "string") return { ok: false, reason: "unavailable" }
  return { ok: true, userId: auth.user.id, today: data }
}

export const TODAY_UNAVAILABLE = "We couldn't check today's date. Check your connection and try again."
