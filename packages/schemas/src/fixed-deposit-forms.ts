import {
  AMOUNT_ERROR_MESSAGES,
  FD_BANK_MAX,
  FD_COMPOUNDING,
  FD_DEFAULT_COMPOUNDING,
  FD_LABEL_MAX,
  FD_MAX_RATE_BPS,
  FD_MAX_TENURE_MONTHS,
  type FdCompounding,
  addMonthsClamped,
  isIsoDate,
  parseAmount,
} from "@fin-creador/domain";
import { z } from "zod";
import { parsePercentToBps } from "./goal-forms";
import { INDIAN_BANKS } from "./money-forms";

// Fixed deposits (Sprint 7), shared by web and mobile. Mirrors the fixed_deposits migration:
// the database checks every range and date rule again. INR only; not linked to accounts.

/**
 * Banks offered in the type-ahead (any name can be typed). The account list without payments
 * banks (they can't take fixed deposits), plus small finance banks that do. Reviewed with
 * the other lists every quarter (docs/quarterly-list-refresh.md).
 */
export const FD_BANKS: readonly string[] = [
  ...INDIAN_BANKS.filter((b) => !b.endsWith("Payments Bank")),
  "Jana Small Finance Bank",
  "Suryoday Small Finance Bank",
  "Utkarsh Small Finance Bank",
  "ESAF Small Finance Bank",
  "Unity Small Finance Bank",
  "Shivalik Small Finance Bank",
];
export const FD_BANKS_REVIEWED_ON = "2026-10-27";

export const FD_COMPOUNDING_OPTIONS: readonly { value: FdCompounding; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half-yearly" },
  { value: "yearly", label: "Yearly" },
];

const text = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim());
const uuidOrEmpty = (message: string) => text.pipe(z.union([z.literal(""), z.uuid({ message })]));

/**
 * Add a fixed deposit (no `depositId`: request key required) or edit one in place
 * (`depositId`). `today` is the person's local date: the start can't be in the future, the
 * maturity must be after the start and at most 10 years later.
 */
export function fixedDepositFormSchema({ today }: { today: string }) {
  return z
    .object({
      depositId: uuidOrEmpty("Fixed deposit not found"),
      bank: text,
      label: text,
      principal: text,
      rate: text,
      compounding: text,
      startDate: text,
      maturityDate: text,
      idempotencyKey: uuidOrEmpty("Please reopen the form and try again"),
    })
    .transform((v, ctx) => {
      const fail = (path: string, message: string) => {
        ctx.addIssue({ code: "custom", path: [path], message });
        return z.NEVER;
      };
      if (!v.depositId && !v.idempotencyKey) return fail("idempotencyKey", "Please reopen the form and try again");
      const bank = v.bank.replace(/\s+/g, " ");
      if (!bank) return fail("bank", "Enter the bank");
      if (bank.length > FD_BANK_MAX) return fail("bank", `Keep it under ${FD_BANK_MAX} characters`);
      const label = v.label.replace(/\s+/g, " ");
      if (label.length > FD_LABEL_MAX) return fail("label", `Keep it under ${FD_LABEL_MAX} characters`);
      const principal = parseAmount(v.principal, "INR");
      if (!principal.ok) return fail("principal", AMOUNT_ERROR_MESSAGES[principal.error]);
      const rateBps = parsePercentToBps(v.rate);
      if (rateBps === null || rateBps > FD_MAX_RATE_BPS) return fail("rate", "Enter a yearly rate from 0 to 25%, e.g. 7.25");
      const compounding = (v.compounding || FD_DEFAULT_COMPOUNDING) as FdCompounding;
      if (!FD_COMPOUNDING.includes(compounding)) return fail("compounding", "Choose how often interest is added");
      if (!isIsoDate(v.startDate)) return fail("startDate", "Enter a valid date");
      if (v.startDate > today) return fail("startDate", "The start date can't be in the future");
      if (!isIsoDate(v.maturityDate)) return fail("maturityDate", "Enter a valid date");
      if (v.maturityDate <= v.startDate) return fail("maturityDate", "Maturity must be after the start date");
      if (v.maturityDate > addMonthsClamped(v.startDate, FD_MAX_TENURE_MONTHS)) return fail("maturityDate", "Maturity can be at most 10 years after the start");
      return {
        depositId: v.depositId || null,
        bank,
        /** Optional; blank is no label. */
        label: label || null,
        principalMinor: principal.minor,
        rateBps,
        compounding,
        startDate: v.startDate,
        maturityDate: v.maturityDate,
        idempotencyKey: v.depositId ? null : v.idempotencyKey,
      };
    });
}

export type FixedDepositFormOutput = z.output<ReturnType<typeof fixedDepositFormSchema>>;
