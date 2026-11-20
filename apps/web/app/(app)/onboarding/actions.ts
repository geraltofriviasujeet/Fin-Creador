"use server"

import { revalidatePath } from "next/cache"
import { dismissGettingStarted, setTourDone } from "@fin-creador/api"
import { createClient } from "@/lib/supabase/server"

// The tour and Get started card (before Sprint 12a). Only the signed-in person's own row: RLS
// and the column grants enforce it, and the database stores its own time (migration
// 20261120120000). This folder has no page; it only holds these actions.

async function signedIn() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return data.user ? { supabase, userId: data.user.id } : null
}

/**
 * Finished or skipped the welcome or the tour: it doesn't come back on any device. The layout is
 * refreshed so it knows the tour is done, and a later Replay (same visit) opens it again.
 */
export async function finishTourAction(): Promise<{ ok: boolean }> {
  const s = await signedIn()
  if (!s) return { ok: false }
  const result = await setTourDone(s.supabase, s.userId, true)
  if (result.ok) revalidatePath("/", "layout")
  return result
}

/** Settings → Replay the tour: the layout shows it again at once. */
export async function replayTourAction(): Promise<{ ok: boolean }> {
  const s = await signedIn()
  if (!s) return { ok: false }
  const result = await setTourDone(s.supabase, s.userId, false)
  if (result.ok) revalidatePath("/", "layout")
  return result
}

/** Hide on the Get started card: gone for good. */
export async function dismissGettingStartedAction(): Promise<{ ok: boolean }> {
  const s = await signedIn()
  if (!s) return { ok: false }
  const result = await dismissGettingStarted(s.supabase, s.userId)
  if (result.ok) revalidatePath("/")
  return result
}
