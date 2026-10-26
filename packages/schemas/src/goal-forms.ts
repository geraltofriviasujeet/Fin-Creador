import {
  AMOUNT_ERROR_MESSAGES,
  GOAL_TYPES,
  MAX_AMOUNT_MINOR,
  MAX_RATE_BPS,
  MAX_TENURE_MONTHS,
  TRIP_COST_LINES,
  VEHICLE_KINDS,
  goalFigures,
  isIsoDate,
  parseAmount,
  type GoalDetails,
  type GoalType,
} from "@fin-creador/domain";
import { z } from "zod";
import { INDIAN_STATES } from "./goal-data";
import { COUNTRY_NAMES } from "./region-data";

// Goals (planned expenses) and monthly budgets, shared by web and mobile. Mirrors the
// Sprint 6 migration: the database checks types, ranges, ownership and that `details` is a
// JSON object under MAX_GOAL_DETAILS_BYTES; the per-type shape of `details` is checked here,
// on every write and again on every read (stored JSON is treated as untrusted).

export const GOAL_TYPE_OPTIONS: readonly { value: GoalType; label: string }[] = [
  { value: "trip", label: "Trip" },
  { value: "vehicle", label: "Wheeler" },
  { value: "house", label: "House" },
  { value: "furniture", label: "Furniture" },
  { value: "electronics", label: "Electronics" },
  { value: "mobile", label: "Mobile" },
  { value: "other", label: "Other" },
];

export const TRIP_COST_LABELS: Record<(typeof TRIP_COST_LINES)[number], string> = {
  transport: "Transport",
  stay: "Stay",
  food: "Food",
  activities: "Activities",
  visaInsurance: "Visa and insurance",
  shopping: "Shopping",
  buffer: "Buffer",
};

export const TRAVEL_MODES = [
  { value: "flight", label: "Flight" },
  { value: "train", label: "Train" },
  { value: "bus", label: "Bus" },
  { value: "car", label: "Car" },
  { value: "other", label: "Other" },
] as const;

export const STAY_TYPES = [
  { value: "hotel", label: "Hotel" },
  { value: "homestay", label: "Homestay" },
  { value: "hostel", label: "Hostel" },
  { value: "friends_family", label: "Friends or family" },
  { value: "other", label: "Other" },
] as const;

export const LOAN_PAYMENTS = [
  { value: "cash", label: "Cash" },
  { value: "loan", label: "Loan" },
  { value: "loan_down_payment", label: "Loan with down payment" },
] as const;

export const ITEM_PAYMENTS = [
  { value: "cash", label: "Cash" },
  { value: "emi", label: "EMI" },
  { value: "no_cost_emi", label: "No-cost EMI" },
] as const;

export const VEHICLE_KIND_OPTIONS = [
  { value: "bike", label: "Bike" },
  { value: "car", label: "Car" },
  { value: "hmv", label: "HMV" },
] as const;

/** Countries for an international trip (every country except India), in name order. */
export const FOREIGN_COUNTRIES: readonly string[] = Object.entries(COUNTRY_NAMES)
  .filter(([code]) => code !== "IN")
  .map(([, name]) => name);

/** Label for the target derived from the answers (every type except "other"). */
export const GOAL_UPFRONT_LABEL = "Amount to save upfront";
/** Shown next to every EMI figure. */
export const EMI_ROUNDING_NOTE = "Your bank's EMI can differ by a few paise because of its own rounding.";
/** The same note, short enough for a goal card. */
export const EMI_ROUNDING_NOTE_SHORT = "Bank EMI can differ by a few paise.";

/** Compact JSON cap; the database allows twice this for its own text form (spaces). */
export const MAX_GOAL_DETAILS_BYTES = 4096;
export const GOAL_NAME_MAX = 80;
export const GOAL_TEXT_MAX = 80;
export const GOAL_DESCRIPTION_MAX = 280;

// ---------------------------------------------------------------------------
// Stored details (numbers already in minor units / basis points / months)
// ---------------------------------------------------------------------------

