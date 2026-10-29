"use server"

import { type ImportMatchesLoad, loadImportMatches } from "@fin-creador/api"
import { createClient } from "@/lib/supabase/server"

/** Read-only: which of a statement's lines are already in the ledger or look like duplicates (RLS). */
export async function importMatchesAction(input: unknown): Promise<ImportMatchesLoad> {
  return loadImportMatches(await createClient(), input)
}
