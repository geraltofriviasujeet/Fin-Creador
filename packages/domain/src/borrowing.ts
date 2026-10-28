// Informal borrowing return plans (Sprint 8b follow-up). Figures the database also computes:
//   * borrowingSchedule = public.borrowing_schedule (parity test:
//     supabase/tests/database/borrowing_schedule_parity.test.sql). Once: one item (seq 0) on the
//     return date. Instalments: seq 1…n, instalment i on the return day clamped to the end of
//     month i (31 Jan, 28 Feb, 31 Mar, not chained); amount floor(T / n), the last takes the
//     remainder; interest through instalment i = floor(extra × amount through i / T), so the
//     interest adds up to the extra and never exceeds an instalment.
//   * borrowingDueProgress = public.borrowing_sync_due and the borrowing_due_progress view:
//     repayments (principal + interest) cover the items in seq order; an item is paid once they
//     reach its cumulative amount, or when nothing is owed. Within an item they cover interest
//     first. The principal left is capped at what is owed now.
import type { IsoDate } from "./dates";
import { addMonthsClamped } from "./fixed-deposits";
import { MAX_AMOUNT_MINOR } from "./money";

export const BORROWING_RETURN_PLANS = ["once", "instalments"] as const;
export type BorrowingReturnPlan = (typeof BORROWING_RETURN_PLANS)[number];
export const BORROWING_INSTALMENTS_MIN = 2;
export const BORROWING_INSTALMENTS_MAX = 60;

export type BorrowingScheduleItem = { seq: number; dueDate: IsoDate; amountMinor: number; interestMinor: number };

export function borrowingSchedule(plan: {
  totalMinor: number;
  borrowedMinor: number;
  returnOn: IsoDate;
  returnPlan: BorrowingReturnPlan;
  instalmentCount: number | null;
}): BorrowingScheduleItem[] {
  const { totalMinor, borrowedMinor, returnOn, returnPlan, instalmentCount } = plan;
  if (![totalMinor, borrowedMinor].every(Number.isSafeInteger) || borrowedMinor < 1 || totalMinor < borrowedMinor || totalMinor > MAX_AMOUNT_MINOR) {
    throw new RangeError("How much to return must be at least the amount borrowed");
  }
  const extra = totalMinor - borrowedMinor;
  if (returnPlan === "once") return [{ seq: 0, dueDate: returnOn, amountMinor: totalMinor, interestMinor: extra }];
  const n = instalmentCount ?? 0;
  if (!Number.isInteger(n) || n < BORROWING_INSTALMENTS_MIN || n > BORROWING_INSTALMENTS_MAX || n > totalMinor) {
    throw new RangeError("Choose between 2 and 60 instalments");
  }
  const each = Math.floor(totalMinor / n);
  // BigInt: extra × amount can pass 2^53.
  const interestThrough = (through: number) => Number((BigInt(extra) * BigInt(through)) / BigInt(totalMinor));
  return Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    const before = (i - 1) * each;
    const through = i === n ? totalMinor : i * each;
    return {
      seq: i,
      dueDate: addMonthsClamped(returnOn, i - 1),
      amountMinor: through - before,
      interestMinor: interestThrough(through) - interestThrough(before),
    };
  });
}

export type BorrowingDueProgress = {
  seq: number;
  status: "paid" | "pending";
  remainingMinor: number;
  remainingInterestMinor: number;
  remainingPrincipalMinor: number;
};

/** Status and what is left of each item, from active repayments (principal + interest) and what is owed now. */
export function borrowingDueProgress(
  items: readonly { seq: number; amountDueMinor: number; interestMinor: number }[],
  repaidMinor: number,
  owedMinor: number,
): BorrowingDueProgress[] {
  let through = 0;
  return [...items]
    .sort((a, b) => a.seq - b.seq)
    .map((item) => {
      through += item.amountDueMinor;
      const paid = owedMinor <= 0 || through <= repaidMinor;
      const remainingMinor = paid ? 0 : Math.min(item.amountDueMinor, Math.max(through - repaidMinor, 0));
      const remainingInterestMinor = item.interestMinor - Math.min(item.interestMinor, item.amountDueMinor - remainingMinor);
      return {
        seq: item.seq,
        status: paid ? "paid" : "pending",
        remainingMinor,
        remainingInterestMinor,
        remainingPrincipalMinor: Math.min(remainingMinor - remainingInterestMinor, Math.max(owedMinor, 0)),
      };
    });
}
