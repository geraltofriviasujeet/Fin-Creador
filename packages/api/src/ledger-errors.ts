// Maps database errors from accounts, categories, entries and recurring items (supabase/
// migrations 20261022150000, 20261023120000, 20261024120000, 20261026180000, 20261027120000) to messages for web and mobile. Raw database messages are never shown.

export type LedgerErrorLike = { code?: string | undefined; message?: string | undefined } | null | undefined

export type LedgerMessage = {
  message: string
  /** Form field the message belongs to, when it is about one input. */
  field?: string
}

const GENERIC = "We couldn’t save that. Please try again."

const BY_CODE: Record<string, LedgerMessage> = {
  FC001: { message: "This account is archived. Restore it or choose another account.", field: "accountId" },
  FC002: { message: "The amount's currency must match the account.", field: "accountId" },
  FC003: { message: "The date can't be in the future." },
  FC004: { message: "The currency can't change once the account has income.", field: "currency" },
  FC005: { message: "This entry is already voided." },
  FC006: { message: "That source can't be used. Choose another.", field: "sourceId" },
  FC007: { message: "This entry was already saved." },
  FC008: { message: "We couldn't find that entry." },
  FC010: { message: "We couldn't find that account.", field: "accountId" },
  FC011: { message: "The as-of date can't change once the account has income.", field: "openingBalanceDate" },
  FC012: { message: "You already have Cash in hand. Update its amount instead." },
  FC013: { message: "Only Cash in hand can be updated this way." },
  FC014: { message: "This entry was changed elsewhere. Reload to see the latest version." },
  FC015: { message: "Both accounts of a transfer need the same currency.", field: "counterAccountId" },
  FC016: { message: "A payment mode can only be used with a bank account.", field: "paymentMode" },
  FC017: { message: "Nothing has changed." },
  FC018: { message: "This recurring item is archived. Restore it first." },
  FC019: { message: "That date isn't due for this recurring item." },
  FC020: { message: "This date was already saved or skipped. Reload to see the latest." },
  FC021: { message: "Only the latest saved or skipped date can be undone." },
  FC022: { message: "The end date can't be before an entry already saved for this item.", field: "endDate" },
  FC023: { message: "We couldn't find that recurring item." },
  FC024: { message: "This goal is archived. Restore it first." },
  FC025: { message: "Budgets can start this month or later. Past months keep their budget.", field: "month" },
  FC026: { message: "That category can't have a budget. Choose another.", field: "categoryId" },
  FC027: { message: "This holding is archived. Restore it first." },
  FC028: { message: "The buy date can't be in the future.", field: "buyDate" },
  FC029: { message: "We couldn't find that fund or share. Search again.", field: "instrumentId" },
}

/** `dateField` names the date input on the current form (occurredOn or openingBalanceDate). */
export function ledgerErrorMessage(error: LedgerErrorLike, { dateField }: { dateField?: string } = {}): LedgerMessage {
  const code = error?.code
  if (code === "FC003") return { ...BY_CODE.FC003!, field: dateField }
  if (code && BY_CODE[code]) return BY_CODE[code]
  // Unique active source name (categories_user_kind_name_active_idx).
  if (code === "23505") return { message: "You already have a source with this name.", field: "name" }
  if (code === "23514") return { message: "Please check the values and try again." }
  return { message: GENERIC }
}
