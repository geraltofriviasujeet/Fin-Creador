import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatClockTime,
  formatDayMonth,
  formatLongDate,
  greetingFor,
  hasTimeZoneData,
  localDateTime,
  partOfDay,
  timeZoneOffsetMinutes,
} from "./local-time";
import { TIME_ZONE_INDEX } from "./time-zone-data";

const at = (iso: string) => new Date(iso);
const KOLKATA = "Asia/Kolkata";
const NEW_YORK = "America/New_York";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("calendar dates", () => {
  it.each([
    ["2026-12-01", "1 Dec", "Tuesday, 1 December"],
    ["2026-11-23", "23 Nov", "Monday, 23 November"],
    ["2026-12-31", "31 Dec", "Thursday, 31 December"],
    ["2027-01-01", "1 Jan", "Friday, 1 January"],
    ["2028-02-29", "29 Feb", "Tuesday, 29 February"],
  ])("%s is %s / %s", (date, short, long) => {
    expect(formatDayMonth(date)).toBe(short);
    expect(formatLongDate(date)).toBe(long);
  });

  it("rejects a date that does not exist", () => {
    expect(() => formatDayMonth("2027-02-29")).toThrow(RangeError);
    expect(() => formatLongDate("23/11/2026")).toThrow(RangeError);
  });
});

describe("instants in a time zone ahead of UTC (Asia/Kolkata, +5:30)", () => {
  it("crosses the month boundary at local midnight", () => {
    // 18:29 UTC on 30 Nov is 23:59 in Kolkata; 18:30 is 00:00 on 1 Dec.
    expect(formatLongDate(at("2026-11-30T18:29:00Z"), KOLKATA)).toBe("Monday, 30 November");
    expect(formatClockTime(at("2026-11-30T18:29:00Z"), KOLKATA)).toBe("11:59 PM");
    expect(formatDayMonth(at("2026-11-30T18:30:00Z"), KOLKATA)).toBe("1 Dec");
    expect(formatClockTime(at("2026-11-30T18:30:00Z"), KOLKATA)).toBe("12:00 AM");
  });

  it("crosses the year boundary", () => {
    expect(formatLongDate(at("2026-12-31T18:30:00Z"), KOLKATA)).toBe("Friday, 1 January");
    expect(localDateTime(at("2026-12-31T18:30:00Z"), KOLKATA).date).toBe("2027-01-01");
    expect(formatDayMonth(at("2026-12-31T18:29:59Z"), KOLKATA)).toBe("31 Dec");
  });

  it("shows noon and the evening", () => {
    expect(formatClockTime(at("2026-11-23T06:30:00Z"), KOLKATA)).toBe("12:00 PM");
    expect(formatClockTime(at("2026-11-23T16:12:00Z"), KOLKATA)).toBe("9:42 PM");
    expect(formatClockTime(at("2026-11-23T03:35:00Z"), KOLKATA)).toBe("9:05 AM");
  });
});

describe("instants in a time zone behind UTC (America/New_York, DST)", () => {
  it("is still the previous day when Kolkata has moved on", () => {
    const instant = at("2027-01-01T02:00:00Z");
    expect(formatLongDate(instant, NEW_YORK)).toBe("Thursday, 31 December");
    expect(formatClockTime(instant, NEW_YORK)).toBe("9:00 PM");
    expect(formatLongDate(instant, KOLKATA)).toBe("Friday, 1 January");
  });

  it("crosses the month boundary at local midnight (UTC-5 in winter)", () => {
    expect(formatDayMonth(at("2026-12-01T04:59:00Z"), NEW_YORK)).toBe("30 Nov");
    expect(formatDayMonth(at("2026-12-01T05:00:00Z"), NEW_YORK)).toBe("1 Dec");
    expect(formatClockTime(at("2026-12-01T05:00:00Z"), NEW_YORK)).toBe("12:00 AM");
  });

  it("follows daylight saving time (UTC-4 in summer)", () => {
    expect(timeZoneOffsetMinutes(at("2026-07-01T12:00:00Z"), NEW_YORK)).toBe(-240);
    expect(timeZoneOffsetMinutes(at("2026-12-01T12:00:00Z"), NEW_YORK)).toBe(-300);
    expect(formatClockTime(at("2026-07-01T16:00:00Z"), NEW_YORK)).toBe("12:00 PM");
    // Clocks go forward at 2:00 AM on 8 March 2026 and back at 2:00 AM on 1 November 2026.
    expect(formatClockTime(at("2026-03-08T06:59:00Z"), NEW_YORK)).toBe("1:59 AM");
    expect(formatClockTime(at("2026-03-08T07:00:00Z"), NEW_YORK)).toBe("3:00 AM");
    expect(formatClockTime(at("2026-11-01T05:59:00Z"), NEW_YORK)).toBe("1:59 AM");
    expect(formatClockTime(at("2026-11-01T06:00:00Z"), NEW_YORK)).toBe("1:00 AM");
  });
});

