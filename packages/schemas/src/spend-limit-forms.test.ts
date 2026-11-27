import { describe, expect, it } from "vitest";
import { spendLimitFormSchema } from "./spend-limit-forms";

const schema = spendLimitFormSchema({ currency: "INR" });
const errors = (result: ReturnType<typeof schema.safeParse>) =>
  result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));

describe("spendLimitFormSchema", () => {
  it("reads fixed periods and ignores the days field for them", () => {
    expect(schema.parse({ period: "day", amount: "1,000" })).toEqual({ period: "day", periodDays: 1, amountMinor: 100_000 });
    expect(schema.parse({ period: "week", amount: "₹7,000", days: "99" })).toEqual({ period: "week", periodDays: 7, amountMinor: 700_000 });
    expect(schema.parse({ period: "month", amount: "30000.50" })).toEqual({ period: "month", periodDays: null, amountMinor: 3_000_050 });
  });

  it("reads a custom number of days from 2 to 365", () => {
    expect(schema.parse({ period: "custom", days: " 10 ", amount: "5000" })).toEqual({ period: "custom", periodDays: 10, amountMinor: 500_000 });
    expect(schema.parse({ period: "custom", days: "2", amount: "1" }).periodDays).toBe(2);
    expect(schema.parse({ period: "custom", days: "365", amount: "1" }).periodDays).toBe(365);
    expect(errors(schema.safeParse({ period: "custom", days: "1", amount: "1" }))).toEqual({ days: "Enter 2 to 365 days" });
    expect(errors(schema.safeParse({ period: "custom", days: "366", amount: "1" }))).toEqual({ days: "Enter 2 to 365 days" });
    expect(errors(schema.safeParse({ period: "custom", days: "", amount: "1" }))).toEqual({ days: "Enter a number of days" });
    expect(errors(schema.safeParse({ period: "custom", days: "7.5", amount: "1" }))).toEqual({ days: "Enter a number of days" });
  });

  it("needs a known period and an amount above zero", () => {
    expect(errors(schema.safeParse({ period: "fortnight", amount: "1" }))).toEqual({ period: "Choose a period" });
    expect(errors(schema.safeParse({ period: "day", amount: "" }))).toEqual({ amount: "Enter an amount" });
    expect(errors(schema.safeParse({ period: "day", amount: "0" }))).toEqual({ amount: "Amount must be more than zero" });
    expect(errors(schema.safeParse({ period: "day", amount: "-5" }))).toEqual({ amount: "Amount can't be negative" });
    expect(errors(schema.safeParse({ period: "day", amount: "1.005" }))).toEqual({ amount: "Too many decimal places for this currency" });
  });
});
