import { AMOUNT_ERROR_MESSAGES, isIsoDate, parseAmount } from "@fin-creador/domain";
import { z } from "zod";

// Form schema for income, expense and transfer entries (add and edit), shared by web and
// mobile. Mirrors the database rules in migration 20261023120000; the database re-checks
// everything (ownership, archived accounts, currencies, dates).

export const ENTRY_TYPES = ["expense", "income", "transfer"] as const;
export type EntryTypeValue = (typeof ENTRY_TYPES)[number];

/** Optional label for how a bank payment was made; the account is what moves the money. */
export const PAYMENT_MODES = [
  { value: "upi", label: "UPI" },
  { value: "debit_card", label: "Debit card" },
  { value: "net_banking", label: "Net banking" },
  { value: "cheque", label: "Cheque" },
] as const;
export type PaymentModeValue = (typeof PAYMENT_MODES)[number]["value"];

/** Icons an expense category may use (categories_icon in the database). */
export const EXPENSE_ICONS = [
  "food", "groceries", "transport", "home", "bills", "shopping", "health", "fun",
  "education", "travel", "care", "other",
] as const;
export type ExpenseIcon = (typeof EXPENSE_ICONS)[number];

const text = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim());

/**
 * `accountKind` is the kind of the chosen "from" (or "received into") account, read by
 * the caller; a payment mode is kept only for expenses from a bank account.
 */
export function transactionFormSchema({
  today,
  currency,
  accountKind,
}: {
  today: string;
  currency: string;
  accountKind: "bank" | "cash" | "other" | null;
}) {
  return z
    .object({
      transactionId: text.pipe(z.union([z.literal(""), z.uuid({ message: "Entry not found" })])),
      type: z.enum(ENTRY_TYPES, { message: "Choose a type" }),
      amount: text,
      categoryId: text,
      accountId: z.uuid({ message: "Choose an account" }),
      counterAccountId: text,
      paymentMode: text,
      occurredOn: z
        .string()
        .trim()
        .refine(isIsoDate, "Choose a date")
        .refine((d) => d <= today, "The date can't be in the future")
        .refine((d) => d >= "1970-01-01", "Choose a later date"),
      note: text.refine((n) => n.length <= 280, "Keep the note under 280 characters"),
      idempotencyKey: z.uuid({ message: "Please reopen the form and try again" }),
    })
    .transform((v, ctx) => {
      const fail = (path: string, message: string) => {
        ctx.addIssue({ code: "custom", path: [path], message });
        return z.NEVER;
      };
      const amount = parseAmount(v.amount, currency);
      if (!amount.ok) return fail("amount", AMOUNT_ERROR_MESSAGES[amount.error]);

      let categoryId: string | null = null;
      let counterAccountId: string | null = null;
      if (v.type === "transfer") {
        if (!z.uuid().safeParse(v.counterAccountId).success) return fail("counterAccountId", "Choose an account");
        if (v.counterAccountId === v.accountId) return fail("counterAccountId", "Choose a different account");
        counterAccountId = v.counterAccountId;
      } else {
        if (!z.uuid().safeParse(v.categoryId).success) {
          return fail("categoryId", v.type === "income" ? "Choose a source" : "Choose a category");
        }
        categoryId = v.categoryId;
      }

      let paymentMode: PaymentModeValue | null = null;
      if (v.paymentMode && v.type === "expense" && accountKind === "bank") {
        const mode = PAYMENT_MODES.find((m) => m.value === v.paymentMode);
        if (!mode) return fail("paymentMode", "Choose a payment mode");
        paymentMode = mode.value;
      }

      return {
        transactionId: v.transactionId || null,
        type: v.type,
        amountMinor: amount.minor,
        categoryId,
        accountId: v.accountId,
        counterAccountId,
        paymentMode,
        occurredOn: v.occurredOn,
        note: v.note || null,
        idempotencyKey: v.idempotencyKey,
      };
    });
}

export type TransactionFormOutput = z.output<ReturnType<typeof transactionFormSchema>>;
