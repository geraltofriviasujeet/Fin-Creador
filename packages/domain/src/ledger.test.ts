import { describe, expect, it } from "vitest";
import { monthRange } from "./dates";
import { accountBalance, summarizeHoldings } from "./holdings";
import {
  type LedgerEntry,
  currentVersions,
  periodTotals,
  postedActivity,
  savingsRateBasisPoints,
  versionHistory,
} from "./ledger";

let n = 0;
const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: `e${++n}`,
  type: "expense",
  amountMinor: 100,
  currency: "INR",
  occurredOn: "2026-10-15",
  accountId: "hdfc",
  counterAccountId: null,
  categoryId: "food",
  voided: false,
  ...over,
});
const october = monthRange("2026-10-15");

describe("periodTotals", () => {
  it("sums income and expenses separately; transfers are neither", () => {
    const totals = periodTotals(
      [
        entry({ type: "income", amountMinor: 12_800_000, categoryId: "salary" }),
        entry({ amountMinor: 248_000 }),
        entry({ amountMinor: 62_000 }),
        entry({ type: "transfer", amountMinor: 2_500_000, counterAccountId: "cash", categoryId: null }),
      ],
      october,
      "INR",
    );
    expect(totals).toEqual({
      incomeMinor: 12_800_000,
      expenseMinor: 310_000,
      netMinor: 12_490_000,
      incomeCount: 1,
      expenseCount: 2,
      transferCount: 1,
      otherCurrencyCount: 0,
    });
  });

  it("ignores voided entries and entries outside the period (both ends inclusive)", () => {
    const totals = periodTotals(
      [
        entry({ occurredOn: "2026-10-01", amountMinor: 1 }),
        entry({ occurredOn: "2026-10-31", amountMinor: 10 }),
        entry({ occurredOn: "2026-09-30", amountMinor: 100 }),
        entry({ occurredOn: "2026-11-01", amountMinor: 1_000 }),
        entry({ amountMinor: 10_000, voided: true }),
      ],
      october,
      "INR",
    );
    expect(totals.expenseMinor).toBe(11);
    expect(totals.expenseCount).toBe(2);
  });

  it("counts other currencies separately, never converted", () => {
    const totals = periodTotals([entry({ currency: "USD", amountMinor: 5_000 }), entry({})], october, "INR");
    expect(totals).toMatchObject({ expenseMinor: 100, otherCurrencyCount: 1 });
  });

  it("goes negative when spending exceeds income", () => {
    const totals = periodTotals([entry({ type: "income", amountMinor: 100, categoryId: "s" }), entry({ amountMinor: 250 })], october, "INR");
    expect(totals.netMinor).toBe(-150);
  });
});

describe("savingsRateBasisPoints", () => {
  it("is net ÷ income, rounded to a basis point", () => {
    expect(savingsRateBasisPoints({ incomeMinor: 14_250_000, netMinor: 7_426_000 })).toBe(5_211);
    expect(savingsRateBasisPoints({ incomeMinor: 100, netMinor: -150 })).toBe(-15_000);
  });
  it("is null without income", () => {
    expect(savingsRateBasisPoints({ incomeMinor: 0, netMinor: -500 })).toBeNull();
  });
});

describe("postedActivity (mirrors the account_balances view)", () => {
  const accounts = [
    { id: "hdfc", openingBalanceDate: "2026-10-01" },
    { id: "cash", openingBalanceDate: "2026-10-20" },
  ];

  it("an expense lowers its account; income raises it", () => {
    const activity = postedActivity(accounts, [
      entry({ type: "income", amountMinor: 1_000, categoryId: "s" }),
      entry({ amountMinor: 300 }),
    ]);
    expect(activity.get("hdfc")).toEqual({ inflowMinor: 1_000, outflowMinor: 300 });
  });

  it("a transfer moves money between accounts; Total available is unchanged", () => {
    const base = [{ ...accounts[0]!, kind: "bank" as const, bankType: "savings" as const, currency: "INR", openingBalanceMinor: 50_000, archived: false }];
    const withCash = [...base, { id: "cash", kind: "cash" as const, bankType: null, currency: "INR", openingBalanceMinor: 0, openingBalanceDate: "2026-10-01", archived: false }];
    const atm = entry({ type: "transfer", amountMinor: 20_000, counterAccountId: "cash", categoryId: null });
    const activity = postedActivity(withCash, [atm]);
    const holdings = summarizeHoldings(
      withCash.map((a) => ({ ...a, ...activity.get(a.id)! })),
      "INR",
    );
    expect(holdings.rows.map((r) => [r.account.id, r.balanceMinor])).toEqual([
      ["hdfc", 30_000],
      ["cash", 20_000],
    ]);
    expect(holdings.totalAvailableMinor).toBe(50_000);
  });

  it("checks each side of a transfer against its own account's opening date", () => {
    // Dated before cash's opening date: leaves HDFC, but is already inside cash's opening figure.
    const activity = postedActivity(accounts, [
      entry({ type: "transfer", amountMinor: 500, counterAccountId: "cash", categoryId: null, occurredOn: "2026-10-10" }),
    ]);
    expect(activity.get("hdfc")).toEqual({ inflowMinor: 0, outflowMinor: 500 });
    expect(activity.get("cash")).toEqual({ inflowMinor: 0, outflowMinor: 0 });
  });

  it("skips voided entries and entries before the opening date", () => {
    const activity = postedActivity(accounts, [entry({ voided: true }), entry({ occurredOn: "2026-09-30" })]);
    expect(activity.get("hdfc")).toEqual({ inflowMinor: 0, outflowMinor: 0 });
  });

  it("an expense can take an account below zero (the balance is not clamped)", () => {
    const activity = postedActivity(accounts, [entry({ accountId: "cash", amountMinor: 700, occurredOn: "2026-10-21" })]);
    const cash = { openingBalanceMinor: 500, ...activity.get("cash")! };
    expect(accountBalance({ id: "cash", kind: "cash", bankType: null, currency: "INR", openingBalanceDate: "2026-10-20", archived: false, ...cash })).toBe(-200);
  });
});

describe("edit history (void and replace)", () => {
  const v1 = entry({ id: "v1", amountMinor: 100, voided: true });
  const v2 = entry({ id: "v2", amountMinor: 120, voided: true, replacesId: "v1" });
  const v3 = entry({ id: "v3", amountMinor: 125, replacesId: "v2" });
  const other = entry({ id: "x", amountMinor: 999, voided: true });

  it("lists only the latest version of each entry (and plain voided entries)", () => {
    expect(currentVersions([v1, v2, v3, other]).map((e) => e.id)).toEqual(["v3", "x"]);
  });

  it("counts only the latest version in totals", () => {
    expect(periodTotals([v1, v2, v3], october, "INR").expenseMinor).toBe(125);
  });

  it("returns every version, oldest first", () => {
    expect(versionHistory([v3, other, v1, v2], "v3").map((e) => e.id)).toEqual(["v1", "v2", "v3"]);
    expect(versionHistory([v1], "v1").map((e) => e.id)).toEqual(["v1"]);
    expect(versionHistory([v1], "missing")).toEqual([]);
  });
});
