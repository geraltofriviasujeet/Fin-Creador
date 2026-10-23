// Calendar dates as ISO strings ("YYYY-MM-DD"). Entries are dated with the user's local
// date, so period boundaries are plain date ranges; the only time-zone step is turning
// "now" into today's local date. Zero-padded ISO dates compare correctly as strings.

export type IsoDate = string;

export interface DateRange {
  /** First day, inclusive. */
  start: IsoDate;
  /** Last day, inclusive. */
  end: IsoDate;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export const isIsoDate = (value: string): boolean => parseIsoDate(value) !== null;

function mustParse(date: IsoDate) {
  const parsed = parseIsoDate(date);
  if (!parsed) throw new RangeError(`Not an ISO date: ${date}`);
  return parsed;
}

/** Today's (or any instant's) calendar date in an IANA time zone. */
export function localDateInTimeZone(instant: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return `${pad(get("year"), 4)}-${pad(get("month"))}-${pad(get("day"))}`;
}

/** The calendar month containing `date`. */
export function monthRange(date: IsoDate): DateRange {
  const { year, month } = mustParse(date);
  return { start: `${pad(year, 4)}-${pad(month)}-01`, end: `${pad(year, 4)}-${pad(month)}-${pad(daysInMonth(year, month))}` };
}

/** The month before the one containing `date` (December of the previous year in January). */
export function previousMonthRange(date: IsoDate): DateRange {
  const { year, month } = mustParse(date);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return monthRange(`${pad(prevYear, 4)}-${pad(prevMonth)}-01`);
}

/** The calendar year (1 January to 31 December) containing `date`. */
export function yearRange(date: IsoDate): DateRange {
  const { year } = mustParse(date);
  return { start: `${pad(year, 4)}-01-01`, end: `${pad(year, 4)}-12-31` };
}

export function isInRange(date: IsoDate, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

/** The earlier of two dates. */
export const minDate = (a: IsoDate, b: IsoDate): IsoDate => (a <= b ? a : b);

/** The calendar date `days` after (or before, if negative) `date`. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = mustParse(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
