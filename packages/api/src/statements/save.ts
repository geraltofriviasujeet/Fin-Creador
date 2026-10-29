import {
  STATEMENT_LINE_KEY_NAMESPACE,
  type StatementLine,
  cardLineDecision,
  parseAmount,
  statementLineKey,
  uuidV5,
} from "@fin-creador/domain"
import { importSaveInputSchema, importStatementInputSchema } from "@fin-creador/schemas"
import { enterStatement } from "../cards/writers"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "../income/client"
import { ledgerErrorMessage } from "../ledger-errors"
import { existingKeys } from "./matches"
import { BANK_CHARGES_KEY, type ReviewCategory, lineErrors } from "./review"

// Saving an imported card statement (Sprint 9a.5), as the signed-in user (RLS, grants and the
// ledger triggers enforce ownership and the money rules). Each line is saved on its own through
// record_transaction as an expense on the card, under a key recomputed here from the line as read
// (never one sent by the client), so a cut-off import is finished by saving again and no key is
// posted twice. The card, its account and the categories are read here, never taken from the
// client. Dates are checked against the person's own today (user_local_today, profile time zone).
// Results carry a reason only: no description, amount or file name, and nothing is logged.

export type LineSaveStatus = "saved" | "already_saved" | "deleted" | "failed"
export type LineSaveResult = { key: string; status: LineSaveStatus; reason?: string }
export type ImportSaveResult = { ok: true; results: LineSaveResult[] } | { ok: false; message: string }

const INVALID = "These lines couldn't be checked. Read the statement again and try again."
const SIGNED_OUT = "Sign in again; your file is still here."
const UNAVAILABLE = "We couldn't reach your entries. Check your connection and try again."
const CARD_NOT_FOUND = "We couldn't find this card. It may be archived."
const NOT_SPENDING = "Not a purchase on the card"

type CardRow = { account_id: string; currency: string; tracking_started_on: string; archived_at: string | null }

async function loadCard(supabase: UserClient, cardId: string): Promise<{ ok: true; card: CardRow } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("credit_cards")
    .select("account_id, currency, tracking_started_on, archived_at")
    .eq("id", cardId)
    .maybeSingle()
  if (error) return { ok: false, message: UNAVAILABLE }
  if (!data || data.archived_at !== null) return { ok: false, message: CARD_NOT_FOUND }
  return { ok: true, card: data }
}

export async function saveImportLines(supabase: UserClient, input: unknown): Promise<ImportSaveResult> {
  const parsed = importSaveInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  const { cardId, statementDate, lines } = parsed.data

  const day = await userToday(supabase)
  if (!day.ok) return { ok: false, message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const loaded = await loadCard(supabase, cardId)
  if (!loaded.ok) return loaded
  const { card } = loaded

  const ids = [...new Set(lines.map((l) => l.categoryId))]
  const { data: owned, error: catError } = await supabase.from("categories").select("id").eq("kind", "expense").is("archived_at", null).in("id", ids)
  if (catError) return { ok: false, message: UNAVAILABLE }
  const categories: ReviewCategory[] = owned.map((c) => ({ id: c.id, name: "", systemKey: null }))

  const keys = lines.map((l) => statementLineKey(cardId, statementDate, l.original as StatementLine))
  const existing = await existingKeys(supabase, keys)
  if (!existing) return { ok: false, message: UNAVAILABLE }

  const context = { cardAddedOn: card.tracking_started_on, today: day.today, currency: card.currency }
  const results: LineSaveResult[] = []
  for (const [i, line] of lines.entries()) {
    const key = keys[i]!
    const state = existing.get(key)
    if (state) {
      results.push({ key, status: state === "live" ? "already_saved" : "deleted" })
      continue
    }
    if (!cardLineDecision(line.original, context).importable) {
      results.push({ key, status: "failed", reason: NOT_SPENDING })
      continue
    }
    const errors = lineErrors(line, categories, context)
    const firstError = errors.date ?? errors.amount ?? errors.categoryId
    const amount = parseAmount(line.amount, card.currency)
    if (firstError || !amount.ok) {
      results.push({ key, status: "failed", reason: firstError ?? "Enter an amount above zero" })
      continue
    }
    const { data, error } = await supabase.rpc("record_transaction", {
      p_type: "expense",
      p_idempotency_key: key,
      p_amount_minor: amount.minor,
      p_occurred_on: line.date,
      p_account_id: card.account_id,
      p_category_id: line.categoryId,
      p_note: line.original.description,
    })
    if (error?.code === "FC007") results.push({ key, status: "already_saved" })
    else if (error || !data) results.push({ key, status: "failed", reason: ledgerErrorMessage(error).message })
    else if (data.voided_at === null) results.push({ key, status: "saved" })
    else {
      // Another save got there first and that row is voided: report its latest version.
      const latest = await existingKeys(supabase, [key])
      results.push({ key, status: latest?.get(key) === "live" ? "already_saved" : "deleted" })
    }
  }
  return { ok: true, results }
}

export type ImportStatementResult = { status: "saved" | "exists" | "error"; message: string }

/** The request key of a statement entered from an import: one per card and statement date. */
export const importStatementKey = (cardId: string, statementDate: string) =>
  uuidV5(JSON.stringify(["card-statement:v1", cardId, statementDate]), STATEMENT_LINE_KEY_NAMESPACE)

/**
 * Enter statement after the lines, with the reviewed figures. Already entered for this card and
 * date: nothing changes. A bill larger than what the card owes then adds the difference as an
 * expense in Bank charges & interest (enter_card_statement).
 */
export async function enterImportedStatement(supabase: UserClient, input: unknown): Promise<ImportStatementResult> {
  const parsed = importStatementInputSchema.safeParse(input)
  if (!parsed.success) return { status: "error", message: "Check the statement figures." }
  const s = parsed.data
  const [existing, bank] = await Promise.all([
    supabase.from("card_statements").select("id").eq("card_id", s.cardId).eq("statement_date", s.statementDate).maybeSingle(),
    supabase.from("categories").select("id").eq("system_key", BANK_CHARGES_KEY).is("archived_at", null).maybeSingle(),
  ])
  if (existing.error || bank.error) return { status: "error", message: UNAVAILABLE }
  if (existing.data) return { status: "exists", message: "A statement for this date was already entered: only the lines were saved." }
  const result = await enterStatement(supabase, {
    cardId: s.cardId,
    statementDate: s.statementDate,
    dueDate: s.dueDate,
    total: s.total,
    minimum: s.minimum,
    emiIncluded: "",
    differenceCategoryId: bank.data?.id ?? "",
    idempotencyKey: importStatementKey(s.cardId, s.statementDate),
  })
  if (result.status === "success") return { status: "saved", message: result.message }
  const field = result.fieldErrors ? Object.values(result.fieldErrors)[0] : undefined
  return { status: "error", message: field ?? result.message }
}
