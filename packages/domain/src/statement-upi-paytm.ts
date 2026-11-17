// Paytm UPI statement (Sprint 9e), from the owner's description and masked layouts of real ones.
// A summary page (the period, totals, "N Payments made" / "N Payments received", and every account
// in full, "<Bank name> - <digits>", with its own payments made and received), then a table of
// blocks, one per payment, in four columns: details, notes and tags, the person's account, amount.
//   <date> [<time>]                                     - Rs.65 | + Rs.1,234.50
//   Paid to <name> | Money sent to <name> | Received from <name> | Recharge of <name>
//   UPI ID: <handle> ... (dropped)   [Note: <text>] (dropped)   Tag: / # <tag>   <account label>
//   [<rest of the payee's name>]
//   UPI Ref No: <reference>         (the key only)
// A long UPI ID wraps after a "." ("UPI ID: <first part>." then the rest alone on the next row);
// a long note runs down the notes column over several rows, pushing "Tag:" and "# <tag>" down to
// the block's last rows; a long payee name wraps onto a row of its own, above or below the UPI ID,
// or, one long word, wraps whole, leaving "Paid to" alone on its row.
// The date and amount sit on the "Paid to" row or about 3 points above it, so a block runs from its
// date to the next date. The account label wraps down its column over up to three rows, its digits
// on a later row ("Punjab" / "National" / "Bank - 66"; "HDFC Bank -" / "00"): the whole column of
// the block is joined, then matched to the summary's accounts (a label read short, "National Bank
// - 66", is the one summary account it ends). From a PDF each cell's column comes from its x
// against the table's column headers; from plain text (no positions) cells are read by what they
// look like, a wrapped label joined from the lines before it. Dates may be printed without a
// year; the summary's period gives it. Paytm doesn't list self transfers.
import { type IsoDate } from "./dates";
import { MAX_STATEMENT_TEXT_CHARS, type StatementDirection, type StatementIssue } from "./statements";
import {
  MAX_UPI_ROWS,
  type UpiAccountCount,
  type UpiAccountRef,
  type UpiCell,
  type UpiRow,
  type UpiRowKind,
  type UpiStatementParse,
  type UpiTextRow,
  cleanUpiPayee,
  dateInPeriod,
  emptyUpiParse,
  isUpiTime,
  parseUpiAccount,
  parseUpiAmount,
  parseUpiDate,
  parseUpiDayMonth,
  parseUpiPeriod,
  sameColumn,
  upiBlocks,
  upiCells,
  upiChecks,
  upiCount,
  upiIssue,
  upiPeriod,
  upiStatusOf,
} from "./statement-upi";

/** Paytm's tags, as printed. */
export const PAYTM_TAGS = [
  "Food", "Groceries", "Medical", "Shopping", "Taxi", "Entertainment", "Bill Payments", "Miscellaneous",
  "Services", "Financial Services", "Money Transfer", "Money Received",
] as const;

