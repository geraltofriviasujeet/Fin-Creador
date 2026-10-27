import {
  AMOUNT_ERROR_MESSAGES,
  LOAN_LENDER_MAX,
  LOAN_MAX_MORATORIUM_MONTHS,
  LOAN_MAX_TENURE_MONTHS,
  LOAN_NICKNAME_MAX,
  LOAN_RATE_KINDS,
  LOAN_START_MODES,
  LOAN_TYPES,
  LOAN_TYPE_LABELS,
  LOAN_TYPE_OTHER_MAX,
  MORATORIUM_INTEREST,
  type LoanRateKind,
  type LoanStartMode,
  type LoanType,
  type MoratoriumInterest,
  addMonthsClamped,
  beforeTrackingDate,
  checkPaymentSplit,
  formatMoney,
  isIsoDate,
  loanEmiEstimate,
  loanSchedule,
  minimumEmiMinor,
  monthRange,
  parseAmount,
  shortfallMinor,
  splitTotal,
} from "@fin-creador/domain";
import { z } from "zod";
import { FD_BANKS } from "./fixed-deposit-forms";
import { parsePercentToBps } from "./goal-forms";

// Loans (Sprint 8a), shared by web and mobile. Mirrors the loans migration: the database
// checks every range, date and ownership rule again, and refuses a payment the account
// can't cover.

/**
 * Lenders offered in the type-ahead (any name can be typed): banks and small finance banks,
 * housing finance companies, NBFCs (including education lenders) and card issuers. Reviewed
 * with the other lists every quarter (docs/quarterly-list-refresh.md).
 */
export const LENDERS: readonly string[] = [
  ...FD_BANKS,
  // Card issuers that are not banks
  "SBI Card",
  "American Express",
  // Housing finance companies
  "LIC Housing Finance",
  "PNB Housing Finance",
  "Bajaj Housing Finance",
  "Tata Capital Housing Finance",
  "ICICI Home Finance",
  "Aadhar Housing Finance",
  "Aavas Financiers",
  "Can Fin Homes",
  "GIC Housing Finance",
  "Home First Finance",
  "Repco Home Finance",
  "Sammaan Capital",
  // NBFCs
  "Bajaj Finance",
  "Tata Capital",
  "Aditya Birla Capital",
  "L&T Finance",
  "Mahindra Finance",
  "Shriram Finance",
  "Cholamandalam Finance",
  "Sundaram Finance",
  "HDB Financial Services",
  "Hero FinCorp",
  "Poonawalla Fincorp",
  "IIFL Finance",
  "SMFG India Credit",
  "Kotak Mahindra Prime",
  "TVS Credit",
  "Piramal Finance",
  "Toyota Financial Services",
  "Muthoot Finance",
  "Manappuram Finance",
  // Education lenders
  "Avanse Financial Services",
  "Credila Financial Services",
  "Auxilo Finserve",
  "InCred Finance",
];
export const LENDERS_REVIEWED_ON = "2026-10-27";

export const LOAN_TYPE_OPTIONS: readonly { value: LoanType; label: string }[] = LOAN_TYPES.map((value) => ({
  value,
  label: value === "other" ? "Other (specify)" : LOAN_TYPE_LABELS[value],
}));

export const LOAN_RATE_KIND_OPTIONS: readonly { value: LoanRateKind; label: string }[] = [
  { value: "fixed", label: "Fixed" },
  { value: "floating", label: "Floating" },
];

export const MORATORIUM_INTEREST_OPTIONS: readonly { value: MoratoriumInterest; label: string }[] = [
  { value: "capitalise", label: "Added to the loan when EMIs start" },
  { value: "pay_monthly", label: "Paid every month" },
];

/** Four or more digits in a row: refused in names so no card or loan account number is stored. */
const DIGIT_RUN = /\d{4,}/;

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

