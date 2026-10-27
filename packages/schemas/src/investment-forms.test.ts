import { describe, expect, it } from "vitest";
import { holdingFormSchema } from "./investment-forms";

const KEY = "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const INSTRUMENT = "0b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e";
const HOLDING = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const today = "2026-10-26";
const schema = holdingFormSchema({ today });

const errors = (result: ReturnType<typeof schema.safeParse>) =>
  result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));

const add = { instrumentId: INSTRUMENT, units: "12.5", buyPrice: "1,250.5", buyDate: today, idempotencyKey: KEY };

describe("holdingFormSchema", () => {
  it("parses a new record into scaled integers", () => {
    expect(schema.parse(add)).toEqual({
      holdingId: null,
      instrumentId: INSTRUMENT,
      unitsScaled: 125_000,
      buyPriceScaled: 12_505_000,
      buyDate: today,
      idempotencyKey: KEY,
    });
  });

  it("edits a record without changing its instrument", () => {
    expect(schema.parse({ holdingId: HOLDING, instrumentId: INSTRUMENT, units: "0.0001", buyPrice: "0", buyDate: "2024-02-29" })).toEqual({
      holdingId: HOLDING,
      instrumentId: null,
      unitsScaled: 1,
      buyPriceScaled: 0,
      buyDate: "2024-02-29",
      idempotencyKey: null,
    });
  });

  it("needs an instrument from the search and a request key when adding", () => {
    expect(errors(schema.safeParse({ ...add, instrumentId: "" }))).toEqual({ instrumentId: "Choose a fund or share from the search" });
    expect(errors(schema.safeParse({ ...add, instrumentId: "HDFC" }))).toEqual({ instrumentId: "Choose a fund or share from the search" });
    expect(errors(schema.safeParse({ ...add, idempotencyKey: undefined }))).toEqual({ idempotencyKey: "Please reopen the form and try again" });
  });

  it("needs units above 0 with at most 4 decimals", () => {
    expect(errors(schema.safeParse({ ...add, units: "" }))).toEqual({ units: "Enter the number of units" });
    expect(errors(schema.safeParse({ ...add, units: "0" }))).toEqual({ units: "Units must be more than zero" });
    expect(errors(schema.safeParse({ ...add, units: "-3" }))).toEqual({ units: "Enter a number, e.g. 12.5" });
    expect(errors(schema.safeParse({ ...add, units: "1.23456" }))).toEqual({ units: "Use at most 4 decimal places" });
    expect(errors(schema.safeParse({ ...add, units: "1000000001" }))).toEqual({ units: "That's too many units" });
  });

  it("checks the buy price and the invested cap (10^13 paise)", () => {
    expect(errors(schema.safeParse({ ...add, buyPrice: "" }))).toEqual({ buyPrice: "Enter the buy price per unit" });
    expect(errors(schema.safeParse({ ...add, buyPrice: "12.34567" }))).toEqual({ buyPrice: "Use at most 4 decimal places" });
    expect(schema.safeParse({ ...add, units: "1000000000", buyPrice: "100" }).success).toBe(true);
    expect(errors(schema.safeParse({ ...add, units: "1000000000", buyPrice: "100.0001" }))).toEqual({
      buyPrice: "Units × buy price is too large",
    });
  });

  it("refuses a buy date in the future in the person's time zone", () => {
    expect(errors(schema.safeParse({ ...add, buyDate: "2026-10-27" }))).toEqual({ buyDate: "The buy date can't be in the future" });
    expect(errors(schema.safeParse({ ...add, buyDate: "2026-02-30" }))).toEqual({ buyDate: "Enter a valid date" });
    expect(errors(schema.safeParse({ ...add, buyDate: "" }))).toEqual({ buyDate: "Enter a valid date" });
  });
});
