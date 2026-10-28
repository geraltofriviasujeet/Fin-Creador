import { describe, expect, it } from "vitest";
import type { AccountKind, LiabilityKind } from "./holdings";
import { summarizeHoldings } from "./holdings";
import { type NetWorthAccount, type NetWorthInput, netWorth } from "./net-worth";

const TODAY = "2026-10-28";

const acct = (id: string, kind: AccountKind | LiabilityKind, balanceMinor: number, extra: Partial<NetWorthAccount> = {}): NetWorthAccount => ({
  id,
  kind,
  name: id,
  currency: "INR",
  balanceMinor,
  archived: false,
  ...extra,
});

const input = (extra: Partial<NetWorthInput> = {}): NetWorthInput => ({
  currency: "INR",
  today: TODAY,
  accounts: { accounts: [], pendingCapitalised: [] },
  investments: { holdings: [], deposits: [] },
  statutory: [],
  ...extra,
});

const line = (r: ReturnType<typeof netWorth>, key: string) => r.lines.find((l) => l.key === key);

describe("netWorth", () => {
  it("the worked example: every part, exact total", () => {
    const r = netWorth(
      input({
        accounts: {
          accounts: [
            acct("bank", "bank", 2_00_000_00),
            acct("cash", "cash", 5_000_00),
            acct("home loan", "loan", -10_00_000_00),
            acct("card emi", "loan", -12_000_00),
            acct("card", "card", -8_500_00),
            acct("friend", "borrowing", -20_000_00),
          ],
          pendingCapitalised: [{ accountId: "home loan", minor: 15_000_00 }],
        },
        investments: {
          holdings: [{ name: "ACME", currency: "INR", valueMinor: 50_000_00, priceDate: "2026-10-27", priceAge: "fresh" }],
          deposits: [{ name: "SBI FD", currency: "INR", valueMinor: 1_05_000_00, matured: false }],
        },
        statutory: [{ name: "Income tax", currency: "INR", leftMinor: 30_000_00 }],
      }),
    );
    // 2,05,000 + 50,000 + 1,05,000 − (10,00,000 + 12,000 + 15,000) − 8,500 − 20,000 − 30,000
    expect(r.totalMinor).toBe(-7_25_500_00);
    expect(r.assetsMinor).toBe(3_60_000_00);
    expect(r.liabilitiesMinor).toBe(10_85_500_00);
    expect(r.lines.map((l) => [l.key, l.amountMinor, l.count])).toEqual([
      ["available", 2_05_000_00, 2],
      ["holdings", 50_000_00, 1],
      ["deposits", 1_05_000_00, 1],
      ["loans", 10_27_000_00, 2],
      ["cards", 8_500_00, 1],
      ["borrowings", 20_000_00, 1],
      ["statutory", 30_000_00, 1],
    ]);
    expect(line(r, "deposits")?.flags).toEqual([{ flag: "estimate", count: 1 }]);
    expect(r.failed).toEqual([]);
  });

  it("a card in credit is its own asset line; liabilities never go negative", () => {
    const r = netWorth(input({ accounts: { accounts: [acct("card", "card", 1_200_00), acct("card2", "card", -300_00)], pendingCapitalised: [] } }));
    expect(line(r, "credit")?.amountMinor).toBe(1_200_00);
    expect(line(r, "cards")?.amountMinor).toBe(300_00);
    expect(r.lines.every((l) => l.side === "asset" || l.amountMinor >= 0)).toBe(true);
    expect(r.totalMinor).toBe(900_00);
  });

  it("Total available keeps its definition (same as summarizeHoldings)", () => {
    const accounts = [acct("a", "bank", 1_000_00), acct("b", "cash", -200_00), acct("c", "other", 50_00), acct("usd", "bank", 9_00, { currency: "USD" }), acct("old", "bank", 7_00, { archived: true }), acct("card", "card", -400_00)];
    const r = netWorth(input({ accounts: { accounts, pendingCapitalised: [] } }));
    const holdings = summarizeHoldings(
      accounts.map((a) => ({ ...a, bankType: null, openingBalanceMinor: a.balanceMinor, openingBalanceDate: TODAY, inflowMinor: 0, outflowMinor: 0 })),
      "INR",
    );
    expect(line(r, "available")?.amountMinor).toBe(holdings.totalAvailableMinor);
    expect(line(r, "available")?.amountMinor).toBe(850_00);
  });

  it("other currencies and holdings without a price are listed, not included", () => {
    const r = netWorth(
      input({
        accounts: { accounts: [acct("Wise", "bank", 100_00, { currency: "USD" }), acct("US card", "card", -50_00, { currency: "USD" })], pendingCapitalised: [] },
        investments: { holdings: [{ name: "NOPRICE", currency: "INR", valueMinor: null, priceDate: null, priceAge: null }], deposits: [] },
        statutory: [{ name: "US tax", currency: "USD", leftMinor: 10_00 }],
      }),
    );
    expect(r.notIncluded).toEqual([
      { name: "Wise", reason: "currency", currency: "USD" },
      { name: "US card", reason: "currency", currency: "USD" },
      { name: "NOPRICE", reason: "no_price", currency: "INR" },
      { name: "US tax", reason: "currency", currency: "USD" },
    ]);
    expect(r.totalMinor).toBe(0);
    expect(r.empty).toBe(false);
  });

  it("investments in INR are not included when the profile currency is another", () => {
    const r = netWorth(input({ currency: "USD", investments: { holdings: [{ name: "ACME", currency: "INR", valueMinor: 10_00, priceDate: TODAY, priceAge: "fresh" }], deposits: [] } }));
    expect(r.notIncluded).toEqual([{ name: "ACME", reason: "currency", currency: "INR" }]);
    expect(r.totalMinor).toBe(0);
  });

  it("old and stale prices: valued at the last price, flagged, as-of from the oldest to the newest price", () => {
    const r = netWorth(
      input({
        investments: {
          holdings: [
            { name: "A", currency: "INR", valueMinor: 100, priceDate: "2026-10-27", priceAge: "fresh" },
            { name: "B", currency: "INR", valueMinor: 200, priceDate: "2026-10-15", priceAge: "old" },
            { name: "C", currency: "INR", valueMinor: 300, priceDate: "2026-09-01", priceAge: "stale" },
          ],
          deposits: [{ name: "FD", currency: "INR", valueMinor: 1_10_000_00, matured: true }],
        },
      }),
    );
    const h = line(r, "holdings")!;
    expect([h.amountMinor, h.asOf, h.flags]).toEqual([
      600,
      { from: "2026-09-01", to: "2026-10-27" },
      [
        { flag: "old_price", count: 1 },
        { flag: "stale_price", count: 1 },
      ],
    ]);
    expect(line(r, "deposits")?.flags).toEqual([{ flag: "matured", count: 1 }]);
  });

  it("pending capitalised interest is added to the loan once, and only while not posted (the loader passes it)", () => {
    const loan = acct("loan", "loan", -1_00_000_00);
    expect(line(netWorth(input({ accounts: { accounts: [loan], pendingCapitalised: [{ accountId: "loan", minor: 5_000_00 }] } })), "loans")).toMatchObject({ amountMinor: 1_05_000_00, count: 1 });
    // A loan that owes nothing yet but has interest to add still counts as one loan.
    expect(line(netWorth(input({ accounts: { accounts: [acct("loan", "loan", 0)], pendingCapitalised: [{ accountId: "loan", minor: 5_000_00 }] } })), "loans")).toMatchObject({ amountMinor: 5_000_00, count: 1 });
    // Interest on an archived or unknown account is ignored.
    expect(netWorth(input({ accounts: { accounts: [acct("loan", "loan", 0, { archived: true })], pendingCapitalised: [{ accountId: "loan", minor: 5_000_00 }] } })).totalMinor).toBe(0);
  });

  it("archived accounts and paid statutory dues are left out", () => {
    const r = netWorth(
      input({
        accounts: { accounts: [acct("old bank", "bank", 9_00, { archived: true }), acct("old card", "card", -9_00, { archived: true })], pendingCapitalised: [] },
        statutory: [{ name: "Paid fine", currency: "INR", leftMinor: 0 }],
      }),
    );
    expect([r.totalMinor, r.lines, r.empty]).toEqual([0, [], true]);
  });

  it("a money account at 0 still shows Total available", () => {
    const r = netWorth(input({ accounts: { accounts: [acct("cash", "cash", 0)], pendingCapitalised: [] } }));
    expect(r.lines.map((l) => [l.key, l.amountMinor, l.count])).toEqual([["available", 0, 1]]);
    expect(r.empty).toBe(false);
  });

  it("a part that failed: no total, the other parts still shown", () => {
    const r = netWorth(input({ investments: null, accounts: { accounts: [acct("bank", "bank", 100)], pendingCapitalised: [] } }));
    expect([r.totalMinor, r.assetsMinor, r.liabilitiesMinor, r.failed, r.empty]).toEqual([null, null, null, ["investments"], false]);
    expect(line(r, "available")?.amountMinor).toBe(100);
    expect(netWorth(input({ accounts: null, statutory: null })).failed).toEqual(["accounts", "statutory"]);
  });
});