const minor = z.number().int().min(0).max(MAX_AMOUNT_MINOR);
const positiveMinor = minor.min(1);
const shortText = z.string().trim().min(1).max(GOAL_TEXT_MAX);
const rateBps = z.number().int().min(0).max(MAX_RATE_BPS);
const tenure = z.number().int().min(1).max(MAX_TENURE_MONTHS);

const tripDetails = z.strictObject({
  v: z.literal(1),
  scope: z.enum(["domestic", "international"]),
  place: shortText,
  people: z.number().int().min(1).max(100),
  days: z.number().int().min(1).max(365),
  travelMode: z.enum(TRAVEL_MODES.map((m) => m.value)),
  stay: z.enum(STAY_TYPES.map((s) => s.value)),
  costs: z.strictObject(Object.fromEntries(TRIP_COST_LINES.map((line) => [line, minor])) as Record<(typeof TRIP_COST_LINES)[number], typeof minor>),
});

const loanFields = {
  payment: z.enum(LOAN_PAYMENTS.map((p) => p.value)),
  priceMinor: positiveMinor,
  downPaymentMinor: minor.nullable(),
  loanRateBps: rateBps.nullable(),
  loanMonths: tenure.nullable(),
};

type LoanShape = { payment: string; priceMinor: number; downPaymentMinor: number | null; loanRateBps: number | null; loanMonths: number | null };
function checkLoan(d: LoanShape, ctx: z.RefinementCtx) {
  const loan = d.payment !== "cash";
  const down = d.payment === "loan_down_payment";
  if (down !== (d.downPaymentMinor !== null)) ctx.addIssue({ code: "custom", path: ["downPaymentMinor"], message: "Down payment mismatch" });
  if (down && d.downPaymentMinor !== null && d.downPaymentMinor >= d.priceMinor) {
    ctx.addIssue({ code: "custom", path: ["downPaymentMinor"], message: "Down payment must be less than the price" });
  }
  if (loan !== (d.loanRateBps !== null) || loan !== (d.loanMonths !== null)) {
    ctx.addIssue({ code: "custom", path: ["loanMonths"], message: "Loan details mismatch" });
  }
}

const vehicleDetails = z
  .strictObject({
    v: z.literal(1),
    vehicle: z.enum(VEHICLE_KINDS),
    condition: z.enum(["new", "used"]),
    make: shortText.nullable(),
    model: shortText,
    extrasMinor: minor,
    ...loanFields,
  })
  .superRefine(checkLoan);

const houseDetails = z
  .strictObject({ v: z.literal(1), purpose: z.enum(["buy", "renovate"]), city: shortText, ...loanFields })
  .superRefine(checkLoan);

const itemDetails = z
  .strictObject({
    v: z.literal(1),
    item: shortText,
    payment: z.enum(ITEM_PAYMENTS.map((p) => p.value)),
    priceMinor: positiveMinor,
    emiRateBps: rateBps.nullable(),
    emiMonths: tenure.nullable(),
  })
  .superRefine((d, ctx) => {
    if ((d.payment === "emi") !== (d.emiRateBps !== null)) ctx.addIssue({ code: "custom", path: ["emiRateBps"], message: "EMI rate mismatch" });
    if ((d.payment !== "cash") !== (d.emiMonths !== null)) ctx.addIssue({ code: "custom", path: ["emiMonths"], message: "EMI months mismatch" });
  });

const otherDetails = z.strictObject({ v: z.literal(1), description: z.string().trim().min(1).max(GOAL_DESCRIPTION_MAX) });

const DETAILS_BY_TYPE: Record<GoalType, z.ZodType> = {
  trip: tripDetails,
  vehicle: vehicleDetails,
  house: houseDetails,
  furniture: itemDetails,
  electronics: itemDetails,
  mobile: itemDetails,
  other: otherDetails,
};

