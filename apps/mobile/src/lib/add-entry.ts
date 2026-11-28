import type { BalanceMove, LedgerCategory } from "@fin-creador/api";
import { type DraftMove, type DraftShortfall, ceilToWholeMinor, formatDayMonth, formatMoney } from "@fin-creador/domain";

// Pure helpers behind the full-screen Add (Sprint 13b PR 2; decisions log 2026-11-24), kept out
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
 * category chosen from More takes the last tile, so the choice is always visible.
 */
export function categoryTiles(
  categories: readonly LedgerCategory[],
  kind: "expense" | "income",
  { lastUsedId, selectedId }: { lastUsedId?: string | null; selectedId?: string | null } = {},
): { tiles: LedgerCategory[]; more: boolean } {
  const active = categories.filter((c) => c.kind === kind && !c.archived);
  const last = active.find((c) => c.id === lastUsedId);
  const ordered = last ? [last, ...active.filter((c) => c !== last)] : active;
  if (ordered.length <= TILE_SLOTS) return { tiles: ordered, more: false };
  const tiles = ordered.slice(0, TILE_SLOTS - 1);
  const selected = ordered.find((c) => c.id === selectedId);
  if (selected && !tiles.includes(selected)) tiles[tiles.length - 1] = selected;
  return { tiles, more: true };
}

/** "Save ₹1,250 expense"; "Save expense" until there is an amount. */
export function saveLabel(type: AddType, amountMinor: number | null, currency: string): string {
  return amountMinor === null ? `Save ${type}` : `Save ${formatMoney(amountMinor, { currency })} ${type}`;
}

/** "Paid from", "Received into", or "From" / "To" for a transfer. */
export function accountRowLabel(type: AddType, side: "from" | "to" = "from"): string {
  if (type === "transfer") return side === "from" ? "From" : "To";
  return type === "income" ? "Received into" : "Paid from";
}

/** The preview's moves as runsShortAfterDraft takes them. */
export function draftMoves(moves: readonly BalanceMove[]): DraftMove[] {
  return moves.map((m) => ({
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
