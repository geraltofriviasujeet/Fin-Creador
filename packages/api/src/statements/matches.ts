import { type ImportMatchesInput, importMatchesInputSchema } from "@fin-creador/schemas"
import type { UserClient } from "../income/client"
import type { ImportMatches } from "./review"

// What the database already holds for a statement under review (Sprint 9a.4), read as the
// signed-in user (RLS): another person's card or keys find nothing. Reads only.

const KEY_CHUNK = 100
const MAX_CARD_ENTRIES = 5000

export type ImportMatchesLoad = { ok: true; matches: ImportMatches } | { ok: false; reason: "invalid" | "not_found" | "unavailable" }

export async function loadImportMatches(supabase: UserClient, input: unknown): Promise<ImportMatchesLoad> {
  const parsed = importMatchesInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: "invalid" }
  const { cardId, keys, from, to, statementDate }: ImportMatchesInput = parsed.data

  const card = await supabase.from("credit_cards").select("account_id").eq("id", cardId).maybeSingle()
  if (card.error) return { ok: false, reason: "unavailable" }
  if (!card.data) return { ok: false, reason: "not_found" }

  const unique = [...new Set(keys)]
  const chunks = Array.from({ length: Math.ceil(unique.length / KEY_CHUNK) }, (_, i) => unique.slice(i * KEY_CHUNK, (i + 1) * KEY_CHUNK))
  const [importedChunks, entries, statement] = await Promise.all([
    Promise.all(chunks.map((chunk) => supabase.from("transactions").select("idempotency_key").in("idempotency_key", chunk))),
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
  if (importedChunks.some((r) => r.error) || entries.error || statement.error) return { ok: false, reason: "unavailable" }

  const own = new Set(unique)
  return {
    ok: true,
    matches: {
      importedKeys: importedChunks.flatMap((r) => (r.data ?? []).map((t) => t.idempotency_key)),
      cardEntries: entries.data.filter((t) => !own.has(t.idempotency_key)).map((t) => ({ date: t.occurred_on, amountMinor: t.amount_minor })),
      statementExists: statement.data !== null,
    },
  }
}
