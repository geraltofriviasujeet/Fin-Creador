import { describe, expect, it } from "vitest";
import {
  NO_DIGITS,
  borrowingDueDateFormSchema,
  borrowingFormSchema,
  cardEditFormSchema,
  cardFormSchema,
  cardPaymentFormSchema,
  repaymentFormSchema,
  statementFormSchema,
} from "./card-forms";
import { firstFieldErrors } from "./form-errors";

const KEY = "e8000000-0000-4000-8000-0000000000b1";
const CARD = "f8000000-0000-4000-8000-0000000000b1";
const BORROWING = "f8000000-0000-4000-8000-0000000000b2";
const CATEGORY = "f8000000-0000-4000-8000-0000000000b3";
const BANK = "a8000000-0000-4000-8000-0000000000b1";
const TODAY = "2026-10-28";
const accounts = [{ id: BANK, name: "HDFC Savings", currency: "INR", balanceMinor: 10_000_00, openingBalanceDate: "2026-01-01" }];

function errors(result: { success: boolean; error?: unknown }) {
  return result.success ? {} : firstFieldErrors(result.error as Parameters<typeof firstFieldErrors>[0]);
}

describe("cardFormSchema", () => {
  const card = { issuer: " HDFC   Bank ", nickname: "", limit: "2,00,000", statementDay: "20", dueDay: "8", openingOwed: "12,500", idempotencyKey: KEY };

  it("parses a card and what is owed today", () => {
    const r = cardFormSchema({ currency: "INR" }).safeParse(card);
    expect(r.success && r.data).toEqual({
      issuer: "HDFC Bank",
      nickname: null,
      limitMinor: 2_00_000_00,
      statementDay: 20,
      dueDay: 8,
      openingOwedMinor: 12_500_00,
      idempotencyKey: KEY,
    });
  });

  it("refuses any digit in the issuer or nickname", () => {
    expect(errors(cardFormSchema({ currency: "INR" }).safeParse({ ...card, nickname: "Card 1" }))).toEqual({ nickname: NO_DIGITS });
    expect(errors(cardFormSchema({ currency: "INR" }).safeParse({ ...card, issuer: "Bank 4321" }))).toEqual({ issuer: NO_DIGITS });
    expect(errors(cardEditFormSchema({ currency: "INR" }).safeParse({ ...card, cardId: CARD, nickname: "x9" }))).toEqual({ nickname: NO_DIGITS });
  });

  it("checks the limit and days", () => {
    expect(errors(cardFormSchema({ currency: "INR" }).safeParse({ ...card, limit: "0" }))).toHaveProperty("limit");
    expect(errors(cardFormSchema({ currency: "INR" }).safeParse({ ...card, statementDay: "32" }))).toEqual({ statementDay: "Enter the statement day, 1 to 31" });
    expect(errors(cardFormSchema({ currency: "INR" }).safeParse({ ...card, dueDay: "0" }))).toEqual({ dueDay: "Enter the due day, 1 to 31" });
  });
});

describe("statementFormSchema", () => {
  const schema = statementFormSchema({ today: TODAY, currency: "INR", card: { statementDay: 20, dueDay: 8 } });
  const statement = { cardId: CARD, statementDate: "2026-10-20", dueDate: "", total: "25,000", minimum: "1,250", emiIncluded: "5,000", idempotencyKey: KEY };

  it("defaults the due date from the card's due day", () => {
    const r = schema.safeParse(statement);
    expect(r.success && r.data).toEqual({
      cardId: CARD,
      statementDate: "2026-10-20",
      dueDate: "2026-11-08",
      totalMinor: 25_000_00,
      minimumMinor: 1_250_00,
      emiIncludedMinor: 5_000_00,
      differenceCategoryId: null,
      idempotencyKey: KEY,
    });
  });

  it("refuses a future statement, a due date before it and amounts above the total", () => {
    expect(errors(schema.safeParse({ ...statement, statementDate: "2026-10-29" }))).toHaveProperty("statementDate");
    expect(errors(schema.safeParse({ ...statement, dueDate: "2026-10-19" }))).toHaveProperty("dueDate");
    expect(errors(schema.safeParse({ ...statement, minimum: "30,000" }))).toHaveProperty("minimum");
    expect(errors(schema.safeParse({ ...statement, emiIncluded: "30,000" }))).toHaveProperty("emiIncluded");
  });

  it("carries the difference category", () => {
    const r = schema.safeParse({ ...statement, differenceCategoryId: CATEGORY });
    expect(r.success && r.data.differenceCategoryId).toBe(CATEGORY);
  });
});

