import { formatMoney, formatPercentFromBasisPoints } from "@fin-creador/domain";

// Display helpers for the mobile Income screens. Intl support varies across Hermes builds,
// so each one falls back to a plain, still-correct format instead of throwing.

/** "₹2,48,600" (Indian grouping), falling back to "INR 248600" if Intl is unavailable. */
export function money(minor: number, currency: string): string {
  try {
    return formatMoney(minor, { currency });
  } catch {
    return `${currency} ${(minor / 100).toFixed(2).replace(/\.00$/, "")}`;
  }
}

/** "+9.2% from last month" / "-4% from last month" (sign always shown). */
export function trendText(basisPoints: number): string {
  const sign = basisPoints > 0 ? "+" : basisPoints < 0 ? "-" : "";
  let pct: string;
  try {
    pct = formatPercentFromBasisPoints(Math.abs(basisPoints));
  } catch {
    pct = `${Math.abs(basisPoints) / 100}%`;
  }
  return `${sign}${pct} from last month`;
}

/** ISO date ("2026-10-22") ↔ a local Date at midnight, for the native date picker. */
export function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function localDateToIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "22 Oct 2026" without Intl (no time-zone shift: it's a calendar date). */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** A route parameter that may arrive as an array. */
export const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** "22 Oct 2026" for an instant in the user's time zone; the UTC date if Intl lacks time zones. */
export function shortDateInZone(instant: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return shortDate(`${get("year")}-${get("month")}-${get("day")}`);
  } catch {
    return shortDate(instant.slice(0, 10));
  }
}
