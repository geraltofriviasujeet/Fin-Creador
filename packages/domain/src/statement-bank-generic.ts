// Generic bank statement reader (Sprint 9d): any bank's PDF or CSV, read by the table's structure
// rather than by the bank's name. The PNB savings reader and the CSV reader of Sprint 9b stay the
// known-good path; this one runs when they read nothing or their own checks fail (readBankStatement).
//
// - The table starts at the first row naming a date, a description, a balance and either debit and
//   credit columns or one amount column (with or without a Dr / Cr type column). Nothing above it is
//   kept. Value date, cheque, reference, instrument and serial columns are dropped; a PDF cell goes
//   to the header it overlaps most (nearest when none).
// - Repeated headers, page footers and totals are skipped; a row with no date and no amount continues
//   the description above it. Dates are day first, one format a file; dates that run out of order
//   across the file mean the file was not read (a month-first file read day first).
// - Direction: the column (debit / credit) or the Dr / Cr marker; else the balance movement.
// - Acceptance, never a percentage. When the statement prints its opening and closing balances:
//   opening + credits − debits = closing, to the paisa (order-independent, so a missed row or a
//   misread amount fails it). Otherwise every row's balance must follow from the one before it,
//   after same-date rows are reordered. A file that fails is not read at all.
// - The row chain (same-date rows reordered first) only flags rows: a row whose balance doesn't
//   follow, a row whose marker disagrees with its balance movement (unless the totals reconcile with
//   the markers as stated), or the first row when nothing tells its direction. Flagged rows are
//   listed as unreadable, never become lines, and the review asks for "Check this statement".
import { type IsoDate } from "./dates";
import { addMinor } from "./money";
import {
  type BankStatementCheck,
  type BankStatementLine,
  type BankStatementParse,
  MAX_BANK_STATEMENT_LINES,
  bankStatementNeedsCheck,
  csvRows,
  parseBankStatementCsv,
  parsePnbSavingsStatementText,
} from "./statement-bank";
import {
  MAX_STATEMENT_TEXT_CHARS,
  STATEMENT_DATE_SOURCE,
  type StatementDirection,
  type StatementIssue,
  cleanStatementDescription,
  isStatementPageFooter,
  numberOccurrences,
  parseStatementAmount,
  parseStatementBalance,
  parseStatementDate,
  parseStatementDirection,
  statementRowShape,
} from "./statements";

/** One table row: its cells left to right and (PDF) each cell's x range. A CSV row has no spans. */
export interface BankTableRow {
  cells: readonly string[];
  spans?: readonly (readonly [number, number])[];
}

type Role = "date" | "description" | "debit" | "credit" | "amount" | "type" | "balance" | "other";
type HeaderName = Role | "txn_date" | "value_date";

// Header names, first match wins at each position (so "Withdrawal Amount" is a debit, not an amount).
const HEADER_NAMES: [HeaderName, string][] = [
  ["txn_date", String.raw`(?:txn|transaction|tran|trans|posting|post|book(?:ing)?)\.? ?(?:date|dt)\.?`],
  ["value_date", String.raw`value ?(?:date|dt)\.?`],
  ["type", String.raw`(?:dr|debit) ?\/ ?(?:cr|credit)|(?:cr|credit) ?\/ ?(?:dr|debit)|type`],
  ["debit", String.raw`(?:withdrawals?|debits?)(?: (?:amt|amount))?\.?`],
  ["credit", String.raw`(?:deposits?|credits?)(?: (?:amt|amount))?\.?`],
  ["balance", String.raw`(?:closing |running |available )?(?:balance|bal)\.?`],
  ["amount", String.raw`(?:txn |transaction )?(?:amount|amt)\.?`],
  ["description", String.raw`(?:transaction |txn )?(?:narration|particulars|description|remarks?|details)`],
  ["date", String.raw`date`],
  ["other", String.raw`chq|cheque|ref(?:erence)?|instrument(?: id)?|utr|s\.? ?no|sr\.? ?no|serial|init\.? ?br|branch`],
];
const HEADER_RE = new RegExp(HEADER_NAMES.map(([, source]) => String.raw`(?<![a-z])(${source})(?![a-z])`).join("|"), "gi");

