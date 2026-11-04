import { type BankStatementLine, type IsoDate, bankLineDecision, bankStatementLineKey, parseAmount } from "@fin-creador/domain"
import { bankImportMatchesInputSchema, bankImportSaveInputSchema } from "@fin-creador/schemas"
import { cardName } from "../cards/view"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "../income/client"
import { accountLabel } from "../income/load"
import { ledgerErrorMessage } from "../ledger-errors"
import { type BankImportAccount, type BankImportMatches, type BankImportOptions, bankLineErrors } from "./bank-review"
import { existingKeys } from "./matches"
import type { ImportSaveResult, LineSaveResult } from "./save"

// Bank account statement import (Sprint 9b), as the signed-in user (RLS, grants and the ledger
// triggers enforce ownership and the money rules). Each ticked line is saved on its own under a
// key recomputed here from the line as read: an expense or income through record_transaction, a
// transfer between two own accounts as one transfer (never income or expense), a card payment
// through pay_card (the card payment path). Accounts, cards and categories are read here, never
// taken from the client. Results carry a reason only; nothing is logged.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ENTRIES = 20_000

export type BankImportLoad =
  | { ok: true; account: BankImportAccount; today: IsoDate; options: BankImportOptions }
  | { ok: false; reason: "unauthenticated" | "not_found" | "unavailable" }

/** The bank account a statement is imported into, with what its lines can be labelled as. */
export async function loadImportAccount(supabase: UserClient, accountId: string): Promise<BankImportLoad> {
  const day = await userToday(supabase)
  if (!day.ok) return day
  if (!UUID.test(accountId)) return { ok: false, reason: "not_found" }
  const [account, accounts, categories, cards] = await Promise.all([
    supabase.from("accounts").select("id, kind, name, last4, institution, currency, opening_balance_date, archived_at").eq("id", accountId).maybeSingle(),
    supabase.from("accounts").select("id, kind, name, last4, currency").in("kind", ["bank", "cash", "other"]).is("archived_at", null).order("name"),
    supabase.from("categories").select("id, name, kind, system_key").in("kind", ["expense", "income"]).is("archived_at", null).order("name"),
    supabase.from("credit_cards").select("id, issuer, product, product_other, nickname, currency").is("archived_at", null),
  ])
  if (account.error || accounts.error || categories.error || cards.error) return { ok: false, reason: "unavailable" }
  const a = account.data
  if (!a || a.kind !== "bank" || a.archived_at !== null) return { ok: false, reason: "not_found" }
  const pick = (kind: string) => categories.data.filter((c) => c.kind === kind).map((c) => ({ id: c.id, name: c.name, systemKey: c.system_key }))
  return {
    ok: true,
    today: day.today,
    account: { id: a.id, name: accountLabel(a), institution: a.institution ?? a.name, currency: a.currency, openingBalanceDate: a.opening_balance_date },
    options: {
      expenseCategories: pick("expense"),
      incomeSources: pick("income"),
      accounts: accounts.data.filter((o) => o.id !== a.id && o.currency === a.currency).map((o) => ({ id: o.id, name: accountLabel(o) })),
      cards: cards.data
        .filter((c) => c.currency === a.currency)
        .map((c) => ({ id: c.id, name: cardName({ nickname: c.nickname, issuer: c.issuer, product: c.product, productOther: c.product_other }) })),
    },
  }
}

export type BankImportMatchesLoad = { ok: true; matches: BankImportMatches } | { ok: false; reason: "invalid" | "not_found" | "unavailable" }

/**
 * What the ledger already holds for a bank statement under review: keys in the ledger (entries and
 * card payments), the account's income and expense entries and its transfers (either side) in the
 * range, other than this statement's own lines, and its balance at the end of the range.
 */
export async function loadBankImportMatches(supabase: UserClient, input: unknown): Promise<BankImportMatchesLoad> {
  const parsed = bankImportMatchesInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: "invalid" }
  const { accountId, keys, from, to } = parsed.data

  const account = await supabase.from("accounts").select("id, kind").eq("id", accountId).maybeSingle()
  if (account.error) return { ok: false, reason: "unavailable" }
  if (!account.data || account.data.kind !== "bank") return { ok: false, reason: "not_found" }

  const [entryKeys, paymentKeys, rows, balances] = await Promise.all([
    existingKeys(supabase, keys),
    existingKeys(supabase, keys, "liability_payments"),
    supabase
      .from("transactions")
      .select("type, account_id, occurred_on, amount_minor, idempotency_key, liability_payment_id")
      .or(`account_id.eq.${accountId},counter_account_id.eq.${accountId}`)
      .in("type", ["income", "expense", "transfer"])
      .is("voided_at", null)
      .gte("occurred_on", from)
      .lte("occurred_on", to)
      .limit(MAX_ENTRIES),
    supabase.rpc("account_balances_at", { p_dates: [to] }),
  ])
  if (!entryKeys || !paymentKeys || rows.error) return { ok: false, reason: "unavailable" }

  // This statement's own lines: saved under its keys, or (card payments) under a payment with its key.
  const own = new Set(keys)
  const ownPayments = new Set<string>()
  if (paymentKeys.size > 0) {
    const pays = await supabase.from("liability_payments").select("id").in("idempotency_key", [...paymentKeys.keys()])
    if (pays.error) return { ok: false, reason: "unavailable" }
    for (const p of pays.data) ownPayments.add(p.id)
  }
  const others = rows.data.filter((t) => !own.has(t.idempotency_key) && !(t.liability_payment_id && ownPayments.has(t.liability_payment_id)))
  const state = new Map([...entryKeys, ...paymentKeys])
  const book = balances.error ? null : (balances.data.find((b) => b.account_id === accountId)?.balance_minor ?? null)
  return {
    ok: true,
    matches: {
      importedKeys: [...state].filter(([, s]) => s === "live").map(([k]) => k),
      deletedKeys: [...state].filter(([, s]) => s === "deleted").map(([k]) => k),
      entries: others
        .filter((t) => t.type !== "transfer" && t.account_id === accountId)
        .map((t) => ({ date: t.occurred_on, amountMinor: t.amount_minor, direction: t.type === "income" ? ("credit" as const) : ("debit" as const) })),
      transfers: others
        .filter((t) => t.type === "transfer")
        .map((t) => ({ date: t.occurred_on, amountMinor: t.amount_minor, direction: t.account_id === accountId ? ("debit" as const) : ("credit" as const) })),
      bookBalanceMinor: book,
    },
  }
}

