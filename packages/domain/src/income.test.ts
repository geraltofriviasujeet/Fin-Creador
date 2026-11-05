import { describe, expect, it } from "vitest";
import { monthRange, previousMonthRange, yearRange } from "./dates";
import { type IncomeEntry, type IncomeSource, type SourceRateRule, incomeBySource, incomeTrendBasisPoints, rentalIncome, sourceRates, sumIncome } from "./income";

const today = "2026-10-22";
const periods = { month: monthRange(today), previousMonth: previousMonthRange(today), year: yearRange(today) };

const source = (over: Partial<IncomeSource>): IncomeSource => ({
  id: "s",
  name: "Source",
  sourceType: "other",
  defaultAccountId: null,
  isDefault: true,
  archived: false,
  ...over,
});
let n = 0;
const entry = (over: Partial<IncomeEntry>): IncomeEntry => ({
  id: `e${++n}`,
  amountMinor: 100,
  currency: "INR",
  occurredOn: today,
  sourceId: "salary",
  accountId: "hdfc",
  voided: false,
  ...over,
});

const sources = [
  source({ id: "salary", name: "Salary", sourceType: "salary", defaultAccountId: "hdfc" }),
  source({ id: "rent", name: "Rental income", sourceType: "rent" }),
  source({ id: "interest", name: "Interest & dividends", sourceType: "interest" }),
  source({ id: "business", name: "Business", sourceType: "business" }),
  source({ id: "consulting", name: "Consulting", sourceType: "freelance", isDefault: false }),
  source({ id: "oldjob", name: "Old job", sourceType: "salary", isDefault: false, archived: true }),
];

const entries = [
  entry({ sourceId: "salary", amountMinor: 12_800_000, occurredOn: "2026-10-01" }),
  entry({ sourceId: "salary", amountMinor: 12_800_000, occurredOn: "2026-09-01" }),
  entry({ sourceId: "salary", amountMinor: 99_999_999, occurredOn: "2026-10-05", voided: true }),
  entry({ sourceId: "rent", amountMinor: 3_200_000, occurredOn: "2026-10-31", accountId: "icici" }),
  entry({ sourceId: "rent", amountMinor: 3_200_000, occurredOn: "2025-12-31", accountId: "icici" }),
  entry({ sourceId: "interest", amountMinor: 200_000, occurredOn: "2026-10-02", accountId: "hdfc" }),
  entry({ sourceId: "interest", amountMinor: 225_000, occurredOn: "2026-07-02", accountId: "icici" }),
  entry({ sourceId: "interest", amountMinor: 50_000, occurredOn: "2026-10-03", currency: "USD", accountId: "usd" }),
];

describe("sumIncome", () => {
  it("sums non-voided income in the profile currency for the period (inclusive)", () => {
    expect(sumIncome(entries, periods.month, "INR")).toBe(12_800_000 + 3_200_000 + 200_000);
    expect(sumIncome(entries, periods.year, "INR")).toBe(12_800_000 * 2 + 3_200_000 + 200_000 + 225_000);
    expect(sumIncome(entries, periods.previousMonth, "INR")).toBe(12_800_000);
  });

  it("puts 31 December in its own year, not the next", () => {
    expect(sumIncome(entries, yearRange("2025-06-01"), "INR")).toBe(3_200_000);
  });

  it("counts a leap-day entry in February", () => {
    const leap = [entry({ amountMinor: 500, occurredOn: "2028-02-29" })];
    expect(sumIncome(leap, monthRange("2028-02-01"), "INR")).toBe(500);
    expect(sumIncome(leap, monthRange("2028-03-01"), "INR")).toBe(0);
  });
});

describe("incomeTrendBasisPoints", () => {
  it("is the change from last month", () => {
    expect(incomeTrendBasisPoints(18_275_000, 16_735_000)).toBe(920); // +9.2%
    expect(incomeTrendBasisPoints(50, 100)).toBe(-5000);
  });
  it("is hidden (null) when last month had no income", () => {
    expect(incomeTrendBasisPoints(100, 0)).toBeNull();
  });
});