type Column = { role: Role; start: number; end: number };

/** The table's columns when `row` is its header row; null otherwise. */
export function bankTableColumns(row: BankTableRow): Column[] | null {
  const named: { name: HeaderName; start: number; end: number }[] = [];
  row.cells.forEach((cell, i) => {
    const [start, end] = row.spans?.[i] ?? [i, i + 1];
    const text = cell.toLowerCase();
    const found = [...text.matchAll(HEADER_RE)].map((m) => ({ name: HEADER_NAMES[m.slice(1).findIndex((g) => g !== undefined)]![0], at: m.index }));
    if (found.length === 0) named.push({ name: "other", start, end });
    else if (!row.spans) named.push({ name: found[0]!.name, start, end });
    else {
      // A PDF cell holding several headers: each name from where it starts to where the next one does.
      const per = (end - start) / Math.max(text.length, 1);
      found.forEach((f, k) => named.push({ name: f.name, start: start + f.at * per, end: start + (found[k + 1]?.at ?? text.length) * per }));
    }
  });

  // The date is the transaction date, else Date, else the value date; every other date column is dropped.
  const dateName = (["txn_date", "date", "value_date"] as const).find((n) => named.some((c) => c.name === n));
  const used = new Set<Role>();
  const columns = named.map(({ name, start, end }): Column => {
    let role: Role = name === dateName ? "date" : name === "txn_date" || name === "value_date" ? "other" : name;
    if (role !== "other" && used.has(role)) role = "other";
    used.add(role);
    return { role, start, end };
  });
  const has = (role: Role) => used.has(role);
  if (!has("date") || !has("description") || !has("balance")) return null;
  if (!(has("debit") && has("credit")) && !has("amount")) return null;
  return columns;
}

const overlap = (a: readonly [number, number], c: Column) => Math.min(a[1], c.end) - Math.max(a[0], c.start);
const gap = (a: readonly [number, number], c: Column) => Math.max(c.start - a[1], a[0] - c.end, 0);

function nearest(span: readonly [number, number], columns: readonly Column[]): Column {
  return [...columns].sort((x, y) => overlap(span, y) - overlap(span, x) || gap(span, x) - gap(span, y))[0]!;
}

const DATE_AT_START = new RegExp(String.raw`^(?:${STATEMENT_DATE_SOURCE})(?=\s|$)`, "i");
const MARKER = /^(?:dr|cr)\.?$/i;
const NUMBERISH = /^[-+]?(?:₹|rs\.?|inr)?[\d,./-]*\d[\d,./-]*$/i;

/** A PDF cell made only of dates, amounts and markers, spread over several columns: split by word. */
function splitCell(cell: string, span: readonly [number, number], columns: readonly Column[]): { text: string; span: [number, number] }[] {
  const words: { text: string; at: number }[] = [];
  const re = /\S+/g;
  for (let m = re.exec(cell); m; m = re.exec(cell)) words.push({ text: m[0], at: m.index });
  const structured = words.every((w) => NUMBERISH.test(w.text) || MARKER.test(w.text) || /^[a-z]{3,9},?$/i.test(w.text));
  const touched = columns.filter((c) => c.role !== "other" && c.role !== "description" && overlap(span, c) > 0);
  if (words.length < 2 || !structured || touched.length < 2) return [{ text: cell, span: [span[0], span[1]] }];
  const per = (span[1] - span[0]) / Math.max(cell.length, 1);
  const parts: { text: string; span: [number, number] }[] = [];
  for (let i = 0; i < words.length; i++) {
    // A three-word date ("01 Oct 2026") and an amount's Dr / Cr stay one part.
    const three = words.slice(i, i + 3);
    const take = three.length === 3 && parseStatementDate(three.map((w) => w.text).join(" ")) ? 3 : MARKER.test(words[i + 1]?.text ?? "") ? 2 : 1;
    const last = words[i + take - 1]!;
    parts.push({ text: words.slice(i, i + take).map((w) => w.text).join(" "), span: [span[0] + words[i]!.at * per, span[0] + (last.at + last.text.length) * per] });
    i += take - 1;
  }
  return parts;
}

