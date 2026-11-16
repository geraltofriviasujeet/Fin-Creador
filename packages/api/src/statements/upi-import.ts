import { type IsoDate, UPI_ROW_KEY_NAMESPACE, type UpiApp, parseAmount, upiBankLabelKey, upiRowKey, uuidV5 } from "@fin-creador/domain"
import { upiAccountMatchInputSchema, upiMatchesInputSchema, upiOpeningMoveInputSchema, upiOpeningPreviewInputSchema, upiSaveInputSchema } from "@fin-creador/schemas"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "../income/client"
import { accountLabel } from "../income/load"
import { ledgerErrorMessage } from "../ledger-errors"
import { existingKeys } from "./matches"
import type { ImportSaveResult, LineSaveResult } from "./save"
import { type UpiAccountMatch, type UpiExistingEntry, type UpiImportOptions, type UpiMatches, payeeKey, upiLineErrors } from "./upi-review"

// UPI app statement import (Sprint 9e), as the signed-in user (RLS, grants and the ledger
// triggers enforce ownership and the money rules). Each ticked payment is saved on its own under a
// key recomputed here from its UPI reference and direction (never one sent by the client): an
// expense, income or refund through record_transaction, a transfer between two own accounts as one
// transfer. Accounts and categories are read here, never taken from the client. The UPI reference
// reaches this server only to derive the key; it is not stored or logged. Results carry a reason only.

const MAX_ENTRIES = 20_000
const MAX_HISTORY_NAMES = 2_000

export type UpiImportLoad =
  | {
      ok: true
      today: IsoDate
      currency: string
      options: UpiImportOptions
      matches: UpiAccountMatch[]
      /** When the person allowed payee names to be sent for category suggestions; null when not. */
      consentAt: string | null
    }
  | { ok: false; reason: "unauthenticated" | "unavailable" }

/** What the import page needs before a file is read: accounts, categories, remembered matches, consent. */
export async function loadUpiImport(supabase: UserClient): Promise<UpiImportLoad> {
  const day = await userToday(supabase)
  if (!day.ok) return day
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false, reason: "unauthenticated" }
  const [profile, accounts, categories, matches] = await Promise.all([
    supabase.from("profiles").select("currency, import_payees_ok_at").eq("id", auth.user.id).maybeSingle(),
    supabase.from("accounts").select("id, kind, name, last4, currency, opening_balance_date").in("kind", ["bank", "cash", "other"]).is("archived_at", null).order("name"),
    supabase.from("categories").select("id, name, kind, system_key, icon, key, source_type").in("kind", ["expense", "income"]).is("archived_at", null).order("name"),
    supabase.from("upi_account_matches").select("app, kind, bank_label, last_digits, account_id"),
  ])
  if (profile.error || !profile.data || accounts.error || categories.error || matches.error) return { ok: false, reason: "unavailable" }
  const currency = profile.data.currency
  return {
    ok: true,
    today: day.today,
    currency,
    consentAt: profile.data.import_payees_ok_at,
    options: {
      accounts: accounts.data
        .filter((a) => a.currency === currency)
        .map((a) => ({ id: a.id, name: accountLabel(a), kind: a.kind, openingBalanceDate: a.opening_balance_date })),
      expenseCategories: categories.data
        .filter((c) => c.kind === "expense")
        .map((c) => ({ id: c.id, name: c.name, systemKey: c.system_key, icon: c.icon, key: c.key })),
      incomeSources: categories.data
        .filter((c) => c.kind === "income")
        .map((c) => ({ id: c.id, name: c.name, systemKey: c.system_key, sourceType: c.source_type })),
    },
    matches: matches.data.map((m): UpiAccountMatch =>
      m.kind === "upi_lite"
        ? { kind: "upi_lite", app: "google_pay", accountId: m.account_id }
        : { kind: "bank", app: m.app as UpiApp, bankLabel: m.bank_label, digits: m.last_digits ?? "", accountId: m.account_id ?? "" },
    ),
  }
}

export type UpiMatchSaveResult = { ok: true; match: UpiAccountMatch } | { ok: false; message: string }

