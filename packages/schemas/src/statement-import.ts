import { MAX_AMOUNT_MINOR, MAX_BANK_STATEMENT_LINES, MAX_STATEMENT_LINES, STATEMENT_NOTE_MAX, isIsoDate } from "@fin-creador/domain"
import { hasDigitRun } from "./digits"
import { z } from "zod"

// Statement import (Sprint 9a): what the review screen asks the server about a statement's lines.

const isoDate = z.string().refine(isIsoDate, "Enter a date")

/** Lookup for the review: which keys exist, the card's entries in the date range, the statement. */
export const importMatchesInputSchema = z
  .object({
    cardId: z.uuid(),
    keys: z.array(z.uuid()).max(MAX_STATEMENT_LINES),
    from: isoDate,
    to: isoDate,
    statementDate: isoDate.nullable(),
  })
  .refine((v) => v.from <= v.to, { message: "The range ends before it starts", path: ["to"] })

export type ImportMatchesInput = z.infer<typeof importMatchesInputSchema>

/** Lines per save call: the client sends a statement in chunks, each line saved on its own. */
export const IMPORT_SAVE_CHUNK = 10

/** A line exactly as the parser read it (its request key is derived from these values only): spending (debit) or a refund (credit). */
const parsedLineSchema = z.object({
  date: isoDate,
  amountMinor: z.number().int().positive().max(MAX_AMOUNT_MINOR),
  direction: z.enum(["debit", "credit"]),
  kind: z.enum(["purchase", "fee", "interest", "tax", "refund"]),
  description: z
    .string()
    .min(1)
    .max(STATEMENT_NOTE_MAX)
    .refine((v) => v === v.trim() && !hasDigitRun(v, 4), "No card or account numbers"),
  foreignCurrency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  occurrence: z.number().int().min(0).max(MAX_STATEMENT_LINES),
}).refine((l) => (l.kind === "refund") === (l.direction === "credit"), "A refund is a credit; spending is a debit")

const optionalId = z.union([z.uuid(), z.literal("")])

/** Ticked lines to save: the line as read, and the date, amount, category and refund link as reviewed. */
export const importSaveInputSchema = z.object({
  cardId: z.uuid(),
  /** The statement date as read ("" when none was read): part of every line's key. */
  statementDate: z.union([isoDate, z.literal("")]),
  lines: z
    .array(
      z.object({
        original: parsedLineSchema,
        date: z.string().max(10),
        amount: z.string().max(40),
        categoryId: z.uuid(),
        /** Refunds only: the purchase it reverses, or "". */
        refundOfId: optionalId.default(""),
      }),
    )
    .min(1)
    .max(IMPORT_SAVE_CHUNK),
})

export type ImportSaveInput = z.infer<typeof importSaveInputSchema>

/** Enter statement from an import: the figures as reviewed. */
export const importStatementInputSchema = z.object({
  cardId: z.uuid(),
  statementDate: isoDate,
  total: z.string().max(40),
  minimum: z.string().max(40),
  dueDate: z.string().max(10),
})

// Bank account statement import (Sprint 9b).

/** Lookup for a bank review: which keys exist (entries and card payments), the account's entries and transfers in the range. */
export const bankImportMatchesInputSchema = z
  .object({
    accountId: z.uuid(),
    keys: z.array(z.uuid()).max(MAX_BANK_STATEMENT_LINES),
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.from <= v.to, { message: "The range ends before it starts", path: ["to"] })

/** A bank line exactly as the parser read it (its key comes from these values only). */
const bankLineSchema = z.object({
  date: isoDate,
  amountMinor: z.number().int().positive().max(MAX_AMOUNT_MINOR),
  direction: z.enum(["debit", "credit"]),
  description: z
    .string()
    .max(STATEMENT_NOTE_MAX)
    .refine((v) => v === v.trim() && !hasDigitRun(v, 4), "No card or account numbers"),
  balanceMinor: z.number().int().min(-MAX_AMOUNT_MINOR).max(MAX_AMOUNT_MINOR),
  occurrence: z.number().int().min(0).max(MAX_BANK_STATEMENT_LINES),
})

/** Ticked bank lines to save: the line as read, and the date, amount, type and its target as reviewed. */
export const bankImportSaveInputSchema = z.object({
  accountId: z.uuid(),
  lines: z
    .array(
      z.object({
        original: bankLineSchema,
        date: z.string().max(10),
        amount: z.string().max(40),
        type: z.enum(["expense", "income", "transfer", "card_payment", "refund"]),
        categoryId: optionalId,
        otherAccountId: optionalId,
        cardId: optionalId,
        /** Refunds only: the purchase it reverses, or "". */
        refundOfId: optionalId.default(""),
      }),
    )
    .min(1)
    .max(IMPORT_SAVE_CHUNK),
})

export type BankImportSaveInput = z.infer<typeof bankImportSaveInputSchema>