// ---------------------------------------------------------------------------
// Property: net worth = Σ active profile-currency account balances (liability accounts too)
//   + holdings with a price + deposits − statutory left − pending capitalised interest.
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32), so a failure always reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("netWorth property", () => {
  it("equals the sum of every counted figure, for 500 random portfolios", () => {
    const rand = rng(8_2026_10_28);
    const int = (max: number) => Math.floor(rand() * max);
    const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
    const kinds = ["bank", "cash", "other", "loan", "card", "borrowing"] as const;
    for (let run = 0; run < 500; run++) {
      const accounts = Array.from({ length: int(8) }, (_, i) => {
        const kind = pick(kinds);
        const liability = kind === "loan" || kind === "card" || kind === "borrowing";
        // Liability accounts are mostly owed; sometimes in credit or settled.
        const balance = liability ? pick([-1, -1, -1, 0, 1]) * int(1_00_000_00) : int(2_00_000_00) - 20_000_00;
        return acct(`a${i}`, kind, balance, { currency: rand() < 0.15 ? "USD" : "INR", archived: rand() < 0.15 });
      });
      const pendingCapitalised = accounts.filter((a) => a.kind === "loan" && rand() < 0.5).map((a) => ({ accountId: a.id, minor: 1 + int(50_000_00) }));
      const holdings = Array.from({ length: int(5) }, (_, i) => {
        const priced = rand() < 0.85;
        return { name: `h${i}`, currency: "INR", valueMinor: priced ? int(10_00_000_00) : null, priceDate: priced ? TODAY : null, priceAge: priced ? pick(["fresh", "old", "stale"] as const) : null };
      });
      const deposits = Array.from({ length: int(4) }, (_, i) => ({ name: `d${i}`, currency: "INR", valueMinor: int(5_00_000_00), matured: rand() < 0.3 }));
      const statutory = Array.from({ length: int(4) }, (_, i) => ({ name: `s${i}`, currency: rand() < 0.1 ? "USD" : "INR", leftMinor: int(50_000_00) }));
      const r = netWorth(input({ accounts: { accounts, pendingCapitalised }, investments: { holdings, deposits }, statutory }));

      const counted = accounts.filter((a) => !a.archived && a.currency === "INR");
      const countedIds = new Set(counted.filter((a) => a.kind === "loan").map((a) => a.id));
      const expected =
        counted.reduce((s, a) => s + a.balanceMinor, 0) +
        holdings.reduce((s, h) => s + (h.valueMinor ?? 0), 0) +
        deposits.reduce((s, d) => s + d.valueMinor, 0) -
        statutory.filter((d) => d.currency === "INR").reduce((s, d) => s + d.leftMinor, 0) -
        pendingCapitalised.filter((p) => countedIds.has(p.accountId)).reduce((s, p) => s + p.minor, 0);
      expect(r.totalMinor, `run ${run}`).toBe(expected);
      expect(r.assetsMinor! - r.liabilitiesMinor!).toBe(expected);
      expect(r.lines.filter((l) => l.side === "liability").every((l) => l.amountMinor >= 0)).toBe(true);
      expect(r.lines.every((l) => Number.isSafeInteger(l.amountMinor))).toBe(true);
    }
  });
});
