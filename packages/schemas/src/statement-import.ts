import { MAX_STATEMENT_LINES, isIsoDate } from "@fin-creador/domain"
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
