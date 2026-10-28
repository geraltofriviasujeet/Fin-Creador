import { describe, expect, it } from "vitest";
import { NO_DIGITS, PRODUCT_DIGITS, REASON_DIGITS, borrowingEditFormSchema, borrowingFormSchema, cardEditFormSchema, cardFormSchema } from "./card-forms";
import { loanFormSchema } from "./loan-forms";
import { firstFieldErrors } from "./form-errors";

// QA: digits in any script are refused where names must not hold card or account numbers.
// One sample per script and a mix; each is built from code points, not typed, so the file shows what is tested.
const ONE: [string, string][] = [
  ["ASCII", "7"],
  ["full-width", String.fromCodePoint(0xff11)],
  ["Devanagari", String.fromCodePoint(0x96a)],
  ["Arabic-Indic", String.fromCodePoint(0x663)],
  ["extended Arabic-Indic", String.fromCodePoint(0x6f5)],
  ["mathematical bold", String.fromCodePoint(0x1d7ce)],
  ["superscript two", String.fromCodePoint(0xb2)],
  ["subscript four", String.fromCodePoint(0x2084)],
];
const MIXED4 = "1" + String.fromCodePoint(0x967) + String.fromCodePoint(0xff13) + String.fromCodePoint(0x664);
const MIXED3 = "1" + String.fromCodePoint(0x967) + String.fromCodePoint(0xff13);

const KEY = "e8000000-0000-4000-8000-0000000000c1";
const ID = "f8000000-0000-4000-8000-0000000000c2";
const BANK = "a8000000-0000-4000-8000-0000000000c3";
const accounts = [{ id: BANK, name: "Savings", currency: "INR", balanceMinor: 10_000_00, openingBalanceDate: "2026-01-01" }];

type Parsed = { success: boolean; error?: unknown };
const errors = (r: Parsed) => (r.success ? {} : firstFieldErrors(r.error as Parameters<typeof firstFieldErrors>[0]));

const card = { issuer: "HDFC Bank", product: "", productOther: "", nickname: "", limit: "2,00,000", statementDay: "20", dueDay: "8", openingOwed: "0", idempotencyKey: KEY };
const cardSchema = cardFormSchema({ currency: "INR" });

describe("cards: digits in any script", () => {
  it.each(ONE)("issuer and nickname refuse a single %s digit", (_n, d) => {
    expect(errors(cardSchema.safeParse({ ...card, issuer: `Bank ${d}` }))).toEqual({ issuer: NO_DIGITS });
    expect(errors(cardSchema.safeParse({ ...card, nickname: `Mine ${d}` }))).toEqual({ nickname: NO_DIGITS });
    expect(errors(cardEditFormSchema({ currency: "INR" }).safeParse({ ...card, cardId: ID, nickname: `Mine ${d}` }))).toEqual({ nickname: NO_DIGITS });
  });

  it.each(ONE)("product allows two but refuses three %s digits", (_n, d) => {
    expect(cardSchema.safeParse({ ...card, product: `Card ${d}${d}`, productOther: "true" }).success).toBe(true);
    expect(errors(cardSchema.safeParse({ ...card, product: `Card ${d}${d}${d}`, productOther: "true" }))).toEqual({ product: PRODUCT_DIGITS });
  });

  it("mixed-script runs count as one run", () => {
    expect(errors(cardSchema.safeParse({ ...card, product: `Card ${MIXED3}`, productOther: "true" }))).toEqual({ product: PRODUCT_DIGITS });
    expect(errors(cardSchema.safeParse({ ...card, product: `Card ${MIXED4}` }))).toEqual({ product: PRODUCT_DIGITS });
    expect(cardSchema.safeParse({ ...card, product: `6E ${MIXED3.slice(0, 2)} Rewards`, productOther: "true" }).success).toBe(true);
  });

  it("a digit split by letters is not a run", () => {
    expect(cardSchema.safeParse({ ...card, product: "A1 B2 C3", productOther: "true" }).success).toBe(true);
  });
});

describe("borrowings: digits in any script", () => {
  const schema = borrowingFormSchema({ today: "2026-10-28", currency: "INR", accounts });
  const base = {
    lender: "Ravi", relationship: "friends", reason: "", amount: "20,000", received: "into_account", accountId: BANK, receivedOn: "2026-10-20",
    sameAsBorrowed: "true", amountToReturn: "", returnOn: "", returnPlan: "", instalments: "", payFromAccountId: "", idempotencyKey: KEY,
  };

  it.each(ONE)("who you owe refuses a single %s digit; the reason allows three and refuses four", (_n, d) => {
    expect(errors(schema.safeParse({ ...base, lender: `Ravi ${d}` }))).toEqual({ lender: NO_DIGITS });
    expect(schema.safeParse({ ...base, reason: `Trip ${d}${d}${d}` }).success).toBe(true);
    expect(errors(schema.safeParse({ ...base, reason: `Trip ${d}${d}${d}${d}` }))).toEqual({ reason: REASON_DIGITS });
    expect(errors(borrowingEditFormSchema().safeParse({ borrowingId: ID, lender: `Ravi ${d}`, relationship: "friends", reason: "" }))).toEqual({ lender: NO_DIGITS });
    expect(errors(borrowingEditFormSchema().safeParse({ borrowingId: ID, lender: "Ravi", relationship: "friends", reason: `Trip ${d}${d}${d}${d}` }))).toEqual({ reason: REASON_DIGITS });
  });

  it("a mixed-script run of four in the reason is refused, three is allowed", () => {
    expect(errors(schema.safeParse({ ...base, reason: `Rent ${MIXED4}` }))).toEqual({ reason: REASON_DIGITS });
    expect(schema.safeParse({ ...base, reason: `Rent ${MIXED3}` }).success).toBe(true);
  });
});

describe("loans: lender and nickname refuse a run of four digits in any script", () => {
  const schema = loanFormSchema({ today: "2026-10-27", currency: "INR" });
  const loan = {
    loanType: "home", lender: "State Bank", nickname: "", sanctioned: "30,00,000", disbursed: "30,00,000", rate: "8.75", rateKind: "floating",
    tenureMonths: "240", startMode: "ongoing", outstanding: "25,00,000", remainingMonths: "180", nextDueDate: "2026-11-05", thisMonthPaid: "paid", idempotencyKey: KEY,
  };
  const fields = (r: Parsed) => Object.keys(errors(r));

  it.each(ONE)("%s digits", (_n, d) => {
    expect(schema.safeParse({ ...loan, lender: `Bank ${d}${d}${d}` }).success).toBe(true);
    expect(fields(schema.safeParse({ ...loan, lender: `Bank ${d}${d}${d}${d}` }))).toEqual(["lender"]);
    expect(schema.safeParse({ ...loan, nickname: `Plan ${d}${d}${d}` }).success).toBe(true);
    expect(fields(schema.safeParse({ ...loan, nickname: `Plan ${d}${d}${d}${d}` }))).toEqual(["nickname"]);
  });

  it("mixed-script runs", () => {
    expect(fields(schema.safeParse({ ...loan, lender: `Bank ${MIXED4}` }))).toEqual(["lender"]);
    expect(fields(schema.safeParse({ ...loan, nickname: `Plan ${MIXED4}` }))).toEqual(["nickname"]);
    expect(schema.safeParse({ ...loan, lender: `Bank ${MIXED3}` }).success).toBe(true);
  });
});
