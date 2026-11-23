import { describe, expect, it } from "vitest";
import { formatDayMonth } from "./local-time";
import {
  type SafeToSpendAccount,
  type SafeToSpendBill,
  type SafeToSpendGoal,
  type SafeToSpendIncome,
  type SafeToSpendInput,
  ceilToWholeMinor,
  floorToWholeMinor,
  safeToSpend,
} from "./safe-to-spend";

// Demo figures only. ₹1 = 100 paise.
const rs = (rupees: number) => Math.round(rupees * 100);
/** Noon in India on `date`. */
const noonIst = (date: string) => new Date(`${date}T06:30:00Z`);

const account = (id: string, rupees: number, extra: Partial<SafeToSpendAccount> = {}): SafeToSpendAccount => ({
  id,
  name: id,
  kind: "bank",
  currency: "INR",
  archived: false,
  startOfTodayMinor: rs(rupees),
  ...extra,
});

const monthlyIncome = (id: string, startDate: string, rupees: number, extra: Partial<SafeToSpendIncome> = {}): SafeToSpendIncome => ({
  id,
  name: id,
  schedule: { frequency: "monthly", startDate, endDate: null },
  amountMinor: rs(rupees),
  currency: "INR",
  archived: false,
  recordedToday: [],
  ...extra,
});

const bill = (id: string, dueDate: string, rupees: number, accountId: string | null = "savings"): SafeToSpendBill => ({
  id,
  name: id,
  dueDate,
  amountMinor: rs(rupees),
  currency: "INR",
  accountId,
});

const goal = (id: string, monthlyRupees: number, contributions: [string, number][] = []): SafeToSpendGoal => ({
  id,
  name: id,
  monthlySavingMinor: rs(monthlyRupees),
  currency: "INR",
  contributions: contributions.map(([date, rupees]) => ({ date, amountMinor: rs(rupees) })),
});

const input = (overrides: Partial<SafeToSpendInput>): SafeToSpendInput => ({
  now: noonIst("2026-11-23"),
  timeZone: "Asia/Kolkata",
  currency: "INR",
  accounts: [],
  incomes: [],
  bills: [],
  goals: [],
  spentTodayMinor: 0,
  ...overrides,
});

const daily = (i: SafeToSpendInput) => {
  const result = safeToSpend(i);
  if (result.kind !== "daily") throw new Error("expected a daily figure");
  return result;
};

/** Example 1 and the no-income-date example share these figures. */
const normalMonth = {
  accounts: [
    account("savings", 38_500),
    account("cash", 3_500, { kind: "cash" }),
    // Not counted: a loan, an archived account and another currency.
    account("car-loan", -2_40_000, { kind: "loan" }),
    account("old-bank", 10_000, { archived: true }),
    account("usd", 500, { currency: "USD" }),
  ],
  bills: [
    bill("Electricity", "2026-11-25", 2_400),
    bill("Phone", "2026-11-28", 600),
    bill("Internet", "2026-11-30", 1_000),
    bill("Rent", "2026-12-01", 12_000), // on payday: after the window
    bill("Overdue", "2026-11-20", 999), // before today: outside the rule's window
  ],
  goals: [goal("Emergency fund", 5_000, [["2026-11-05", 3_000], ["2026-10-20", 4_000]])],
};