/** UTF-8 length of the compact JSON (no TextEncoder on every runtime we target). */
function jsonBytes(value: unknown): number {
  let bytes = 0;
  for (const ch of JSON.stringify(value)) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Validates a goal's stored type and details (from a form or read back from the database). */
export function parseGoalDetails(type: string, details: unknown): GoalDetails | null {
  if (!(GOAL_TYPES as readonly string[]).includes(type)) return null;
  const parsed = DETAILS_BY_TYPE[type as GoalType].safeParse(details);
  if (!parsed.success || jsonBytes(parsed.data) > MAX_GOAL_DETAILS_BYTES) return null;
  return { type, details: parsed.data } as GoalDetails;
}

// ---------------------------------------------------------------------------
// Form input (raw strings) → stored values
// ---------------------------------------------------------------------------

/** "8.5" or "8.50 %" → 850 basis points; up to two decimals, 0–100%. */
export function parsePercentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(input.replace(/[\s%]/g, ""));
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= MAX_RATE_BPS ? bps : null;
}

const text = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim());
const uuidOrEmpty = (message: string) => text.pipe(z.union([z.literal(""), z.uuid({ message })]));

type Ctx = z.RefinementCtx;
const fail = (ctx: Ctx, path: string, message: string) => {
  ctx.addIssue({ code: "custom", path: [path], message });
  return z.NEVER;
};

type Fields = Record<string, string>;

function amountField(ctx: Ctx, v: Fields, field: string, currency: string, { allowZero = false } = {}): number | typeof z.NEVER {
  const parsed = parseAmount(v[field] ?? "", currency, { allowZero });
  if (!parsed.ok) return fail(ctx, field, AMOUNT_ERROR_MESSAGES[parsed.error]);
  return parsed.minor;
}

function requiredText(ctx: Ctx, v: Fields, field: string, label: string, max = GOAL_TEXT_MAX): string | typeof z.NEVER {
  const value = v[field] ?? "";
  if (!value) return fail(ctx, field, `Enter ${label}`);
  if (value.length > max) return fail(ctx, field, `Keep it under ${max} characters`);
  return value;
}

function wholeNumber(ctx: Ctx, v: Fields, field: string, label: string, max: number): number | typeof z.NEVER {
  const value = v[field] ?? "";
  if (!/^\d{1,4}$/.test(value) || Number(value) < 1 || Number(value) > max) return fail(ctx, field, `Enter ${label} from 1 to ${max}`);
  return Number(value);
}

function choice<T extends string>(ctx: Ctx, v: Fields, field: string, options: readonly { value: T }[], message: string): T | typeof z.NEVER {
  const found = options.find((o) => o.value === v[field]);
  return found ? found.value : fail(ctx, field, message);
}

/** One of a complete list (states, countries): the form offers it as a dropdown. */
function listed(ctx: Ctx, v: Fields, field: string, options: readonly string[], message: string): string | typeof z.NEVER {
  const value = v[field] ?? "";
  return options.includes(value) ? value : fail(ctx, field, message);
}

function loanAnswers(ctx: Ctx, v: Fields, currency: string, priceMinor: number) {
  const payment = choice(ctx, v, "payment", LOAN_PAYMENTS, "Choose how you'll pay");
  let downPaymentMinor: number | null = null;
  let loanRateBps: number | null = null;
  let loanMonths: number | null = null;
  if (payment === "loan_down_payment") {
    downPaymentMinor = amountField(ctx, v, "downPayment", currency);
    if (downPaymentMinor >= priceMinor) return fail(ctx, "downPayment", "The down payment must be less than the price");
  }
  if (payment !== "cash") {
    loanRateBps = parsePercentToBps(v.rate ?? "");
    if (loanRateBps === null) return fail(ctx, "rate", "Enter the yearly interest rate, e.g. 8.5");
    loanMonths = wholeNumber(ctx, v, "months", "the loan tenure in months", MAX_TENURE_MONTHS);
  }
  return { payment, priceMinor, downPaymentMinor, loanRateBps, loanMonths };
}

