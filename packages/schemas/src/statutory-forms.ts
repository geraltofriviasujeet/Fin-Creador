import { AMOUNT_ERROR_MESSAGES, STATUTORY_TYPES, type StatutoryType, formatMoney, isIsoDate, parseAmount } from "@fin-creador/domain";
import { z } from "zod";
import { hasDigitRun } from "./digits";
import { INDIAN_CITIES, INDIAN_STATES } from "./goal-data";
import type { PayingAccount } from "./loan-forms";

// Statutory and legal dues (Sprint 8d), shared by web and mobile. Mirrors the migration
// 20261028230000: the database checks every rule again. Never a challan, vehicle or RTO number.

export const STATUTORY_DESCRIPTION_MAX = 120;

export const STATUTORY_TYPE_OPTIONS: readonly { value: StatutoryType; label: string }[] = [
  { value: "income_tax", label: "Income tax payable" },
  { value: "fine", label: "Traffic e-challan or other fine" },
  { value: "other_statutory", label: "Other statutory due" },
];

export const STATUTORY_TYPE_LABEL: Record<StatutoryType, string> = { income_tax: "Income tax", fine: "Fine", other_statutory: "Statutory due" };

export const VEHICLE_KINDS = ["two_wheeler", "four_wheeler", "other"] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];

export const STATUTORY_VEHICLE_OPTIONS: readonly { value: VehicleKind; label: string }[] = [
  { value: "two_wheeler", label: "Two-wheeler" },
  { value: "four_wheeler", label: "Four-wheeler" },
  { value: "other", label: "Other vehicle" },
];

/** A description may hold a short number ("Q4"), never a run of 4 or more digits. */
export const STATUTORY_DIGITS = "Leave out challan, vehicle and account numbers: no 4 or more digits in a row";

/** The due's name on lists: "Income tax · Advance tax", "Fine · Bengaluru", "Property tax". */
export function statutoryDueName(d: { dueType: StatutoryType; description: string | null; issuedCity?: string | null }): string {
  if (d.dueType === "other_statutory" && d.description) return d.description;
  const detail = d.description ?? (d.dueType === "fine" ? (d.issuedCity ?? null) : null);
  return detail ? `${STATUTORY_TYPE_LABEL[d.dueType]} · ${detail}` : STATUTORY_TYPE_LABEL[d.dueType];
}

const text = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim());
const uuidOrEmpty = (message: string) => text.pipe(z.union([z.literal(""), z.uuid({ message })]));
const REOPEN = "Please reopen the form and try again";

type Ctx = z.RefinementCtx;
const fail = (ctx: Ctx, path: string, message: string) => {
  ctx.addIssue({ code: "custom", path: [path], message });
  return z.NEVER;
};

const fields = {
  amount: text,
  dueDate: text,
  description: text,
  vehicleKind: text,
  issuedState: text,
  issuedCity: text,
  payFromAccountId: text,
};

function details(
  ctx: Ctx,
  dueType: StatutoryType,
  v: { amount: string; dueDate: string; description: string; vehicleKind: string; issuedState: string; issuedCity: string; payFromAccountId: string },
  { currency, accounts, paidMinor }: { currency: string; accounts: readonly PayingAccount[]; paidMinor: number },
) {
  const amount = parseAmount(v.amount, currency);
  if (!amount.ok) return fail(ctx, "amount", AMOUNT_ERROR_MESSAGES[amount.error]);
  if (amount.minor < paidMinor) return fail(ctx, "amount", `Enter at least what is already paid (${formatMoney(paidMinor, { currency })})`);
  if (!v.dueDate) return fail(ctx, "dueDate", "Enter the due date");
  if (!isIsoDate(v.dueDate)) return fail(ctx, "dueDate", "Enter a valid date");
  const description = v.description.replace(/\s+/g, " ") || null;
  if (dueType === "other_statutory" && !description) return fail(ctx, "description", "Say what it is, e.g. Property tax");
  if (description && description.length > STATUTORY_DESCRIPTION_MAX) return fail(ctx, "description", `Keep it under ${STATUTORY_DESCRIPTION_MAX} characters`);
  if (description && hasDigitRun(description, 4)) return fail(ctx, "description", STATUTORY_DIGITS);
  let vehicleKind: VehicleKind | null = null;
  let issuedState: string | null = null;
  let issuedCity: string | null = null;
  if (dueType === "fine") {
    if (v.vehicleKind) {
      if (!VEHICLE_KINDS.includes(v.vehicleKind as VehicleKind)) return fail(ctx, "vehicleKind", "Choose two-wheeler, four-wheeler or other");
      vehicleKind = v.vehicleKind as VehicleKind;
    }
    if (v.issuedState) {
      if (!INDIAN_STATES.includes(v.issuedState)) return fail(ctx, "issuedState", "Choose a state or union territory from the list");
      issuedState = v.issuedState;
    }
    if (v.issuedCity) {
      if (!INDIAN_CITIES.includes(v.issuedCity)) return fail(ctx, "issuedCity", "Choose a city from the list");
      issuedCity = v.issuedCity;
    }
  }
  let payFromAccountId: string | null = null;
  if (v.payFromAccountId) {
    const account = accounts.find((a) => a.id === v.payFromAccountId);
    if (!account) return fail(ctx, "payFromAccountId", "Choose a bank, cash or other account");
    if (account.currency !== currency) return fail(ctx, "payFromAccountId", `Choose an account in ${currency}`);
    payFromAccountId = account.id;
  }
  return { amountMinor: amount.minor, dueDate: v.dueDate, description, vehicleKind, issuedState, issuedCity, payFromAccountId };
}

/**
 * Add a due: its type, amount, due date (required; a past date is fine for something already
 * overdue), optional words and, for a fine, the vehicle kind and where it was issued; the
 * account it will be paid from is optional. Nothing is posted until it is paid.
 */
export function statutoryDueFormSchema({ currency, accounts }: { currency: string; accounts: readonly PayingAccount[] }) {
  return z
    .object({ dueType: text, ...fields, idempotencyKey: uuidOrEmpty(REOPEN) })
    .transform((v, ctx) => {
      if (!v.idempotencyKey) return fail(ctx, "idempotencyKey", REOPEN);
      const dueType = v.dueType as StatutoryType;
      if (!STATUTORY_TYPES.includes(dueType)) return fail(ctx, "dueType", "Choose what it is");
      const d = details(ctx, dueType, v, { currency, accounts, paidMinor: 0 });
      if (d === z.NEVER) return z.NEVER;
      return { dueType, ...d, idempotencyKey: v.idempotencyKey };
    });
}

export type StatutoryDueFormOutput = z.output<ReturnType<typeof statutoryDueFormSchema>>;

/** Edit a due: the amount never below what is paid; the type stays. */
export function statutoryDueEditFormSchema({
  currency,
  accounts,
  dueType,
  paidMinor,
}: {
  currency: string;
  accounts: readonly PayingAccount[];
  dueType: StatutoryType;
  paidMinor: number;
}) {
  return z
    .object({ statutoryDueId: text.pipe(z.uuid({ message: "Due not found" })), ...fields })
    .transform((v, ctx) => {
      const d = details(ctx, dueType, v, { currency, accounts, paidMinor });
      if (d === z.NEVER) return z.NEVER;
      return { statutoryDueId: v.statutoryDueId, ...d };
    });
}

export type StatutoryDueEditFormOutput = z.output<ReturnType<typeof statutoryDueEditFormSchema>>;