describe("safeToSpend: worked examples", () => {
  it("normal month: ₹42,000 left → ₹4,500 a day, ₹3,300 left today after ₹1,200 spent", () => {
    const r = daily(
      input({ ...normalMonth, incomes: [monthlyIncome("Salary", "2026-01-01", 85_000)], spentTodayMinor: rs(1_200) }),
    );
    expect(r.today).toBe("2026-11-23");
    expect(r.nextIncomeDate).toBe("2026-12-01");
    expect(r.lastDay).toBe("2026-11-30");
    expect(r.days).toBe(8);
    expect(r.moneyLeftMinor).toBe(rs(42_000));
    expect(r.billsMinor).toBe(rs(4_000));
    expect(r.bills.map((b) => b.id)).toEqual(["Electricity", "Phone", "Internet"]);
    expect(r.goalSavingMinor).toBe(rs(2_000)); // ₹5,000 due 1 Nov, ₹3,000 put toward it since
    expect(r.availableMinor).toBe(rs(36_000));
    expect(r.dailyMinor).toBe(rs(4_500));
    expect(r.leftTodayMinor).toBe(rs(3_300));
    expect(r.shortMinor).toBe(0);
    expect(r.shortAccounts).toEqual([]);
    expect(r.paydayPending).toBe(false);
  });

  it("bills bigger than money left: ₹0 a day, ₹3,000 short before 1 Dec, HDFC Savings named", () => {
    const r = daily(
      input({
        accounts: [account("hdfc", 9_000, { name: "HDFC Savings" })],
        incomes: [monthlyIncome("Salary", "2026-01-01", 85_000)],
        bills: [bill("Rent", "2026-11-28", 12_000, "hdfc")],
        spentTodayMinor: rs(250),
      }),
    );
    expect(r.days).toBe(8);
    expect(r.dailyMinor).toBe(0);
    expect(r.leftTodayMinor).toBe(-rs(250));
    expect(r.availableMinor).toBe(-rs(3_000));
    expect(r.shortMinor).toBe(rs(3_000));
    expect(formatDayMonth(r.nextIncomeDate)).toBe("1 Dec");
    expect(r.shortAccounts).toEqual([
      {
        accountId: "hdfc",
        accountName: "HDFC Savings",
        bill: { id: "Rent", name: "Rent", dueDate: "2026-11-28" },
        shortAfterBillMinor: rs(3_000),
        shortByEndMinor: rs(3_000),
      },
    ]);
  });

  it("no income date: money left this month ₹36,000, no per-day figure, flagged", () => {
    const r = safeToSpend(input({ ...normalMonth, spentTodayMinor: rs(1_200) }));
    expect(r.kind).toBe("month");
    if (r.kind !== "month") return;
    expect(r.needsIncomeDate).toBe(true);
    expect(r.lastDay).toBe("2026-11-30");
    expect(r.availableMinor).toBe(rs(36_000));
    expect(r).not.toHaveProperty("dailyMinor");
  });

  it("income on the 15th with a monthly goal: ₹1,090 a day, ₹490 left today", () => {
    const r = daily(
      input({
        accounts: [account("savings", 38_500), account("cash", 3_500, { kind: "cash" })],
        incomes: [monthlyIncome("Salary", "2026-01-15", 85_000)],
        bills: [bill("Electricity", "2026-11-25", 2_400), bill("Phone", "2026-11-28", 600), bill("Rent", "2026-12-01", 12_000)],
        goals: [goal("Emergency fund", 5_000, [["2026-11-16", 2_000], ["2026-11-10", 5_000]])],
        spentTodayMinor: rs(600),
      }),
    );
    expect(r.nextIncomeDate).toBe("2026-12-15");
    expect(r.days).toBe(22);
    expect(r.billsMinor).toBe(rs(15_000));
    expect(r.goalSavingMinor).toBe(rs(3_000)); // the ₹5,000 on 10 Nov was last cycle's
    expect(r.dailyMinor).toBe(1_09_090); // 24,00,000 paise ÷ 22, rounded down
    expect(floorToWholeMinor(r.dailyMinor, "INR")).toBe(rs(1_090));
    expect(floorToWholeMinor(r.leftTodayMinor, "INR")).toBe(rs(490));
  });

  it("payday with the salary already recorded: start of today plus the salary", () => {
    const salary = monthlyIncome("Salary", "2026-01-01", 85_000, { recordedToday: [{ accountId: "savings", amountMinor: rs(85_000) }] });
    const r = daily(
      input({
        now: noonIst("2026-12-01"),
        accounts: [account("savings", 6_200)],
        incomes: [salary],
        bills: [bill("Rent", "2026-12-05", 22_000), bill("EMI", "2026-12-07", 8_450), bill("Card", "2026-12-20", 6_300)],
        goals: [goal("Emergency fund", 5_000, [["2026-11-03", 5_000]])],
        spentTodayMinor: rs(500),
      }),
    );
    expect(r.nextIncomeDate).toBe("2027-01-01");
    expect(r.days).toBe(31);
    expect(r.moneyLeftMinor).toBe(rs(91_200));
    expect(r.billsMinor).toBe(rs(36_750));
    expect(r.goalSavingMinor).toBe(rs(5_000)); // due today; last month's saving doesn't count
    expect(r.dailyMinor).toBe(1_59_516);
    expect(floorToWholeMinor(r.dailyMinor, "INR")).toBe(rs(1_595));
    expect(floorToWholeMinor(r.leftTodayMinor, "INR")).toBe(rs(1_095));
    expect(r.paydayPending).toBe(false);
  });

  it("payday before the salary is recorded: not counted yet, flagged, next income after today", () => {
    const r = daily(
      input({
        now: noonIst("2026-12-01"),
        accounts: [account("savings", 6_200)],
        incomes: [monthlyIncome("Salary", "2026-01-01", 85_000)],
      }),
    );
    expect(r.moneyLeftMinor).toBe(rs(6_200));
    expect(r.nextIncomeDate).toBe("2027-01-01");
    expect(r.days).toBe(31);
    expect(r.paydayPending).toBe(true);
  });

  it("two incomes on different dates: the earliest upcoming one; goal saving once per pay cycle", () => {
    const incomes = [monthlyIncome("Salary", "2026-01-01", 85_000), monthlyIncome("Freelance", "2026-01-15", 20_000)];
    const r = daily(
      input({
        now: noonIst("2026-12-03"),
        accounts: [account("savings", 60_000)],
        incomes,
        bills: [bill("Rent", "2026-12-05", 22_000), bill("EMI", "2026-12-07", 8_450), bill("Card", "2026-12-20", 6_300)],
        goals: [goal("Emergency fund", 5_000)],
      }),
    );
    expect(r.nextIncomeDate).toBe("2026-12-15");
    expect(r.days).toBe(12);
    expect(r.billsMinor).toBe(rs(30_450));
    expect(r.goalSavingMinor).toBe(rs(5_000));
    expect(r.dailyMinor).toBe(2_04_583);

    // 16 December: next income 1 January. Saved on 2 December, so not due again.
    const later = daily(
      input({
        now: noonIst("2026-12-16"),
        accounts: [account("savings", 50_000)],
        incomes,
        goals: [goal("Emergency fund", 5_000, [["2026-12-02", 5_000]])],
      }),
    );
    expect(later.nextIncomeDate).toBe("2027-01-01");
    expect(later.days).toBe(16);
    expect(later.goalSavingMinor).toBe(0);
  });
});

