// India's financial year (April to March), from a date already in the person's own time zone
// (Sprint 10.6c: the knowledge base's "may be out of date" notice). Written "2026-27".

/** The financial year a YYYY-MM-DD date falls in: April 2026 to March 2027 is "2026-27". */
export function financialYearOf(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Whether a financial year ("2025-26") ended before the one `today` falls in; false when unreadable. */
export function isPastFinancialYear(financialYear: string, today: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(financialYear);
  if (!match) return false;
  return Number(match[1]) < Number(financialYearOf(today).slice(0, 4));
}
