import { emi, simpleInterestMinor } from "@fin-creador/domain";
import { describe, expect, it } from "vitest";
import { LENDERS, loanEditFormSchema, loanFormSchema, payDueFormSchema, planDueFormSchema } from "./loan-forms";

const KEY = "e8000000-0000-4000-8000-000000000001";
const LOAN = "f8000000-0000-4000-8000-000000000001";
const DUE = "f8000000-0000-4000-8000-000000000002";
const BANK = "a8000000-0000-4000-8000-000000000001";
const CASH = "a8000000-0000-4000-8000-000000000002";
const TODAY = "2026-10-27";
const schema = loanFormSchema({ today: TODAY, currency: "INR" });

const ongoing = {
  loanType: "home",
  lender: "  State Bank   of India ",
  sanctioned: "30,00,000",
  disbursed: "30,00,000",
  rate: "8.75",
  rateKind: "floating",
  tenureMonths: "240",
  startMode: "ongoing",
  outstanding: "25,00,000",
  remainingMonths: "180",
  nextDueDate: "2026-11-05",
  thisMonthPaid: "paid",
  idempotencyKey: KEY,
};

const errorOf = (s: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }, values: unknown) => {
  const r = s.safeParse(values);
  return r.success ? null : r.error!.issues.map((i) => [i.path.join("."), i.message]);
};

describe("loanFormSchema: ongoing", () => {
  it("stores minor units and basis points, estimates the EMI, records this month's paid EMI as before tracking", () => {
    const out = schema.parse(ongoing);
    const expected = emi({ principalMinor: 25_00_000_00, annualRateBps: 875, months: 180 }).emiMinor;
    expect(out).toEqual({
      loanType: "home",
      typeOther: null,
      lender: "State Bank of India",
      nickname: null,
      sanctionedMinor: 30_00_000_00,
      disbursedMinor: 30_00_000_00,
      rateBps: 875,
      rateKind: "floating",
      tenureMonths: 240,
      startMode: "ongoing",
      outstandingMinor: 25_00_000_00,
      remainingMonths: 180,
      firstDueDate: "2026-11-05",
      beforeTrackingOn: "2026-10-05",
      moratoriumMonths: 0,
      moratoriumInterest: null,
      capitalisedMinor: 0,
      moratoriumMonthlyInterestMinor: 0,
      emiEstimateMinor: expected,
      emiMinor: expected,
      idempotencyKey: KEY,
    });
  });

  it("takes the bank's EMI over the estimate", () => {
    expect(schema.parse({ ...ongoing, emi: "25,000" }).emiMinor).toBe(25_000_00);
  });

  it("still due: this month's EMI is pending, even when its date has passed", () => {
    const out = schema.parse({ ...ongoing, thisMonthPaid: "due", nextDueDate: "2026-10-05" });
    expect(out.firstDueDate).toBe("2026-10-05");
    expect(out.beforeTrackingOn).toBeNull();
    expect(errorOf(schema, { ...ongoing, thisMonthPaid: "due", nextDueDate: "2026-11-05" })).toEqual([["nextDueDate", "Enter this month's EMI date"]]);
  });

  it("checks the amounts against each other", () => {
    expect(errorOf(schema, { ...ongoing, disbursed: "31,00,000" })).toEqual([["disbursed", "The amount taken can't be more than the sanctioned amount"]]);
    expect(errorOf(schema, { ...ongoing, outstanding: "31,00,000", sanctioned: "40,00,000" })?.[0]?.[0]).toBe("outstanding");
    expect(errorOf(schema, { ...ongoing, remainingMonths: "241" })?.[0]?.[0]).toBe("remainingMonths");
    expect(errorOf(schema, { ...ongoing, nextDueDate: "2026-10-27" })?.[0]?.[0]).toBe("nextDueDate"); // paid: next is after today
    expect(errorOf(schema, { ...ongoing, thisMonthPaid: "" })?.[0]?.[0]).toBe("thisMonthPaid");
  });

  it("refuses an EMI below a month's interest", () => {
    expect(errorOf(schema, { ...ongoing, emi: "18,000" })?.[0]).toEqual(["emi", expect.stringContaining("at least")]);
  });

  it("reads the rate as text without floats", () => {
    expect(schema.parse({ ...ongoing, rate: "8.5%" }).rateBps).toBe(850);
    expect(schema.parse({ ...ongoing, rate: "0" }).rateBps).toBe(0);
    expect(errorOf(schema, { ...ongoing, rate: "8.555" })?.[0]?.[0]).toBe("rate");
    expect(errorOf(schema, { ...ongoing, rate: "abc" })?.[0]?.[0]).toBe("rate");
  });
});