describe("safeToSpend: dates and time zones", () => {
  const salaryOn1st = [monthlyIncome("Salary", "2026-01-01", 85_000)];

  it("uses the date in the profile time zone", () => {
    const now = new Date("2026-11-30T19:00:00Z"); // 1 Dec 00:30 in India, 30 Nov 14:00 in New York
    const india = daily(input({ now, timeZone: "Asia/Kolkata", accounts: [account("savings", 1_000)], incomes: salaryOn1st }));
    expect(india.today).toBe("2026-12-01");
    expect(india.nextIncomeDate).toBe("2027-01-01");
    expect(india.paydayPending).toBe(true);

    const newYork = daily(input({ now, timeZone: "America/New_York", accounts: [account("savings", 1_000)], incomes: salaryOn1st }));
    expect(newYork.today).toBe("2026-11-30");
    expect(newYork.days).toBe(1);
    expect(newYork.dailyMinor).toBe(rs(1_000));
  });

  it("one day left: the whole amount is for today (year boundary)", () => {
    const r = daily(input({ now: noonIst("2026-12-31"), accounts: [account("savings", 2_000)], incomes: salaryOn1st, bills: [bill("Phone", "2026-12-31", 500)] }));
    expect(r.nextIncomeDate).toBe("2027-01-01");
    expect(r.lastDay).toBe("2026-12-31");
    expect(r.days).toBe(1);
    expect(r.dailyMinor).toBe(rs(1_500));
  });

  it("never divides by zero: on payday the window runs to the next income", () => {
    const r = daily(input({ now: noonIst("2027-01-01"), accounts: [account("savings", 3_100)], incomes: salaryOn1st }));
    expect(r.days).toBe(31);
    expect(r.dailyMinor).toBe(rs(100));
  });

  it("income on the 31st falls on the month's last day, including 29 February", () => {
    const on31st = [monthlyIncome("Salary", "2026-01-31", 85_000)];
    expect(daily(input({ now: noonIst("2027-02-10"), incomes: on31st })).nextIncomeDate).toBe("2027-02-28");
    expect(daily(input({ now: noonIst("2027-02-10"), incomes: on31st })).days).toBe(18);
    expect(daily(input({ now: noonIst("2028-02-10"), incomes: on31st })).nextIncomeDate).toBe("2028-02-29");
    expect(daily(input({ now: noonIst("2028-02-10"), incomes: on31st })).days).toBe(19);
    // 30 November is that month's payday, so the next one is 31 December.
    expect(daily(input({ now: noonIst("2026-11-30"), incomes: on31st })).nextIncomeDate).toBe("2026-12-31");
  });

  it("no income date at the year's end: the month ends on 31 December", () => {
    const r = safeToSpend(input({ now: noonIst("2026-12-31"), accounts: [account("savings", 2_000)], bills: [bill("Phone", "2026-12-31", 500), bill("Rent", "2027-01-01", 900)] }));
    expect(r.kind).toBe("month");
    expect(r.lastDay).toBe("2026-12-31");
    expect(r.availableMinor).toBe(rs(1_500));
  });

  it("no income date in a leap February: the month ends on the 29th", () => {
    const r = safeToSpend(input({ now: noonIst("2028-02-20"), bills: [bill("Phone", "2028-02-29", 500)] }));
    expect(r.lastDay).toBe("2028-02-29");
    expect(r.billsMinor).toBe(rs(500));
  });

  it("an income that has ended or is archived gives no income date", () => {
    const ended = monthlyIncome("Old job", "2025-01-01", 50_000, { schedule: { frequency: "monthly", startDate: "2025-01-01", endDate: "2026-06-01" } });
    const archived = monthlyIncome("Archived", "2026-01-01", 50_000, { archived: true });
    expect(safeToSpend(input({ incomes: [ended, archived] })).kind).toBe("month");
  });
});

