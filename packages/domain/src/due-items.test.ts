import { describe, expect, it } from "vitest";
import { type DueItemLike, dueReminders, nextPending, reminderReason, shortfallMinor } from "./due-items";

const item = (id: string, dueDate: string, extra: Partial<DueItemLike> = {}): DueItemLike => ({
  id,
  dueDate,
  status: "pending",
  plannedOn: null,
  amountDueMinor: 1_000,
  ...extra,
});

describe("reminderReason", () => {
  const today = "2026-10-31";

  it("flags overdue, due today and due within 24 hours (tomorrow)", () => {
    expect(reminderReason(item("a", "2026-10-30"), today)).toBe("overdue");
    expect(reminderReason(item("a", "2026-10-31"), today)).toBe("due_today");
    expect(reminderReason(item("a", "2026-11-01"), today)).toBe("due_tomorrow"); // across a month end
    expect(reminderReason(item("a", "2026-11-02"), today)).toBeNull();
  });

  it("reminds the day before and on a planned pay date", () => {
    expect(reminderReason(item("a", "2026-11-20", { plannedOn: "2026-11-01" }), today)).toBe("planned_tomorrow");
    expect(reminderReason(item("a", "2026-11-20", { plannedOn: "2026-10-31" }), today)).toBe("planned_today");
    // The due date wins when it is more urgent.
    expect(reminderReason(item("a", "2026-10-31", { plannedOn: "2026-11-01" }), today)).toBe("due_today");
  });

  it("ignores items of an archived loan", () => {
    expect(reminderReason(item("a", "2026-10-01", { sourceArchived: true }), today)).toBeNull();
    expect(nextPending([item("a", "2026-10-01", { sourceArchived: true })])).toBeNull();
  });

  it("ignores a card bill whose minimum is already paid", () => {
    expect(reminderReason(item("a", "2026-10-01", { covered: true }), today)).toBeNull();
  });

  it("ignores paid and before-tracking items", () => {
    expect(reminderReason(item("a", "2026-10-01", { status: "paid" }), today)).toBeNull();
    expect(reminderReason(item("a", "2026-10-01", { status: "before_tracking" }), today)).toBeNull();
  });
});

describe("dueReminders", () => {
  it("sorts by urgency, then due date, and counts days overdue", () => {
    const items = [
      item("t", "2027-01-01"),
      item("p", "2027-01-20", { plannedOn: "2027-01-01" }),
      item("d", "2026-12-31"),
      item("o2", "2026-12-20"),
      item("o1", "2026-12-01"),
      item("later", "2027-02-01"),
    ];
    const out = dueReminders(items, "2026-12-31");
    expect(out.map((r) => [r.item.id, r.reason])).toEqual([
      ["o1", "overdue"],
      ["o2", "overdue"],
      ["d", "due_today"],
      ["t", "due_tomorrow"],
      ["p", "planned_tomorrow"],
    ]);
    expect(out[0]!.daysOverdue).toBe(30);
    expect(out[2]!.daysOverdue).toBe(0);
  });
});

describe("nextPending", () => {
  it("is the earliest pending item", () => {
    expect(nextPending([item("b", "2026-12-05"), item("a", "2026-11-05", { status: "paid" }), item("c", "2026-11-20")])?.id).toBe("c");
    expect(nextPending([item("a", "2026-11-05", { status: "before_tracking" })])).toBeNull();
  });
});

describe("shortfallMinor", () => {
  it("is what the account is short of, never below zero", () => {
    expect(shortfallMinor(10_000, 4_000)).toBe(0);
    expect(shortfallMinor(10_000, 10_000)).toBe(0);
    expect(shortfallMinor(10_000, 12_500)).toBe(2_500);
    expect(shortfallMinor(-500, 1_000)).toBe(1_500); // an overdrawn account
    expect(shortfallMinor(0, 1)).toBe(1);
  });
});
