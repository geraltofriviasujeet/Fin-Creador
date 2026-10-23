import { describe, expect, it } from "vitest";
import {
  type Schedule,
  isOccurrence,
  latestOccurrenceOnOrBefore,
  nextOccurrenceAfter,
  occurrence,
  occurrencesBetween,
  anchorDayMayMove,
  recurringStatus,
  scheduleText,
} from "./recurrence";

const monthly = (startDate: string, endDate: string | null = null): Schedule => ({ frequency: "monthly", startDate, endDate });

describe("occurrences are anchored to the start day", () => {
  it("monthly from the 31st falls on each month's last day when shorter, then back to the 31st", () => {
    const s = monthly("2026-01-31");
    expect([0, 1, 2, 3, 4].map((n) => occurrence(s, n))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("monthly from the 29th uses 29 February in a leap year", () => {
    expect(occurrence(monthly("2027-12-29"), 2)).toBe("2028-02-29");
    expect(occurrence(monthly("2026-12-29"), 2)).toBe("2027-02-28");
  });

  it("quarterly and yearly cross year boundaries; 29 February falls on 28 February in other years", () => {
    expect(occurrence({ frequency: "quarterly", startDate: "2026-11-30" }, 1)).toBe("2027-02-28");
    expect(occurrence({ frequency: "yearly", startDate: "2028-02-29" }, 1)).toBe("2029-02-28");
    expect(occurrence({ frequency: "yearly", startDate: "2028-02-29" }, 4)).toBe("2032-02-29");
  });

  it("weekly adds seven days across month and year ends", () => {
    expect(occurrence({ frequency: "weekly", startDate: "2026-12-28" }, 1)).toBe("2027-01-04");
  });
});

describe("dates within start..min(end, today)", () => {
  it("finds the latest occurrence on or before a date, and none before the start", () => {
    expect(latestOccurrenceOnOrBefore(monthly("2026-01-31"), "2026-03-30")).toBe("2026-02-28");
    expect(latestOccurrenceOnOrBefore(monthly("2026-01-31"), "2026-03-31")).toBe("2026-03-31");
    expect(latestOccurrenceOnOrBefore(monthly("2026-01-31"), "2026-01-30")).toBeNull();
  });

  it("stops at the end date (inclusive)", () => {
    const s = monthly("2026-01-15", "2026-04-15");
    expect(latestOccurrenceOnOrBefore(s, "2026-10-23")).toBe("2026-04-15");
    expect(nextOccurrenceAfter(s, "2026-04-15")).toBeNull();
    expect(nextOccurrenceAfter(s, "2026-04-14")).toBe("2026-04-15");
  });

  it("gives the next occurrence strictly after a date", () => {
    expect(nextOccurrenceAfter(monthly("2026-01-31"), "2026-02-28")).toBe("2026-03-31");
    expect(nextOccurrenceAfter(monthly("2026-11-01"), "2026-10-23")).toBe("2026-11-01");
    expect(nextOccurrenceAfter({ frequency: "weekly", startDate: "2026-10-01", endDate: null }, "2026-10-23")).toBe("2026-10-29");
  });

  it("lists occurrences in a range and checks a single date", () => {
    expect(occurrencesBetween({ frequency: "weekly", startDate: "2026-10-01", endDate: null }, "2026-10-10", "2026-10-31")).toEqual([
      "2026-10-15", "2026-10-22", "2026-10-29",
    ]);
    expect(isOccurrence(monthly("2026-01-31"), "2026-02-28")).toBe(true);
    expect(isOccurrence(monthly("2026-01-31"), "2026-02-27")).toBe(false);
    expect(isOccurrence(monthly("2026-01-31", "2026-02-01"), "2026-02-28")).toBe(false);
  });
});

describe("recurringStatus", () => {
  const rule = { ...monthly("2026-01-01"), archived: false, blocked: false };
  const today = "2026-10-23";

  it("shows only the latest missed occurrence as due", () => {
    expect(recurringStatus(rule, today, new Set())).toEqual({ kind: "due", date: "2026-10-01" });
    // Handling the latest one leaves nothing due, however many earlier ones were missed.
    expect(recurringStatus(rule, today, new Set(["2026-10-01"]))).toEqual({ kind: "upcoming", date: "2026-11-01" });
  });

  it("is due again when its posted entry is voided (handled no longer has the date)", () => {
    expect(recurringStatus(rule, "2026-10-01", new Set())).toEqual({ kind: "due", date: "2026-10-01" });
  });

  it("needs attention while its account or category is archived", () => {
    expect(recurringStatus({ ...rule, blocked: true }, today, new Set())).toEqual({ kind: "needs_attention", date: "2026-10-01" });
  });

  it("ends after its end date, and an archived rule is archived", () => {
    expect(recurringStatus({ ...rule, endDate: "2026-09-30" }, today, new Set(["2026-09-01"]))).toEqual({ kind: "ended" });
    expect(recurringStatus({ ...rule, archived: true }, today, new Set())).toEqual({ kind: "archived" });
  });
});

describe("scheduleText", () => {
  it("names the schedule from its start date", () => {
    expect(scheduleText({ frequency: "weekly", startDate: "2026-10-22" })).toBe("Weekly on Thursday");
    expect(scheduleText({ frequency: "monthly", startDate: "2026-01-31" })).toBe("Monthly on day 31");
    expect(scheduleText({ frequency: "quarterly", startDate: "2026-01-05" })).toBe("Every 3 months on day 5");
    expect(scheduleText({ frequency: "yearly", startDate: "2028-02-29" })).toBe("Yearly on 29 Feb");
    expect(anchorDayMayMove({ frequency: "monthly", startDate: "2026-01-29" })).toBe(true);
    expect(anchorDayMayMove({ frequency: "weekly", startDate: "2026-01-31" })).toBe(false);
  });
});
