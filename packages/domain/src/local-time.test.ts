import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatClockTime,
  formatDayMonth,
  formatLongDate,
  greetingFor,
  hasTimeZoneData,
  localDateTime,
  partOfDay,
  resolveTimeZone,
  timeZoneOffsetMinutes,
} from "./local-time";
import { TIME_ZONE_INDEX, TIME_ZONE_TZDATA } from "./time-zone-data";

const at = (iso: string) => new Date(iso);
// packages/domain has no DOM or Node types.
const testConsole = (globalThis as unknown as { console: { warn: (message: string) => void } }).console;
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
  it("knows legacy names", () => {
    expect(hasTimeZoneData("Asia/Calcutta")).toBe(true);
    expect(hasTimeZoneData("Mars/Olympus")).toBe(false);
    expect(timeZoneOffsetMinutes(at("2026-01-01T00:00:00Z"), "Asia/Calcutta")).toBe(330);
    expect(() => formatDayMonth(new Date("nope"), KOLKATA)).toThrow(RangeError);
  });
});

describe("unknown time zone", () => {
  /** Intl whose default DateTimeFormat reports `zone` as the device's time zone. */
  function stubDeviceZone(zone: string) {
    const DateTimeFormat = () => ({ resolvedOptions: () => ({ timeZone: zone }) });
    vi.stubGlobal("Intl", Object.assign(Object.create(Intl), { DateTimeFormat }));
  }
  const instant = at("2026-11-23T16:12:00Z"); // 9:42 PM Kolkata, 11:12 AM New York

  it("falls back to the device's zone and warns once, without throwing", () => {
    stubDeviceZone(NEW_YORK);
    const warn = vi.spyOn(testConsole, "warn").mockImplementation(() => {});
    try {
      expect(resolveTimeZone("Mars/Olympus")).toBe(NEW_YORK);
      expect(formatClockTime(instant, "Mars/Olympus")).toBe("11:12 AM");
      expect(greetingFor("Asha", instant, "Mars/Olympus")).toBe("Good morning, Asha");
      expect(formatLongDate(instant, "Mars/Olympus")).toBe("Monday, 23 November");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("Mars/Olympus");
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ["the device's zone is unknown too", () => stubDeviceZone("Not/AZone")],
    ["Intl is missing", () => vi.stubGlobal("Intl", undefined)],
  ])("falls back to Asia/Kolkata when %s", (_case, stub) => {
    stub();
    const warn = vi.spyOn(testConsole, "warn").mockImplementation(() => {});
    try {
      expect(resolveTimeZone("Venus/Maxwell")).toBe(KOLKATA);
      expect(formatClockTime(instant, "")).toBe("9:42 PM");
      expect(formatDayMonth(at("2026-11-30T18:30:00Z"), "Venus/Maxwell")).toBe("1 Dec");
      expect(partOfDay(instant, "Venus/Maxwell")).toBe("evening");
    } finally {
      warn.mockRestore();
    }
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

// The table is generated from ICU. Every zone is compared with this Node's Intl from 2024 to
// 2030 on whatever Node runs the tests; only a real offset difference fails. A different tzdata
// release alone only warns, so a Node update in CI doesn't break unrelated PRs. To fix a
// failure, regenerate with CI's Node (docs/quarterly-list-refresh.md, "Time-zone offset table").
const runtimeTzdata = (globalThis as { process?: { versions?: { tz?: string } } }).process?.versions?.tz ?? "";
if (runtimeTzdata !== TIME_ZONE_TZDATA) {
  testConsole.warn(
    `Time-zone table is from tzdata ${TIME_ZONE_TZDATA}, this Node has ${runtimeTzdata || "unknown"}; comparing offsets anyway.`,
  );
}

describe(`offset table matches Intl (table tzdata ${TIME_ZONE_TZDATA}, Node tzdata ${runtimeTzdata || "unknown"})`, () => {
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
