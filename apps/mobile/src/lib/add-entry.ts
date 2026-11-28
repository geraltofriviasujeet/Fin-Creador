import type { BalanceMove, EntryType, LedgerCategory } from "@fin-creador/api";
import { type DraftMove, type DraftShortfall, type SafeToSpendBill, ceilToWholeMinor, formatDayMonth, formatMoney } from "@fin-creador/domain";

// Pure helpers behind the full-screen Add (Sprint 13b PRs 2–3; decisions log 2026-11-24), kept out
// of the screen so they are unit-tested. Formatting comes from @fin-creador/domain without
// Intl date APIs (Hermes-safe); nothing here calculates a balance the server owns.

export type AddType = "expense" | "income" | "transfer";

export const ADD_TYPES: readonly { value: AddType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
];

export const isAddType = (v: string): v is AddType => v === "expense" || v === "income" || v === "transfer";

/** Tiles on Add: a 4×2 grid, so 8 categories, or 7 and More when there are more. */
export const TILE_SLOTS = 8;

/**
 * The category (or income source) tiles: the person's own categories in their list order with
 * the last-used one first, archived ones left out. With more than fit, 7 tiles and More; a
 * category chosen from More takes the last tile, so the choice is always visible. An edit keeps
 * its own category (`keepId`) even when it has since been archived.
 */
export function categoryTiles(
  categories: readonly LedgerCategory[],
  kind: "expense" | "income",
  { lastUsedId, selectedId, keepId }: { lastUsedId?: string | null; selectedId?: string | null; keepId?: string | null } = {},
): { tiles: LedgerCategory[]; more: boolean } {
  const active = categories.filter((c) => c.kind === kind && (!c.archived || c.id === keepId));
  const last = active.find((c) => c.id === lastUsedId);
  const ordered = last ? [last, ...active.filter((c) => c !== last)] : active;
  if (ordered.length <= TILE_SLOTS) return { tiles: ordered, more: false };
  const tiles = ordered.slice(0, TILE_SLOTS - 1);
  const selected = ordered.find((c) => c.id === selectedId);
  if (selected && !tiles.includes(selected)) tiles[tiles.length - 1] = selected;
  return { tiles, more: true };
}

/** "Save ₹1,250 expense"; "Save expense" until there is an amount; "Save changes" on an edit. */
export function saveLabel(type: EntryType, amountMinor: number | null, currency: string, editing = false): string {
  if (editing) return "Save changes";
  return amountMinor === null ? `Save ${type}` : `Save ${formatMoney(amountMinor, { currency })} ${type}`;
}

/** "Paid from", "Received into", "Refunded to", or "From" / "To" for a transfer. */
export function accountRowLabel(type: EntryType, side: "from" | "to" = "from"): string {
  if (type === "transfer") return side === "from" ? "From" : "To";
  return type === "income" ? "Received into" : type === "refund" ? "Refunded to" : "Paid from";
}

/** A card is offered only for an expense (or the refund of one), as on the web. */
export const takesCard = (type: EntryType) => type === "expense" || type === "refund";

/**
 * A card's balance as words, as on the web form: "owed ₹500", or "in credit ₹200" after refunds
 * larger than what was owed. (A card's balance is minus what is owed.)
 */
export const cardPosition = (balanceMinor: number, currency: string) =>
  balanceMinor > 0 ? `in credit ${formatMoney(balanceMinor, { currency })}` : `owed ${formatMoney(-balanceMinor, { currency })}`;

/** The note chip: "Add a note", or the note itself, cut short to keep the row on one line. */
export function noteChipLabel(note: string, max = 18): string {
  const t = note.trim().replace(/\s+/g, " ");
  if (!t) return "Add a note";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Home's bills without the occurrence being confirmed: confirming pays it, so the draft already
 * takes that money out and it must not be counted a second time. Home ids a recurring bill
 * `${ruleId}:${date}` (packages/api home/view.ts).
 */
export function billsWithout(bills: readonly SafeToSpendBill[], ruleId: string | null, date: string | null): SafeToSpendBill[] {
  return ruleId && date ? bills.filter((b) => b.id !== `${ruleId}:${date}`) : [...bills];
}

/**
 * The preview's moves as runsShortAfterDraft takes them. A card never warns (owner, 2026-11-28):
 * spending on a card leaves the bank balance as it is until the card is paid.
 */
export function draftMoves(moves: readonly BalanceMove[]): DraftMove[] {
  return moves.filter((m) => m.account.kind !== "card").map((m) => ({
    accountId: m.account.id,
    accountName: m.account.label,
    currency: m.account.currency,
    beforeMinor: m.before,
    afterMinor: m.after,
  }));
}

/**
 * The runs-short warning on Add, in Home's words ("Rent on 3 Dec leaves you ₹3,000 short in
 * HDFC Bank"). The shortfall rounds up to a whole unit, so it is never understated.
 * Informational: saving stays allowed.
 */
export function runsShortText(s: DraftShortfall, currency: string): string {
  const short = formatMoney(ceilToWholeMinor(s.shortAfterBillMinor, currency), { currency });
  const what = `${s.bill.name} on ${formatDayMonth(s.bill.dueDate)}`;
  return s.alreadyShort
    ? `${s.accountName} is already short for ${what}. With this, it leaves you ${short} short.`
    : `With this, ${what} leaves you ${short} short in ${s.accountName}.`;
}
