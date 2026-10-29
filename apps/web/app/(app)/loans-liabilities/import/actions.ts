"use server"

import { revalidatePath } from "next/cache"
import {
  type ImportMatchesLoad,
  type ImportSaveResult,
  type ImportStatementResult,
  enterImportedStatement,
  loadImportMatches,
  saveImportLines,
} from "@fin-creador/api"
import { createClient } from "@/lib/supabase/server"

// Statement import (Sprint 9a): the server side of the import page, as the signed-in user (RLS).
// Inputs are checked in @fin-creador/api; nothing here logs or echoes statement text.

function refresh() {
  revalidatePath("/loans-liabilities")
  revalidatePath("/")
  revalidatePath("/transactions")
}

/** Read-only: which of a statement's lines are already in the ledger or look like duplicates. */
export async function importMatchesAction(input: unknown): Promise<ImportMatchesLoad> {
  return loadImportMatches(await createClient(), input)
}

/** Saves up to IMPORT_SAVE_CHUNK ticked lines, each on its own; returns a result per line. */
export async function saveImportLinesAction(input: unknown): Promise<ImportSaveResult> {
  const result = await saveImportLines(await createClient(), input)
  if (result.ok && result.results.some((r) => r.status === "saved")) refresh()
  return result
}

/** Enter statement after the lines (or nothing, when one exists for that date). */
export async function importStatementAction(input: unknown): Promise<ImportStatementResult> {
  const result = await enterImportedStatement(await createClient(), input)
  if (result.status === "saved") refresh()
  return result
}