/** A data row's text by role (cells of dropped columns are left out). */
function rowByRole(row: BankTableRow, columns: readonly Column[]): Record<Role, string> {
  const out: Record<Role, string[]> = { date: [], description: [], debit: [], credit: [], amount: [], type: [], balance: [], other: [] };
  row.cells.forEach((cell, i) => {
    if (cell === "") return;
    // A CSV cell belongs to its header's column, and a cell past the last header to none.
    if (!row.spans) return void (columns[i] && out[columns[i].role].push(cell));
    for (const part of splitCell(cell, row.spans[i]!, columns)) if (part.text !== "") out[nearest(part.span, columns).role].push(part.text);
  });
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join(" ").trim()])) as Record<Role, string>;
}

const isZero = (text: string) => text === "" || text === "-" || /^0+(?:\.0+)?$/.test(text);

/** An amount cell; the direction comes from a Dr / Cr marker only (a minus sign states none here). */
function readAmount(text: string): { minor: number; direction: StatementDirection | null } | null {
  return parseStatementAmount(text.replace(/^-\s*/, ""));
}

// Rows that end a wrapped description and are never lines: totals, end markers, page furniture.
const FURNITURE = /^(?:totals?\b|grand total|end of statement|statement summary|page \d|generated on|this is a (?:computer|system) generated|\*+)/i;
const SUMMARY_LINE = /^(opening|closing) (?:balance|bal)\.?(?:\s+(?:as on|as of)\s+\S+)?[\s:]*(?:₹|rs\.?|inr)?\s*(-?\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:dr|cr)\.?)?)\s*$/i;
const SUMMARY_LABELS = /opening (?:balance|bal)\.?|closing (?:balance|bal)\.?|(?:dr|cr|debit|credit)s? count|(?:total )?(?:debits?|credits?|withdrawals?|deposits?)(?: amount)?/gi;
const OPENING_ROW = /^(?:opening balance|balance b\/?f|b\/?f|balance brought forward|brought forward)\b/i;
const CLOSING_ROW = /^closing balance\b/i;
const CARRIED_ROW = /^(?:balance c\/?f|c\/?f|carried forward|balance carried forward)\b/i;

type Raw = {
  line: number;
  shape: string;
  date: IsoDate;
  amountMinor: number;
  /** From the debit / credit column or a Dr / Cr marker; null when the row states none. */
  stated: StatementDirection | null;
  balanceMinor: number;
  remarks: string[];
};

const sign = (direction: StatementDirection, minor: number) => (direction === "credit" ? minor : -minor);

