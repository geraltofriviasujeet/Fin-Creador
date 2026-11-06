import { z } from "zod"
import { loadTransactionPage } from "@fin-creador/api"
import { formatMoney, stripDigitRuns } from "@fin-creador/domain"
import { matchCategories } from "./categories"
import { periodData, periodFields, periodRangeOrThrow } from "./period"
import { type FinanceTool, type Figure, ToolError } from "./types"

// search_transactions (Sprint 10.2): matching entries, newest first, at most SEARCH_LIMIT
// (list_transactions, the Transactions page's search: text in the note, category or account,
// or an amount). A category asked for matches loosely (matchCategories, as category_breakdown):
// every matching category is searched, and the newest SEARCH_LIMIT entries across them are
// kept. Accounts and categories go by name only, never digits or record IDs.
// Descriptions are sent only once the person has agreed in Roma (roma_descriptions_ok_at);
// until then rows go without them and the answer says so. Every description is cleaned again
// here, whatever cleaned it at import: digit runs of 4 or more and anything shaped like an
// email or UPI handle (x@y) are removed.

export const SEARCH_LIMIT = 20
/** A category asked for may match several; past this many, ask for something narrower. */
export const MAX_MATCHED_CATEGORIES = 8
const MAX_DESCRIPTION_CHARS = 80
const ENTRY_TYPES = ["expense", "income", "transfer", "refund"] as const

const input = z
  .object({
    ...periodFields,
    query: z.string().trim().max(60).optional().describe("Text to find in descriptions, categories or accounts, or an amount such as 1499."),
    type: z.enum(ENTRY_TYPES).optional().describe("Only entries of this type."),
    category: z
      .string()
      .trim()
      .max(60)
      .optional()
      .describe("Only entries in categories whose name contains these words, e.g. 'food' finds 'Food & dining'."),
  })
  .strict()

export type SearchInput = z.infer<typeof input>

/** A description as Roma may send it, or null when nothing is left. */
export function cleanDescription(note: string | null): string | null {
  if (!note) return null
  const text = stripDigitRuns(note.replace(/\S*@\S*/g, " "))
    .replace(/\s+/g, " ")
    .trim()
  return text === "" ? null : text.slice(0, MAX_DESCRIPTION_CHARS)
}

export const searchTransactionsTool: FinanceTool<SearchInput> = {
  name: "search_transactions",
  description: `Find entries in a period, newest first, at most ${SEARCH_LIMIT}: by text (description, category or account), amount, type or category. Each entry has its date, type, amount, category and account; descriptions only when the person has allowed them.`,
  input,
  async run(ctx, p) {
    const range = periodRangeOrThrow(p, ctx.today)
    const [categories, accounts] = await Promise.all([
      ctx.supabase.from("categories").select("id, name, archived_at"),
      ctx.supabase.from("accounts").select("id, name"),
    ])
    if (categories.error || accounts.error) throw new ToolError("The entries couldn't be searched.")
    const categoryName = new Map(categories.data.map((c) => [c.id, c.name]))
    const accountName = new Map(accounts.data.map((a) => [a.id, a.name]))

    const matched = p.category ? matchCategories(categories.data, p.category) : null
    if (matched && matched.length > MAX_MATCHED_CATEGORIES) {
      throw new ToolError(`"${p.category}" matches ${matched.length} categories: ${matched.map((c) => c.name).join(", ")}. Ask for a narrower name.`)
    }

    // One page per matched category (list_transactions takes one), merged newest first.
    const pages = await Promise.all(
      (matched?.map((c) => c.id) ?? [null]).map((categoryId) =>
        loadTransactionPage(
          ctx.supabase,
          { from: range.start, to: range.end, type: p.type ?? null, categoryId, query: p.query ?? null },
          { currency: ctx.currency, limit: SEARCH_LIMIT },
        ),
      ),
    )
    if (pages.some((page) => !page.ok)) throw new ToolError("The entries couldn't be searched.")
    const found = pages
      .flatMap((page) => (page.ok ? page.items : []))
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    const more = found.length > SEARCH_LIMIT || pages.some((page) => page.ok && page.nextCursor !== null)

    const rows = found.slice(0, SEARCH_LIMIT).map((e) => {
      const description = cleanDescription(e.note)
      return {
        date: e.occurredOn,
        type: e.type,
        amount: formatMoney(e.amountMinor, { currency: e.currency }),
        minor: e.amountMinor,
        currency: e.currency,
        category: e.categoryId ? (categoryName.get(e.categoryId) ?? null) : null,
        account: e.accountId ? (accountName.get(e.accountId) ?? null) : null,
        to_account: e.counterAccountId ? (accountName.get(e.counterAccountId) ?? null) : null,
        description: ctx.descriptionsOk ? description : null,
        hasDescription: description !== null,
      }
    })
    const withheld = !ctx.descriptionsOk && rows.some((r) => r.hasDescription)

    return {
      data: {
        period: periodData(range),
        currency: ctx.currency,
        ...(matched ? { categories_searched: matched.map((c) => c.name) } : {}),
        entries: rows.map(({ minor: _m, hasDescription: _h, ...r }) => r),
        shown: rows.length,
        more_not_shown: more,
        note: [
          rows.length === 0 ? "No entries match." : `Newest first, at most ${SEARCH_LIMIT}.`,
          withheld ? "Descriptions are not shared until the person allows it in Roma; say so if they matter." : "",
        ]
          .join(" ")
          .trim(),
      },
      figures: [
        { label: "Entries shown", kind: "count", value: rows.length },
        ...rows.map((r): Figure => ({ label: `${r.date} · ${r.description ?? r.category ?? r.type}`, kind: "money", minor: r.minor, currency: r.currency })),
      ],
      period: range,
      dates: rows.map((r) => r.date),
      descriptionsWithheld: withheld,
      descriptionsSent: ctx.descriptionsOk && rows.some((r) => r.hasDescription),
    }
  },
}
