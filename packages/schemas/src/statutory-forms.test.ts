import { describe, expect, it } from "vitest";
import { hasDigitRun } from "./digits";
import { firstFieldErrors } from "./form-errors";
import { INDIAN_CITIES, INDIAN_STATES } from "./goal-data";
import { STATUTORY_DIGITS, statutoryDueEditFormSchema, statutoryDueFormSchema, statutoryDueName } from "./statutory-forms";

const KEY = "e8000000-0000-4000-8000-0000000000d1";
const DUE = "f8000000-0000-4000-8000-0000000000d1";
const BANK = "a8000000-0000-4000-8000-0000000000d1";
const accounts = [{ id: BANK, name: "HDFC Savings", currency: "INR", balanceMinor: 10_000_00, openingBalanceDate: "2026-01-01" }];
const schema = statutoryDueFormSchema({ currency: "INR", accounts });
const base = {
  dueType: "fine",
  amount: "1,000",
  dueDate: "2026-10-20",
  description: "",
  vehicleKind: "two_wheeler",
  issuedState: "Karnataka",
  issuedCity: "Bengaluru",
  payFromAccountId: "",
  idempotencyKey: KEY,
};

function errors(result: { success: boolean; error?: unknown }) {
  return result.success ? {} : firstFieldErrors(result.error as Parameters<typeof firstFieldErrors>[0]);
}

describe("statutoryDueFormSchema", () => {
  it("takes a fine with vehicle kind and where it was issued; a past due date is fine", () => {
    const r = schema.safeParse(base);
    expect(r.success && r.data).toEqual({
      dueType: "fine",
      amountMinor: 1_000_00,
      dueDate: "2026-10-20",
      description: null,
      vehicleKind: "two_wheeler",
      issuedState: "Karnataka",
      issuedCity: "Bengaluru",
      payFromAccountId: null,
      idempotencyKey: KEY,
    });
  });

  it("keeps fine details only on a fine, and the paying account when chosen", () => {
    const r = schema.safeParse({ ...base, dueType: "income_tax", description: "Advance  tax", payFromAccountId: BANK });
    expect(r.success && r.data).toMatchObject({ description: "Advance tax", vehicleKind: null, issuedState: null, issuedCity: null, payFromAccountId: BANK });
  });

  it("refuses a missing due date, an unnamed other due, numbers, unlisted places and other currencies", () => {
    expect(errors(schema.safeParse({ ...base, dueDate: "" }))).toEqual({ dueDate: "Enter the due date" });
    expect(errors(schema.safeParse({ ...base, dueType: "other_statutory" }))).toEqual({ description: "Say what it is, e.g. Property tax" });
    expect(errors(schema.safeParse({ ...base, description: "Challan 1234" }))).toEqual({ description: STATUTORY_DIGITS });
    expect(errors(schema.safeParse({ ...base, description: `Challan 1${String.fromCodePoint(0x968, 0xff13, 0x664)}` }))).toEqual({ description: STATUTORY_DIGITS });
    expect(schema.safeParse({ ...base, description: "Q4 of 202" }).success).toBe(true);
    expect(errors(schema.safeParse({ ...base, issuedState: "KA 01" }))).toEqual({ issuedState: "Choose a state or union territory from the list" });
    expect(errors(schema.safeParse({ ...base, issuedCity: "Gotham" }))).toEqual({ issuedCity: "Choose a city from the list" });
    expect(errors(schema.safeParse({ ...base, vehicleKind: "truck" }))).toEqual({ vehicleKind: "Choose two-wheeler, four-wheeler or other" });
    expect(errors(schema.safeParse({ ...base, dueType: "parking" }))).toEqual({ dueType: "Choose what it is" });
    expect(errors(schema.safeParse({ ...base, amount: "0" }))).toHaveProperty("amount");
    expect(errors(schema.safeParse({ ...base, payFromAccountId: "a8000000-0000-4000-8000-0000000000ff" }))).toEqual({ payFromAccountId: "Choose a bank, cash or other account" });
  });

  it("an edit keeps the amount at or above what is paid", () => {
    const edit = statutoryDueEditFormSchema({ currency: "INR", accounts, dueType: "income_tax", paidMinor: 600_00 });
    const v = { ...base, statutoryDueId: DUE, dueType: undefined };
    expect(errors(edit.safeParse({ ...v, amount: "599.99" }))).toEqual({ amount: "Enter at least what is already paid (₹600)" });
    const ok = edit.safeParse({ ...v, amount: "600" });
    expect(ok.success && [ok.data.amountMinor, ok.data.issuedCity]).toEqual([600_00, null]);
  });
});

describe("statutoryDueName", () => {
  it("names a due without numbers", () => {
    expect(statutoryDueName({ dueType: "income_tax", description: "Advance tax" })).toBe("Income tax · Advance tax");
    expect(statutoryDueName({ dueType: "fine", description: null, issuedCity: "Bengaluru" })).toBe("Fine · Bengaluru");
    expect(statutoryDueName({ dueType: "fine", description: null })).toBe("Fine");
    expect(statutoryDueName({ dueType: "other_statutory", description: "Property tax" })).toBe("Property tax");
  });
});

describe("the state and city lists", () => {
  it("every state and city passes the no-digit rule (the database refuses any digit in them)", () => {
    for (const name of [...INDIAN_STATES, ...INDIAN_CITIES]) {
      expect(hasDigitRun(name)).toBe(false);
      expect(name.length).toBeLessThanOrEqual(80);
      expect(name).toBe(name.trim().replace(/\s+/g, " "));
    }
  });
});