function wholeMonths(value: string, min: number, max: number): number | null {
  if (!/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

const RATE_MESSAGE = "Enter the yearly interest rate, e.g. 8.5 (0 for a no-cost EMI)";
const NO_DIGITS = "Leave out card and account numbers";

function names(ctx: Ctx, v: { loanType: string; typeOther: string; lender: string; nickname: string }) {
  const loanType = v.loanType as LoanType;
  if (!LOAN_TYPES.includes(loanType)) return fail(ctx, "loanType", "Choose a loan type");
  const typeOther = v.typeOther.replace(/\s+/g, " ");
  if (loanType === "other" && !typeOther) return fail(ctx, "typeOther", "Say what kind of loan it is");
  if (typeOther.length > LOAN_TYPE_OTHER_MAX) return fail(ctx, "typeOther", `Keep it under ${LOAN_TYPE_OTHER_MAX} characters`);
  const lender = v.lender.replace(/\s+/g, " ");
  if (!lender) return fail(ctx, "lender", loanType === "credit_card_emi" ? "Enter the card issuer" : "Enter the lender");
  if (lender.length > LOAN_LENDER_MAX) return fail(ctx, "lender", `Keep it under ${LOAN_LENDER_MAX} characters`);
  if (DIGIT_RUN.test(lender)) return fail(ctx, "lender", NO_DIGITS);
  const nickname = v.nickname.replace(/\s+/g, " ");
  if (nickname.length > LOAN_NICKNAME_MAX) return fail(ctx, "nickname", `Keep it under ${LOAN_NICKNAME_MAX} characters`);
  if (DIGIT_RUN.test(nickname)) return fail(ctx, "nickname", NO_DIGITS);
  return { loanType, typeOther: loanType === "other" ? typeOther : null, lender, nickname: nickname || null };
}

/**
 * Add a loan. `today` is the person's local date, `currency` the profile currency.
 *  - Ongoing: outstanding today, EMIs left, next EMI date, and whether this month's EMI is
 *    already paid (then it is recorded as before tracking and never posted, and the next EMI
 *    is after today) or still due (the next EMI date is this month's, possibly already past).
 *  - Starts later: first EMI date (after today), moratorium months and, with a moratorium,
 *    what happens to interest during it.
 * The EMI is calculated; a typed EMI (the bank's) overwrites it and the schedule follows it.
 */
export function loanFormSchema({ today, currency }: { today: string; currency: string }) {
  return z
    .object({
      loanType: text,
      typeOther: text,
      lender: text,
      nickname: text,
      sanctioned: text,
      disbursed: text,
      rate: text,
      rateKind: text,
      tenureMonths: text,
      startMode: text,
      outstanding: text,
      remainingMonths: text,
      nextDueDate: text,
      thisMonthPaid: text,
      firstEmiDate: text,
      moratoriumMonths: text,
      moratoriumInterest: text,
      emi: text,
      idempotencyKey: uuidOrEmpty("Please reopen the form and try again"),
    })
    .transform((v, ctx) => {
      if (!v.idempotencyKey) return fail(ctx, "idempotencyKey", "Please reopen the form and try again");
      const named = names(ctx, v);
      if (named === z.NEVER) return z.NEVER;

      const sanctioned = parseAmount(v.sanctioned, currency);
      if (!sanctioned.ok) return fail(ctx, "sanctioned", AMOUNT_ERROR_MESSAGES[sanctioned.error]);
      const disbursed = parseAmount(v.disbursed, currency);
      if (!disbursed.ok) return fail(ctx, "disbursed", AMOUNT_ERROR_MESSAGES[disbursed.error]);
      if (disbursed.minor > sanctioned.minor) return fail(ctx, "disbursed", "The amount taken can't be more than the sanctioned amount");

      const rateBps = parsePercentToBps(v.rate);
      if (rateBps === null) return fail(ctx, "rate", RATE_MESSAGE);
      const rateKind = (v.rateKind || "fixed") as LoanRateKind;
      if (!LOAN_RATE_KINDS.includes(rateKind)) return fail(ctx, "rateKind", "Choose fixed or floating");
      const tenureMonths = wholeMonths(v.tenureMonths, 1, LOAN_MAX_TENURE_MONTHS);
      if (tenureMonths === null) return fail(ctx, "tenureMonths", `Enter the tenure in months, 1 to ${LOAN_MAX_TENURE_MONTHS}`);

      const startMode = v.startMode as LoanStartMode;
      if (!LOAN_START_MODES.includes(startMode)) return fail(ctx, "startMode", "Choose ongoing or starts later");

      let outstandingMinor: number;
      let remainingMonths: number;
      let firstDueDate: string;
      let beforeTrackingOn: string | null = null;
      let moratoriumMonths = 0;
      let moratoriumInterest: MoratoriumInterest | null = null;

      if (startMode === "ongoing") {
        const outstanding = parseAmount(v.outstanding, currency);
        if (!outstanding.ok) return fail(ctx, "outstanding", AMOUNT_ERROR_MESSAGES[outstanding.error]);
        if (outstanding.minor > disbursed.minor) return fail(ctx, "outstanding", "What you owe can't be more than the amount taken");
        outstandingMinor = outstanding.minor;
        const left = wholeMonths(v.remainingMonths, 1, tenureMonths);
        if (left === null) return fail(ctx, "remainingMonths", `Enter the EMIs left, 1 to ${tenureMonths}`);
        remainingMonths = left;
        if (v.thisMonthPaid !== "paid" && v.thisMonthPaid !== "due") return fail(ctx, "thisMonthPaid", "Say whether this month's EMI is paid");
        if (!isIsoDate(v.nextDueDate)) return fail(ctx, "nextDueDate", "Enter a valid date");
        if (v.thisMonthPaid === "paid") {
          if (v.nextDueDate <= today) return fail(ctx, "nextDueDate", "With this month's EMI paid, the next one is after today");
          if (v.nextDueDate > addMonthsClamped(today, 2)) return fail(ctx, "nextDueDate", "The next EMI should be within two months");
          beforeTrackingOn = beforeTrackingDate(v.nextDueDate, true);
        } else {
          const month = monthRange(today);
          if (v.nextDueDate < month.start || v.nextDueDate > month.end) return fail(ctx, "nextDueDate", "Enter this month's EMI date");
        }
        firstDueDate = v.nextDueDate;
      } else {
        outstandingMinor = disbursed.minor;
        remainingMonths = tenureMonths;
        if (!isIsoDate(v.firstEmiDate)) return fail(ctx, "firstEmiDate", "Enter a valid date");
        if (v.firstEmiDate <= today) return fail(ctx, "firstEmiDate", "The first EMI is after today; otherwise choose Ongoing");
        if (v.firstEmiDate > addMonthsClamped(today, LOAN_MAX_MORATORIUM_MONTHS + 1)) return fail(ctx, "firstEmiDate", "The first EMI should be within 10 years");
        firstDueDate = v.firstEmiDate;
        const m = v.moratoriumMonths ? wholeMonths(v.moratoriumMonths, 0, LOAN_MAX_MORATORIUM_MONTHS) : 0;
        if (m === null) return fail(ctx, "moratoriumMonths", `Enter the moratorium in months, 0 to ${LOAN_MAX_MORATORIUM_MONTHS}`);
        moratoriumMonths = m;
        if (m > 0) {
          if (!MORATORIUM_INTEREST.includes(v.moratoriumInterest as MoratoriumInterest)) {
            return fail(ctx, "moratoriumInterest", "Say what happens to interest during the moratorium");
          }
          moratoriumInterest = v.moratoriumInterest as MoratoriumInterest;
        }
      }

      const estimate =
        startMode === "ongoing"
          ? loanEmiEstimate({ startMode, outstandingMinor, rateBps, remainingMonths })
          : loanEmiEstimate({ startMode, disbursedMinor: disbursed.minor, rateBps, tenureMonths, moratoriumMonths, moratoriumInterest });

      let emiMinor = estimate.emiMinor;
      if (v.emi) {
        const typed = parseAmount(v.emi, currency);
        if (!typed.ok) return fail(ctx, "emi", AMOUNT_ERROR_MESSAGES[typed.error]);
        emiMinor = typed.minor;
      }
      if (estimate.months > 1 && emiMinor < minimumEmiMinor(estimate.principalMinor, rateBps)) {
        const least = formatMoney(minimumEmiMinor(estimate.principalMinor, rateBps), { currency });
        return fail(ctx, "emi", `The EMI must be more than a month's interest: at least ${least}`);
      }
      // The schedule must work with this EMI (a later month's interest can't exceed it).
      try {
        loanSchedule({ principalMinor: estimate.principalMinor, rateBps, emiMinor, months: estimate.months, firstDueDate });
      } catch {
        return fail(ctx, "emi", "This EMI doesn't cover the interest. Check the amount");
      }

      return {
        ...named,
        sanctionedMinor: sanctioned.minor,
        disbursedMinor: disbursed.minor,
        rateBps,
        rateKind,
        tenureMonths,
        startMode,
        /** Ongoing: owed today; starts later: the amount taken. */
        outstandingMinor,
        /** Ongoing: EMIs left; starts later: the tenure. */
        remainingMonths,
        /** The first pending EMI. */
        firstDueDate,
        /** Ongoing with this month's EMI paid: its date, recorded as before tracking. */
        beforeTrackingOn,
        moratoriumMonths,
        moratoriumInterest,
        capitalisedMinor: estimate.capitalisedMinor,
        moratoriumMonthlyInterestMinor: estimate.moratoriumMonthlyInterestMinor,
        emiEstimateMinor: estimate.emiMinor,
        emiMinor,
        idempotencyKey: v.idempotencyKey,
      };
    });
}

export type LoanFormOutput = z.output<ReturnType<typeof loanFormSchema>>;

/**
 * Edit a loan in place: names, rate (and fixed or floating), sanctioned amount and the EMI.
 * The amounts, dates and tenure that shaped the schedule stay as entered. A new EMI applies
 * to pending EMIs. `loan` carries what the checks need.
 */
export function loanEditFormSchema({
  currency,
  loan,
}: {
  currency: string;
  loan: { disbursedMinor: number; outstandingMinor: number; pendingEmis: number };
}) {
  return z
    .object({
      loanId: text.pipe(z.uuid({ message: "Loan not found" })),
      loanType: text,
      typeOther: text,
      lender: text,
      nickname: text,
      sanctioned: text,
      rate: text,
      rateKind: text,
      emi: text,
    })
    .transform((v, ctx) => {
      const named = names(ctx, v);
      if (named === z.NEVER) return z.NEVER;
      const sanctioned = parseAmount(v.sanctioned, currency);
      if (!sanctioned.ok) return fail(ctx, "sanctioned", AMOUNT_ERROR_MESSAGES[sanctioned.error]);
      if (sanctioned.minor < loan.disbursedMinor) return fail(ctx, "sanctioned", "The sanctioned amount can't be less than the amount taken");
      const rateBps = parsePercentToBps(v.rate);
      if (rateBps === null) return fail(ctx, "rate", RATE_MESSAGE);
      const rateKind = (v.rateKind || "fixed") as LoanRateKind;
      if (!LOAN_RATE_KINDS.includes(rateKind)) return fail(ctx, "rateKind", "Choose fixed or floating");
      const emi = parseAmount(v.emi, currency);
      if (!emi.ok) return fail(ctx, "emi", AMOUNT_ERROR_MESSAGES[emi.error]);
      if (loan.pendingEmis > 1 && loan.outstandingMinor > 0 && emi.minor < minimumEmiMinor(loan.outstandingMinor, rateBps)) {
        const least = formatMoney(minimumEmiMinor(loan.outstandingMinor, rateBps), { currency });
        return fail(ctx, "emi", `The EMI must be more than a month's interest: at least ${least}`);
      }
      return { loanId: v.loanId, ...named, sanctionedMinor: sanctioned.minor, rateBps, rateKind, emiMinor: emi.minor };
    });
}

export type LoanEditFormOutput = z.output<ReturnType<typeof loanEditFormSchema>>;

// ---------------------------------------------------------------------------
// Paying a due item, or planning to
// ---------------------------------------------------------------------------

export interface PayingAccount {
  id: string;
  name: string;
  currency: string;
  balanceMinor: number;
  openingBalanceDate: string;
}

/**
 * "Paid": the account (any active bank, cash or other account, in the loan's currency), the
 * date (today by default, not before the loan was added, not in the future) and the split
 * (principal, interest, fees; each may be edited, principal at most what is owed). The total
 * is checked against the balance: "You need X more in <account> to pay this EMI" until the
 * person chooses "Pay anyway" (`allowShortfall`), which sends the same request again.
 */
export function payDueFormSchema({
  today,
  currency,
  trackingStartedOn,
  outstandingMinor,
  accounts,
}: {
  today: string;
  currency: string;
  trackingStartedOn: string;
  /** Owed, including moratorium interest still to be added. */
  outstandingMinor: number;
  accounts: readonly PayingAccount[];
}) {
  return z
    .object({
      dueItemId: text.pipe(z.uuid({ message: "We couldn't find that EMI" })),
      accountId: text,
      paidOn: text,
      principal: text,
      interest: text,
      fees: text,
      allowShortfall: text,
      idempotencyKey: uuidOrEmpty("Please reopen the form and try again"),
    })
    .transform((v, ctx) => {
      if (!v.idempotencyKey) return fail(ctx, "idempotencyKey", "Please reopen the form and try again");
      const account = accounts.find((a) => a.id === v.accountId);
      if (!account) return fail(ctx, "accountId", "Choose the account you paid from");
      if (account.currency !== currency) return fail(ctx, "accountId", `Choose an account in ${currency}`);
      const paidOn = v.paidOn || today;
      if (!isIsoDate(paidOn)) return fail(ctx, "paidOn", "Enter a valid date");
      if (paidOn > today) return fail(ctx, "paidOn", "The date can't be in the future. Use Will pay later");
      if (paidOn < trackingStartedOn) return fail(ctx, "paidOn", "Payments before the loan was added aren't recorded");
      if (paidOn < account.openingBalanceDate) return fail(ctx, "paidOn", "That date is before this account's opening balance");
      const parts: number[] = [];
      for (const field of ["principal", "interest", "fees"] as const) {
        const parsed = parseAmount(v[field] || "0", currency, { allowZero: true });
        if (!parsed.ok) return fail(ctx, field, AMOUNT_ERROR_MESSAGES[parsed.error]);
        parts.push(parsed.minor);
      }
      const [principalMinor = 0, interestMinor = 0, feesMinor = 0] = parts;
      const split = { principalMinor, interestMinor, feesMinor };
      const problem = checkPaymentSplit(split, outstandingMinor);
      if (problem === "empty") return fail(ctx, "principal", "Enter what you paid");
      if (problem === "principal_over_outstanding") {
        return fail(ctx, "principal", `Principal can't be more than you owe (${formatMoney(outstandingMinor, { currency })})`);
      }
      if (problem) return fail(ctx, "principal", "Please check the amounts");
      const totalMinor = splitTotal(split);
      const allowShortfall = v.allowShortfall === "true";
      const short = shortfallMinor(account.balanceMinor, totalMinor);
      if (short > 0 && !allowShortfall) {
        // `params.shortfallMinor` lets the form offer "Pay anyway" with the amount.
        ctx.addIssue({ code: "custom", path: ["accountId"], message: shortfallMessage(short, account.name, currency), params: { shortfallMinor: short } });
        return z.NEVER;
      }
      return { dueItemId: v.dueItemId, accountId: account.id, paidOn, ...split, totalMinor, allowShortfall, idempotencyKey: v.idempotencyKey };
    });
}

/** The warning on the pay form and, ahead of time, on the EMI card (or a card bill, a repayment). */
export function shortfallMessage(shortMinor: number, accountName: string, currency: string, what = "this EMI"): string {
  return `You need ${formatMoney(shortMinor, { currency })} more in ${accountName} to pay ${what}`;
}

export type PayDueFormOutput = z.output<ReturnType<typeof payDueFormSchema>>;

/** "Will pay later": a planned date (today or later, up to a year) and the account. The EMI stays pending. */
export function planDueFormSchema({ today, currency, accounts }: { today: string; currency: string; accounts: readonly PayingAccount[] }) {
  return z
    .object({
      dueItemId: text.pipe(z.uuid({ message: "We couldn't find that EMI" })),
      accountId: text,
      plannedOn: text,
    })
    .transform((v, ctx) => {
      const account = accounts.find((a) => a.id === v.accountId);
      if (!account) return fail(ctx, "accountId", "Choose the account you'll pay from");
      if (account.currency !== currency) return fail(ctx, "accountId", `Choose an account in ${currency}`);
      if (!isIsoDate(v.plannedOn)) return fail(ctx, "plannedOn", "Enter a valid date");
      if (v.plannedOn < today) return fail(ctx, "plannedOn", "Choose today or a later date");
      if (v.plannedOn > addMonthsClamped(today, 12)) return fail(ctx, "plannedOn", "Choose a date within a year");
      return { dueItemId: v.dueItemId, accountId: account.id, plannedOn: v.plannedOn };
    });
}

export type PlanDueFormOutput = z.output<ReturnType<typeof planDueFormSchema>>;