/** Reads a bank statement's table by structure; null when it can't be read or doesn't add up. */
export function parseGenericBankStatement(rows: readonly BankTableRow[]): BankStatementParse | null {
  let start = -1;
  let columns: Column[] | null = null;
  for (const [i, row] of rows.entries()) {
    columns = bankTableColumns(row);
    if (columns) {
      start = i;
      break;
    }
  }
  if (!columns) return null;

  const issues: StatementIssue[] = [];
  const raw: Raw[] = [];
  let openingMinor: number | null = null;
  let closingMinor: number | null = null;
  let labels: string[] | null = null;
  let dateFormat: string | null = null;
  let open: Raw | null = null;
  for (let index = start + 1; index < rows.length; index++) {
    const row = rows[index]!;
    const line = index + 1;
    const text = row.cells.join(" ").replace(/\s+/g, " ").trim();
    const pending = labels;
    labels = null;
    if (text === "" || isStatementPageFooter(text) || FURNITURE.test(text) || bankTableColumns(row)) {
      open = null;
      continue;
    }

    // A summary: "Opening Balance 1,000.00", or a row of labels with their values in the row below.
    if (pending) {
      const values = text.split(" ").reduce<string[]>((acc, w) => (MARKER.test(w) && acc.length > 0 ? [...acc.slice(0, -1), `${acc[acc.length - 1]} ${w}`] : [...acc, w]), []);
      if (values.length === pending.length && values.every((v) => parseStatementBalance(v) !== null)) {
        pending.forEach((label, k) => {
          if (/^opening/i.test(label)) openingMinor = parseStatementBalance(values[k]!);
          if (/^closing/i.test(label)) closingMinor = parseStatementBalance(values[k]!);
        });
        open = null;
        continue;
      }
    }
    const summary = SUMMARY_LINE.exec(text);
    if (summary) {
      if (summary[1]!.toLowerCase() === "opening") openingMinor = parseStatementBalance(summary[2]!);
      else closingMinor = parseStatementBalance(summary[2]!);
      open = null;
      continue;
    }
    if (!/\d/.test(text) && /opening (?:balance|bal)/i.test(text) && /closing (?:balance|bal)/i.test(text)) {
      labels = [...text.matchAll(SUMMARY_LABELS)].map((m) => m[0]);
      open = null;
      continue;
    }

    const cells = rowByRole(row, columns);
    const dateMatch = DATE_AT_START.exec(cells.date);
    // What the date cell holds after its date (a PDF cell can run into the description).
    const afterDate = dateMatch ? cells.date.slice(dateMatch[0].length).trim() : cells.date;
    const description = [afterDate !== "" && !parseStatementDate(afterDate) && /[a-z]/i.test(afterDate) ? afterDate : "", cells.description].filter((t) => t !== "").join(" ");

    let amount: { minor: number; direction: StatementDirection | null } | null = null;
    let hasAmount: boolean;
    if (columns.some((c) => c.role === "debit")) {
      hasAmount = !isZero(cells.debit) || !isZero(cells.credit);
      const debit = isZero(cells.debit) ? null : readAmount(cells.debit);
      const credit = isZero(cells.credit) ? null : readAmount(cells.credit);
      if (debit && isZero(cells.credit)) amount = { minor: debit.minor, direction: "debit" };
      else if (credit && isZero(cells.debit)) amount = { minor: credit.minor, direction: "credit" };
    } else {
      hasAmount = !isZero(cells.amount);
      const read = isZero(cells.amount) ? null : readAmount(cells.amount);
      const typed = cells.type === "" ? null : parseStatementDirection(cells.type);
      if (read && (cells.type === "" || typed) && !(typed && read.direction && typed !== read.direction)) amount = { minor: read.minor, direction: typed ?? read.direction };
    }
    const balance = cells.balance === "" ? null : parseStatementBalance(cells.balance);

    if (!dateMatch && !hasAmount) {
      // A balance-only row: the opening or closing balance, or a page's carried-forward balance.
      if (balance !== null && OPENING_ROW.test(description)) {
        if (raw.length === 0) openingMinor ??= balance;
      } else if (balance !== null && CLOSING_ROW.test(description)) closingMinor = balance;
      else if (balance === null && open && cells.description !== "" && cells.date === "" && cells.type === "") open.remarks.push(cells.description);
      else if (balance !== null && !CARRIED_ROW.test(description)) issues.push({ line, reason: "no_amount", shape: statementRowShape(text) });
      continue;
    }
    open = null;
    if (dateMatch && !hasAmount && balance !== null && (OPENING_ROW.test(description) || CLOSING_ROW.test(description) || CARRIED_ROW.test(description))) {
      if (OPENING_ROW.test(description) && raw.length === 0) openingMinor ??= balance;
      if (CLOSING_ROW.test(description)) closingMinor = balance;
      continue;
    }
    const date = dateMatch ? parseStatementDate(dateMatch[0]) : null;
    const format = dateMatch ? dateMatch[0].replace(/\d+/g, "9").replace(/[a-z]+/gi, "a") : null;
    if (date && format) dateFormat ??= format;
    if (!date || format !== dateFormat) {
      issues.push({ line, reason: "bad_date", shape: statementRowShape(text) });
      continue;
    }
    if (!amount || balance === null) {
      issues.push({ line, reason: hasAmount ? "bad_amount" : "no_amount", shape: statementRowShape(text) });
      continue;
    }
    if (raw.length >= MAX_BANK_STATEMENT_LINES) {
      issues.push({ line, reason: "too_many_lines", shape: statementRowShape(text) });
      continue;
    }
    open = { line, shape: statementRowShape(text), date, amountMinor: amount.minor, stated: amount.direction, balanceMinor: balance, remarks: description === "" ? [] : [description] };
    raw.push(open);
  }
  if (raw.length === 0) return null;

  // Day first, in date order either way; out of order means the dates were not read right.
  const ascending = raw.every((r, i) => i === 0 || r.date >= raw[i - 1]!.date);
  const descending = raw.every((r, i) => i === 0 || r.date <= raw[i - 1]!.date);
  if (!ascending && !descending) return null;
  const orders = ascending && descending ? [false, true] : [descending];
  const chains = orders.map((newestFirst) => chainCheck(newestFirst ? [...raw].reverse() : raw, openingMinor));
  const chosen = chains.reduce((best, c) => (c.suspect.size < best.suspect.size ? c : best));
  const { inferred, suspect } = chosen;
  const timeOrder = chosen.rows;

  const conflicts = new Set(raw.filter((r) => r.stated && inferred.get(r) && r.stated !== inferred.get(r)));
  const asStated = (r: Raw) => r.stated ?? inferred.get(r) ?? null;
  const asBalance = (r: Raw) => inferred.get(r) ?? r.stated;
  const total = (pick: (r: Raw) => StatementDirection | null): number | null => {
    let sum = openingMinor!;
    for (const r of raw) {
      const d = pick(r);
      if (!d) return null;
      sum = addMinor(sum, sign(d, r.amountMinor));
    }
    return sum;
  };

  let flagged: Set<Raw>;
  let direction: (r: Raw) => StatementDirection | null;
  let totals: BankStatementCheck;
  if (openingMinor !== null && closingMinor !== null) {
    if (total(asStated) === closingMinor) {
      flagged = new Set(suspect);
      direction = asStated;
    } else if (conflicts.size > 0 && total(asBalance) === closingMinor) {
      flagged = new Set([...suspect, ...conflicts]);
      direction = asBalance;
    } else return null;
    totals = { name: "totals", status: "ok", foundMinor: closingMinor, expectedMinor: closingMinor };
  } else {
    if (suspect.size > 0) return null;
    if (closingMinor !== null && timeOrder[timeOrder.length - 1]!.balanceMinor !== closingMinor) return null;
    // No endpoints to settle a disagreement: a row whose marker and balance disagree is flagged.
    flagged = new Set([...conflicts, ...raw.filter((r) => !asStated(r))]);
    direction = asStated;
    totals = { name: "totals", status: "unchecked", foundMinor: null, expectedMinor: null };
  }

  const kept = raw.filter((r) => !flagged.has(r));
  if (kept.length === 0) return null;
  for (const r of raw) if (flagged.has(r)) issues.push({ line: r.line, reason: "balance_mismatch", shape: r.shape });
  issues.sort((a, b) => a.line - b.line);
  const lines: BankStatementLine[] = numberOccurrences(
    kept.map((r) => ({
      date: r.date,
      amountMinor: r.amountMinor,
      direction: direction(r)!,
      description: cleanStatementDescription(r.remarks.join(" ")).description,
      balanceMinor: r.balanceMinor,
    })),
  );
  const dates = lines.map((l) => l.date).sort();
  return {
    summary: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, openingMinor, closingMinor },
    lines,
    issues,
    checks: [
      flagged.size > 0
        ? { name: "balance_chain", status: "mismatch", foundMinor: null, expectedMinor: null }
        : { name: "balance_chain", status: "ok", foundMinor: null, expectedMinor: null },
      totals,
    ],
  };
}