describe("loanFormSchema: starts later", () => {
  const later = {
    loanType: "education",
    lender: "Avanse Financial Services",
    sanctioned: "10,00,000",
    disbursed: "5,00,000",
    rate: "10",
    tenureMonths: "60",
    startMode: "starts_later",
    firstEmiDate: "2027-10-27",
    moratoriumMonths: "12",
    moratoriumInterest: "capitalise",
    idempotencyKey: KEY,
  };

  it("capitalises simple moratorium interest into the EMI", () => {
    const out = schema.parse(later);
    const cap = simpleInterestMinor(5_00_000_00, 1_000, 12);
    expect(out).toMatchObject({
      startMode: "starts_later",
      outstandingMinor: 5_00_000_00,
      remainingMonths: 60,
      firstDueDate: "2027-10-27",
      beforeTrackingOn: null,
      moratoriumMonths: 12,
      moratoriumInterest: "capitalise",
      capitalisedMinor: cap,
      emiMinor: emi({ principalMinor: 5_00_000_00 + cap, annualRateBps: 1_000, months: 60 }).emiMinor,
    });
  });

  it("interest paid monthly: an interest-only amount each moratorium month", () => {
    expect(schema.parse({ ...later, moratoriumInterest: "pay_monthly" })).toMatchObject({ capitalisedMinor: 0, moratoriumMonthlyInterestMinor: 416_667 });
  });

  it("needs a future first EMI and, with a moratorium, the interest rule", () => {
    expect(errorOf(schema, { ...later, firstEmiDate: TODAY })?.[0]?.[0]).toBe("firstEmiDate");
    expect(errorOf(schema, { ...later, moratoriumInterest: "" })?.[0]?.[0]).toBe("moratoriumInterest");
    expect(schema.parse({ ...later, moratoriumMonths: "", moratoriumInterest: "" })).toMatchObject({ moratoriumMonths: 0, moratoriumInterest: null });
  });
});

describe("loanFormSchema: names", () => {
  it("credit card EMI: issuer and nickname, never card digits; a 0% no-cost EMI", () => {
    const card = {
      ...ongoing,
      loanType: "credit_card_emi",
      lender: "HDFC Bank",
      nickname: "HDFC Regalia",
      sanctioned: "60,000",
      disbursed: "60,000",
      outstanding: "60,000",
      rate: "0",
      tenureMonths: "6",
      remainingMonths: "6",
    };
    expect(schema.parse(card)).toMatchObject({ nickname: "HDFC Regalia", rateBps: 0, emiMinor: 10_000_00 });
    expect(errorOf(schema, { ...card, nickname: "Card 4111 1111" })).toEqual([["nickname", "Leave out card and account numbers"]]);
    expect(errorOf(schema, { ...card, lender: "" })).toEqual([["lender", "Enter the card issuer"]]);
  });

  it("other needs a description", () => {
    expect(errorOf(schema, { ...ongoing, loanType: "other" })).toEqual([["typeOther", "Say what kind of loan it is"]]);
    expect(schema.parse({ ...ongoing, loanType: "other", typeOther: " Family  loan " }).typeOther).toBe("Family loan");
    expect(schema.parse({ ...ongoing, typeOther: "ignored" }).typeOther).toBeNull();
  });

  it("lists lenders without duplicates", () => {
    expect(new Set(LENDERS).size).toBe(LENDERS.length);
    expect(LENDERS).toContain("Bajaj Finance");
    expect(LENDERS).not.toContain("Paytm Payments Bank");
  });
});

