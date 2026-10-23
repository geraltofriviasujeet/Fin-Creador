import { describe, expect, it } from "vitest";
import {
  addDays,
  daysInMonth,
  isInRange,
  isIsoDate,
  isLeapYear,
  localDateInTimeZone,
  monthRange,
  previousMonthRange,
  yearRange,
} from "./dates";

describe("localDateInTimeZone (today in the user's time zone)", () => {
  it.each([
    // Month boundary: 19:00 UTC on 31 March is already 1 April in India (UTC+5:30).
    ["2026-03-31T19:00:00Z", "Asia/Kolkata", "2026-04-01"],
    ["2026-03-31T19:00:00Z", "UTC", "2026-03-31"],
    // Year boundary: 18:45 UTC on 31 December is New Year in India, still 31 Dec in New York.
    ["2026-12-31T18:45:00Z", "Asia/Kolkata", "2027-01-01"],
    ["2026-12-31T18:45:00Z", "America/New_York", "2026-12-31"],
    // Just before midnight in India stays on the same day.
    ["2026-12-31T18:29:59Z", "Asia/Kolkata", "2026-12-31"],
    // Leap day.
    ["2028-02-29T12:00:00Z", "Asia/Kolkata", "2028-02-29"],
    ["2028-02-29T19:00:00Z", "Asia/Kolkata", "2028-03-01"],
    // Far east / far west of UTC.
    ["2026-06-15T11:00:00Z", "Pacific/Kiritimati", "2026-06-16"],
    ["2026-06-15T09:00:00Z", "Pacific/Pago_Pago", "2026-06-14"],
  ])("%s in %s is %s", (instant, zone, expected) => {
    expect(localDateInTimeZone(new Date(instant), zone)).toBe(expected);
  });
});

describe("calendar ranges", () => {
  it("leap years follow the Gregorian rules", () => {
    expect([2024, 2028, 2000].map(isLeapYear)).toEqual([true, true, true]);
    expect([2026, 2100, 1900].map(isLeapYear)).toEqual([false, false, false]);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
  });

  it.each([
    ["2026-10-22", "2026-10-01", "2026-10-31"],
    ["2026-04-30", "2026-04-01", "2026-04-30"],
    ["2028-02-10", "2028-02-01", "2028-02-29"],
    ["2027-02-10", "2027-02-01", "2027-02-28"],
    ["2026-12-31", "2026-12-01", "2026-12-31"],
  ])("month of %s is %s..%s", (date, start, end) => {
    expect(monthRange(date)).toEqual({ start, end });
  });

  it.each([
    ["2027-01-15", "2026-12-01", "2026-12-31"],
    ["2028-03-31", "2028-02-01", "2028-02-29"],
    ["2026-03-31", "2026-02-01", "2026-02-28"],
  ])("month before %s is %s..%s", (date, start, end) => {
    expect(previousMonthRange(date)).toEqual({ start, end });
  });

  it("year is the calendar year", () => {
    expect(yearRange("2028-02-29")).toEqual({ start: "2028-01-01", end: "2028-12-31" });
  });

  it("ranges are inclusive at both ends", () => {
    const r = monthRange("2028-02-15");
    expect(isInRange("2028-02-01", r)).toBe(true);
    expect(isInRange("2028-02-29", r)).toBe(true);
    expect(isInRange("2028-03-01", r)).toBe(false);
    expect(isInRange("2028-01-31", r)).toBe(false);
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("22/10/2026")).toBe(false);
    expect(() => monthRange("nope")).toThrow(RangeError);
  });
});

describe("addDays", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });
});