describe("cardPaymentFormSchema", () => {
  const schema = (owedMinor: number) => cardPaymentFormSchema({ today: TODAY, currency: "INR", trackingStartedOn: "2026-10-01", owedMinor, accounts });
  const pay = { cardId: CARD, accountId: BANK, paidOn: "", amount: "5,000", idempotencyKey: KEY };

  it("pays up to what is owed, today by default", () => {
    const r = schema(8_000_00).safeParse(pay);
    expect(r.success && r.data).toMatchObject({ amountMinor: 5_000_00, paidOn: TODAY, allowShortfall: false });
  });

  it("asks for the missing purchase when paying more than is owed", () => {
    expect(errors(schema(4_000_00).safeParse(pay))).toEqual({ amount: "That's more than you owe on this card (₹4,000). Record the missing purchase first" });
  });

  it("warns of a shortfall until Pay anyway", () => {
    const short = schema(50_000_00).safeParse({ ...pay, amount: "12,000" });
    expect(errors(short)).toEqual({ accountId: "You need ₹2,000 more in HDFC Savings to pay this card" });
    expect(schema(50_000_00).safeParse({ ...pay, amount: "12,000", allowShortfall: "true" }).success).toBe(true);
  });

  it("refuses a date before the card was added", () => {
    expect(errors(schema(8_000_00).safeParse({ ...pay, paidOn: "2026-09-30" }))).toEqual({ paidOn: "Payments before you added the card aren't recorded" });
  });
});

describe("borrowingFormSchema", () => {
  const schema = borrowingFormSchema({ today: TODAY, currency: "INR", accounts });
  const base = { lender: "Ravi", amount: "20,000", received: "into_account", accountId: BANK, receivedOn: "2026-10-20", dueDate: "2026-12-31", idempotencyKey: KEY };

  it("records money received into an account, with a due date", () => {
    const r = schema.safeParse(base);
    expect(r.success && r.data).toEqual({ lender: "Ravi", amountMinor: 20_000_00, received: "into_account", accountId: BANK, receivedOn: "2026-10-20", dueDate: "2026-12-31", idempotencyKey: KEY });
  });

  it("records only what is owed when it was received earlier", () => {
    const r = schema.safeParse({ ...base, received: "earlier", accountId: "", receivedOn: "", dueDate: "" });
    expect(r.success && r.data).toMatchObject({ received: "earlier", accountId: null, receivedOn: null, dueDate: null });
  });

  it("refuses digits in who you owe and a due date before the money came", () => {
    expect(errors(schema.safeParse({ ...base, lender: "Ravi 98765" }))).toEqual({ lender: NO_DIGITS });
    expect(errors(schema.safeParse({ ...base, dueDate: "2026-10-19" }))).toHaveProperty("dueDate");
  });

  it("changes the due date to today or later, or removes it", () => {
    const s = borrowingDueDateFormSchema({ today: TODAY });
    expect(s.safeParse({ borrowingId: BORROWING, dueDate: "" }).success && s.parse({ borrowingId: BORROWING, dueDate: "" }).dueDate).toBeNull();
    expect(errors(s.safeParse({ borrowingId: BORROWING, dueDate: "2026-10-27" }))).toEqual({ dueDate: "Choose today or a later date" });
  });
});

describe("repaymentFormSchema", () => {
  const schema = repaymentFormSchema({ today: TODAY, currency: "INR", openedOn: "2026-10-20", owedMinor: 20_000_00, accounts });
  const pay = { borrowingId: BORROWING, accountId: BANK, paidOn: "", principal: "5,000", interest: "200", idempotencyKey: KEY };

  it("takes a part payment with interest", () => {
    const r = schema.safeParse(pay);
    expect(r.success && r.data).toMatchObject({ principalMinor: 5_000_00, interestMinor: 200_00, paidOn: TODAY });
  });

  it("refuses more than is owed, nothing at all and a date before the borrowing", () => {
    expect(errors(schema.safeParse({ ...pay, principal: "25,000" }))).toEqual({ principal: "That's more than you owe (₹20,000)" });
    expect(errors(schema.safeParse({ ...pay, principal: "", interest: "" }))).toEqual({ principal: "Enter what you paid" });
    expect(errors(schema.safeParse({ ...pay, paidOn: "2026-10-19" }))).toEqual({ paidOn: "That date is before you borrowed the money" });
  });
});