describe("loanEditFormSchema", () => {
  const edit = loanEditFormSchema({ currency: "INR", loan: { disbursedMinor: 30_00_000_00, outstandingMinor: 25_00_000_00, pendingEmis: 180 } });
  const values = { loanId: LOAN, loanType: "home", lender: "SBI", sanctioned: "30,00,000", rate: "9", rateKind: "floating", emi: "26,000" };

  it("edits names, rate and EMI", () => {
    expect(edit.parse(values)).toMatchObject({ loanId: LOAN, rateBps: 900, emiMinor: 26_000_00, sanctionedMinor: 30_00_000_00 });
    expect(errorOf(edit, { ...values, sanctioned: "29,00,000" })?.[0]?.[0]).toBe("sanctioned");
    expect(errorOf(edit, { ...values, emi: "15,000" })?.[0]?.[0]).toBe("emi");
  });
});

describe("payDueFormSchema", () => {
  const accounts = [
    { id: BANK, name: "HDFC Savings", currency: "INR", balanceMinor: 50_000_00, openingBalanceDate: "2026-01-01" },
    { id: CASH, name: "Cash in hand", currency: "INR", balanceMinor: 2_000_00, openingBalanceDate: "2026-10-20" },
  ];
  const pay = payDueFormSchema({ today: TODAY, currency: "INR", trackingStartedOn: "2026-10-15", outstandingMinor: 25_00_000_00, accounts });
  const values = { dueItemId: DUE, accountId: BANK, paidOn: "", principal: "5,000", interest: "18,229.17", fees: "", idempotencyKey: KEY };

  it("defaults the date to today and totals the parts", () => {
    expect(pay.parse(values)).toEqual({
      dueItemId: DUE,
      accountId: BANK,
      paidOn: TODAY,
      principalMinor: 5_000_00,
      interestMinor: 18_229_17,
      feesMinor: 0,
      totalMinor: 23_229_17,
      allowShortfall: false,
      idempotencyKey: KEY,
    });
  });

  it("warns when the account can't cover it, saying how much more is needed; Pay anyway goes through", () => {
    expect(errorOf(pay, { ...values, accountId: CASH })).toEqual([["accountId", "You need ₹21,229.17 more in Cash in hand to pay this EMI"]]);
    expect(pay.parse({ ...values, accountId: CASH, allowShortfall: "true" })).toMatchObject({ accountId: CASH, totalMinor: 23_229_17, allowShortfall: true });
    expect(pay.parse({ ...values, principal: "26,770.83" }).totalMinor).toBe(45_000_00); // within the bank balance
  });

  it("checks the date and the parts", () => {
    expect(errorOf(pay, { ...values, paidOn: "2026-10-28" })?.[0]?.[0]).toBe("paidOn");
    expect(errorOf(pay, { ...values, paidOn: "2026-10-14" })).toEqual([["paidOn", "Payments before the loan was added aren't recorded"]]);
    expect(errorOf(pay, { ...values, accountId: CASH, paidOn: "2026-10-19", principal: "1" , interest: "" })?.[0]?.[0]).toBe("paidOn");
    expect(errorOf(pay, { ...values, principal: "", interest: "" })).toEqual([["principal", "Enter what you paid"]]);
    expect(errorOf(pay, { ...values, principal: "-5" })?.[0]?.[0]).toBe("principal");
    expect(errorOf(pay, { ...values, accountId: "" })?.[0]?.[0]).toBe("accountId");
    expect(pay.parse({ ...values, fees: "1,179" }).feesMinor).toBe(1_179_00); // processing fee + GST on the first payment
  });
});

describe("planDueFormSchema", () => {
  const plan = planDueFormSchema({
    today: TODAY,
    currency: "INR",
    accounts: [{ id: BANK, name: "HDFC Savings", currency: "INR", balanceMinor: 0, openingBalanceDate: "2026-01-01" }],
  });

  it("stores a planned date and account; the balance is not checked yet", () => {
    expect(plan.parse({ dueItemId: DUE, accountId: BANK, plannedOn: "2026-11-01" })).toEqual({ dueItemId: DUE, accountId: BANK, plannedOn: "2026-11-01" });
    expect(errorOf(plan, { dueItemId: DUE, accountId: BANK, plannedOn: "2026-10-26" })?.[0]?.[0]).toBe("plannedOn");
  });
});
