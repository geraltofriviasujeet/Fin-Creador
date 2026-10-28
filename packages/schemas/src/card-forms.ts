import {
  AMOUNT_ERROR_MESSAGES,
  BORROWING_INSTALMENTS_MAX,
  BORROWING_INSTALMENTS_MIN,
  type BorrowingReturnPlan,
  addMonthsClamped,
  cardDueDate,
  formatMoney,
  isIsoDate,
  parseAmount,
  shortfallMinor,
} from "@fin-creador/domain";
import { z } from "zod";
import { hasDigitRun } from "./digits";
import { type PayingAccount, shortfallMessage } from "./loan-forms";

// Credit cards and informal borrowing (Sprint 8b), shared by web and mobile. Mirrors the
// migrations 20261028180000 and 20261028210000: the database checks every rule again.

export const CARD_ISSUER_MAX = 80;
export const CARD_NICKNAME_MAX = 40;
export const CARD_PRODUCT_MAX = 80;
export const BORROWING_LENDER_MAX = 80;
export const BORROWING_REASON_MAX = 80;

/** Names never hold a digit (in any script), so no card or account number (or any part of one) is stored. */
export const NO_DIGITS = "Leave out numbers: no card or account digits in names";
/** A card product may hold a digit or two ("6E"), never a run of 3 or more. */
export const PRODUCT_DIGITS = "Leave out card numbers: no 3 or more digits in a row";
/** A reason may hold a short number ("3 day trip"), never a run of 4 or more. */
export const REASON_DIGITS = "Leave out account or card numbers: no 4 or more digits in a row";

/** The dialog line next to "EMIs included" on a statement. */
export const CARD_EMI_NOTE = "Card EMIs are paid from the loan row";

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

function name(
  ctx: Ctx,
  path: string,
  value: string,
  { required, max, missing, digitRun = 1, digits = NO_DIGITS }: { required: boolean; max: number; missing: string; digitRun?: number; digits?: string },
): string | null | typeof z.NEVER {
  const v = value.replace(/\s+/g, " ");
  if (!v) return required ? fail(ctx, path, missing) : null;
  if (v.length > max) return fail(ctx, path, `Keep it under ${max} characters`);
  if (hasDigitRun(v, digitRun)) return fail(ctx, path, digits);
  return v;
}

function day(ctx: Ctx, path: string, value: string, label: string): number | typeof z.NEVER {
  if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 31) return fail(ctx, path, `Enter the ${label}, 1 to 31`);
  return Number(value);
}

function shortfall(ctx: Ctx, account: PayingAccount, totalMinor: number, currency: string, what: string, allow: boolean): boolean {
  const short = shortfallMinor(account.balanceMinor, totalMinor);
  if (short > 0 && !allow) {
    // `params.shortfallMinor` lets the form offer "Pay anyway" with the amount.
    ctx.addIssue({ code: "custom", path: ["accountId"], message: shortfallMessage(short, account.name, currency, what), params: { shortfallMinor: short } });
    return true;
  }
  return false;
}

function payingAccount(ctx: Ctx, accounts: readonly PayingAccount[], id: string, currency: string): PayingAccount | typeof z.NEVER {
  const account = accounts.find((a) => a.id === id);
  if (!account) return fail(ctx, "accountId", "Choose the account you paid from");
  if (account.currency !== currency) return fail(ctx, "accountId", `Choose an account in ${currency}`);
  return account;
}