/** Remembers which account a statement's bank account is (or the UPI Lite choice). The database checks the account is the person's own, active, and not a card or loan. */
export async function saveUpiAccountMatch(supabase: UserClient, input: unknown): Promise<UpiMatchSaveResult> {
  const parsed = upiAccountMatchInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Choose one of your accounts." }
  const m = parsed.data
  const bankLabel = m.kind === "bank" ? upiBankLabelKey(m.bankLabel) : ""
  const digits = m.kind === "bank" ? m.digits : null
  let query = supabase.from("upi_account_matches").select("id").eq("app", m.app).eq("kind", m.kind).eq("bank_label", bankLabel)
  query = digits === null ? query.is("last_digits", null) : query.eq("last_digits", digits)
  const found = await query.maybeSingle()
  if (found.error) return { ok: false, message: "We couldn't save this. Check your connection and try again." }
  const write = found.data
    ? await supabase.from("upi_account_matches").update({ account_id: m.accountId }).eq("id", found.data.id).select("id").maybeSingle()
    : await supabase.from("upi_account_matches").insert({ app: m.app, kind: m.kind, bank_label: bankLabel, last_digits: digits, account_id: m.accountId }).select("id").maybeSingle()
  if (write.error || !write.data) return { ok: false, message: write.error?.code === "22023" ? "Pick one of your active bank, cash or other accounts." : "We couldn't save this. Try again." }
  return {
    ok: true,
    match: m.kind === "bank" ? { kind: "bank", app: m.app, bankLabel, digits: m.digits, accountId: m.accountId } : { kind: "upi_lite", app: "google_pay", accountId: m.accountId },
  }
}

/** The person's last category for each payee name (their own live expenses whose description is that name). */
export async function loadPayeeHistory(supabase: UserClient, names: unknown): Promise<{ ok: true; history: [string, string][] } | { ok: false }> {
  if (!Array.isArray(names) || names.length > MAX_HISTORY_NAMES || !names.every((n) => typeof n === "string" && n.length <= 280)) return { ok: false }
  if (names.length === 0) return { ok: true, history: [] }
  const { data, error } = await supabase.rpc("payee_last_categories", { p_names: names as string[] })
  if (error) return { ok: false }
  return { ok: true, history: data.map((r) => [payeeKey(r.payee), r.category_id]) }
}

export type UpiMatchesLoad = { ok: true; matches: UpiMatches } | { ok: false; reason: "invalid" | "unavailable" }

/** Which keys are already in the ledger, and the live entries on these accounts in the range (for possible duplicates). */
export async function loadUpiMatches(supabase: UserClient, input: unknown): Promise<UpiMatchesLoad> {
  const parsed = upiMatchesInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: "invalid" }
  const { keys, accountIds, from, to } = parsed.data
  const ids = [...new Set(accountIds)]
  const [state, rows, categories] = await Promise.all([
    existingKeys(supabase, keys),
    ids.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("transactions")
          .select("id, type, account_id, counter_account_id, occurred_on, amount_minor, note, category_id, idempotency_key")
          .or(`account_id.in.(${ids.join(",")}),counter_account_id.in.(${ids.join(",")})`)
          .in("type", ["income", "expense", "refund", "transfer"])
          .is("voided_at", null)
          .gte("occurred_on", from)
          .lte("occurred_on", to)
          .limit(MAX_ENTRIES),
    supabase.from("categories").select("id, name"),
  ])
  if (!state || rows.error || categories.error) return { ok: false, reason: "unavailable" }
  const own = new Set(keys)
  const names = new Map(categories.data.map((c) => [c.id, c.name]))
  return {
    ok: true,
    matches: {
      importedKeys: [...state].filter(([, s]) => s === "live").map(([k]) => k),
      deletedKeys: [...state].filter(([, s]) => s === "deleted").map(([k]) => k),
      entries: rows.data
        .filter((t) => !own.has(t.idempotency_key))
        .map(
          (t): UpiExistingEntry => ({
            id: t.id,
            type: t.type as UpiExistingEntry["type"],
            accountId: t.account_id,
            counterAccountId: t.counter_account_id,
            date: t.occurred_on,
            amountMinor: t.amount_minor,
            note: t.note,
            categoryName: t.category_id ? (names.get(t.category_id) ?? null) : null,
          }),
        ),
    },
  }
}

/** Allows (true) or withdraws (false) sending payee names for category suggestions; the database sets the time. */
export async function setImportPayeesConsent(supabase: UserClient, allow: boolean): Promise<{ ok: true; at: string | null } | { ok: false }> {
  const { data, error } = await supabase.rpc("set_import_payees_consent", { p_allow: allow })
  if (error || (allow && !data)) return { ok: false }
  return { ok: true, at: data ?? null }
}

const INVALID = "These payments couldn't be checked. Read the statement again and try again."
const SIGNED_OUT = "Sign in again; your file is still here."
const UNAVAILABLE = "We couldn't reach your entries. Check your connection and try again."

