import { describe, expect, it } from "vitest";
import {
  NO_DIGITS,
  PRODUCT_DIGITS,
  REASON_DIGITS,
  borrowingEditFormSchema,
  borrowingFormSchema,
  borrowingReturnPlanFormSchema,
  cardEditFormSchema,
  cardFormSchema,
  cardPaymentFormSchema,
  repaymentFormSchema,
  statementFormSchema,
} from "./card-forms";
import { CARD_ISSUERS, CARD_PRODUCTS, CARD_PRODUCTS_REVIEWED_ON } from "./card-data";
import { hasDigitRun } from "./digits";
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
      product: null,
      productOther: false,
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

  it("takes a listed product, or a typed one under Other", () => {
    const listed = cardFormSchema({ currency: "INR" }).safeParse({ ...card, product: "HDFC Regalia Gold" });
    expect(listed.success && [listed.data.product, listed.data.productOther]).toEqual(["HDFC Regalia Gold", false]);
    const other = cardFormSchema({ currency: "INR" }).safeParse({ ...card, product: " My   card ", productOther: "true" });
    expect(other.success && [other.data.product, other.data.productOther]).toEqual(["My card", true]);
    expect(errors(cardFormSchema({ currency: "INR" }).safeParse({ ...card, productOther: "true" }))).toEqual({ product: "Type the card's name" });
    expect(errors(cardFormSchema({ currency: "INR" }).safeParse({ ...card, product: "Card 123" }))).toEqual({ product: PRODUCT_DIGITS });
    expect(cardFormSchema({ currency: "INR" }).safeParse({ ...card, product: "6E Rewards XL" }).success).toBe(true);
  });

  it("checks the limit and days", () => {
    expect(errors(cardFormSchema({ currency: "INR" }).safeParse({ ...card, limit: "0" }))).toHaveProperty("limit");
    expect(errors(cardFormSchema({ currency: "INR" }).safeParse({ ...card, statementDay: "32" }))).toEqual({ statementDay: "Enter the statement day, 1 to 31" });
    expect(errors(cardFormSchema({ currency: "INR" }).safeParse({ ...card, dueDay: "0" }))).toEqual({ dueDay: "Enter the due day, 1 to 31" });
  });
});

