"use server"

import { z } from "zod"
import { readSearchConfig } from "@/lib/ai/config"
import { type LookupsLeft, lookupsLeft } from "@/lib/ai/plan/intake"
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

// Deleting conversations (Sprint 10.3): one, or all of the caller's. RLS limits the delete to
// their own rows; the turns go with each conversation (on delete cascade).
export async function deleteRomaConversationAction(conversationId: string): Promise<{ ok: boolean }> {
  const id = z.uuid().safeParse(conversationId)
  if (!id.success) return { ok: false }
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false }
  const { error } = await supabase.from("ai_conversations").delete().eq("id", id.data)
  return { ok: !error }
}

export async function deleteAllRomaConversationsAction(): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false }
  const { error } = await supabase.from("ai_conversations").delete().eq("user_id", auth.user.id)
  return { ok: !error }
}

// Web lookups left for the caller (10.9 follow-up), for the plan intake to say before the form
// is filled in. Advice only: roma_search_begin decides when a lookup is sent. Null when it
// can't be read (the intake then goes on as before; the plan still says what happened).
export async function romaLookupsLeftAction(): Promise<LookupsLeft | null> {
  if (readSearchConfig(process.env).status === "off") return { outcome: "disabled", credits: 0, limitedBy: null }
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null
  const { data, error } = await supabase.rpc("roma_search_remaining")
  const row = data?.[0]
  if (error || !row) return null
  const parsed = lookupsLeft.safeParse({ outcome: row.outcome, credits: row.credits, limitedBy: row.limited_by })
  return parsed.success ? parsed.data : null
}
