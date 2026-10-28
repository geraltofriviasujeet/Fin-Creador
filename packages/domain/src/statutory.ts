// Statutory and legal dues (Sprint 8d): income tax payable, fines (traffic e-challans and
// others) and other statutory dues. Figures the database also computes:
//   * What is paid towards a due: the amounts of its active payments; interest or a penalty on
//     a tax due is extra and does not count (public.statutory_paid).
//   * Paid once that covers the amount, pending otherwise (public.statutory_sync_due); "part
//     paid" while something is paid and something is left.
import { addMinor } from "./money";

export const STATUTORY_TYPES = ["income_tax", "fine", "other_statutory"] as const;
export type StatutoryType = (typeof STATUTORY_TYPES)[number];

/** Types whose payment may carry interest or a penalty (posted in "Fines & penalties"). */
export const STATUTORY_TYPES_WITH_INTEREST: readonly StatutoryType[] = ["income_tax", "other_statutory"];

export type StatutoryState = "unpaid" | "part_paid" | "paid";

export function statutoryDueState(amountDueMinor: number, paidMinor: number): { state: StatutoryState; leftMinor: number } {
  if (![amountDueMinor, paidMinor].every(Number.isSafeInteger) || amountDueMinor <= 0 || paidMinor < 0) throw new RangeError("Amounts must be safe integers");
  const leftMinor = Math.max(addMinor(amountDueMinor, -paidMinor), 0);
  return { state: leftMinor === 0 ? "paid" : paidMinor > 0 ? "part_paid" : "unpaid", leftMinor };
}
