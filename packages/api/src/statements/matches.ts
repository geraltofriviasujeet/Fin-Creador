import { type ImportMatchesInput, importMatchesInputSchema } from "@fin-creador/schemas"
import type { UserClient } from "../income/client"
import type { ImportMatches } from "./review"

// What the database already holds for a statement under review (Sprint 9a.4), read as the
// signed-in user (RLS): another person's card or keys find nothing. Reads only.

const KEY_CHUNK = 100
const MAX_CARD_ENTRIES = 5000

/** How many edits are followed from an imported row; a longer chain counts as live. */
export const MAX_EDIT_DEPTH = 20

const chunked = <T>(xs: readonly T[]) => Array.from({ length: Math.ceil(xs.length / KEY_CHUNK) }, (_, i) => xs.slice(i * KEY_CHUNK, (i + 1) * KEY_CHUNK))

/**
 * Which request keys already have a ledger row: "live" when the latest version of the row counts,
 * "deleted" when the latest version is voided (clients cannot hard-delete entries, so a deleted
 * entry is a voided one). An edit voids a row and inserts a newer version under a new key with
 * replaces_id set, so a voided row is followed to its latest version, one batched read per edit
 * level, up to MAX_EDIT_DEPTH (beyond that: "live"). Null when a read fails.
 */
export async function existingKeys(supabase: UserClient, keys: readonly string[]): Promise<Map<string, "live" | "deleted"> | null> {
  const rows = await Promise.all(chunked([...new Set(keys)]).map((chunk) => supabase.from("transactions").select("id, idempotency_key, voided_at").in("idempotency_key", chunk)))
  if (rows.some((r) => r.error)) return null
  const found = rows.flatMap((r) => r.data ?? [])
  const state = new Map(found.map((t) => [t.idempotency_key, t.voided_at === null ? ("live" as const) : ("deleted" as const)]))

  // The latest version reached so far, for each key whose row is voided.
  let heads = new Map(found.filter((t) => t.voided_at !== null).map((t) => [t.idempotency_key, t.id]))
  for (let depth = 0; heads.size > 0; depth++) {
    if (depth > MAX_EDIT_DEPTH) {
      for (const key of heads.keys()) state.set(key, "live")
      break
    }
    const next = await Promise.all(chunked([...new Set(heads.values())]).map((chunk) => supabase.from("transactions").select("id, voided_at, replaces_id").in("replaces_id", chunk)))
    if (next.some((r) => r.error)) return null
    const newer = new Map(next.flatMap((r) => r.data ?? []).map((t) => [t.replaces_id, t]))
    const still = new Map<string, string>()
    for (const [key, id] of heads) {
      const version = newer.get(id)
      if (!version) continue // voided with nothing newer: deleted
      if (version.voided_at === null) state.set(key, "live")
      else still.set(key, version.id)
    }
    heads = still
  }
  return state
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
