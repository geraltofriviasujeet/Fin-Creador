"use server"

import { createClient } from "@/lib/supabase/server"

// Agreeing, in Roma, to transaction descriptions being sent (Sprint 10.2). The database sets
// roma_descriptions_ok_at to its own now() whatever is sent (profiles_roma_consent), and
// refuses it while Roma is off. RLS limits the row to the caller.
export async function allowRomaDescriptionsAction(): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false }
  const { data, error } = await supabase
    .from("profiles")
    .update({ roma_descriptions_ok_at: new Date().toISOString() })
    .eq("id", auth.user.id)
    .select("id")
    .maybeSingle()
  return { ok: !error && Boolean(data) }
}
