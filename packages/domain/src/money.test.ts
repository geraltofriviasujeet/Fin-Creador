import { describe, expect, it } from "vitest";
import { addMinor, currencyMinorDigits, MAX_AMOUNT_MINOR, minorToInputString, parseAmount } from "./money";

describe("parseAmount (no floating point)", () => {
  it.each([
    ["1,28,000", "INR", 12_800_000],
    ["1,28,000.50", "INR", 12_800_050],
    ["₹ 2500", "INR", 250_000],
    ["0.1", "INR", 10],
    [".05", "INR", 5],
    ["0.29", "INR", 29], // 0.29 * 100 is 28.999… in floating point
    ["1234", "JPY", 1234],
    ["1.234", "KWD", 1234],
    ["100000000000", "INR", MAX_AMOUNT_MINOR],
  ])("%s %s → %i minor units", (input, currency, expected) => {
    expect(parseAmount(input, currency)).toEqual({ ok: true, minor: expected });
  });

  it.each([
    ["", "INR", "empty"],
    ["   ", "INR", "empty"],
    ["abc", "INR", "invalid"],
    ["1.2.3", "INR", "invalid"],
    ["-", "INR", "invalid"],
    ["1.234", "INR", "too_many_decimals"],
    ["1.5", "JPY", "too_many_decimals"],
    ["0", "INR", "zero"],
    ["0.00", "INR", "zero"],
    ["-5", "INR", "negative"],
    ["100000000000.01", "INR", "too_large"],
  ])("%s %s → %s", (input, currency, error) => {
    expect(parseAmount(input, currency)).toEqual({ ok: false, error });
  });

  it("allows negative and zero only when asked (bank opening balance)", () => {
    expect(parseAmount("-2,500.50", "INR", { allowNegative: true })).toEqual({ ok: true, minor: -250_050 });
    expect(parseAmount("0", "INR", { allowZero: true })).toEqual({ ok: true, minor: 0 });
  });
});

describe("money helpers", () => {
  it("knows minor-unit digits per currency", () => {
    expect(["INR", "USD", "JPY", "KWD"].map(currencyMinorDigits)).toEqual([2, 2, 0, 3]);
  });

  it("adds exactly and refuses unsafe sums", () => {
    expect(addMinor(10, 20, -5)).toBe(25);
    expect(addMinor()).toBe(0);
    expect(() => addMinor(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
    expect(() => addMinor(1.5)).toThrow(RangeError);
  });

  it("turns minor units back into an editable value", () => {
    expect(minorToInputString(12_800_000, "INR")).toBe("128000");
    expect(minorToInputString(12_800_050, "INR")).toBe("128000.50");
    expect(minorToInputString(-250_000, "INR")).toBe("-2500");
  });
});
