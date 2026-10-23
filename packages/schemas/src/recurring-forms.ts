import { AMOUNT_ERROR_MESSAGES, isIsoDate, parseAmount } from "@fin-creador/domain";
import { z } from "zod";
import { ENTRY_TYPES, PAYMENT_MODES, type PaymentModeValue } from "./transaction-forms";

// Form schemas for recurring rules, confirming an occurrence and skipping one, shared by
// web and mobile. Mirrors migration 20261024120000; the database re-checks everything
// (ownership, archived accounts and categories, occurrence dates, the once-only rule).

export const FREQUENCY_VALUES = ["weekly", "monthly", "quarterly", "yearly"] as const;

type AccountKind = "bank" | "cash" | "other" | null;

const text = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim());
const uuidOrEmpty = (message: string) => text.pipe(z.union([z.literal(""), z.uuid({ message })]));
const isoDate = (message: string) => z.string().trim().refine(isIsoDate, message);

type Ctx = z.RefinementCtx;
const fail = (ctx: Ctx, path: string, message: string) => {
  ctx.addIssue({ code: "custom", path: [path], message });
  return z.NEVER;
};

/**
 * The account / category / payment-mode rules shared by rules and confirmations. When
 * confirming, the category comes from the rule (`categoryFromRule`), so it isn't asked for.
 */
function sides(
  ctx: Ctx,
  v: { type: (typeof ENTRY_TYPES)[number]; categoryId: string; counterAccountId: string; accountId: string; paymentMode: string },
  accountKind: AccountKind,
  { categoryFromRule = false }: { categoryFromRule?: boolean } = {},
) {
  let categoryId: string | null = null;
  let counterAccountId: string | null = null;
  if (v.type === "transfer") {
    if (!z.uuid().safeParse(v.counterAccountId).success) return fail(ctx, "counterAccountId", "Choose an account");
    if (v.counterAccountId === v.accountId) return fail(ctx, "counterAccountId", "Choose a different account");
    counterAccountId = v.counterAccountId;
  } else if (!categoryFromRule) {
    if (!z.uuid().safeParse(v.categoryId).success) {
      return fail(ctx, "categoryId", v.type === "income" ? "Choose a source" : "Choose a category");
    }
    categoryId = v.categoryId;
  }
  let paymentMode: PaymentModeValue | null = null;
  if (v.paymentMode && v.type === "expense" && accountKind === "bank") {
    const mode = PAYMENT_MODES.find((m) => m.value === v.paymentMode);
    if (!mode) return fail(ctx, "paymentMode", "Choose a payment mode");
    paymentMode = mode.value;
  }
  return { categoryId, counterAccountId, paymentMode };
}

/**
 * Add a rule (no `ruleId`; type, frequency and start date set once) or edit one (with
 * `ruleId`; type, frequency and start date are ignored: they never change).
 */
export function recurringRuleFormSchema({ currency, accountKind }: { currency: string; accountKind: AccountKind }) {
  return z
    .object({
      ruleId: uuidOrEmpty("Recurring item not found"),
      type: z.enum(ENTRY_TYPES, { message: "Choose a type" }),
      amount: text,
      categoryId: text,
      accountId: z.uuid({ message: "Choose an account" }),
      counterAccountId: text,
      paymentMode: text,
      frequency: z.enum(FREQUENCY_VALUES, { message: "Choose how often" }),
      startDate: isoDate("Choose a start date").refine((d) => d >= "1970-01-01", "Choose a later date"),
      endDate: text.pipe(z.union([z.literal(""), z.string().refine(isIsoDate, "Choose a valid end date")])),
      note: text.refine((n) => n.length <= 280, "Keep the note under 280 characters"),
      idempotencyKey: uuidOrEmpty("Please reopen the form and try again"),
    })
    .transform((v, ctx) => {
      const amount = parseAmount(v.amount, currency);
      if (!amount.ok) return fail(ctx, "amount", AMOUNT_ERROR_MESSAGES[amount.error]);
      if (v.endDate && v.endDate < v.startDate) return fail(ctx, "endDate", "The end date can't be before the start");
      if (!v.ruleId && !v.idempotencyKey) return fail(ctx, "idempotencyKey", "Please reopen the form and try again");
      const s = sides(ctx, v, accountKind);
      return {
        ruleId: v.ruleId || null,
        type: v.type,
        amountMinor: amount.minor,
        accountId: v.accountId,
        ...s,
        frequency: v.frequency,
        startDate: v.startDate,
        endDate: v.endDate || null,
        note: v.note || null,
        idempotencyKey: v.idempotencyKey || null,
      };
    });
}

export type RecurringRuleFormOutput = z.output<ReturnType<typeof recurringRuleFormSchema>>;

/** Confirming one occurrence: the normal entry fields; type and category come from the rule. */
export function confirmOccurrenceSchema({
  today,
  currency,
  accountKind,
  type,
}: {
  today: string;
  currency: string;
  accountKind: AccountKind;
  type: (typeof ENTRY_TYPES)[number];
}) {
  return z
    .object({
      ruleId: z.uuid({ message: "Recurring item not found" }),
      occurrenceDate: isoDate("Recurring item not found"),
      amount: text,
      occurredOn: isoDate("Choose a date")
        .refine((d) => d <= today, "The date can't be in the future")
        .refine((d) => d >= "1970-01-01", "Choose a later date"),
      accountId: z.uuid({ message: "Choose an account" }),
      counterAccountId: text,
      paymentMode: text,
      note: text.refine((n) => n.length <= 280, "Keep the note under 280 characters"),
      idempotencyKey: z.uuid({ message: "Please reopen the form and try again" }),
    })
    .transform((v, ctx) => {
      const amount = parseAmount(v.amount, currency);
      if (!amount.ok) return fail(ctx, "amount", AMOUNT_ERROR_MESSAGES[amount.error]);
      const s = sides(ctx, { ...v, type, categoryId: "" }, accountKind, { categoryFromRule: true });
      return {
        ruleId: v.ruleId,
        occurrenceDate: v.occurrenceDate,
        amountMinor: amount.minor,
        occurredOn: v.occurredOn,
        accountId: v.accountId,
        counterAccountId: s.counterAccountId,
        paymentMode: s.paymentMode,
        note: v.note || null,
        idempotencyKey: v.idempotencyKey,
      };
    });
}

export const skipOccurrenceSchema = z.object({
  ruleId: z.uuid({ message: "Recurring item not found" }),
  occurrenceDate: isoDate("Recurring item not found"),
  reason: text.refine((r) => r.length <= 200, "Keep the reason under 200 characters").transform((r) => r || null),
  idempotencyKey: z.uuid({ message: "Please reopen the form and try again" }),
});