describe("greeting by local hour", () => {
  it.each([
    ["2026-11-22T18:30:00Z", "morning"], // 00:00 midnight
    ["2026-11-23T06:29:00Z", "morning"], // 11:59
    ["2026-11-23T06:30:00Z", "afternoon"], // 12:00 noon
    ["2026-11-23T11:29:00Z", "afternoon"], // 16:59
    ["2026-11-23T11:30:00Z", "evening"], // 17:00
    ["2026-11-23T18:29:00Z", "evening"], // 23:59
  ])("%s in Kolkata is %s", (instant, part) => {
    expect(partOfDay(at(instant), KOLKATA)).toBe(part);
  });

  it("uses the person's zone, not UTC", () => {
    const instant = at("2026-11-23T14:00:00Z"); // 7:30 PM Kolkata, 9:00 AM New York
    expect(greetingFor("Asha Rao", instant, KOLKATA)).toBe("Good evening, Asha");
    expect(greetingFor("Asha Rao", instant, NEW_YORK)).toBe("Good morning, Asha");
    expect(greetingFor("  ", instant, NEW_YORK)).toBe("Good morning");
    expect(greetingFor(null, instant, KOLKATA)).toBe("Good evening");
  });
});

describe("time zones", () => {
  it("knows legacy names and rejects unknown zones", () => {
    expect(hasTimeZoneData("Asia/Calcutta")).toBe(true);
    expect(timeZoneOffsetMinutes(at("2026-01-01T00:00:00Z"), "Asia/Calcutta")).toBe(330);
    expect(() => formatClockTime(at("2026-01-01T00:00:00Z"), "Mars/Olympus")).toThrow(RangeError);
    expect(() => formatDayMonth(new Date("nope"), KOLKATA)).toThrow(RangeError);
  });

  it("reads years outside the table from the same rules", () => {
    expect(formatClockTime(at("2060-07-01T16:00:00Z"), NEW_YORK)).toBe("12:00 PM");
    expect(formatClockTime(at("2060-12-01T17:00:00Z"), NEW_YORK)).toBe("12:00 PM");
    expect(formatLongDate(at("2015-06-15T12:00:00Z"), KOLKATA)).toBe("Monday, 15 June");
  });
});

describe("with Intl removed (Hermes)", () => {
  it("formats dates, times and greetings without Intl or toLocale*", () => {
    vi.stubGlobal("Intl", undefined);
    const proto = Date.prototype as unknown as Record<string, unknown>;
    const saved = ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"].map((k) => [k, proto[k]] as const);
    for (const [k] of saved) {
      proto[k] = () => {
        throw new Error(`${k} called`);
      };
    }
    try {
      const instant = at("2026-11-23T16:12:00Z");
      expect(formatClockTime(instant, KOLKATA)).toBe("9:42 PM");
      expect(formatLongDate(instant, KOLKATA)).toBe("Monday, 23 November");
      expect(formatDayMonth(at("2026-11-30T18:30:00Z"), KOLKATA)).toBe("1 Dec");
      expect(formatClockTime(at("2026-07-01T16:00:00Z"), NEW_YORK)).toBe("12:00 PM");
      expect(greetingFor("Asha", instant, NEW_YORK)).toBe("Good morning, Asha");
      expect(formatLongDate("2026-11-23")).toBe("Monday, 23 November");
    } finally {
      for (const [k, v] of saved) proto[k] = v;
    }
  });
});

// The table is generated from ICU; this compares it with this Node's Intl. A failure after a
// Node upgrade means tzdata changed: re-run packages/domain/scripts/generate-time-zone-data.mjs.
describe("offset table matches Intl", () => {
  function intlOffset(formatter: Intl.DateTimeFormat, instant: Date): number {
    const name = formatter
      .formatToParts(instant)
      .find((p) => p.type === "timeZoneName")?.value as string;
    const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
    if (!m) throw new Error(name);
    return m[1] ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  }

  // Every 3 days and 7 hours from 2024 through 2030, so each month, weekday and hour is hit.
  const samples: Date[] = [];
  for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2031, 0, 1); t += (3 * 24 + 7) * 3_600_000) samples.push(new Date(t));

  it.each(Object.keys(TIME_ZONE_INDEX))("%s", (zone) => {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
    const mismatches = samples.filter((d) => timeZoneOffsetMinutes(d, zone) !== intlOffset(formatter, d));
    expect(mismatches.map((d) => d.toISOString()).slice(0, 3)).toEqual([]);
  });
});
