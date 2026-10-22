import { describe, expect, it } from "vitest";
import { isoToLocalDate, localDateToIso, money, param, shortDate, shortDateInZone, trendText } from "./income-format";

describe("mobile income formatting", () => {
  it("formats money with Indian grouping", () => {
    expect(money(24_860_000, "INR")).toBe("₹2,48,600");
    expect(money(12_800_050, "INR")).toBe("₹1,28,000.50");
  });

  it("always shows the trend's sign", () => {
    expect(trendText(920)).toBe("+9.2% from last month");
    expect(trendText(-400)).toBe("-4% from last month");
    expect(trendText(0)).toBe("0% from last month");
  });

  it("round-trips calendar dates for the picker, including a leap day", () => {
    for (const iso of ["2026-10-22", "2028-02-29", "2026-12-31", "2027-01-01"]) {
      expect(localDateToIso(isoToLocalDate(iso))).toBe(iso);
    }
  });

  it("writes short dates without Intl", () => {
    expect(shortDate("2028-02-29")).toBe("29 Feb 2028");
  });

  it("dates an instant in the user's time zone", () => {
    expect(shortDateInZone("2026-12-31T18:45:00Z", "Asia/Kolkata")).toBe("1 Jan 2027");
    expect(shortDateInZone("2026-12-31T18:45:00Z", "America/New_York")).toBe("31 Dec 2026");
  });

  it("reads route params", () => {
    expect(param(["a", "b"])).toBe("a");
    expect(param(undefined)).toBe("");
    expect(param("x")).toBe("x");
  });
});
