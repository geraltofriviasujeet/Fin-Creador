import { describe, expect, it } from "vitest";
import { firstFieldErrors } from "./form-errors";
import { accountFormSchema, incomeFormSchema, INDIAN_BANKS, OTHER_BANK, sourceFormSchema, voidFormSchema } from "./money-forms";

const today = "2026-10-22";
const errorsOf = (r: { success: boolean; error?: unknown }) =>
  r.success ? {} : firstFieldErrors(r.error as Parameters<typeof firstFieldErrors>[0]);

describe("accountFormSchema", () => {
  const schema = accountFormSchema({ today });
  const bank = {
    kind: "bank",
    bankType: "savings",
    bankName: "HDFC Bank",
    last4: "4821",
    currency: "INR",
    openingBalance: "2,48,600",
    openingBalanceDate: "2026-10-01",
  };

  it("normalizes a bank account (name from the bank, minor units)", () => {
    expect(schema.parse(bank)).toEqual({
      kind: "bank",
      bankType: "savings",
      name: "HDFC Bank",
      institution: "HDFC Bank",
      last4: "4821",
      currency: "INR",
      openingBalanceMinor: 24_860_000,
      openingBalanceDate: "2026-10-01",
    });
  });

  it("accepts an 'Other bank' name and an overdrawn opening balance", () => {
    const out = schema.parse({ ...bank, bankName: OTHER_BANK, otherBankName: " Saraswat Bank ", openingBalance: "-2500" });
    expect(out).toMatchObject({ name: "Saraswat Bank", openingBalanceMinor: -250_000 });
  });

  it.each([
    [{ bankName: "" }, "bankName", "Select your bank"],
    [{ bankName: OTHER_BANK, otherBankName: "" }, "otherBankName", "Enter the bank's name"],
    [{ bankType: "" }, "bankType", "Choose savings or current"],
    [{ last4: "12a4" }, "last4", "Enter exactly 4 digits"],
    [{ openingBalance: "12.345" }, "openingBalance", "Too many decimal places for this currency"],
    [{ openingBalanceDate: "2026-10-23" }, "openingBalanceDate", "The as-of date can't be in the future"],
    [{ openingBalanceDate: "2026-02-30" }, "openingBalanceDate", "Enter a valid date"],
  ])("rejects %j", (patch, field, message) => {
    expect(errorsOf(schema.safeParse({ ...bank, ...patch }))[field]).toBe(message);
  });

  it("cash: name required, never negative, no institution, blank balance is zero", () => {
    const cash = { kind: "cash", name: "Cash in hand", institution: "ignored", currency: "INR", openingBalance: "", openingBalanceDate: today };
    expect(schema.parse(cash)).toMatchObject({ name: "Cash in hand", institution: null, bankType: null, openingBalanceMinor: 0 });
    expect(errorsOf(schema.safeParse({ ...cash, openingBalance: "-1" })).openingBalance).toBe("Only bank accounts can start below zero");
    expect(errorsOf(schema.safeParse({ ...cash, name: " " })).name).toBe("Enter a name");
  });

  it("other accounts keep an optional institution", () => {
    expect(
      schema.parse({ kind: "other", name: "Paytm wallet", institution: "Paytm", currency: "INR", openingBalance: "120", openingBalanceDate: today }),
    ).toMatchObject({ institution: "Paytm", openingBalanceMinor: 12_000 });
  });
});

describe("incomeFormSchema", () => {
  const schema = incomeFormSchema({ today, currency: "INR" });
  const valid = {
    amount: "1,28,000",
    sourceId: "c0000000-0000-4000-8000-000000000001",
    accountId: "a0000000-0000-4000-8000-000000000001",
    occurredOn: today,
    note: "  October salary ",
    idempotencyKey: "e0000000-0000-4000-8000-000000000001",
  };

  it("normalizes income", () => {
    expect(schema.parse(valid)).toEqual({
      amountMinor: 12_800_000,
      sourceId: valid.sourceId,
      accountId: valid.accountId,
      occurredOn: today,
      note: "October salary",
      idempotencyKey: valid.idempotencyKey,
    });
    expect(schema.parse({ ...valid, note: "" }).note).toBeNull();
  });

  it.each([
    [{ amount: "" }, "amount", "Enter an amount"],
    [{ amount: "0" }, "amount", "Amount must be more than zero"],
    [{ amount: "-5" }, "amount", "Amount can't be negative"],
    [{ sourceId: "" }, "sourceId", "Choose a source"],
    [{ accountId: "x" }, "accountId", "Choose where it was received"],
    [{ occurredOn: "2026-10-23" }, "occurredOn", "The date can't be in the future"],
    [{ note: "x".repeat(281) }, "note", "Keep the note under 280 characters"],
  ])("rejects %j", (patch, field, message) => {
    expect(errorsOf(schema.safeParse({ ...valid, ...patch }))[field]).toBe(message);
  });
});

describe("sourceFormSchema and voidFormSchema", () => {
  it("normalizes a source", () => {
    expect(sourceFormSchema.parse({ name: " Shop rent ", sourceType: "rent", defaultAccountId: "" })).toEqual({
      name: "Shop rent",
      sourceType: "rent",
      defaultAccountId: null,
    });
    expect(errorsOf(sourceFormSchema.safeParse({ name: "", sourceType: "x" }))).toMatchObject({
      name: "Enter a name",
      sourceType: "Choose a type",
    });
  });

  it("normalizes a void request", () => {
    expect(voidFormSchema.parse({ transactionId: "e0000000-0000-4000-8000-000000000001", idempotencyKey: "e0000000-0000-4000-8000-000000000002", reason: " " }).reason).toBeNull();
  });

  it("has a bank list without duplicates", () => {
    expect(new Set(INDIAN_BANKS).size).toBe(INDIAN_BANKS.length);
  });
});
