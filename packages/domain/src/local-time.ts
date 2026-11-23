// Local date and time in the person's profile time zone, without Intl. Hermes on iOS lacks
// formatToParts and returns date parts as one string, so mobile cannot ask Intl for the hour
// in a zone. Offsets come from the generated table in time-zone-data.ts instead, and month and
// day names are fixed English. No formatting goes through Intl or toLocale*; Intl is touched
// only to read the device's zone name when the profile's zone is unknown (guarded).
import type { IsoDate } from "./dates";
import { parseIsoDate } from "./dates";
import { TIME_ZONE_ENTRIES, TIME_ZONE_FIRST_YEAR, TIME_ZONE_INDEX, TIME_ZONE_LAST_YEAR } from "./time-zone-data";

const MINUTE = 60_000;
const DAY = 86_400_000;
/** 28 Gregorian years (7 leap days) between 1901 and 2099: weekdays and DST rules repeat. */
const CYCLE = 10_227 * DAY;
const TABLE_START = Date.UTC(TIME_ZONE_FIRST_YEAR, 0, 1);
const TABLE_END = Date.UTC(TIME_ZONE_LAST_YEAR + 1, 0, 1);

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
export const MONTH_SHORT_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
/** Index 0 is Sunday, as Date#getUTCDay counts. */
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

interface OffsetTable {
  /** Offset in minutes before the first change. */
  initial: number;
  /** Instant (ms) of each change, ascending. */
  at: number[];
  /** Offset in minutes from the matching change. */
  offset: number[];
}

const decoded = new Map<number, OffsetTable>();

/** Used when neither the profile's zone nor the device's is in the table (India-first default). */
export const FALLBACK_TIME_ZONE = "Asia/Kolkata";

function deviceTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && TIME_ZONE_INDEX[zone] !== undefined ? zone : undefined;
  } catch {
    return undefined;
  }
}

const warnedZones = new Set<string>();

/**
 * The zone to read times in: `timeZone` when the table has it, else the device's zone, else
 * Asia/Kolkata, with one warning per unknown zone. Never throws, so a bad profile value
 * cannot break a screen.
 */
export function resolveTimeZone(timeZone: string): string {
  if (TIME_ZONE_INDEX[timeZone] !== undefined) return timeZone;
  const zone = deviceTimeZone() ?? FALLBACK_TIME_ZONE;
  if (!warnedZones.has(timeZone)) {
    warnedZones.add(timeZone);
    // packages/domain has no DOM or Node types; console exists on Hermes, browsers and Node.
    const log = (globalThis as { console?: { warn?: (message: string) => void } }).console;
    log?.warn?.(`Unknown time zone "${timeZone}"; showing dates and times in ${zone}.`);
  }
  return zone;
}

function offsetTable(timeZone: string): OffsetTable {
  const index = TIME_ZONE_INDEX[resolveTimeZone(timeZone)] as number;
  let table = decoded.get(index);
  if (!table) {
    const [first, ...changes] = (TIME_ZONE_ENTRIES[index] as string).split(";");
    table = { initial: Number(first), at: [], offset: [] };
    let t = TABLE_START;
    for (const change of changes) {
      const [delta, offset] = change.split(",");
      t += parseInt(delta as string, 36) * MINUTE;
      table.at.push(t);
      table.offset.push(Number(offset));
    }
    decoded.set(index, table);
  }
  return table;
}

/** True when the zone is in the bundled table (current or legacy IANA name). */
export const hasTimeZoneData = (timeZone: string): boolean => TIME_ZONE_INDEX[timeZone] !== undefined;

/**
 * UTC offset in minutes of `timeZone` at `instant` (330 for Asia/Kolkata). Exact for
 * 2020–2050; other years use the rules of a year 28 years nearer (same weekdays), so a
 * zone's past rule changes before 2020 are not reflected. An unknown zone falls back as
 * `resolveTimeZone` describes. Throws RangeError only for an invalid Date.
 */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const table = offsetTable(timeZone);
  let t = instant.getTime();
  if (Number.isNaN(t)) throw new RangeError("Invalid date");
  while (t < TABLE_START) t += CYCLE;
  while (t >= TABLE_END) t -= CYCLE;
  // Last change at or before t (binary search).
  let lo = 0;
  let hi = table.at.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((table.at[mid] as number) <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? table.initial : (table.offset[found] as number);
}

export interface LocalDateTime {
  /** Calendar date in the zone, "YYYY-MM-DD". */
  date: IsoDate;
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  /** 0–23. */
  hour: number;
  minute: number;
  /** 0 is Sunday. */
  weekday: number;
}

/** The wall-clock date and time of `instant` in `timeZone`. */
export function localDateTime(instant: Date, timeZone: string): LocalDateTime {
  const shifted = new Date(instant.getTime() + timeZoneOffsetMinutes(instant, timeZone) * MINUTE);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return {
    date: `${pad(year, 4)}-${pad(month)}-${pad(day)}`,
    year,
    month,
    day,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

function calendarDate(value: IsoDate | Date, timeZone: string | undefined) {
  if (value instanceof Date) {
    if (timeZone === undefined) throw new TypeError("A time zone is needed to format an instant");
    return localDateTime(value, timeZone);
  }
  const parsed = parseIsoDate(value);
  if (!parsed) throw new RangeError(`Not an ISO date: ${value}`);
  const weekday = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
  return { ...parsed, weekday };
}

/**
 * "1 Dec": day and short month. A calendar date ("2026-12-01", as entries are stored) is shown
 * as it is; an instant is first turned into the date in `timeZone`.
 */
export function formatDayMonth(date: IsoDate): string;
export function formatDayMonth(instant: Date, timeZone: string): string;
export function formatDayMonth(value: IsoDate | Date, timeZone?: string): string {
  const { day, month } = calendarDate(value, timeZone);
  return `${day} ${MONTH_SHORT_NAMES[month - 1]}`;
}

/** "Monday, 23 November": weekday, day and month, for a calendar date or an instant in `timeZone`. */
export function formatLongDate(date: IsoDate): string;
export function formatLongDate(instant: Date, timeZone: string): string;
export function formatLongDate(value: IsoDate | Date, timeZone?: string): string {
  const { day, month, weekday } = calendarDate(value, timeZone);
  return `${WEEKDAY_NAMES[weekday]}, ${day} ${MONTH_NAMES[month - 1]}`;
}

/** "9:42 PM": 12-hour clock in `timeZone`; midnight is "12:00 AM" and noon "12:00 PM". */
export function formatClockTime(instant: Date, timeZone: string): string {
  const { hour, minute } = localDateTime(instant, timeZone);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export type PartOfDay = "morning" | "afternoon" | "evening";

/**
 * Part of the day by the local hour in `timeZone`: morning before noon (from midnight),
 * afternoon from 12:00 to 16:59, evening from 17:00. Same boundaries as the web greeting.
 */
export function partOfDay(instant: Date, timeZone: string): PartOfDay {
  const { hour } = localDateTime(instant, timeZone);
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

/** "Good morning, Asha": the first word of the name, left out when there is none. */
export function greetingFor(name: string | null | undefined, instant: Date, timeZone: string): string {
  const part = partOfDay(instant, timeZone);
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}