export async function saveUpiImportLines(supabase: UserClient, input: unknown): Promise<ImportSaveResult> {
  const parsed = upiSaveInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  const loaded = await loadUpiImport(supabase)
  if (!loaded.ok) return { ok: false, message: loaded.reason === "unauthenticated" ? SIGNED_OUT : UNAVAILABLE }
  const { options, currency } = loaded
  const day = await userToday(supabase)
  if (!day.ok) return { ok: false, message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }

  const keys = parsed.data.lines.map((l) => upiRowKey(l.original))
  const state = await existingKeys(supabase, keys)
  if (!state) return { ok: false, message: UNAVAILABLE }

  const context = { today: day.today, currency }
  const results: LineSaveResult[] = []
  for (const [i, line] of parsed.data.lines.entries()) {
    const key = keys[i]!
    const known = state.get(key)
    if (known) {
      results.push({ key, status: known === "live" ? "already_saved" : "deleted" })
      continue
    }
    const debit = line.original.direction === "debit"
    if ((line.type === "expense" || line.type === "transfer") !== debit) {
      results.push({ key, status: "failed", reason: "This kind of entry doesn't fit this payment" })
      continue
    }
    const errors = upiLineErrors(line, options, context)
    const firstError = errors.account ?? errors.date ?? errors.amount ?? errors.type ?? errors.category
    const amount = parseAmount(line.amount, currency)
    if (firstError || !amount.ok) {
      results.push({ key, status: "failed", reason: firstError ?? "Enter an amount above zero" })
      continue
    }
    const transfer = line.type === "transfer"
    const { data, error } = await supabase.rpc("record_transaction", {
      p_type: line.type,
      p_idempotency_key: key,
      p_amount_minor: amount.minor,
      p_occurred_on: line.date,
      p_account_id: line.accountId,
      p_counter_account_id: transfer ? line.counterAccountId : undefined,
      p_category_id: transfer ? undefined : line.categoryId,
      p_note: line.original.payee === "" ? undefined : line.original.payee,
    })
    if (error?.code === "FC007") results.push({ key, status: "already_saved" })
    else if (error || !data) results.push({ key, status: "failed", reason: ledgerErrorMessage(error).message })
    else if (data.voided_at === null) results.push({ key, status: "saved" })
    else {
      const latest = await existingKeys(supabase, [key])
      results.push({ key, status: latest?.get(key) === "live" ? "already_saved" : "deleted" })
    }
  }
  return { ok: true, results }
}

export type UpiOpeningPreview = { ok: true; oldDate: IsoDate; oldMinor: number; earlierNetMinor: number } | { ok: false; message: string }

/**
 * What moving an account's opening back to `newDate` starts from: its opening date and amount, and
 * the net of the live entries already saved between the new and the old date (the old date leaves
 * them out today; the move counts them, so the opening amount absorbs them too).
 */
export async function loadUpiOpeningPreview(supabase: UserClient, input: unknown): Promise<UpiOpeningPreview> {
  const parsed = upiOpeningPreviewInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  const { accountId, newDate } = parsed.data
  const account = await supabase.from("accounts").select("opening_balance_date, opening_balance_minor").eq("id", accountId).maybeSingle()
  if (account.error) return { ok: false, message: UNAVAILABLE }
  if (!account.data) return { ok: false, message: ledgerErrorMessage({ code: "FC010" }).message }
  const oldDate = account.data.opening_balance_date
  let earlierNetMinor = 0
  if (newDate < oldDate) {
    const entries = await supabase
      .from("transactions")
      .select("type, amount_minor, counter_account_id")
      .or(`account_id.eq.${accountId},counter_account_id.eq.${accountId}`)
      .is("voided_at", null)
      .gte("occurred_on", newDate)
      .lt("occurred_on", oldDate)
      .limit(MAX_ENTRIES)
    if (entries.error) return { ok: false, message: UNAVAILABLE }
    for (const e of entries.data) {
      const into = e.type === "income" || e.type === "refund" || (e.type === "transfer" && e.counter_account_id === accountId)
      earlierNetMinor += into ? e.amount_minor : -e.amount_minor
    }
  }
  return { ok: true, oldDate, oldMinor: account.data.opening_balance_minor, earlierNetMinor }
}

export type UpiOpeningMoveResult =
  | { ok: true; keys: string[]; move: { oldDate: IsoDate; newDate: IsoDate; oldMinor: number; newMinor: number; added: number } }
  | { ok: false; message: string }