describe("incomeBySource", () => {
  const rows = incomeBySource(entries, sources, periods, "INR");
  const byId = Object.fromEntries(rows.map((r) => [r.source.id, r]));

  it("lists sources with income this year plus user-added ones; hides unused defaults and archived", () => {
    expect(rows.map((r) => r.source.id)).toEqual(["salary", "rent", "interest", "consulting"]);
  });

  it("gives this month and this year per source, ignoring voided entries", () => {
    expect(byId.salary).toMatchObject({ monthMinor: 12_800_000, yearMinor: 25_600_000 });
    expect(byId.rent).toMatchObject({ monthMinor: 3_200_000, yearMinor: 3_200_000 });
  });

  it("keeps a source whose only entries are voided, at zero, marked onlyVoided", () => {
    const voidedOnly = [entry({ sourceId: "business", amountMinor: 900_000, occurredOn: "2026-10-05", voided: true })];
    const [row] = incomeBySource(voidedOnly, sources, periods, "INR").filter((r) => r.source.id === "business");
    expect(row).toMatchObject({ monthMinor: 0, yearMinor: 0, onlyVoided: true });
    expect(byId.salary?.onlyVoided).toBe(false);
  });

  it("does not list a default source whose only voided entry was in an earlier year", () => {
    const old = [entry({ sourceId: "business", occurredOn: "2025-10-05", voided: true })];
    expect(incomeBySource(old, sources, periods, "INR").map((r) => r.source.id)).not.toContain("business");
  });

  it("links the account that received the income, 'multiple' if several, else the default", () => {
    expect(byId.salary?.linked).toEqual({ kind: "account", accountId: "hdfc" });
    expect(byId.interest?.linked).toEqual({ kind: "multiple" });
    expect(byId.consulting?.linked).toEqual({ kind: "none" });
  });
});

describe("rentalIncome", () => {
  it("sums all rent-type sources", () => {
    expect(rentalIncome(entries, sources, periods, "INR")).toEqual({
      monthMinor: 3_200_000,
      yearMinor: 3_200_000,
      hasRentSource: true,
    });
  });
});

describe("sourceRates", () => {
  const today = "2026-11-05";
  const rule = (over: Partial<SourceRateRule> = {}): SourceRateRule => ({
    type: "income",
    categoryId: "salary",
    amountMinor: 5_000_000,
    currency: "INR",
    frequency: "monthly",
    endDate: null,
    archived: false,
    ...over,
  });

  it("takes the rate from the source's recurring rule, at its current amount", () => {
    expect(sourceRates([rule()], today).get("salary")).toEqual([{ amountMinor: 5_000_000, currency: "INR", frequency: "monthly" }]);
  });

  it("a source without a rule has no rate (totals only)", () => {
    expect(sourceRates([rule()], today).has("rent")).toBe(false);
    expect(sourceRates([], today).size).toBe(0);
  });

  it("several rules give one rate each, largest first", () => {
    const rates = sourceRates([rule({ amountMinor: 100_000, frequency: "yearly" }), rule({ amountMinor: 900_000 })], today).get("salary");
    expect(rates?.map((r) => [r.amountMinor, r.frequency])).toEqual([
      [900_000, "monthly"],
      [100_000, "yearly"],
    ]);
  });

  it("ignores archived and ended rules, expense and transfer rules, and rules without a source", () => {
    const rates = sourceRates(
      [
        rule({ archived: true }),
        rule({ endDate: "2026-11-04" }),
        rule({ type: "expense" }),
        rule({ type: "transfer", categoryId: null }),
      ],
      today,
    );
    expect(rates.size).toBe(0);
    expect(sourceRates([rule({ endDate: today })], today).get("salary")).toHaveLength(1);
  });
});