describe("statementFormSchema", () => {
  const schema = statementFormSchema({ today: TODAY, currency: "INR", card: { dueDay: 8 } });
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
  const base = {
    lender: "Ravi",
    relationship: "friends",
    reason: " Bike  repair ",
    amount: "20,000",
    received: "into_account",
    accountId: BANK,
    receivedOn: "2026-10-20",
    sameAsBorrowed: "",
    amountToReturn: "22,000",
    returnOn: "2026-12-31",
    returnPlan: "instalments",
    instalments: "6",
    payFromAccountId: BANK,
    idempotencyKey: KEY,
  };

  it("records the details, the money received and a return plan", () => {
    const r = schema.safeParse(base);
    expect(r.success && r.data).toEqual({
      lender: "Ravi",
      relationship: "friends",
      reason: "Bike repair",
      amountMinor: 20_000_00,
      received: "into_account",
      accountId: BANK,
      receivedOn: "2026-10-20",
      amountToReturnMinor: 22_000_00,
      returnOn: "2026-12-31",
      returnPlan: "instalments",
      instalmentCount: 6,
      payFromAccountId: BANK,
      idempotencyKey: KEY,
    });
  });

  it("same as borrowed, received earlier, no return date: no plan", () => {
    const r = schema.safeParse({ ...base, sameAsBorrowed: "true", amountToReturn: "", received: "earlier", accountId: "", receivedOn: "", returnOn: "", returnPlan: "once" });
    expect(r.success && r.data).toMatchObject({
      received: "earlier",
      accountId: null,
      amountToReturnMinor: 20_000_00,
      returnOn: null,
      returnPlan: null,
      instalmentCount: null,
      payFromAccountId: null,
    });
  });

  it("asks how and from where only once a return date is entered", () => {
    expect(errors(schema.safeParse({ ...base, returnPlan: "" }))).toEqual({ returnPlan: "Choose how you will return it" });
    expect(errors(schema.safeParse({ ...base, payFromAccountId: "" }))).toEqual({ payFromAccountId: "Choose the account you will return it from" });
    expect(errors(schema.safeParse({ ...base, instalments: "1" }))).toEqual({ instalments: "Enter 2 to 60 instalments" });
    expect(errors(schema.safeParse({ ...base, instalments: "61" }))).toEqual({ instalments: "Enter 2 to 60 instalments" });
    const once = schema.safeParse({ ...base, returnPlan: "once" });
    expect(once.success && [once.data.returnPlan, once.data.instalmentCount]).toEqual(["once", null]);
  });

  it("refuses digits in who you owe, a long number in the reason, too little to return and an early return date", () => {
    expect(errors(schema.safeParse({ ...base, lender: "Ravi 98765" }))).toEqual({ lender: NO_DIGITS });
    expect(errors(schema.safeParse({ ...base, lender: `Ravi ${String.fromCodePoint(0x967)}` }))).toEqual({ lender: NO_DIGITS });
    expect(errors(schema.safeParse({ ...base, reason: "Rent 2027" }))).toEqual({ reason: REASON_DIGITS });
    expect(schema.safeParse({ ...base, reason: "A 3 day trip" }).success).toBe(true);
    expect(errors(schema.safeParse({ ...base, relationship: "" }))).toEqual({ relationship: "Choose family, friends or others" });
    expect(errors(schema.safeParse({ ...base, amountToReturn: "19,999" }))).toEqual({ amountToReturn: "Enter at least the amount borrowed (₹20,000)" });
    expect(errors(schema.safeParse({ ...base, returnOn: "2026-10-19" }))).toEqual({ returnOn: "The return date can't be before you borrowed the money" });
  });

  it("edits the details", () => {
    const r = borrowingEditFormSchema().safeParse({ borrowingId: BORROWING, lender: "Ravi K", relationship: "family", reason: "" });
    expect(r.success && r.data).toEqual({ borrowingId: BORROWING, lender: "Ravi K", relationship: "family", reason: null });
  });

  it("changes the plan: a new date today or later, the current one may stay; empty removes it", () => {
    const s = borrowingReturnPlanFormSchema({ today: TODAY, currency: "INR", borrowedMinor: 20_000_00, currentReturnOn: "2026-10-01", accounts });
    const plan = { borrowingId: BORROWING, sameAsBorrowed: "true", amountToReturn: "", returnOn: "2026-10-27", returnPlan: "once", instalments: "", payFromAccountId: BANK };
    expect(errors(s.safeParse(plan))).toEqual({ returnOn: "Choose today or a later date" });
    expect(s.safeParse({ ...plan, returnOn: "2026-10-01" }).success).toBe(true);
    const removed = s.safeParse({ ...plan, returnOn: "" });
    expect(removed.success && [removed.data.returnOn, removed.data.payFromAccountId, removed.data.amountToReturnMinor]).toEqual([null, null, 20_000_00]);
  });
});

describe("card-data", () => {
  it("lists each issuer's products with the issuer's name in them, no run of 3 digits and no duplicates", () => {
    const brand: Record<string, string> = { "HDFC Bank": "HDFC", "SBI Card": "SBI", "ICICI Bank": "ICICI", "Axis Bank": "Axis", "Kotak Mahindra Bank": "Kotak", "Punjab National Bank": "PNB" };
    // Issuers listed by name only until the next list refresh (their cards are typed under "Other").
    const nameOnly = new Set(["Punjab National Bank"]);
    for (const issuer of CARD_ISSUERS) {
      const products = CARD_PRODUCTS[issuer];
      expect(products.length > 0 || nameOnly.has(issuer)).toBe(true);
      expect(new Set(products).size).toBe(products.length);
      for (const p of products) {
        expect(p).toContain(brand[issuer]);
        expect(hasDigitRun(p, 3)).toBe(false);
        expect(p.length).toBeLessThanOrEqual(80);
        expect(p).toBe(p.trim().replace(/\s+/g, " "));
      }
      expect(hasDigitRun(issuer)).toBe(false);
    }
    expect(CARD_PRODUCTS_REVIEWED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
