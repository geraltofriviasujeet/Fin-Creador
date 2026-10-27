import { AMOUNT_ERROR_MESSAGES, addMonthsClamped, cardDueDate, formatMoney, isIsoDate, parseAmount, shortfallMinor } from "@fin-creador/domain";
import { z } from "zod";
import { type PayingAccount, shortfallMessage } from "./loan-forms";

// Credit cards and informal borrowing (Sprint 8b), shared by web and mobile. Mirrors the
// migration 20261028180000: the database checks every rule again.

export const CARD_ISSUER_MAX = 80;
export const CARD_NICKNAME_MAX = 40;
export const BORROWING_LENDER_MAX = 80;

/** Names never hold a digit (in any script), so no card or account number (or any part of one) is stored. */
export const NO_DIGITS = "Leave out numbers: no card or account digits in names";
const HAS_DIGIT = /\p{Nd}/u;

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

function name(ctx: Ctx, path: string, value: string, { required, max, missing }: { required: boolean; max: number; missing: string }): string | null | typeof z.NEVER {
  const v = value.replace(/\s+/g, " ");
  if (!v) return required ? fail(ctx, path, missing) : null;
  if (v.length > max) return fail(ctx, path, `Keep it under ${max} characters`);
  if (HAS_DIGIT.test(v)) return fail(ctx, path, NO_DIGITS);
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

function cardFields(ctx: Ctx, v: { issuer: string; nickname: string; limit: string; statementDay: string; dueDay: string }, currency: string) {
  const issuer = name(ctx, "issuer", v.issuer, { required: true, max: CARD_ISSUER_MAX, missing: "Enter the card issuer" });
  if (issuer === z.NEVER) return z.NEVER;
  const nickname = name(ctx, "nickname", v.nickname, { required: false, max: CARD_NICKNAME_MAX, missing: "" });
  if (nickname === z.NEVER) return z.NEVER;
  const limit = parseAmount(v.limit, currency);
  if (!limit.ok) return fail(ctx, "limit", AMOUNT_ERROR_MESSAGES[limit.error]);
  const statementDay = day(ctx, "statementDay", v.statementDay, "statement day");
  if (statementDay === z.NEVER) return z.NEVER;
  const dueDay = day(ctx, "dueDay", v.dueDay, "due day");
  if (dueDay === z.NEVER) return z.NEVER;
  return { issuer: issuer as string, nickname, limitMinor: limit.minor, statementDay, dueDay };
}

/** Add a card: issuer, optional nickname (no digits), limit, statement and due days, what is owed today (not posted). */
export function cardFormSchema({ currency }: { currency: string }) {
  return z
    .object({ issuer: text, nickname: text, limit: text, statementDay: text, dueDay: text, openingOwed: text, idempotencyKey: uuidOrEmpty(REOPEN) })
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
    .object({ cardId: text.pipe(z.uuid({ message: "Card not found" })), issuer: text, nickname: text, limit: text, statementDay: text, dueDay: text })
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

/**
 * Add a borrowing: who you owe (a name, no digits), the amount, how it was received (into an
 * account on a date, posted now; or earlier, only what is owed is recorded) and an optional
 * due date.
 */
export function borrowingFormSchema({ today, currency, accounts }: { today: string; currency: string; accounts: readonly PayingAccount[] }) {
  return z
    .object({ lender: text, amount: text, received: text, accountId: text, receivedOn: text, dueDate: text, idempotencyKey: uuidOrEmpty(REOPEN) })
    .transform((v, ctx) => {
      if (!v.idempotencyKey) return fail(ctx, "idempotencyKey", REOPEN);
      const lender = name(ctx, "lender", v.lender, { required: true, max: BORROWING_LENDER_MAX, missing: "Enter who you borrowed from" });
      if (lender === z.NEVER) return z.NEVER;
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
      let dueDate: string | null = null;
      if (v.dueDate) {
        if (!isIsoDate(v.dueDate)) return fail(ctx, "dueDate", "Enter a valid date");
        if (v.dueDate < (receivedOn ?? today)) return fail(ctx, "dueDate", "The due date can't be before you borrowed the money");
        dueDate = v.dueDate;
      }
      return { lender: lender as string, amountMinor: amount.minor, received, accountId, receivedOn, dueDate, idempotencyKey: v.idempotencyKey };
    });
}

export type BorrowingFormOutput = z.output<ReturnType<typeof borrowingFormSchema>>;

/** Rename a borrowing (who you owe). */
export function borrowingEditFormSchema() {
  return z
    .object({ borrowingId: text.pipe(z.uuid({ message: "Borrowing not found" })), lender: text })
    .transform((v, ctx) => {
      const lender = name(ctx, "lender", v.lender, { required: true, max: BORROWING_LENDER_MAX, missing: "Enter who you borrowed from" });
      if (lender === z.NEVER) return z.NEVER;
      return { borrowingId: v.borrowingId, lender: lender as string };
    });
}

/** Add, change (today or later) or remove (empty) a borrowing's due date. */
export function borrowingDueDateFormSchema({ today }: { today: string }) {
  return z
    .object({ borrowingId: text.pipe(z.uuid({ message: "Borrowing not found" })), dueDate: text })
    .transform((v, ctx) => {
      if (!v.dueDate) return { borrowingId: v.borrowingId, dueDate: null };
      if (!isIsoDate(v.dueDate)) return fail(ctx, "dueDate", "Enter a valid date");
      if (v.dueDate < today) return fail(ctx, "dueDate", "Choose today or a later date");
      return { borrowingId: v.borrowingId, dueDate: v.dueDate };
    });
}

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