/**
 * The balance chain in time order, rows of one date reordered when that makes it hold (stated
 * directions respected first, then not). Gives the direction each row's balance movement shows
 * and the rows whose balance doesn't follow from the one before it.
 */
function chainCheck(rows: readonly Raw[], opening: number | null): { rows: readonly Raw[]; inferred: Map<Raw, StatementDirection>; suspect: Set<Raw> } {
  const inferred = new Map<Raw, StatementDirection>();
  const suspect = new Set<Raw>();
  const fit = (r: Raw, before: number | null, strict: boolean): StatementDirection | "unknown" | "none" => {
    if (before === null) return "unknown";
    const moved = r.balanceMinor - before;
    const d: StatementDirection | null = moved === r.amountMinor ? "credit" : moved === -r.amountMinor ? "debit" : null;
    if (!d || (strict && r.stated && r.stated !== d)) return "none";
    return d;
  };
  let before = opening;
  for (let i = 0; i < rows.length; ) {
    let j = i;
    while (j < rows.length && rows[j]!.date === rows[i]!.date) j++;
    const group = rows.slice(i, j);
    const order = arrange(group, before, true, fit) ?? arrange(group, before, false, fit);
    if (order) {
      for (const { r, d } of order) if (d) inferred.set(r, d);
      before = order[order.length - 1]!.r.balanceMinor;
    } else {
      for (const r of group) {
        const d = fit(r, before, false);
        if (d === "none") suspect.add(r);
        else if (d !== "unknown") inferred.set(r, d);
        before = r.balanceMinor;
      }
    }
    i = j;
  }
  return { rows, inferred, suspect };
}

