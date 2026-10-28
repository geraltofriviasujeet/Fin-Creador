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

const text = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim());

/** Icons an expense category may use (categories_icon in the database), with their names. */
export const EXPENSE_ICON_OPTIONS = [
  { value: "food", label: "Food" },
  { value: "groceries", label: "Groceries" },
  { value: "transport", label: "Transport" },
  { value: "home", label: "Home" },
  { value: "bills", label: "Bills" },
  { value: "shopping", label: "Shopping" },
  { value: "health", label: "Health" },
  { value: "fun", label: "Entertainment" },
  { value: "education", label: "Education" },
  { value: "travel", label: "Travel" },
  { value: "care", label: "Personal care" },
  // Sprint 4: the Membership and Subscription defaults (icon CHECK extended in Phase 2).
  { value: "membership", label: "Membership" },
  { value: "subscription", label: "Subscription" },
  { value: "other", label: "Other" },
] as const;
export type ExpenseIcon = (typeof EXPENSE_ICON_OPTIONS)[number]["value"];
const EXPENSE_ICONS = EXPENSE_ICON_OPTIONS.map((o) => o.value) as [ExpenseIcon, ...ExpenseIcon[]];

/** Add (no id) or rename / change the icon of (with id) an expense category. */
export const expenseCategoryFormSchema = z.object({
  id: text.pipe(z.union([z.literal(""), z.uuid({ message: "Category not found" })])).transform((v) => v || null),
  name: z.string().trim().min(1, "Enter a name").max(60, "Keep the name under 60 characters"),
  icon: z.enum(EXPENSE_ICONS, { message: "Choose an icon" }),
});
export type ExpenseCategoryFormOutput = z.output<typeof expenseCategoryFormSchema>;

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
  /** "card": a credit card (8b), allowed only for expenses. */
  accountKind: "bank" | "cash" | "other" | "card" | null;
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
      if (accountKind === "card" && v.type !== "expense") return fail("accountId", "A card can only pay for expenses. Choose a bank, cash or other account");

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
