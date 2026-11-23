// Regression test for the iPhone crash "undefined is not a function" at
// Intl.NumberFormat#formatToParts: Hermes on iOS has no formatToParts. AmountInput renders
// amountInputState(); AmountText renders formatAmount(). Both must work without it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shortDateInZone } from "../../lib/income-format";
import { amountInputState, currencySymbol, formatAmount } from "./logic";

type Proto = { formatToParts?: unknown };
const numberProto = Intl.NumberFormat.prototype as Proto;
const dateProto = Intl.DateTimeFormat.prototype as Proto;
let savedNumber: unknown;
let savedDate: unknown;

beforeEach(() => {
  savedNumber = numberProto.formatToParts;
  savedDate = dateProto.formatToParts;
  delete numberProto.formatToParts;
  delete dateProto.formatToParts;
});

afterEach(() => {
  numberProto.formatToParts = savedNumber;
  dateProto.formatToParts = savedDate;
});

describe("design-system amounts without Intl formatToParts (Hermes iOS)", () => {
  it("the engine really lacks formatToParts in this test", () => {
    expect(typeof new Intl.NumberFormat("en-IN").formatToParts).toBe("undefined");
  });

  it("currencySymbol draws ₹ for INR", () => {
    expect(currencySymbol("INR")).toBe("₹");
    expect(currencySymbol("INR", "en-IN")).toBe("₹");
  });

  it("AmountInput shows ₹ with lakh grouping", () => {
    expect(amountInputState("").display).toBe("₹0");
    expect(amountInputState("1234567").display).toBe("₹12,34,567");
    expect(amountInputState("1234567.5").display).toBe("₹12,34,567.5");
    expect(amountInputState("1250.").display).toBe("₹1,250.");
    expect(amountInputState("1234567").minor).toBe(123_456_700);
  });

  it("AmountText shows ₹, the sign and lakh grouping", () => {
    expect(formatAmount(123_456_700).text).toBe("₹12,34,567");
    expect(formatAmount(123_456_700, { direction: "out" }).text).toBe("−₹12,34,567");
    expect(formatAmount(4_200_000, { direction: "in" }).text).toBe("+₹42,000");
    expect(formatAmount(125_050, { whole: false }).text).toBe("₹1,250.50");
  });

  it("the Income screen's 'As of' date still reads correctly", () => {
    expect(shortDateInZone("2026-12-31T18:45:00Z", "Asia/Kolkata")).toBe("1 Jan 2027");
  });
});
