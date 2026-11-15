import { describe, expect, it } from "vitest";
import { financialYearOf, isPastFinancialYear } from "./financial-year";

describe("financialYearOf", () => {
  it("starts the year on 1 April", () => {
    expect(financialYearOf("2026-03-31")).toBe("2025-26");
    expect(financialYearOf("2026-04-01")).toBe("2026-27");
    expect(financialYearOf("2027-01-15")).toBe("2026-27");
    expect(financialYearOf("2099-12-31")).toBe("2099-00");
    expect(financialYearOf("2028-02-29")).toBe("2027-28");
  });
});

describe("isPastFinancialYear", () => {
  it("is past only once the next year has begun in the person's own today", () => {
    expect(isPastFinancialYear("2026-27", "2027-03-31")).toBe(false);
    expect(isPastFinancialYear("2026-27", "2027-04-01")).toBe(true);
    expect(isPastFinancialYear("2026-27", "2026-04-01")).toBe(false);
    expect(isPastFinancialYear("2027-28", "2026-11-14")).toBe(false);
    expect(isPastFinancialYear("FY27", "2030-01-01")).toBe(false);
  });
});
