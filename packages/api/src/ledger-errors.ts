// Maps database errors from accounts, categories and entries (supabase/migrations
// 20261022150000, 20261023120000) to messages for web and mobile. Raw database messages are never shown.

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
