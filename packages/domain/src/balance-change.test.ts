import { describe, expect, it } from "vitest";
import {
  type BalanceAfter,
  type BalanceEffectEntry,
  balanceAnnouncement,
  balanceChanges,
  balanceDirection,
  countUpValue,
  formatBalance,
  formatBalanceChange,
  touchedAccounts,
} from "./balance-change";

const hdfc: BalanceAfter = { accountId: "hdfc", name: "HDFC Bank", label: "HDFC Bank", currency: "INR", openingBalanceDate: "2026-01-01", afterMinor: 5_180_000 };
const cash: BalanceAfter = { accountId: "cash", name: "Cash in hand", label: "Cash in hand", currency: "INR", openingBalanceDate: "2026-01-01", afterMinor: 300_000 };
const entry = (over: Partial<BalanceEffectEntry>): BalanceEffectEntry => ({
  type: "expense",
  amountMinor: 50_000,
  occurredOn: "2026-11-20",
  accountId: "hdfc",
  counterAccountId: null,
  ...over,
});

describe("balanceChanges", () => {
  it("an expense: before is after plus the amount (money out)", () => {
    expect(balanceChanges([hdfc], [entry({})])).toEqual([
      { accountId: "hdfc", name: "HDFC Bank", label: "HDFC Bank", currency: "INR", beforeMinor: 5_230_000, afterMinor: 5_180_000 },
    ]);
  });

  it("income and refunds: before is after minus the amount (money in)", () => {
    expect(balanceChanges([hdfc], [entry({ type: "income", amountMinor: 1_000_000 })])[0]).toMatchObject({ beforeMinor: 4_180_000 });
    expect(balanceChanges([hdfc], [entry({ type: "refund", amountMinor: 20_000 })])[0]).toMatchObject({ beforeMinor: 5_160_000 });
  });

  it("a transfer: both accounts, out of one and into the other", () => {
    const t = entry({ type: "transfer", amountMinor: 100_000, counterAccountId: "cash" });
    expect(balanceChanges([hdfc, cash], [t])).toEqual([
      { accountId: "hdfc", name: "HDFC Bank", label: "HDFC Bank", currency: "INR", beforeMinor: 5_280_000, afterMinor: 5_180_000 },
      { accountId: "cash", name: "Cash in hand", label: "Cash in hand", currency: "INR", beforeMinor: 200_000, afterMinor: 300_000 },
    ]);
  });

  it("an edit: new effect minus old effect", () => {
    // ₹500 expense edited to ₹800: the balance moved down by ₹300 more.
    expect(balanceChanges([hdfc], [entry({ amountMinor: 80_000 })], [entry({ amountMinor: 50_000 })])[0]).toMatchObject({
      beforeMinor: 5_210_000,
      afterMinor: 5_180_000,
    });
  });

  it("an edit that moves the entry to another account: both accounts", () => {
    const changes = balanceChanges([cash, hdfc], [entry({ accountId: "cash" })], [entry({ accountId: "hdfc" })]);
    expect(changes).toEqual([
      { accountId: "cash", name: "Cash in hand", label: "Cash in hand", currency: "INR", beforeMinor: 350_000, afterMinor: 300_000 },
      { accountId: "hdfc", name: "HDFC Bank", label: "HDFC Bank", currency: "INR", beforeMinor: 5_130_000, afterMinor: 5_180_000 },
    ]);
  });

  it("leaves out accounts the save didn't move (note-only edit; dated before the opening date)", () => {
    expect(balanceChanges([hdfc], [entry({})], [entry({})])).toEqual([]);
    expect(balanceChanges([hdfc], [entry({ occurredOn: "2025-12-31" })])).toEqual([]);
  });

  it("lists each account once", () => {
    expect(balanceChanges([hdfc, hdfc], [entry({})])).toHaveLength(1);
  });

  it("touchedAccounts: the account, then a transfer's other account, once each", () => {
    expect(touchedAccounts([entry({ type: "transfer", counterAccountId: "cash" }), entry({ accountId: "cash" })])).toEqual(["hdfc", "cash"]);
  });
});

describe("formatting and direction", () => {
  const down = { beforeMinor: 5_230_000, afterMinor: 5_180_000, currency: "INR" };
  const up = { beforeMinor: 4_180_000, afterMinor: 5_180_000, currency: "INR" };

  it("direction: down for money out, up for money in", () => {
    expect(balanceDirection(down)).toBe("down");
    expect(balanceDirection(up)).toBe("up");
    expect(balanceDirection({ beforeMinor: 1, afterMinor: 1 })).toBe("none");
  });

  it("the change is signed with a true minus sign", () => {
    expect(formatBalanceChange(down)).toBe("−₹500");
    expect(formatBalanceChange(up)).toBe("+₹10,000");
    expect(formatBalanceChange({ beforeMinor: 10_050, afterMinor: 10_000, currency: "INR" })).toBe("−₹0.50");
  });

  it("balances below zero use a true minus sign", () => {
    expect(formatBalance(-120_000, "INR")).toBe("−₹1,200");
    expect(formatBalance(5_180_000, "INR")).toBe("₹51,800");
  });

  it("the screen-reader line: one sentence per account", () => {
    expect(balanceAnnouncement([{ accountId: "hdfc", name: "HDFC Bank", label: "HDFC Bank", currency: "INR", beforeMinor: 5_230_000, afterMinor: 5_180_000 }])).toBe(
      "Saved. HDFC Bank balance now ₹51,800.",
    );
    expect(balanceAnnouncement([])).toBe("Saved.");
  });
});

describe("countUpValue", () => {
  it("starts at from, ends exactly at to, whole minor units between", () => {
    expect(countUpValue(5_230_000, 5_180_000, 0)).toBe(5_230_000);
    expect(countUpValue(5_230_000, 5_180_000, 1)).toBe(5_180_000);
    const mid = countUpValue(5_230_000, 5_180_000, 0.5);
    expect(Number.isInteger(mid)).toBe(true);
    expect(mid).toBeLessThan(5_230_000);
    expect(mid).toBeGreaterThan(5_180_000);
  });

  it("counts up for money in", () => {
    expect(countUpValue(100, 200, 0.5)).toBeGreaterThan(100);
  });
});
