import { type ImportMatchesInput, importMatchesInputSchema } from "@fin-creador/schemas"
import type { UserClient } from "../income/client"
import type { ImportMatches } from "./review"

// What the database already holds for a statement under review (Sprint 9a.4), read as the
// signed-in user (RLS): another person's card or keys find nothing. Reads only.

const KEY_CHUNK = 100
const MAX_CARD_ENTRIES = 5000

/**
 * Which request keys already have a ledger row: "live" for a row that counts or was edited (an
 * edit voids it and a newer version replaces it), "deleted" for a row voided with no newer version
 * (clients cannot hard-delete entries, so a deleted entry is a voided one). Null when the read fails.
 */
export async function existingKeys(supabase: UserClient, keys: readonly string[]): Promise<Map<string, "live" | "deleted"> | null> {
  const unique = [...new Set(keys)]
  const chunks = Array.from({ length: Math.ceil(unique.length / KEY_CHUNK) }, (_, i) => unique.slice(i * KEY_CHUNK, (i + 1) * KEY_CHUNK))
  const rows = await Promise.all(chunks.map((chunk) => supabase.from("transactions").select("id, idempotency_key, voided_at").in("idempotency_key", chunk)))
  if (rows.some((r) => r.error)) return null
  const found = rows.flatMap((r) => r.data ?? [])
  const voided = found.filter((t) => t.voided_at !== null).map((t) => t.id)
  const voidedChunks = Array.from({ length: Math.ceil(voided.length / KEY_CHUNK) }, (_, i) => voided.slice(i * KEY_CHUNK, (i + 1) * KEY_CHUNK))
  const replaced = await Promise.all(voidedChunks.map((chunk) => supabase.from("transactions").select("replaces_id").in("replaces_id", chunk)))
  if (replaced.some((r) => r.error)) return null
  const edited = new Set(replaced.flatMap((r) => (r.data ?? []).map((t) => t.replaces_id)))
  return new Map(found.map((t) => [t.idempotency_key, t.voided_at === null || edited.has(t.id) ? "live" : "deleted"]))
}

export type ImportMatchesLoad = { ok: true; matches: ImportMatches } | { ok: false; reason: "invalid" | "not_found" | "unavailable" }

export async function loadImportMatches(supabase: UserClient, input: unknown): Promise<ImportMatchesLoad> {
  const parsed = importMatchesInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: "invalid" }
  const { cardId, keys, from, to, statementDate }: ImportMatchesInput = parsed.data

  const card = await supabase.from("credit_cards").select("account_id").eq("id", cardId).maybeSingle()
  if (card.error) return { ok: false, reason: "unavailable" }
  if (!card.data) return { ok: false, reason: "not_found" }

  const [existing, entries, statement] = await Promise.all([
    existingKeys(supabase, keys),
    supabase
      .from("transactions")
      .select("occurred_on, amount_minor, idempotency_key")
      .eq("account_id", card.data.account_id)
      .eq("type", "expense")
      .is("voided_at", null)
      .gte("occurred_on", from)
      .lte("occurred_on", to)
      .limit(MAX_CARD_ENTRIES),
    statementDate === null
      ? Promise.resolve({ data: null, error: null })
      : supabase.from("card_statements").select("id").eq("card_id", cardId).eq("statement_date", statementDate).maybeSingle(),
  ])
  if (!existing || entries.error || statement.error) return { ok: false, reason: "unavailable" }

  const own = new Set(keys)
  return {
    ok: true,
    matches: {
      importedKeys: [...existing].filter(([, state]) => state === "live").map(([key]) => key),
      deletedKeys: [...existing].filter(([, state]) => state === "deleted").map(([key]) => key),
      cardEntries: entries.data.filter((t) => !own.has(t.idempotency_key)).map((t) => ({ date: t.occurred_on, amountMinor: t.amount_minor })),
      statementExists: statement.data !== null,
    },
  }
}