function paidDate(ctx: Ctx, value: string, { today, openedOn, account, before }: { today: string; openedOn: string; account: PayingAccount; before: string }) {
  const paidOn = value || today;
  if (!isIsoDate(paidOn)) return fail(ctx, "paidOn", "Enter a valid date");
  if (paidOn > today) return fail(ctx, "paidOn", "The date can't be in the future");
  if (paidOn < openedOn) return fail(ctx, "paidOn", before);
  if (paidOn < account.openingBalanceDate) return fail(ctx, "paidOn", "That date is before this account's opening balance");
  return paidOn;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function cardFields(
  ctx: Ctx,
  v: { issuer: string; product: string; productOther: string; nickname: string; limit: string; statementDay: string; dueDay: string },
  currency: string,
) {
  const issuer = name(ctx, "issuer", v.issuer, { required: true, max: CARD_ISSUER_MAX, missing: "Enter the card issuer" });
  if (issuer === z.NEVER) return z.NEVER;
  const productOther = v.productOther === "true";
  const product = name(ctx, "product", v.product, {
    required: productOther,
    max: CARD_PRODUCT_MAX,
    missing: "Type the card's name",
    digitRun: 3,
    digits: PRODUCT_DIGITS,
  });
  if (product === z.NEVER) return z.NEVER;
  const nickname = name(ctx, "nickname", v.nickname, { required: false, max: CARD_NICKNAME_MAX, missing: "" });
  if (nickname === z.NEVER) return z.NEVER;
  const limit = parseAmount(v.limit, currency);
  if (!limit.ok) return fail(ctx, "limit", AMOUNT_ERROR_MESSAGES[limit.error]);
  const statementDay = day(ctx, "statementDay", v.statementDay, "statement day");
  if (statementDay === z.NEVER) return z.NEVER;
  const dueDay = day(ctx, "dueDay", v.dueDay, "due day");
  if (dueDay === z.NEVER) return z.NEVER;
  return { issuer: issuer as string, product, productOther: productOther && product !== null, nickname, limitMinor: limit.minor, statementDay, dueDay };
}

/**
 * Add a card: issuer, product (from CARD_PRODUCTS or typed under "Other"), an optional label
 * (no digits) for two of the same card, limit, statement and due days, what is owed today (not posted).
 */
export function cardFormSchema({ currency }: { currency: string }) {
  return z
    .object({
      issuer: text,
      product: text,
      productOther: text,
      nickname: text,
      limit: text,
      statementDay: text,
      dueDay: text,
      openingOwed: text,
      idempotencyKey: uuidOrEmpty(REOPEN),
    })
    .transform((v, ctx) => {
      if (!v.idempotencyKey) return fail(ctx, "idempotencyKey", REOPEN);
      const fields = cardFields(ctx, v, currency);
      if (fields === z.NEVER) return z.NEVER;
      const owed = parseAmount(v.openingOwed || "0", currency, { allowZero: true });
      if (!owed.ok) return fail(ctx, "openingOwed", AMOUNT_ERROR_MESSAGES[owed.error]);
      return { ...fields, openingOwedMinor: owed.minor, idempotencyKey: v.idempotencyKey };
    });
}

export type CardFormOutput = z.output<ReturnType<typeof cardFormSchema>>;

/** Edit a card: names, limit and days. What was owed when it was added stays as entered. */
export function cardEditFormSchema({ currency }: { currency: string }) {
  return z
    .object({
      cardId: text.pipe(z.uuid({ message: "Card not found" })),
      issuer: text,
      product: text,
      productOther: text,
      nickname: text,
      limit: text,
      statementDay: text,
      dueDay: text,
    })
    .transform((v, ctx) => {
      const fields = cardFields(ctx, v, currency);
      if (fields === z.NEVER) return z.NEVER;
      return { cardId: v.cardId, ...fields };
    });
}

export type CardEditFormOutput = z.output<ReturnType<typeof cardEditFormSchema>>;

/**
 * Enter a statement: its date (on or before today), the due date (the card's due day by
 * default), the total, the minimum and the card EMIs included (paid from the loan row). When
 * `differenceCategoryId` is set and the bill is more than what is logged as owed, the
 * difference is recorded as an expense in that category.
 */
export function statementFormSchema({ today, currency, card }: { today: string; currency: string; card: { dueDay: number } }) {
  return z
    .object({
      cardId: text.pipe(z.uuid({ message: "Card not found" })),
      statementDate: text,
      dueDate: text,
      total: text,
      minimum: text,
      emiIncluded: text,
      differenceCategoryId: uuidOrEmpty("Choose a category"),
      idempotencyKey: uuidOrEmpty(REOPEN),
    })
    .transform((v, ctx) => {
      if (!v.idempotencyKey) return fail(ctx, "idempotencyKey", REOPEN);
      if (!isIsoDate(v.statementDate)) return fail(ctx, "statementDate", "Enter the statement date");
      if (v.statementDate > today) return fail(ctx, "statementDate", "The statement date can't be in the future");
      const dueDate = v.dueDate || cardDueDate(v.statementDate, card.dueDay);
      if (!isIsoDate(dueDate)) return fail(ctx, "dueDate", "Enter a valid date");
      if (dueDate < v.statementDate) return fail(ctx, "dueDate", "The due date can't be before the statement date");
      if (dueDate > addMonthsClamped(v.statementDate, 2)) return fail(ctx, "dueDate", "The due date should be within two months of the statement");
      const total = parseAmount(v.total, currency, { allowZero: true });
      if (!total.ok) return fail(ctx, "total", AMOUNT_ERROR_MESSAGES[total.error]);
      const minimum = parseAmount(v.minimum || "0", currency, { allowZero: true });
      if (!minimum.ok) return fail(ctx, "minimum", AMOUNT_ERROR_MESSAGES[minimum.error]);
      if (minimum.minor > total.minor) return fail(ctx, "minimum", "The minimum can't be more than the total");
      const emi = parseAmount(v.emiIncluded || "0", currency, { allowZero: true });
      if (!emi.ok) return fail(ctx, "emiIncluded", AMOUNT_ERROR_MESSAGES[emi.error]);
      if (emi.minor > total.minor) return fail(ctx, "emiIncluded", "Card EMIs can't be more than the total");
      return {
        cardId: v.cardId,
        statementDate: v.statementDate,
        dueDate,
        totalMinor: total.minor,
        minimumMinor: minimum.minor,
        emiIncludedMinor: emi.minor,
        differenceCategoryId: v.differenceCategoryId || null,
        idempotencyKey: v.idempotencyKey,
      };
    });
}

export type StatementFormOutput = z.output<ReturnType<typeof statementFormSchema>>;

/** The message when a card payment is more than what is logged as owed. */
export function missingPurchaseMessage(owedMinor: number, currency: string): string {
  return `That's more than you owe on this card (${formatMoney(owedMinor, { currency })}). Record the missing purchase first`;
}

/**
 * Pay a card any amount (the "Other amount" option): a transfer from the chosen account, at
 * most what the card owes, not before the card was added; the shortfall warning as for EMIs.
 */
export function cardPaymentFormSchema({
  today,
  currency,
  trackingStartedOn,
  owedMinor,
  accounts,
}: {
  today: string;
  currency: string;
  trackingStartedOn: string;
  owedMinor: number;
  accounts: readonly PayingAccount[];
}) {
  return z
    .object({
      cardId: text.pipe(z.uuid({ message: "Card not found" })),
      accountId: text,
      paidOn: text,
      amount: text,
      allowShortfall: text,
      idempotencyKey: uuidOrEmpty(REOPEN),
    })
    .transform((v, ctx) => {
      if (!v.idempotencyKey) return fail(ctx, "idempotencyKey", REOPEN);
      const account = payingAccount(ctx, accounts, v.accountId, currency);
      if (account === z.NEVER) return z.NEVER;
      const paidOn = paidDate(ctx, v.paidOn, { today, openedOn: trackingStartedOn, account, before: "Payments before you added the card aren't recorded" });
      if (paidOn === z.NEVER) return z.NEVER;
      const amount = parseAmount(v.amount, currency);
      if (!amount.ok) return fail(ctx, "amount", AMOUNT_ERROR_MESSAGES[amount.error]);
      if (amount.minor > Math.max(owedMinor, 0)) return fail(ctx, "amount", missingPurchaseMessage(Math.max(owedMinor, 0), currency));
      const allowShortfall = v.allowShortfall === "true";
      if (shortfall(ctx, account, amount.minor, currency, "this card", allowShortfall)) return z.NEVER;
      return { cardId: v.cardId, accountId: account.id, paidOn, amountMinor: amount.minor, allowShortfall, idempotencyKey: v.idempotencyKey };
    });
}

export type CardPaymentFormOutput = z.output<ReturnType<typeof cardPaymentFormSchema>>;

// ---------------------------------------------------------------------------
// Informal borrowing
// ---------------------------------------------------------------------------

export const BORROWING_RECEIVED = ["into_account", "earlier"] as const;
export type BorrowingReceived = (typeof BORROWING_RECEIVED)[number];

export const BORROWING_RECEIVED_OPTIONS: readonly { value: BorrowingReceived; label: string }[] = [
  { value: "into_account", label: "Money received into an account" },
  { value: "earlier", label: "Already received earlier: record only what I owe" },
];

export const BORROWING_RELATIONSHIPS = ["family", "friends", "others"] as const;
export type BorrowingRelationship = (typeof BORROWING_RELATIONSHIPS)[number];

export const BORROWING_RELATIONSHIP_OPTIONS: readonly { value: BorrowingRelationship; label: string }[] = [
  { value: "family", label: "Family" },
  { value: "friends", label: "Friends" },
  { value: "others", label: "Others" },
];

export const BORROWING_RETURN_PLAN_OPTIONS: readonly { value: BorrowingReturnPlan; label: string }[] = [
  { value: "once", label: "All at once on that date" },
  { value: "instalments", label: "In monthly instalments" },
];

type ReturnPlanInput = { amountToReturn: string; sameAsBorrowed: string; returnOn: string; returnPlan: string; instalments: string; payFromAccountId: string };
type ReturnPlan = {
  amountToReturnMinor: number;
  returnOn: string | null;
  returnPlan: BorrowingReturnPlan | null;
  instalmentCount: number | null;
  payFromAccountId: string | null;
};

/**
 * How much to return ("Same as borrowed", or at least the amount borrowed: the extra is
 * interest) and, only once a return date is entered, how: all at once on that date or in 2–60
 * monthly instalments (the first on that date), from a bank, cash or other account.
 */
function returnPlan(
  ctx: Ctx,
  v: ReturnPlanInput,
  { currency, borrowedMinor, earliest, earliestMessage, accounts }: { currency: string; borrowedMinor: number; earliest: string; earliestMessage: string; accounts: readonly PayingAccount[] },
): ReturnPlan | typeof z.NEVER {
  let amountToReturnMinor = borrowedMinor;
  if (v.sameAsBorrowed !== "true") {
    const amount = parseAmount(v.amountToReturn, currency);
    if (!amount.ok) return fail(ctx, "amountToReturn", AMOUNT_ERROR_MESSAGES[amount.error]);
    if (amount.minor < borrowedMinor) return fail(ctx, "amountToReturn", `Enter at least the amount borrowed (${formatMoney(borrowedMinor, { currency })})`);
    amountToReturnMinor = amount.minor;
  }
  if (!v.returnOn) return { amountToReturnMinor, returnOn: null, returnPlan: null, instalmentCount: null, payFromAccountId: null };
  if (!isIsoDate(v.returnOn)) return fail(ctx, "returnOn", "Enter a valid date");
  if (v.returnOn < earliest) return fail(ctx, "returnOn", earliestMessage);
  const plan = v.returnPlan as BorrowingReturnPlan;
  if (plan !== "once" && plan !== "instalments") return fail(ctx, "returnPlan", "Choose how you will return it");
  let instalmentCount: number | null = null;
  if (plan === "instalments") {
    const n = /^\d{1,2}$/.test(v.instalments) ? Number(v.instalments) : NaN;
    if (!(n >= BORROWING_INSTALMENTS_MIN && n <= BORROWING_INSTALMENTS_MAX)) {
      return fail(ctx, "instalments", `Enter ${BORROWING_INSTALMENTS_MIN} to ${BORROWING_INSTALMENTS_MAX} instalments`);
    }
    if (n > amountToReturnMinor) return fail(ctx, "instalments", "That's more instalments than the amount allows");
    instalmentCount = n;
  }
  const account = accounts.find((a) => a.id === v.payFromAccountId);
  if (!account) return fail(ctx, "payFromAccountId", "Choose the account you will return it from");
  if (account.currency !== currency) return fail(ctx, "payFromAccountId", `Choose an account in ${currency}`);
  return { amountToReturnMinor, returnOn: v.returnOn, returnPlan: plan, instalmentCount, payFromAccountId: account.id };
}

function details(ctx: Ctx, v: { relationship: string; reason: string }) {
  const relationship = v.relationship as BorrowingRelationship;
  if (!BORROWING_RELATIONSHIPS.includes(relationship)) return fail(ctx, "relationship", "Choose family, friends or others");
  const reason = name(ctx, "reason", v.reason, { required: false, max: BORROWING_REASON_MAX, missing: "", digitRun: 4, digits: REASON_DIGITS });
  if (reason === z.NEVER) return z.NEVER;
  return { relationship, reason };
}

const returnPlanFields = { amountToReturn: text, sameAsBorrowed: text, returnOn: text, returnPlan: text, instalments: text, payFromAccountId: text };

/**
 * Add a borrowing: who you owe (a name, no digits) and who they are to you, what it was for
 * (optional), the amount, how it was received (into an account, "Cash in hand" included, on a
 * date, posted now; or earlier, only what is owed is recorded), how much to return and an
 * optional return plan. Nothing is ever repaid by itself.
 */
export function borrowingFormSchema({ today, currency, accounts }: { today: string; currency: string; accounts: readonly PayingAccount[] }) {
  return z
    .object({
      lender: text,
      relationship: text,
      reason: text,
      amount: text,
      received: text,
      accountId: text,
      receivedOn: text,
      ...returnPlanFields,
      idempotencyKey: uuidOrEmpty(REOPEN),
    })
    .transform((v, ctx) => {
      if (!v.idempotencyKey) return fail(ctx, "idempotencyKey", REOPEN);
      const lender = name(ctx, "lender", v.lender, { required: true, max: BORROWING_LENDER_MAX, missing: "Enter who you borrowed from" });
      if (lender === z.NEVER) return z.NEVER;
      const who = details(ctx, v);
      if (who === z.NEVER) return z.NEVER;
      const amount = parseAmount(v.amount, currency);
      if (!amount.ok) return fail(ctx, "amount", AMOUNT_ERROR_MESSAGES[amount.error]);
      const received = v.received as BorrowingReceived;
      if (!BORROWING_RECEIVED.includes(received)) return fail(ctx, "received", "Say how you received the money");
      let accountId: string | null = null;
      let receivedOn: string | null = null;
      if (received === "into_account") {
        const account = accounts.find((a) => a.id === v.accountId);
        if (!account) return fail(ctx, "accountId", "Choose the account the money went into");
        if (account.currency !== currency) return fail(ctx, "accountId", `Choose an account in ${currency}`);
        receivedOn = v.receivedOn || today;
        if (!isIsoDate(receivedOn)) return fail(ctx, "receivedOn", "Enter a valid date");
        if (receivedOn > today) return fail(ctx, "receivedOn", "The date can't be in the future");
        if (receivedOn < account.openingBalanceDate) return fail(ctx, "receivedOn", "That date is before this account's opening balance");
        accountId = account.id;
      }
      const plan = returnPlan(ctx, v, {
        currency,
        borrowedMinor: amount.minor,
        earliest: receivedOn ?? today,
        earliestMessage: "The return date can't be before you borrowed the money",
        accounts,
      });
      if (plan === z.NEVER) return z.NEVER;
      return { lender: lender as string, ...who, amountMinor: amount.minor, received, accountId, receivedOn, ...plan, idempotencyKey: v.idempotencyKey };
    });
}

export type BorrowingFormOutput = z.output<ReturnType<typeof borrowingFormSchema>>;

/** Change who you owe, who they are to you and what it was for. */
export function borrowingEditFormSchema() {
  return z
    .object({ borrowingId: text.pipe(z.uuid({ message: "Borrowing not found" })), lender: text, relationship: text, reason: text })
    .transform((v, ctx) => {
      const lender = name(ctx, "lender", v.lender, { required: true, max: BORROWING_LENDER_MAX, missing: "Enter who you borrowed from" });
      if (lender === z.NEVER) return z.NEVER;
      const who = details(ctx, v);
      if (who === z.NEVER) return z.NEVER;
      return { borrowingId: v.borrowingId, lender: lender as string, ...who };
    });
}

/**
 * Change how much to return and the return plan, or remove it (empty return date). A new
 * return date is today or later; the one already set may stay as it is. The due items are
 * rebuilt: "Will pay later" plans on them are dropped.
 */
export function borrowingReturnPlanFormSchema({
  today,
  currency,
  borrowedMinor,
  currentReturnOn,
  accounts,
}: {
  today: string;
  currency: string;
  borrowedMinor: number;
  currentReturnOn: string | null;
  accounts: readonly PayingAccount[];
}) {
  return z
    .object({ borrowingId: text.pipe(z.uuid({ message: "Borrowing not found" })), ...returnPlanFields })
    .transform((v, ctx) => {
      const keepsDate = currentReturnOn !== null && v.returnOn === currentReturnOn;
      const plan = returnPlan(ctx, v, {
        currency,
        borrowedMinor,
        earliest: keepsDate ? currentReturnOn : today,
        earliestMessage: "Choose today or a later date",
        accounts,
      });
      if (plan === z.NEVER) return z.NEVER;
      return { borrowingId: v.borrowingId, ...plan };
    });
}

export type BorrowingReturnPlanFormOutput = z.output<ReturnType<typeof borrowingReturnPlanFormSchema>>;

/**
 * A repayment (part or full): principal (at most what is owed) as a transfer, optional
 * interest as an expense, from the chosen account; the shortfall warning as for EMIs.
 */
export function repaymentFormSchema({
  today,
  currency,
  openedOn,
  owedMinor,
  accounts,
}: {
  today: string;
  currency: string;
  /** The borrowing account's opening date (received on, or the day it was added). */
  openedOn: string;
  owedMinor: number;
  accounts: readonly PayingAccount[];
}) {
  return z
    .object({
      borrowingId: text.pipe(z.uuid({ message: "Borrowing not found" })),
      accountId: text,
      paidOn: text,
      principal: text,
      interest: text,
      allowShortfall: text,
      idempotencyKey: uuidOrEmpty(REOPEN),
    })
    .transform((v, ctx) => {
      if (!v.idempotencyKey) return fail(ctx, "idempotencyKey", REOPEN);
      const account = payingAccount(ctx, accounts, v.accountId, currency);
      if (account === z.NEVER) return z.NEVER;
      const paidOn = paidDate(ctx, v.paidOn, { today, openedOn, account, before: "That date is before you borrowed the money" });
      if (paidOn === z.NEVER) return z.NEVER;
      const principal = parseAmount(v.principal || "0", currency, { allowZero: true });
      if (!principal.ok) return fail(ctx, "principal", AMOUNT_ERROR_MESSAGES[principal.error]);
      const interest = parseAmount(v.interest || "0", currency, { allowZero: true });
      if (!interest.ok) return fail(ctx, "interest", AMOUNT_ERROR_MESSAGES[interest.error]);
      if (principal.minor + interest.minor === 0) return fail(ctx, "principal", "Enter what you paid");
      const owed = Math.max(owedMinor, 0);
      if (principal.minor > owed) return fail(ctx, "principal", `That's more than you owe (${formatMoney(owed, { currency })})`);
      const allowShortfall = v.allowShortfall === "true";
      if (shortfall(ctx, account, principal.minor + interest.minor, currency, "this repayment", allowShortfall)) return z.NEVER;
      return {
        borrowingId: v.borrowingId,
        accountId: account.id,
        paidOn,
        principalMinor: principal.minor,
        interestMinor: interest.minor,
        allowShortfall,
        idempotencyKey: v.idempotencyKey,
      };
    });
}

export type RepaymentFormOutput = z.output<ReturnType<typeof repaymentFormSchema>>;
