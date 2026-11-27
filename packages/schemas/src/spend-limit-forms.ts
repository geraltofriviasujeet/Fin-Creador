import { AMOUNT_ERROR_MESSAGES, parseAmount } from "@fin-creador/domain";
import { z } from "zod";

// The daily spend limit form (decisions log 2026-11-24 "Daily spend limit"), shared by web and
// mobile. Mirrors migration 20261127120000_spend_limits.sql: an amount above zero for a period
// of 1 day, 1 week, 1 month or a custom 2 to 365 days. The currency is the profile currency,
// set by the database, never by the form.

export const SPEND_LIMIT_PERIODS = ["day", "week", "month", "custom"] as const;
export type SpendLimitPeriod = (typeof SPEND_LIMIT_PERIODS)[number];

export const SPEND_LIMIT_PERIOD_OPTIONS: readonly { value: SpendLimitPeriod; label: string }[] = [
  { value: "day", label: "1 day" },
  { value: "week", label: "1 week" },
  { value: "month", label: "1 month" },
  { value: "custom", label: "Custom" },
];

/** Custom periods: 2 to 365 days (1 day is "1 day"). */
export const SPEND_LIMIT_MIN_CUSTOM_DAYS = 2;
export const SPEND_LIMIT_MAX_CUSTOM_DAYS = 365;

/** Days in a fixed period; null for a month (its length varies). */
export function spendLimitPeriodDays(period: Exclude<SpendLimitPeriod, "custom">): number | null {
  return period === "day" ? 1 : period === "week" ? 7 : null;
}

const text = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim());

const fail = (ctx: z.RefinementCtx, path: string, message: string) => {
  ctx.addIssue({ code: "custom", path: [path], message });
  return z.NEVER;
};

/** Raw form strings → the values set_spend_limit takes (integer minor units). */
export function spendLimitFormSchema({ currency }: { currency: string }) {
  return z
    .object({
      period: text.pipe(z.enum(SPEND_LIMIT_PERIODS, { message: "Choose a period" })),
      days: text,
      amount: text,
    })
    .transform((v, ctx) => {
      let periodDays: number | null;
      if (v.period === "custom") {
        if (!/^\d{1,3}$/.test(v.days)) return fail(ctx, "days", "Enter a number of days");
        const days = Number(v.days);
        if (days < SPEND_LIMIT_MIN_CUSTOM_DAYS || days > SPEND_LIMIT_MAX_CUSTOM_DAYS) {
          return fail(ctx, "days", `Enter ${SPEND_LIMIT_MIN_CUSTOM_DAYS} to ${SPEND_LIMIT_MAX_CUSTOM_DAYS} days`);
        }
        periodDays = days;
      } else {
        periodDays = spendLimitPeriodDays(v.period);
      }
      const parsed = parseAmount(v.amount, currency);
      if (!parsed.ok) return fail(ctx, "amount", AMOUNT_ERROR_MESSAGES[parsed.error]);
      return { period: v.period, periodDays, amountMinor: parsed.minor };
    });
}

export type SpendLimitFormOutput = z.output<ReturnType<typeof spendLimitFormSchema>>;