describe("safeToSpend: goals and shortfalls", () => {
  it("a goal already saved for is not due; saving more does not add money", () => {
    const r = daily(
      input({
        accounts: [account("savings", 10_000)],
        incomes: [monthlyIncome("Salary", "2026-01-15", 85_000)],
        goals: [goal("Trip", 3_000, [["2026-11-15", 4_000]]), goal("Bike", 2_000, [["2026-11-20", 500]])],
      }),
    );
    expect(r.goalSavingMinor).toBe(rs(1_500));
  });

  it("with a weekly main income, goal saving is due from the 1st of the month", () => {
    const weekly = monthlyIncome("Wages", "2026-11-02", 10_000, { schedule: { frequency: "weekly", startDate: "2026-11-02", endDate: null } });
    const r = daily(input({ accounts: [account("savings", 10_000)], incomes: [weekly], goals: [goal("Trip", 3_000, [["2026-11-01", 1_000]])] }));
    expect(r.nextIncomeDate).toBe("2026-11-30");
    expect(r.goalSavingMinor).toBe(rs(2_000));
  });

  it("names each account that goes short, even when the total is fine", () => {
    const r = daily(
      input({
        accounts: [account("sbi", 2_000, { name: "SBI" }), account("hdfc", 50_000, { name: "HDFC" })],
        incomes: [monthlyIncome("Salary", "2026-01-01", 85_000)],
        bills: [
          bill("Phone", "2026-11-24", 600, "sbi"),
          bill("Rent", "2026-11-26", 3_380, "sbi"),
          bill("Gym", "2026-11-29", 1_000, "sbi"),
          bill("Card", "2026-11-27", 5_000, "hdfc"),
          bill("Maid", "2026-11-28", 2_000, null),
        ],
      }),
    );
    expect(r.shortMinor).toBe(0);
    expect(r.billsMinor).toBe(rs(11_980));
    expect(r.shortAccounts).toEqual([
      {
        accountId: "sbi",
        accountName: "SBI",
        bill: { id: "Rent", name: "Rent", dueDate: "2026-11-26" },
        shortAfterBillMinor: rs(1_980),
        shortByEndMinor: rs(2_980),
      },
    ]);
  });

  it("payday income counts toward the account it went into", () => {
    const salary = monthlyIncome("Salary", "2026-01-01", 85_000, { recordedToday: [{ accountId: "sbi", amountMinor: rs(85_000) }] });
    const r = daily(
      input({
        now: noonIst("2026-12-01"),
        accounts: [account("sbi", 1_000, { name: "SBI" })],
        incomes: [salary],
        bills: [bill("Rent", "2026-12-02", 22_000, "sbi")],
      }),
    );
    expect(r.shortAccounts).toEqual([]);
    expect(r.moneyLeftMinor).toBe(rs(86_000));
  });
});

describe("safeToSpend: input checks and display rounding", () => {
  it("refuses amounts that are not whole minor units", () => {
    expect(() => safeToSpend(input({ spentTodayMinor: 1.5 }))).toThrow(RangeError);
    expect(() => safeToSpend(input({ bills: [{ ...bill("Rent", "2026-11-25", 1), amountMinor: -1 }] }))).toThrow(RangeError);
  });

  it("rounds down for spending and up for a shortfall, in whole currency units", () => {
    expect(floorToWholeMinor(1_09_090, "INR")).toBe(1_09_000);
    expect(floorToWholeMinor(-1_050, "INR")).toBe(-1_100);
    expect(ceilToWholeMinor(3_00_001, "INR")).toBe(3_00_100);
    expect(ceilToWholeMinor(3_00_000, "INR")).toBe(3_00_000);
    expect(floorToWholeMinor(1_234, "JPY")).toBe(1_234);
  });
});