/**
 * Adds one account's payments dated before its opening and moves the opening back
 * (move_account_opening: one transaction, today's balance unchanged, checked by the database).
 * Each payment is checked as a saved one is, except against this account's opening date; the
 * request key comes from the account and the payments' keys, so a retry adds nothing.
 */
export async function moveUpiOpening(supabase: UserClient, input: unknown): Promise<UpiOpeningMoveResult> {
  const parsed = upiOpeningMoveInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  const loaded = await loadUpiImport(supabase)
  if (!loaded.ok) return { ok: false, message: loaded.reason === "unauthenticated" ? SIGNED_OUT : UNAVAILABLE }
  const { options, currency } = loaded
  const day = await userToday(supabase)
  if (!day.ok) return { ok: false, message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const { accountId, lines } = parsed.data
  const account = options.accounts.find((a) => a.id === accountId)
  if (!account) return { ok: false, message: ledgerErrorMessage({ code: "FC010" }).message }

  const keys: string[] = []
  const entries = []
  for (const line of lines) {
    const key = upiRowKey(line.original)
    const transfer = line.type === "transfer"
    const amount = parseAmount(line.amount, currency)
    const errors = upiLineErrors(line, options, { today: day.today, currency }, accountId)
    const touches = line.accountId === accountId || (transfer && line.counterAccountId === accountId)
    if (!amount.ok || Object.keys(errors).length > 0 || !touches || line.date >= account.openingBalanceDate || (line.type === "expense" || transfer) !== (line.original.direction === "debit")) {
      return { ok: false, message: "A payment here can't be added. Reload the statement and try again." }
    }
    keys.push(key)
    entries.push({
      key,
      type: line.type,
      amount_minor: amount.minor,
      occurred_on: line.date,
      account_id: line.accountId,
      counter_account_id: transfer ? line.counterAccountId : null,
      category_id: transfer ? null : line.categoryId,
      note: line.original.payee === "" ? null : line.original.payee,
    })
  }
  const requestKey = uuidV5(JSON.stringify(["upi-opening:v1", accountId, [...keys].sort()]), UPI_ROW_KEY_NAMESPACE)
  const { data, error } = await supabase.rpc("move_account_opening", { p_request_key: requestKey, p_account_id: accountId, p_entries: entries })
  if (error || !data) return { ok: false, message: ledgerErrorMessage(error).message }
  return {
    ok: true,
    keys,
    move: { oldDate: data.old_opening_date, newDate: data.new_opening_date, oldMinor: data.old_opening_minor, newMinor: data.new_opening_minor, added: data.entries_added },
  }
}

export type UpiLiteResult = { ok: true; account: { id: string; name: string; openingBalanceDate: IsoDate }; match: UpiAccountMatch } | { ok: false; message: string }

/**
 * The Google Pay UPI Lite choice. `create`: adds an "UPI Lite" account (kind other, opening balance
 * zero on the first Lite day of the statement, so its top-ups and payments are inside it) and
 * remembers it; otherwise remembers the decline (Lite payments then post from the linked bank).
 */
export async function chooseUpiLite(supabase: UserClient, input: { create: boolean; openingDate?: unknown }): Promise<UpiLiteResult> {
  if (!input.create) {
    const saved = await saveUpiAccountMatch(supabase, { kind: "upi_lite", app: "google_pay", accountId: null })
    return saved.ok ? { ok: true, account: { id: "", name: "", openingBalanceDate: "" }, match: saved.match } : saved
  }
  const day = await userToday(supabase)
  if (!day.ok) return { ok: false, message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const opening = typeof input.openingDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.openingDate) && input.openingDate <= day.today ? input.openingDate : day.today
  const { data: auth } = await supabase.auth.getUser()
  const profile = await supabase.from("profiles").select("currency").eq("id", auth.user?.id ?? "").maybeSingle()
  if (profile.error || !profile.data) return { ok: false, message: UNAVAILABLE }
  const { data, error } = await supabase
    .from("accounts")
    .insert({ kind: "other", name: "UPI Lite", currency: profile.data.currency, opening_balance_minor: 0, opening_balance_date: opening })
    .select("id, name, last4, opening_balance_date")
    .maybeSingle()
  if (error || !data) return { ok: false, message: "We couldn't add the UPI Lite account. Try again." }
  const saved = await saveUpiAccountMatch(supabase, { kind: "upi_lite", app: "google_pay", accountId: data.id })
  if (!saved.ok) return saved
  return { ok: true, account: { id: data.id, name: accountLabel(data), openingBalanceDate: data.opening_balance_date }, match: saved.match }
}
