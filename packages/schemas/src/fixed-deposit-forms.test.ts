import { describe, expect, it } from "vitest";
import { FD_BANKS, fixedDepositFormSchema } from "./fixed-deposit-forms";

const KEY = "e7000000-0000-4000-8000-000000000002";
const DEPOSIT = "f7000000-0000-4000-8000-000000000001";
const schema = fixedDepositFormSchema({ today: "2026-10-27" });
const input = {
  bank: "  State Bank   of India ",
  principal: "1,00,000",
  rate: "7.25",
  compounding: "",
  startDate: "2026-01-15",
  maturityDate: "2027-01-15",
  idempotencyKey: KEY,
};
const errorOf = (values: Record<string, string>) => {
  const r = schema.safeParse(values);
  return r.success ? null : r.error.issues.map((i) => [i.path.join("."), i.message]);
};

describe("fixedDepositFormSchema", () => {
  it("stores minor units, basis points and quarterly by default", () => {
    expect(schema.parse(input)).toEqual({
      depositId: null,
      bank: "State Bank of India",
      label: null,
      principalMinor: 10_000_000,
      rateBps: 725,
      compounding: "quarterly",
      startDate: "2026-01-15",
      maturityDate: "2027-01-15",
      idempotencyKey: KEY,
    });
  });

  it("edits in place without a request key; any bank name can be typed", () => {
    expect(schema.parse({ ...input, depositId: DEPOSIT, idempotencyKey: "", bank: "My Co-op Bank", compounding: "monthly" })).toMatchObject({
      depositId: DEPOSIT,
      bank: "My Co-op Bank",
      compounding: "monthly",
      idempotencyKey: null,
    });
  });

  it("keeps an optional label of up to 40 characters, spaces normalised", () => {
    expect(schema.parse({ ...input, label: "  Emergency   fund " }).label).toBe("Emergency fund");
    expect(schema.parse({ ...input, label: "   " }).label).toBeNull();
    expect(schema.parse({ ...input, label: "x".repeat(40) }).label).toHaveLength(40);
    expect(errorOf({ ...input, label: "x".repeat(41) })).toEqual([["label", "Keep it under 40 characters"]]);
  });

  it("accepts a 0% rate and the 25% limit", () => {
    expect(schema.parse({ ...input, rate: "0" }).rateBps).toBe(0);
    expect(schema.parse({ ...input, rate: "25" }).rateBps).toBe(2_500);
  });

  it("refuses what the database refuses", () => {
    expect(errorOf({ ...input, bank: "" })).toEqual([["bank", "Enter the bank"]]);
    expect(errorOf({ ...input, bank: "x".repeat(81) })).toEqual([["bank", "Keep it under 80 characters"]]);
    expect(errorOf({ ...input, principal: "0" })).toEqual([["principal", "Amount must be more than zero"]]);
    expect(errorOf({ ...input, rate: "25.01" })?.[0]?.[0]).toBe("rate");
    expect(errorOf({ ...input, rate: "7.255" })?.[0]?.[0]).toBe("rate");
    expect(errorOf({ ...input, compounding: "daily" })?.[0]?.[0]).toBe("compounding");
    expect(errorOf({ ...input, startDate: "2026-10-28" })).toEqual([["startDate", "The start date can't be in the future"]]);
    expect(errorOf({ ...input, maturityDate: "2026-01-15" })).toEqual([["maturityDate", "Maturity must be after the start date"]]);
    expect(errorOf({ ...input, maturityDate: "2036-01-16" })).toEqual([["maturityDate", "Maturity can be at most 10 years after the start"]]);
    expect(schema.parse({ ...input, maturityDate: "2036-01-15" }).maturityDate).toBe("2036-01-15");
    expect(errorOf({ ...input, idempotencyKey: "" })?.[0]?.[0]).toBe("idempotencyKey");
  });

  it("offers banks that take deposits, without duplicates", () => {
    expect(new Set(FD_BANKS).size).toBe(FD_BANKS.length);
    expect(FD_BANKS.some((b) => b.endsWith("Payments Bank"))).toBe(false);
    expect(FD_BANKS).toContain("State Bank of India");
  });
});
