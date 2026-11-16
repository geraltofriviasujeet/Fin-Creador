"use server"

import { revalidatePath } from "next/cache"
import {
  type ImportSaveResult,
  type UpiLiteResult,
  type UpiMatchSaveResult,
  type UpiMatchesLoad,
  chooseUpiLite,
  loadPayeeHistory,
  loadUpiMatches,
  saveUpiAccountMatch,
  saveUpiImportLines,
  setImportPayeesConsent,
} from "@fin-creador/api"
import { upiSuggestInputSchema } from "@fin-creador/schemas"
import { readLlmConfig } from "@/lib/ai/config"
import { type SuggestBeginOutcome, type SuggestResult, suggestCategories } from "@/lib/ai/import-categories"
import { createProvider } from "@/lib/ai/llm"
import { createClient } from "@/lib/supabase/server"

// UPI app statement import (Sprint 9e): the server side of the import page, as the signed-in user
// (RLS). Inputs are checked in @fin-creador/api and @fin-creador/schemas; nothing here logs or
// echoes statement text, payee names or references.

export async function saveUpiAccountMatchAction(input: unknown): Promise<UpiMatchSaveResult> {
  return saveUpiAccountMatch(await createClient(), input)
}

export async function chooseUpiLiteAction(input: { create: boolean; openingDate?: unknown }): Promise<UpiLiteResult> {
  const result = await chooseUpiLite(await createClient(), { create: input?.create === true, openingDate: input?.openingDate })
  if (result.ok && result.account.id) revalidatePath("/income")
  return result
}

export async function upiHistoryAction(names: unknown): Promise<{ ok: true; history: [string, string][] } | { ok: false }> {
  return loadPayeeHistory(await createClient(), names)
}

export async function upiMatchesAction(input: unknown): Promise<UpiMatchesLoad> {
  return loadUpiMatches(await createClient(), input)
}

/** "Allow" in the consent prompt, or withdrawing it in Settings: the database records the time. */
export async function setImportPayeesConsentAction(allow: boolean): Promise<{ ok: true; at: string | null } | { ok: false }> {
  const result = await setImportPayeesConsent(await createClient(), allow === true)
  if (result.ok) revalidatePath("/settings")
  return result
}

/** Category suggestions for payee names no rule covers; rules only whenever the database or the model says no. */
export async function suggestUpiCategoriesAction(input: unknown): Promise<SuggestResult> {
  const parsed = upiSuggestInputSchema.safeParse(input)
  if (!parsed.success) return { suggestions: {}, rulesOnly: "failed", calls: 0 }
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { suggestions: {}, rulesOnly: "failed", calls: 0 }
  const profile = await supabase.from("profiles").select("display_name").eq("id", auth.user.id).maybeSingle()
  const config = readLlmConfig(process.env)
  return suggestCategories({
    config,
    ownName: profile.data?.display_name ?? null,
    names: parsed.data.names,
    makeProvider: () => {
      if (config.status !== "on") throw new Error("off")
      return createProvider(config)
    },
    db: {
      async begin(provider, model) {
        const { data, error } = await supabase.rpc("import_categories_begin", { p_provider: provider, p_model: model })
        const row = Array.isArray(data) ? data[0] : null
        if (error || !row) return null
        return { outcome: row.outcome as SuggestBeginOutcome, requestId: row.request_id }
      },
      async settle(requestId, inputTokens, outputTokens, costUsd) {
        const { data, error } = await supabase.rpc("import_categories_settle", { p_request_id: requestId, p_input_tokens: inputTokens, p_output_tokens: outputTokens, p_cost_usd: costUsd })
        return !error && data === true
      },
      async release(requestId) {
        const { data, error } = await supabase.rpc("import_categories_release", { p_request_id: requestId })
        return !error && data === true
      },
    },
  })
}

/** Saves up to IMPORT_SAVE_CHUNK ticked payments, each on its own; returns a result per payment. */
export async function saveUpiImportLinesAction(input: unknown): Promise<ImportSaveResult> {
  const result = await saveUpiImportLines(await createClient(), input)
  if (result.ok && result.results.some((r) => r.status === "saved")) {
    revalidatePath("/income")
    revalidatePath("/")
    revalidatePath("/transactions")
  }
  return result
}
