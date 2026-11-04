"use server"

import { revalidatePath } from "next/cache"
import { type BankImportMatchesLoad, type ImportSaveResult, loadBankImportMatches, saveBankImportLines } from "@fin-creador/api"
import { createClient } from "@/lib/supabase/server"

// Bank statement import (Sprint 9b): the server side of the import page, as the signed-in user
// (RLS). Inputs are checked in @fin-creador/api; nothing here logs or echoes statement text.

/** Read-only: which lines are already in the ledger (or recorded as a transfer), and possible duplicates. */
export async function bankImportMatchesAction(input: unknown): Promise<BankImportMatchesLoad> {
  return loadBankImportMatches(await createClient(), input)
}

/** Saves up to IMPORT_SAVE_CHUNK ticked lines, each on its own; returns a result per line. */
export async function saveBankImportLinesAction(input: unknown): Promise<ImportSaveResult> {
  const result = await saveBankImportLines(await createClient(), input)
  if (result.ok && result.results.some((r) => r.status === "saved")) {
    revalidatePath("/income")
    revalidatePath("/")
    revalidatePath("/transactions")
    revalidatePath("/loans-liabilities")
  }
  return result
}
