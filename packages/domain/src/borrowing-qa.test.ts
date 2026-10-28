import { describe, expect, it } from "vitest";
import { borrowingDueProgress, borrowingSchedule } from "./borrowing";

// QA: first in, first out status and progress with expected values worked out by hand, the same
// scenarios as supabase/tests/database/borrowing_followup_qa.test.sql (paise).
// Borrowed 900.00, 1,000.00 to return in 4 instalments of 250.00; interest through i = floor(10,000 x 25,000 i / 100,000) = 2,500 i.
const items = [1, 2, 3, 4].map((seq) => ({ seq, amountDueMinor: 25000, interestMinor: 2500 }));
const view = (repaid: number, owed: number) => borrowingDueProgress(items, repaid, owed).map((p) => `${p.seq}:${p.status}:${p.remainingMinor}:${p.remainingInterestMinor}:${p.remainingPrincipalMinor}`).join(" ");

describe("borrowingDueProgress: first in, first out", () => {
  it("the schedule used here is 4 x 250.00 with 25.00 interest each", () => {
    const s = borrowingSchedule({ totalMinor: 100000, borrowedMinor: 90000, returnOn: "2026-11-07", returnPlan: "instalments", instalmentCount: 4 });
    expect(s.map((i) => [i.amountMinor, i.interestMinor])).toEqual([[25000, 2500], [25000, 2500], [25000, 2500], [25000, 2500]]);
  });

  it("nothing repaid", () => {
    expect(view(0, 90000)).toBe("1:pending:25000:2500:22500 2:pending:25000:2500:22500 3:pending:25000:2500:22500 4:pending:25000:2500:22500");
  });

  it("part-paid: 200.00 repaid leaves 50.00 of the first, all principal", () => {
    expect(view(20000, 70000)).toBe("1:pending:5000:0:5000 2:pending:25000:2500:22500 3:pending:25000:2500:22500 4:pending:25000:2500:22500");
  });

  it("prepaid: 650.00 repaid (600.00 principal) pays two and 150.00 of the third", () => {
    expect(view(65000, 30000)).toBe("1:paid:0:0:0 2:paid:0:0:0 3:pending:10000:0:10000 4:pending:25000:2500:22500");
  });

  it("after a void: 450.00 repaid", () => {
    expect(view(45000, 50000)).toBe("1:paid:0:0:0 2:pending:5000:0:5000 3:pending:25000:2500:22500 4:pending:25000:2500:22500");
  });

  it("after an edit up to 500.00 repaid", () => {
    expect(view(50000, 50000)).toBe("1:paid:0:0:0 2:paid:0:0:0 3:pending:25000:2500:22500 4:pending:25000:2500:22500");
  });

  it("all principal repaid closes every item although interest is short", () => {
    expect(view(90000, 0)).toBe("1:paid:0:0:0 2:paid:0:0:0 3:paid:0:0:0 4:paid:0:0:0");
  });

  it("interest paid alone counts first: 100.00 repaid, 900.00 owed", () => {
    expect(view(10000, 90000)).toBe("1:pending:15000:0:15000 2:pending:25000:2500:22500 3:pending:25000:2500:22500 4:pending:25000:2500:22500");
  });

  it("does not depend on the order the items are given", () => {
    expect(borrowingDueProgress([...items].reverse(), 65000, 30000)).toEqual(borrowingDueProgress(items, 65000, 30000));
  });
});