function detailsFrom(ctx: Ctx, type: GoalType, v: Fields, currency: string): GoalDetails | typeof z.NEVER {
  switch (type) {
    case "trip": {
      const costs = Object.fromEntries(
        TRIP_COST_LINES.map((line) => [line, v[`cost_${line}`] ? amountField(ctx, v, `cost_${line}`, currency, { allowZero: true }) : 0]),
      ) as Record<(typeof TRIP_COST_LINES)[number], number>;
      // Not returned early, so every missing answer is reported at once.
      if (TRIP_COST_LINES.every((line) => costs[line] === 0)) fail(ctx, "cost_transport", "Enter at least one cost");
      const scope = v.scope === "international" ? "international" : v.scope === "domestic" ? "domestic" : fail(ctx, "scope", "Choose domestic or international");
      return {
        type,
        details: {
          v: 1,
          scope,
          place: listed(ctx, v, "place", scope === "domestic" ? INDIAN_STATES : FOREIGN_COUNTRIES, scope === "domestic" ? "Choose a state" : "Choose a country"),
          people: wholeNumber(ctx, v, "people", "the number of people", 100),
          days: wholeNumber(ctx, v, "days", "the number of days", 365),
          travelMode: choice(ctx, v, "travelMode", TRAVEL_MODES, "Choose how you'll travel"),
          stay: choice(ctx, v, "stay", STAY_TYPES, "Choose where you'll stay"),
          costs,
        },
      };
    }
    case "vehicle": {
      const vehicle = choice(ctx, v, "vehicle", VEHICLE_KIND_OPTIONS, "Choose bike, car or HMV");
      const condition = v.condition === "new" || v.condition === "used" ? v.condition : fail(ctx, "condition", "Choose new or used");
      // Makes and models are suggestions: anything typed is accepted (the lists go out of date).
      const make = requiredText(ctx, v, "make", "the make");
      const model = requiredText(ctx, v, "model", "the model");
      const priceMinor = amountField(ctx, v, "price", currency);
      const extrasMinor = v.extras ? amountField(ctx, v, "extras", currency, { allowZero: true }) : 0;
      return { type, details: { v: 1, vehicle, condition, make, model, extrasMinor, ...loanAnswers(ctx, v, currency, priceMinor) } };
    }
    case "house": {
      const purpose = v.purpose === "buy" || v.purpose === "renovate" ? v.purpose : fail(ctx, "purpose", "Choose buy or renovate");
      const city = requiredText(ctx, v, "city", "the city");
      const priceMinor = amountField(ctx, v, "price", currency);
      return { type, details: { v: 1, purpose, city, ...loanAnswers(ctx, v, currency, priceMinor) } };
    }
    case "furniture":
    case "electronics":
    case "mobile": {
      const item = requiredText(ctx, v, "item", "the item");
      const priceMinor = amountField(ctx, v, "price", currency);
      const payment = choice(ctx, v, "payment", ITEM_PAYMENTS, "Choose how you'll pay");
      let emiRateBps: number | null = null;
      let emiMonths: number | null = null;
      if (payment === "emi") {
        emiRateBps = parsePercentToBps(v.rate ?? "");
        if (emiRateBps === null) return fail(ctx, "rate", "Enter the yearly interest rate, e.g. 15");
      }
      if (payment !== "cash") emiMonths = wholeNumber(ctx, v, "months", "the number of EMIs", MAX_TENURE_MONTHS);
      return { type, details: { v: 1, item, payment, priceMinor, emiRateBps, emiMonths } };
    }
    case "other":
      return { type, details: { v: 1, description: requiredText(ctx, v, "description", "what it's for", GOAL_DESCRIPTION_MAX) } };
  }
}

/**
 * Add a goal (no `goalId`) or edit one (`goalId`; the type never changes). The target
 * amount comes from the answers (goalFigures), except for "other", where it is entered.
 * A target date can't be in the past, unless it is the date the goal already has.
 */
