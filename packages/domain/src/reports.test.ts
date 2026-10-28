import { describe, expect, it } from "vitest";
import { fdValueOn } from "./fixed-deposits";
import { netWorth } from "./net-worth";
import { type SeriesInput, cashFlowReport, monthStart, monthsBetween, netWorthSeries, trendDates } from "./reports";

const TODAY = "2026-10-28";

describe("months and trend dates", () => {
  it("month starts across years", () => {
    expect([monthStart("2026-01-15", -1), monthStart("2026-12-31", 1), monthStart("2024-02-29", 0), monthStart("2026-10-28", -11)]).toEqual([
      "2025-12-01",
      "2027-01-01",
      "2024-02-01",
      "2025-11-01",
    ]);
    expect(monthsBetween("2025-11-01", "2026-02-01")).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });

  it("month-ends before the current month (leap February included), then today", () => {
    expect(trendDates("2024-01-01", "2024-03-10")).toEqual(["2024-01-31", "2024-02-29", "2024-03-10"]);
    expect(trendDates("2026-10-01", TODAY)).toEqual([TODAY]);
    expect(trendDates("2025-11-01", TODAY)).toHaveLength(12);
  });
});

describe("cashFlowReport", () => {
  const months = [
    { month: "2026-08-01", incomeMinor: 50_000_00, expenseMinor: 20_000_00, categories: [{ categoryId: "food", expenseMinor: 12_000_00 }, { categoryId: "rent", expenseMinor: 8_000_00 }] },
    { month: "2026-09-01", incomeMinor: 0, expenseMinor: 5_000_00, categories: [{ categoryId: "food", expenseMinor: 5_000_00 }] },
    { month: "2026-10-01", incomeMinor: 10_000_00, expenseMinor: 15_000_00, categories: [{ categoryId: "rent", expenseMinor: 15_000_00 }] },
  ];

  it("net, savings rate (— without income, negative when over), so far, each month's largest category", () => {
    const r = cashFlowReport(months, TODAY);
    expect(r.rows.map((x) => [x.month, x.netMinor, x.savingsRateBps, x.soFar, x.topCategory?.categoryId ?? null, x.range.end])).toEqual([
      ["2026-08-01", 30_000_00, 6000, false, "food", "2026-08-31"],
      ["2026-09-01", -5_000_00, null, false, "food", "2026-09-30"],
      ["2026-10-01", -5_000_00, -5000, true, "rent", TODAY],
    ]);
    expect(r.totals).toEqual({ incomeMinor: 60_000_00, expenseMinor: 40_000_00, netMinor: 20_000_00, savingsRateBps: 3333 });
    expect(r.topCategories).toEqual([
      { categoryId: "rent", expenseMinor: 23_000_00 },
      { categoryId: "food", expenseMinor: 17_000_00 },
    ]);
  });

  it("a month with no spending has no top category", () => {
    expect(cashFlowReport([{ month: "2026-10-01", incomeMinor: 0, expenseMinor: 0, categories: [] }], TODAY).rows[0]?.topCategory).toBeNull();
  });
});

