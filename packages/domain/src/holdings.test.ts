import { describe, expect, it } from "vitest";
import { type AccountWithActivity, accountBalance, countsTowardBalance, summarizeHoldings } from "./holdings";

const account = (over: Partial<AccountWithActivity>): AccountWithActivity => ({
  id: "a",
  kind: "bank",
  bankType: "savings",
  currency: "INR",
  openingBalanceMinor: 0,
  openingBalanceDate: "2026-01-01",
  archived: false,
  inflowMinor: 0,
  outflowMinor: 0,
  ...over,
});

describe("accountBalance", () => {
  it("is opening + posted inflows − posted outflows", () => {
    expect(accountBalance(account({ openingBalanceMinor: 100_000, inflowMinor: 250_000, outflowMinor: 30_000 }))).toBe(320_000);
  });

  it("works for an overdrawn bank account", () => {
    expect(accountBalance(account({ openingBalanceMinor: -250_000, inflowMinor: 100_000 }))).toBe(-150_000);
  });

  it("counts entries on or after the opening-balance date only", () => {
    expect(countsTowardBalance("2026-01-01", "2026-01-01")).toBe(true);
    expect(countsTowardBalance("2026-03-05", "2026-01-01")).toBe(true);
    expect(countsTowardBalance("2025-12-31", "2026-01-01")).toBe(false);
  });
});

describe("summarizeHoldings", () => {
  const accounts = [
    account({ id: "hdfc", bankType: "savings", openingBalanceMinor: 24_860_000 }),
    account({ id: "icici", bankType: "current", openingBalanceMinor: 17_625_000 }),
    account({ id: "sbi", bankType: "savings", openingBalanceMinor: 3_700_000 }),
    account({ id: "cash1", kind: "cash", bankType: null, openingBalanceMinor: 1_580_000 }),
    account({ id: "cash2", kind: "cash", bankType: null, openingBalanceMinor: 500_000 }),
    account({ id: "wallet", kind: "other", bankType: null, openingBalanceMinor: 120_000 }),
    account({ id: "usd", kind: "other", bankType: null, currency: "USD", openingBalanceMinor: 99_999 }),
    account({ id: "old", openingBalanceMinor: 9_999_900, archived: true }),
  ];
  const s = summarizeHoldings(accounts, "INR");

  it("Total available sums every active account in the profile currency", () => {
    expect(s.totalAvailableMinor).toBe(24_860_000 + 17_625_000 + 3_700_000 + 1_580_000 + 500_000 + 120_000);
  });

  it("Money in banks and Cash in hand (all cash accounts) are separate", () => {
    expect(s.moneyInBanksMinor).toBe(24_860_000 + 17_625_000 + 3_700_000);
    expect(s.cashInHandMinor).toBe(2_080_000);
  });

  it("archived accounts leave the list and the totals", () => {
    expect(s.rows.map((r) => r.account.id)).not.toContain("old");
    expect(s.archived.map((a) => a.id)).toEqual(["old"]);
  });

  it("other-currency accounts are listed but not totalled or converted", () => {
    const usd = s.rows.find((r) => r.account.id === "usd");
    expect(usd).toMatchObject({ inTotal: false, balanceMinor: 99_999 });
  });

  it("counts bank accounts by type and orders banks, cash, other", () => {
    expect([s.bankCount, s.savingsCount, s.currentCount]).toEqual([3, 2, 1]);
    expect(s.rows.map((r) => r.account.kind)).toEqual(["bank", "bank", "bank", "cash", "cash", "other", "other"]);
  });

  it("is zero with no accounts", () => {
    expect(summarizeHoldings([], "INR")).toMatchObject({ totalAvailableMinor: 0, bankCount: 0, rows: [] });
  });
});