export function goalFormSchema({ currency, today, currentTargetDate = null }: { currency: string; today: string; currentTargetDate?: string | null }) {
  return z
    .looseObject({
      goalId: uuidOrEmpty("Goal not found"),
      type: z.enum(GOAL_TYPES, { message: "Choose what you're planning" }),
      name: text,
      targetDate: text,
      saved: text,
      idempotencyKey: uuidOrEmpty("Please reopen the form and try again"),
    })
    .transform((raw, ctx) => {
      const v: Fields = Object.fromEntries(
        Object.entries(raw).map(([k, value]) => [k, typeof value === "string" ? value.trim() : ""]),
      );
      if (!raw.goalId && !raw.idempotencyKey) return fail(ctx, "idempotencyKey", "Please reopen the form and try again");
      const name = requiredText(ctx, v, "name", "a name", GOAL_NAME_MAX);
      let targetDate: string | null = null;
      if (raw.targetDate) {
        if (!isIsoDate(raw.targetDate)) return fail(ctx, "targetDate", "Choose a valid date");
        if (raw.targetDate < today && raw.targetDate !== currentTargetDate) return fail(ctx, "targetDate", "The target date can't be in the past");
        if (raw.targetDate > "2199-12-31") return fail(ctx, "targetDate", "Choose an earlier date");
        targetDate = raw.targetDate;
      }
      const savedMinor = raw.saved ? amountField(ctx, v, "saved", currency, { allowZero: true }) : 0;
      const goal = detailsFrom(ctx, raw.type, v, currency);
      if (ctx.issues.length > 0) return z.NEVER;
      // Re-check the shape exactly as stored (also caps the JSON size).
      if (!parseGoalDetails(goal.type, goal.details)) return fail(ctx, "type", "Please check the answers and try again");
      const upfront = goalFigures(goal).upfrontMinor;
      const targetMinor = upfront ?? amountField(ctx, v, "amount", currency);
      if (targetMinor > MAX_AMOUNT_MINOR) return fail(ctx, "type", AMOUNT_ERROR_MESSAGES.too_large);
      return {
        goalId: raw.goalId || null,
        type: goal.type,
        name,
        targetDate,
        savedMinor,
        targetMinor,
        details: goal.details,
        idempotencyKey: raw.idempotencyKey || null,
      };
    });
}

export type GoalFormOutput = z.output<ReturnType<typeof goalFormSchema>>;

/** Updating only what has been saved so far. */
export function goalSavedSchema({ currency }: { currency: string }) {
  return z.object({ goalId: z.uuid({ message: "Goal not found" }), saved: text }).transform((v, ctx) => {
    const parsed = parseAmount(v.saved, currency, { allowZero: true });
    if (!parsed.ok) return fail(ctx, "saved", AMOUNT_ERROR_MESSAGES[parsed.error]);
    return { goalId: v.goalId, savedMinor: parsed.minor };
  });
}

// ---------------------------------------------------------------------------
// Monthly budgets
// ---------------------------------------------------------------------------

/**
 * A category's monthly budget from a month onward ("YYYY-MM", this month or later).
 * 0 or blank removes the budget from that month on.
 */
export function budgetFormSchema({ currency, today }: { currency: string; today: string }) {
  const thisMonth = today.slice(0, 7);
  return z
    .object({
      categoryId: z.uuid({ message: "Choose a category" }),
      month: z
        .string()
        .trim()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month")
        .refine((m) => m >= thisMonth, "Budgets can start this month or later"),
      amount: text,
    })
    .transform((v, ctx) => {
      let amountMinor = 0;
      if (v.amount) {
        const parsed = parseAmount(v.amount, currency, { allowZero: true });
        if (!parsed.ok) return fail(ctx, "amount", AMOUNT_ERROR_MESSAGES[parsed.error]);
        amountMinor = parsed.minor;
      }
      return { categoryId: v.categoryId, effectiveFrom: `${v.month}-01`, amountMinor };
    });
}

export type BudgetFormOutput = z.output<ReturnType<typeof budgetFormSchema>>;