describe("netWorthSeries", () => {
  const fd = { principalMinor: 1_00_000_00, rateBps: 700, compounding: "quarterly" as const, startDate: "2026-09-15", maturityDate: "2027-09-15" };
  const base: SeriesInput = {
    currency: "INR",
    dates: ["2026-08-31", "2026-09-30", TODAY],
    accounts: [
      { id: "bank", kind: "bank", name: "Bank", currency: "INR" },
      { id: "loan", kind: "loan", name: "Loan", currency: "INR" },
    ],
    balances: [
      { asOf: "2026-09-30", accountId: "bank", balanceMinor: 40_000_00 },
      { asOf: "2026-09-30", accountId: "loan", balanceMinor: -10_000_00 },
      { asOf: TODAY, accountId: "bank", balanceMinor: 45_000_00 },
      { asOf: TODAY, accountId: "loan", balanceMinor: -9_000_00 },
    ],
    capitalising: [{ accountId: "loan", minor: 300_00, postedOn: "2026-10-05" }],
    deposits: [{ name: "FD", currency: "INR", deposit: fd, archivedOn: null }],
    dues: [{ name: "Fine", currency: "INR", amountMinor: 1_000_00, addedOn: "2026-09-20", archivedOn: null, payments: [{ paidOn: "2026-10-10", minor: 400_00 }] }],
  };

  it("starts at the first point with data; interest until posted; FD from its start; dues minus payments by then", () => {
    const s = netWorthSeries(base);
    expect(s.map((p) => [p.date, p.isToday])).toEqual([
      ["2026-09-30", false],
      [TODAY, true],
    ]);
    const sep = s[0]!.worth;
    expect(sep.totalMinor).toBe(40_000_00 + fdValueOn(fd, "2026-09-30") - 10_000_00 - 300_00 - 1_000_00);
    const today = s[1]!.worth;
    expect(today.totalMinor).toBe(45_000_00 + fdValueOn(fd, TODAY) - 9_000_00 - 600_00);
    expect(today.lines.find((l) => l.key === "deposits")?.flags).toEqual([{ flag: "estimate", count: 1 }]);
  });

  it("an archived deposit or due leaves on its archive date; a matured deposit is flagged", () => {
    const s = netWorthSeries({
      ...base,
      deposits: [{ name: "FD", currency: "INR", deposit: { ...fd, startDate: "2025-01-01", maturityDate: "2026-09-01" }, archivedOn: TODAY }],
      dues: [{ ...base.dues[0]!, archivedOn: "2026-09-30" }],
    });
    expect(s.map((p) => p.date)).toEqual(["2026-08-31", "2026-09-30", TODAY]);
    expect(s[1]!.worth.lines.find((l) => l.key === "deposits")?.flags).toEqual([{ flag: "matured", count: 1 }]);
    expect(s[1]!.worth.lines.find((l) => l.key === "statutory")).toBeUndefined();
    expect(s[2]!.worth.lines.find((l) => l.key === "deposits")).toBeUndefined();
  });

  it("no data at all: an empty series", () => {
    expect(netWorthSeries({ ...base, balances: [], capitalising: [], deposits: [], dues: [] })).toEqual([]);
  });

  it("property: today's point plus holdings equals the Overview card's netWorth for the same data", () => {
    let seed = 0x8c;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const int = (n: number) => Math.floor(rand() * n);
    const kinds = ["bank", "cash", "other", "loan", "card", "borrowing"] as const;
    for (let run = 0; run < 300; run++) {
      const accounts = Array.from({ length: int(6) }, (_, i) => ({ id: `a${i}`, kind: kinds[int(kinds.length)]!, name: `a${i}`, currency: rand() < 0.1 ? "USD" : "INR" }));
      const balances = accounts.map((a) => ({ asOf: TODAY, accountId: a.id, balanceMinor: int(2_00_000_00) - 1_00_000_00 }));
      const capitalising = accounts.filter((a) => a.kind === "loan" && rand() < 0.5).map((a) => ({ accountId: a.id, minor: 1 + int(10_000_00), postedOn: rand() < 0.5 ? null : "2026-10-01" }));
      const deposits = Array.from({ length: int(3) }, (_, i) => ({
        name: `d${i}`,
        currency: "INR",
        deposit: { principalMinor: 1 + int(5_00_000_00), rateBps: int(900), compounding: "monthly" as const, startDate: "2025-06-01", maturityDate: rand() < 0.5 ? "2026-06-01" : "2027-06-01" },
        archivedOn: null,
      }));
      const dues = Array.from({ length: int(3) }, (_, i) => ({ name: `s${i}`, currency: "INR", amountMinor: 1 + int(50_000_00), addedOn: "2026-10-01", archivedOn: null, payments: [{ paidOn: "2026-10-02", minor: int(30_000_00) }] }));
      const holdingsMinor = int(10_00_000_00);
      const [point] = netWorthSeries({ currency: "INR", dates: [TODAY], accounts, balances, capitalising, deposits, dues });
      const card = netWorth({
        currency: "INR",
        today: TODAY,
        accounts: {
          accounts: accounts.map((a, i) => ({ ...a, balanceMinor: balances[i]!.balanceMinor, archived: false })),
          pendingCapitalised: capitalising.filter((l) => l.postedOn === null).map((l) => ({ accountId: l.accountId, minor: l.minor })),
        },
        investments: {
          holdings: [{ name: "H", currency: "INR", valueMinor: holdingsMinor, priceDate: TODAY, priceAge: "fresh" }],
          deposits: deposits.map((d) => ({ name: d.name, currency: d.currency, valueMinor: fdValueOn(d.deposit, TODAY), matured: TODAY >= d.deposit.maturityDate })),
        },
        statutory: dues.map((d) => ({ name: d.name, currency: d.currency, leftMinor: Math.max(d.amountMinor - d.payments[0]!.minor, 0) })),
      });
      expect((point?.worth.totalMinor ?? 0) + holdingsMinor, `run ${run}`).toBe(card.totalMinor);
    }
  });
});