const TYPE = /^(Paid to|Money sent to|Received from|Recharge of)\s+(.+)$/i;
// The payment type alone on its row: the payee's name wrapped whole to the rows below.
const TYPE_ALONE = /^(Paid to|Money sent to|Received from|Recharge of)$/i;
const KINDS: Record<string, UpiRowKind> = { "paid to": "paid", "money sent to": "sent", "received from": "received", "recharge of": "recharge" };
const AMOUNT = /^([-+])\s*(Rs\.?\s*[\d,]+(?:\.\d{1,2})?)$/i;
// A follow-on line can be merged into the cell above it by the PDF reader, so these are found anywhere in a cell.
const REF = /\bUPI\s*Ref(?:erence)?\.?\s*(?:No\.?|Number)?\s*:?\s*([0-9A-Za-z]{6,35})\b/i;
const TAG = /\bTag\s*:?\s*#\s*([A-Za-z][A-Za-z &]*?)\s*$/i;
// In the notes and tags column, "Tag:" and "# <tag>" may sit on different rows, around a note.
const TAG_IN_COLUMN = /#\s*([A-Za-z][A-Za-z &]*?)\s*(?=Tag\s*:|Note\s*:|#|$)/i;
const DROPPED = /^(?:UPI\s*ID|Note)\b/i;
// The UPI ID in a details cell; the PDF reader may have merged the payee's name running on before or after it.
const UPI_ID = /\bUPI\s*ID\s*:?\s*(\S+)(\s+on\b)?\s*/i;
const ACCOUNT_END = /-\s*\d{2,4}$/;
const WORDS = /^[A-Za-z][A-Za-z .&()']*$/;
const STATUS_WORD = /^(?:success(?:ful)?|failed|failure|declined|cancell?ed|canceled|reversed|pending|processing|in progress)$/i;
const SUMMARY_ACCOUNT = /^[A-Za-z][A-Za-z .&()']*-\s*\d{2,4}$/;
const SUMMARY_COUNT = /\((\d[\d,]*)\s+payments?\)/i;
const MONEY = /^[-+]?\s*(?:Rs\.?|₹)\s*[\d,]+(?:\.\d{1,2})?$/i;

const isDateCell = (cell: string) => parseUpiDate(cell) !== null || parseUpiDayMonth(cell) !== null;

export const isPaytmStatement = (text: string): boolean =>
  /\bpaytm\b/i.test(text.slice(0, 5_000)) || (/UPI\s*Ref(?:erence)?\.?\s*No/i.test(text) && /\bTag\s*:?\s*#/i.test(text));

function totalIn(text: string, label: RegExp): number | null {
  const m = new RegExp(String.raw`${label.source}\s*:?\s*[-+]?\s*((?:Rs\.?|₹)\s*[\d,]+(?:\.\d{1,2})?)`, "i").exec(text);
  return m ? parseUpiAmount(m[1]!) : null;
}

/** A summary figure under its label: the first amount below it in its column (PDF), else just after it (text). */
function totalUnder(header: readonly UpiTextRow[], label: RegExp): number | null {
  const cells = upiCells(header);
  const at = cells.findIndex((c) => new RegExp(`^${label.source}$`, "i").test(c.text));
  const below = at === -1 ? undefined : cells.slice(at + 1).find((c) => c.line > cells[at]!.line && sameColumn(c, cells[at]!) && MONEY.test(c.text));
  if (below) return parseUpiAmount(below.text.replace(/^[-+]\s*/, ""));
  return totalIn(header.map((r) => r.text).join("\n"), label);
}

function printedCount(text: string, word: "made" | "received"): number | null {
  const m = new RegExp(String.raw`(\d[\d,]*)\s+Payments?\s+${word}\b`, "i").exec(text);
  return m ? Number(m[1]!.replace(/,/g, "")) : null;
}

/**
 * The summary's accounts: "<Bank> - <digits>", and the counts in brackets beside or below it
 * ("(146 payments)" made, then "(13 payments)" received, left to right), when both are printed.
 */
function summaryAccounts(header: readonly UpiTextRow[]): { account: UpiAccountRef; made: number | null; received: number | null }[] {
  const out: { account: UpiAccountRef; made: number | null; received: number | null }[] = [];
  header.forEach((row, i) => {
    const cell = row.cells.find((c) => SUMMARY_ACCOUNT.test(c));
    const account = cell ? parseUpiAccount(cell, "dash") : null;
    if (!account || out.some((a) => sameAccount(a.account, account))) return;
    const near = [row, header[i + 1]].map((r) => (r?.cells ?? []).map((c) => SUMMARY_COUNT.exec(c)).filter((m) => m !== null));
    const counts = (near[0]!.length > 0 ? near[0]! : near[1]!).map((m) => Number(m[1]!.replace(/,/g, "")));
    out.push({ account, made: counts.length === 2 ? counts[0]! : null, received: counts.length === 2 ? counts[1]! : null });
  });
  return out;
}

const sameAccount = (a: UpiAccountRef, b: UpiAccountRef) => a.digits === b.digits && a.bankLabel.toLowerCase() === b.bankLabel.toLowerCase();

/** A label as compared with the summary's: lower case, no spaces (tightly set words can be read run together, "HDFCBank"). */
const labelKey = (label: string) => label.toLowerCase().replace(/\s+/g, "");

/** The summary's account a label read in a block is: the same, else the only one with its digits whose name ends (or starts) with it. */
function resolveAccount(read: UpiAccountRef, known: readonly UpiAccountRef[]): UpiAccountRef | null {
  const label = labelKey(read.bankLabel);
  const exact = known.find((k) => k.digits === read.digits && labelKey(k.bankLabel) === label);
  if (exact) return exact;
  const near = known.filter((k) => k.digits === read.digits && (labelKey(k.bankLabel).endsWith(label) || labelKey(k.bankLabel).startsWith(label)));
  return near.length === 1 ? near[0]! : null;
}

/** Plain text: "<Bank> - <digits>", with up to two lines of the label above it (in its column, or just before it). */
function accountIn(rest: readonly UpiCell[]): UpiAccountRef | null {
  const end = rest.findIndex((c) => ACCOUNT_END.test(c.text));
  if (end === -1) return null;
  const last = rest[end]!;
  const head: string[] = [];
  for (let k = end - 1; k >= 0 && head.length < 2 && WORDS.test(rest[k]!.text); k--) head.unshift(rest[k]!.text);
  return parseUpiAccount([...head, last.text].join(" "), "dash");
}

type Column = "date" | "details" | "notes" | "account" | "amount";
const DEFAULT_COLUMNS = { details: 90, notes: 288, account: 395, amount: 491 };

/** The table's column starts from its header row ("Transaction Details", "Notes & Tags", "Your Account", "Amount"), else Paytm's usual ones. */
function columnStarts(rows: readonly UpiTextRow[]): typeof DEFAULT_COLUMNS {
  for (const row of rows) {
    if (!row.spans) continue;
    const at = (re: RegExp) => row.spans![row.cells.findIndex((c) => re.test(c))]?.[0];
    const details = at(/^Transaction Details$/i);
    const notes = at(/^Notes\b/i);
    const account = at(/^Your Account$/i);
    const amount = at(/^Amount$/i);
    if (details !== undefined && account !== undefined && amount !== undefined && details < account && account < amount) {
      return { details, notes: notes ?? (details + account) / 2, account, amount };
    }
  }
  return DEFAULT_COLUMNS;
}

/** A cell's column by where it starts (a few points of slack: cells start a little right of their header). */
function columnOf(cell: UpiCell, starts: typeof DEFAULT_COLUMNS): Column {
  const x = cell.span![0] + 10;
  return x >= starts.amount ? "amount" : x >= starts.account ? "account" : x >= starts.notes ? "notes" : x >= starts.details ? "details" : "date";
}

/**
 * The payee's name running on in the details cells after the payment type: plain words, before or
 * after the UPI ID in a cell. A UPI ID ending "." without "on" wrapped: its rest is the next word,
 * in the same cell or starting the next one, and is dropped with it.
 */
function nameRunOn(cells: readonly string[]): string[] {
  const out: string[] = [];
  let wrapped = false;
  let afterId = false;
  for (const cell of cells) {
    // The UPI ID's "on" set apart, as a cell of its own.
    if (afterId && /^on$/i.test(cell)) continue;
    const text = wrapped ? cell.replace(/^\S+\s*/, "") : cell;
    wrapped = false;
    const id = UPI_ID.exec(text);
    afterId = id !== null && !id[2];
    if (id) {
      let after = text.slice(id.index + id[0].length);
      if (id[1]!.endsWith(".") && !id[2]) {
        if (after === "") wrapped = true;
        else after = after.replace(/^\S+\s*/, "");
      }
      out.push(text.slice(0, id.index).trim(), after.trim());
    } else out.push(text);
  }
  return out.filter((c) => WORDS.test(c) && !DROPPED.test(c) && !REF.test(c) && !STATUS_WORD.test(c) && !isUpiTime(c));
}

/** What a block holds, read by column (PDF) or by what each cell looks like (text). */
type BlockRead = { type: RegExpExecArray | null; payee: string; amount: RegExpExecArray | null; tag: string | null; account: UpiAccountRef | null };

function readByColumn(cells: readonly UpiCell[], starts: typeof DEFAULT_COLUMNS): BlockRead {
  const by = (col: Column) => cells.filter((c) => columnOf(c, starts) === col).map((c) => c.text);
  const details = by("details");
  const typeAt = details.findIndex((c) => TYPE.test(c) || TYPE_ALONE.test(c));
  const found = typeAt === -1 ? null : (TYPE.exec(details[typeAt]!) ?? TYPE_ALONE.exec(details[typeAt]!));
  // The payee's name can run onto a row of its own (plain words in the details column), which the
  // PDF reader may merge into the UPI ID's cell; with the type alone on its row, it is all there.
  const more = typeAt === -1 ? [] : nameRunOn(details.slice(typeAt + 1));
  const payee = found ? [found[2], ...more].filter((w) => w).join(" ") : "";
  const label = by("account").join(" ");
  return {
    // A type with no name after it nor below it is not read (listed, with its UPI reference).
    type: payee === "" ? null : found,
    payee,
    amount: by("amount").map((c) => AMOUNT.exec(c)).find((m) => m !== null) ?? null,
    tag: (TAG_IN_COLUMN.exec(by("notes").join(" ")) ?? cells.map((c) => TAG.exec(c.text)).find((m) => m !== null))?.[1]?.trim() ?? null,
    account: label ? parseUpiAccount(label, "dash") : null,
  };
}

function readByShape(cells: readonly UpiCell[]): BlockRead {
  const texts = cells.map((c) => c.text);
  const type = texts.map((c) => TYPE.exec(c)).find((m) => m !== null) ?? null;
  const rest = cells.slice(1).filter((c) => !TYPE.test(c.text) && !AMOUNT.test(c.text) && !REF.test(c.text) && !TAG.test(c.text) && !DROPPED.test(c.text) && !isUpiTime(c.text));
  return {
    type,
    payee: type?.[2] ?? "",
    amount: texts.map((c) => AMOUNT.exec(c)).find((m) => m !== null) ?? null,
    tag: texts.map((c) => TAG.exec(c)).find((m) => m !== null)?.[1]?.trim() ?? null,
    account: accountIn(rest),
  };
}

export function parsePaytmStatement(rows: readonly UpiTextRow[]): UpiStatementParse {
  const text = rows.map((r) => r.text).join("\n");
  if (text.length > MAX_STATEMENT_TEXT_CHARS) return emptyUpiParse("paytm");

  const { blocks } = upiBlocks(rows, (row) => isDateCell(row.cells[0]!));
  // The header: every row before the first payment (a date with a payment type).
  const start = blocks.find((b) => upiCells(b).some((c) => TYPE.test(c.text) || TYPE_ALONE.test(c.text)))?.[0]?.line ?? Infinity;
  const header = rows.filter((r) => r.line < start);
  let printed: { from: IsoDate; to: IsoDate } | null = null;
  for (const row of header) for (const cell of [row.text, ...row.cells]) printed ??= parseUpiPeriod(cell);
  const summary = summaryAccounts(header);
  const starts = columnStarts(rows);
  const counted = summary.some((a) => a.made !== null);

  const out: UpiRow[] = [];
  const issues: StatementIssue[] = [];
  for (const block of blocks) {
    const first = block[0]!;
    const cells = upiCells(block);
    const texts = cells.map((c) => c.text);
    const read = cells.every((c) => c.span) ? readByColumn(cells, starts) : readByShape(cells);
    // A date row with no payment type (the summary's tail, a printed date in a footer): not a
    // payment. With a UPI reference it is one that couldn't be read, and is listed.
    if (!read.type) {
      if (start !== Infinity && first.line > start && texts.some((c) => REF.test(c))) issues.push(upiIssue(first, "no_description"));
      continue;
    }
    if (out.length + issues.length >= MAX_UPI_ROWS) {
      issues.push({ line: first.line, reason: "too_many_lines" });
      break;
    }
    const dm = parseUpiDayMonth(texts[0]!);
    const date = parseUpiDate(texts[0]!) ?? (dm ? dateInPeriod(dm, printed ?? { from: null, to: null }) : null);
    if (!date) {
      issues.push(upiIssue(first, "bad_date"));
      continue;
    }
    const minor = read.amount ? parseUpiAmount(read.amount[2]!) : null;
    if (!read.amount || minor === null) {
      issues.push(upiIssue(first, read.amount ? "bad_amount" : "no_amount"));
      continue;
    }
    const ref = texts.map((c) => REF.exec(c)).find((m) => m !== null)?.[1];
    if (!ref) {
      issues.push(upiIssue(first, "no_reference"));
      continue;
    }
    // When the summary counts each account's payments, a label that is none of them was misread:
    // listed, not kept under a stray name that leaves an account's count short unsaid.
    const account =
      read.account && read.account.bankLabel !== ""
        ? (resolveAccount(read.account, summary.map((a) => a.account)) ?? (counted ? null : read.account))
        : null;
    if (!account) {
      issues.push(upiIssue(first, "no_account"));
      continue;
    }
    out.push({
      line: first.line,
      date,
      kind: KINDS[read.type[1]!.toLowerCase()]!,
      direction: read.amount[1] === "+" ? "credit" : "debit",
      amountMinor: minor,
      payee: cleanUpiPayee(read.payee),
      tag: read.tag,
      account,
      viaLite: false,
      toAccount: null,
      status: upiStatusOf(texts),
      ref,
    });
  }

  const headerText = header.map((r) => r.text).join("\n");
  const totals = {
    sentMinor: totalUnder(header, /Total\s+(?:Money\s+)?(?:Paid|Sent|Spent)/),
    receivedMinor: totalUnder(header, /Total\s+(?:Money\s+)?Received/),
  };
  const made = printedCount(headerText, "made");
  const received = printedCount(headerText, "received");
  const found = (account: UpiAccountRef, direction: StatementDirection) => out.filter((r) => r.direction === direction && sameAccount(r.account, account)).length;
  const accountCounts: UpiAccountCount[] = summary.flatMap(({ account, made: m, received: r }) =>
    m === null || r === null
      ? []
      : [
          { account, direction: "debit" as const, expected: m, found: found(account, "debit") },
          { account, direction: "credit" as const, expected: r, found: found(account, "credit") },
        ],
  );
  return {
    app: "paytm",
    period: upiPeriod(printed, out),
    rows: out,
    issues,
    checks: upiChecks(out, totals),
    count: upiCount(out, issues, made !== null && received !== null ? made + received : null),
    accountCounts,
  };
}