const INVALID = "These lines couldn't be checked. Read the statement again and try again."
const SIGNED_OUT = "Sign in again; your file is still here."
const UNAVAILABLE = "We couldn't reach your entries. Check your connection and try again."
const ACCOUNT_NOT_FOUND = "We couldn't find this account. It may be archived."
const WRONG_TYPE = "This kind of entry doesn't fit this line"

export async function saveBankImportLines(supabase: UserClient, input: unknown): Promise<ImportSaveResult> {
  const parsed = bankImportSaveInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  const { accountId, lines } = parsed.data

  const loaded = await loadImportAccount(supabase, accountId)
  if (!loaded.ok) return { ok: false, message: loaded.reason === "unauthenticated" ? SIGNED_OUT : loaded.reason === "not_found" ? ACCOUNT_NOT_FOUND : UNAVAILABLE }
  const { account, options } = loaded
  const day = await userToday(supabase)
  if (!day.ok) return { ok: false, message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }

  const keys = lines.map((l) => bankStatementLineKey(accountId, l.original as BankStatementLine))
  const [entryKeys, paymentKeys] = await Promise.all([existingKeys(supabase, keys), existingKeys(supabase, keys, "liability_payments")])
  if (!entryKeys || !paymentKeys) return { ok: false, message: UNAVAILABLE }

  const context = { openingBalanceDate: account.openingBalanceDate, today: day.today, currency: account.currency }
  const results: LineSaveResult[] = []
  for (const [i, line] of lines.entries()) {
    const key = keys[i]!
    const state = entryKeys.get(key) ?? paymentKeys.get(key)
    if (state) {
      results.push({ key, status: state === "live" ? "already_saved" : "deleted" })
      continue
    }
    const debit = line.original.direction === "debit"
    if (!bankLineDecision(line.original, { accountAddedOn: account.openingBalanceDate, today: day.today }).importable) {
      results.push({ key, status: "failed", reason: "Before the account's opening balance date, or in the future" })
      continue
    }
    if ((line.type === "expense" || line.type === "card_payment") !== debit && line.type !== "transfer") {
      results.push({ key, status: "failed", reason: WRONG_TYPE })
      continue
    }
    const errors = bankLineErrors(line, options, context)
    const firstError = errors.date ?? errors.amount ?? errors.type ?? errors.target
    const amount = parseAmount(line.amount, account.currency)
    if (firstError || !amount.ok) {
      results.push({ key, status: "failed", reason: firstError ?? "Enter an amount above zero" })
      continue
    }
    const note = line.original.description === "" ? null : line.original.description
    const { data, error } =
      line.type === "card_payment"
        ? await supabase.rpc("pay_card", {
            p_card_id: line.cardId,
            p_idempotency_key: key,
            p_account_id: accountId,
            p_paid_on: line.date,
            p_amount_minor: amount.minor,
            // The statement shows the money already left the account.
            p_allow_shortfall: true,
          })
        : await supabase.rpc("record_transaction", {
            p_type: line.type,
            p_idempotency_key: key,
            p_amount_minor: amount.minor,
            p_occurred_on: line.date,
            // A transfer leaves the debit side's account: this one for a debit, the other for a credit.
            p_account_id: line.type === "transfer" && !debit ? line.otherAccountId : accountId,
            p_counter_account_id: line.type === "transfer" ? (debit ? line.otherAccountId : accountId) : undefined,
            p_category_id: line.type === "transfer" ? undefined : line.categoryId,
            p_note: note ?? undefined,
          })
    if (error?.code === "FC007") results.push({ key, status: "already_saved" })
    else if (error || !data) results.push({ key, status: "failed", reason: ledgerErrorMessage(error).message })
    else if (data.voided_at === null) results.push({ key, status: "saved" })
    else {
      const latest = await existingKeys(supabase, [key], line.type === "card_payment" ? "liability_payments" : "transactions")
      results.push({ key, status: latest?.get(key) === "live" ? "already_saved" : "deleted" })
    }
  }
  return { ok: true, results }
}