/** An order of one date's rows in which each balance follows from the one before; null if none (or too many to try). */
function arrange(
  group: readonly Raw[],
  start: number | null,
  strict: boolean,
  fit: (r: Raw, before: number | null, strict: boolean) => StatementDirection | "unknown" | "none",
): { r: Raw; d: StatementDirection | null }[] | null {
  let budget = 5_000;
  const used = group.map(() => false);
  const out: { r: Raw; d: StatementDirection | null }[] = [];
  const go = (before: number | null): boolean => {
    if (out.length === group.length) return true;
    for (let k = 0; k < group.length; k++) {
      if (used[k]) continue;
      if (--budget < 0) return false;
      const r = group[k]!;
      const f = fit(r, before, strict);
      if (f === "none") continue;
      used[k] = true;
      out.push({ r, d: f === "unknown" ? null : f });
      if (go(r.balanceMinor)) return true;
      used[k] = false;
      out.pop();
    }
    return false;
  };
  return go(start) ? out : null;
}

export type BankStatementReader = "pnb" | "csv" | "generic";

/**
 * Reads a bank statement: the PNB savings reader (PDF) or the CSV reader first, as in Sprint 9b;
 * when it reads nothing or its own checks fail, the generic reader. Null when neither can read it.
 * `rows` are the PDF's rows with their cell positions (statementPages); a CSV is split here.
 */
export function readBankStatement(read: { format: "pdf" | "csv"; text: string; rows?: readonly BankTableRow[] }): { parse: BankStatementParse; reader: BankStatementReader } | null {
  const known = read.format === "csv" ? parseBankStatementCsv(read.text) : parsePnbSavingsStatementText(read.text);
  const reader = read.format === "csv" ? "csv" : "pnb";
  if (read.text.length > MAX_STATEMENT_TEXT_CHARS || (known.lines.length > 0 && !bankStatementNeedsCheck(known))) return { parse: known, reader };
  const rows = read.format === "csv" ? csvRows(read.text.replace(/^﻿/, "")).map((cells) => ({ cells })) : read.rows;
  const generic = rows ? parseGenericBankStatement(rows) : null;
  if (generic) return { parse: generic, reader: "generic" };
  if (known.lines.length > 0 || known.issues.length > 0) return { parse: known, reader };
  return null;
}
