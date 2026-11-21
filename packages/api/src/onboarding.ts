import type { UserClient } from "./income/client"

// The welcome (before Sprint 12a), shared by web and mobile. Its time lives on the profile and is
// set by the database's own clock (migrations 20261120120000 and 20261120200000): a client sends
// any value for "now" and null to clear, nothing else. The Get started card was removed from the
// Overview (owner review 2026-11-21); its database pieces stay, unused, until a later migration.

// The value sent is ignored by the database (it stores its own now()); any non-null value works.
const NOW = new Date(0).toISOString()

/**
 * "Don't show this again" ticked when the welcome closed, or Settings → "Show the welcome when I
 * sign in" turned off (true); that setting turned on (false).
 */
export async function setWelcomeHidden(supabase: UserClient, userId: string, hidden: boolean): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.from("profiles").update({ welcome_hidden_at: hidden ? NOW : null }).eq("id", userId).select("id").maybeSingle()
  return { ok: !error && data !== null }
}

/**
 * Records a UPI import that saved at least one entry (the checklist's "import a statement").
 * Never fails the import: a failed insert is logged (no data) and ignored.
 */
export async function logUpiImport(supabase: UserClient, savedCount: number): Promise<void> {
  if (!Number.isSafeInteger(savedCount) || savedCount < 1) return
  try {
    const { error } = await supabase.from("upi_imports").insert({ saved_count: savedCount })
    if (error) console.warn("upi_imports: log insert failed", error.code)
  } catch {
    console.warn("upi_imports: log insert failed")
  }
}
