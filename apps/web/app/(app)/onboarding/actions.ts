"use server"

import { dismissGettingStarted, setWelcomeHidden } from "@fin-creador/api"
import { revalidatePath } from "next/cache"
import { clearWelcome } from "@/lib/auth/welcome-cookie"
import { createClient } from "@/lib/supabase/server"

// The welcome and the Get started card (before Sprint 12a). Only the signed-in person's own row:
// RLS and the column grants enforce it, and the database stores its own time (migrations
// 20261120120000 and 20261120200000). This folder has no page; it only holds these actions.

async function signedIn() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return data.user ? { supabase, userId: data.user.id } : null
}

/**
 * The welcome closed (Skip, Escape, Start using FinCreador or Show me around). Clears this
 * sign-in's welcome cookie, so a reload doesn't bring it back; with "Don't show this again"
 * ticked, also hides it at later sign-ins on every device. Unticked never un-hides it.
 */
export async function closeWelcomeAction(hide: boolean): Promise<{ ok: boolean }> {
  await clearWelcome()
  if (hide !== true) return { ok: true }
  const s = await signedIn()
  if (!s) return { ok: false }
  return setWelcomeHidden(s.supabase, s.userId, true)
}

/** Settings → "Show the welcome when I sign in". */
export async function setWelcomeOnSignInAction(show: boolean): Promise<{ ok: boolean }> {
  if (typeof show !== "boolean") return { ok: false }
  const s = await signedIn()
  if (!s) return { ok: false }
  return setWelcomeHidden(s.supabase, s.userId, !show)
}

/** Hide on the Get started card: gone for good. */
export async function dismissGettingStartedAction(): Promise<{ ok: boolean }> {
  const s = await signedIn()
  if (!s) return { ok: false }
  const result = await dismissGettingStarted(s.supabase, s.userId)
  if (result.ok) revalidatePath("/")
  return result
}
