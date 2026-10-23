import { AMOUNT_ERROR_MESSAGES, isIsoDate, parseAmount } from "@fin-creador/domain";
import { z } from "zod";
import { currencyCodeSchema } from "./profile";

// Form schemas for accounts, income entries and income sources. Inputs are the raw
// strings a form sends; outputs are the exact values the database stores (integer minor
// units, ISO dates, nulls for blanks). `today` is the user's local date, so "not in the
// future" uses their time zone, like the database does.

/** Major banks in India for the "Bank name" list; "Other bank" lets the user type one. */
export const INDIAN_BANKS = [
  "State Bank of India",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Kotak Mahindra Bank",
  "Punjab National Bank",
  "Bank of Baroda",
  "Canara Bank",
  "Union Bank of India",
  "Bank of India",
  "Indian Bank",
  "Central Bank of India",
  "Indian Overseas Bank",
  "UCO Bank",
  "Bank of Maharashtra",
  "Punjab & Sind Bank",
  "IndusInd Bank",
  "Yes Bank",
  "IDFC FIRST Bank",
  "IDBI Bank",
  "Federal Bank",
  "South Indian Bank",
  "Karur Vysya Bank",
  "City Union Bank",
  "RBL Bank",
  "Bandhan Bank",
  "AU Small Finance Bank",
  "Equitas Small Finance Bank",
  "Ujjivan Small Finance Bank",
  "Standard Chartered",
  "HSBC",
  "DBS Bank",
  "Citibank",
  "Paytm Payments Bank",
  "Airtel Payments Bank",
  "India Post Payments Bank",
] as const;

/** Select value for "Other bank" (the name comes from a text field). */
export const OTHER_BANK = "__other__";

export const ACCOUNT_KINDS = ["bank", "cash", "other"] as const;
export const BANK_TYPES = [
  { value: "savings", label: "Savings account" },
  { value: "current", label: "Current account" },
] as const;
export const SOURCE_TYPES = [
  { value: "salary", label: "Salary" },
  { value: "rent", label: "Rent" },
  { value: "freelance", label: "Freelance" },
  { value: "business", label: "Business" },
  { value: "interest", label: "Interest & dividends" },
  { value: "other", label: "Other" },
] as const;

const optionalText = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim());

function notFuture(today: string, message: string) {
  return z
    .string()
    .trim()
    .refine(isIsoDate, "Enter a valid date")
    .refine((d) => d <= today, message);
}

export function accountFormSchema({ today }: { today: string }) {
  return z
    .object({
      kind: z.enum(ACCOUNT_KINDS, { message: "Choose an account type" }),
      bankType: optionalText,
      bankName: optionalText,
      otherBankName: optionalText,
      name: optionalText,
      institution: optionalText,
      last4: optionalText,
      currency: currencyCodeSchema,
      openingBalance: optionalText,
      openingBalanceDate: notFuture(today, "The as-of date can't be in the future"),
    })
    .transform((v, ctx) => {
      const fail = (path: string, message: string) => {
        ctx.addIssue({ code: "custom", path: [path], message });
        return z.NEVER;
      };

      let name = v.name;
      let institution: string | null = v.institution || null;
      let bankType: "savings" | "current" | null = null;
      if (v.kind === "bank") {
        if (!v.bankName) return fail("bankName", "Select your bank");
        const bank = v.bankName === OTHER_BANK ? v.otherBankName : v.bankName;
        if (!bank) return fail("otherBankName", "Enter the bank's name");
        if (bank.length > 80) return fail("otherBankName", "Keep the name under 80 characters");
        name = bank;
        institution = bank;
        if (v.bankType !== "savings" && v.bankType !== "current") return fail("bankType", "Choose savings or current");
        bankType = v.bankType;
      } else {
        if (!name) return fail("name", "Enter a name");
        if (name.length > 80) return fail("name", "Keep the name under 80 characters");
        if (institution && institution.length > 80) return fail("institution", "Keep it under 80 characters");
        if (v.kind === "cash") institution = null;
      }

      if (v.last4 && !/^\d{4}$/.test(v.last4)) return fail("last4", "Enter exactly 4 digits");

      const amount = parseAmount(v.openingBalance || "0", v.currency, { allowNegative: v.kind === "bank", allowZero: true });
      if (!amount.ok) {
        return fail(
          "openingBalance",
          amount.error === "negative"
            ? "Only bank accounts can start below zero"
            : AMOUNT_ERROR_MESSAGES[amount.error],
        );
      }

      return {
        kind: v.kind,
        bankType,
        name,
        institution,
        last4: v.last4 || null,
        currency: v.currency,
        openingBalanceMinor: amount.minor,
        openingBalanceDate: v.openingBalanceDate,
      };
    });
}

export type AccountFormOutput = z.output<ReturnType<typeof accountFormSchema>>;

export function incomeFormSchema({ today, currency }: { today: string; currency: string }) {
  return z
    .object({
      amount: optionalText,
      sourceId: z.uuid({ message: "Choose a source" }),
      accountId: z.uuid({ message: "Choose where it was received" }),
      occurredOn: notFuture(today, "The date can't be in the future"),
      note: optionalText.refine((n) => n.length <= 280, "Keep the note under 280 characters"),
      idempotencyKey: z.uuid({ message: "Please reopen the form and try again" }),
    })
    .transform((v, ctx) => {
      const amount = parseAmount(v.amount, currency);
      if (!amount.ok) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: AMOUNT_ERROR_MESSAGES[amount.error] });
        return z.NEVER;
      }
      return {
        amountMinor: amount.minor,
        sourceId: v.sourceId,
        accountId: v.accountId,
        occurredOn: v.occurredOn,
        note: v.note || null,
        idempotencyKey: v.idempotencyKey,
      };
    });
}

export type IncomeFormOutput = z.output<ReturnType<typeof incomeFormSchema>>;

export const sourceFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60, "Keep the name under 60 characters"),
  sourceType: z.enum(["salary", "rent", "freelance", "business", "interest", "other"], { message: "Choose a type" }),
  defaultAccountId: optionalText.pipe(z.union([z.literal(""), z.uuid({ message: "Choose an account" })])).transform((v) => v || null),
});

export type SourceFormOutput = z.output<typeof sourceFormSchema>;

export const voidFormSchema = z.object({
  transactionId: z.uuid({ message: "Entry not found" }),
  idempotencyKey: z.uuid({ message: "Please reopen the form and try again" }),
  reason: optionalText.refine((r) => r.length <= 200, "Keep the reason under 200 characters").transform((r) => r || null),
});
