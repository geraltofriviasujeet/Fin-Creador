// Reader pieces for the later bank-statement import (9b). Fixture rows are synthetic, built from
// the owner's layout description only (columns Date, Instrument ID, Amount, Type, Balance,
// Remarks; DD/MM/YYYY; one-decimal amounts; newest first; page footers; Remarks wrapping over
// two lines; UPI remarks). Invented names, references and handles; never a real statement.
import { describe, expect, it } from "vitest";
import { hasDigitRun } from "./digits";
import {
  type StatementLine,
  checkBalanceChain,
  cleanStatementDescription,
  isStatementPageFooter,
  parseStatementAmount,
  parseStatementAmountWithType,
  parseStatementBalance,
  parseStatementDate,
  parseStatementDirection,
} from "./statements";

// Rows as cells, newest first; the second Remarks line is the wrapped part of the cell.
const ROWS = [
  ["28/10/2026", "", "80.0", "DR", "11,420.0", "UPI/DR/600000000001/ASHA TEA", "STALL/EXMB/9800000001@okexample"],
  ["27/10/2026", "", "1,500.0", "CR", "11,500.0", "UPI/CR/600000000002/RAVI KUMAR/EXMB/ravi.k@okexample"],
  ["25/10/2026", "", "2,000.00", "DR", "10,000.0", "ATM CASH WITHDRAWAL", ""],
  ["20/10/2026", "", "12,000.0", "CR", "12,000.0", "SALARY EXAMPLE PVT LTD", ""],
] as const;

const lines = ROWS.map(([date, , amount, type, balance, remarks, wrapped]) => {
  const parsed = parseStatementAmountWithType(amount, type)!;
  return {
    date: parseStatementDate(date)!,
    amountMinor: parsed.minor,
    direction: parsed.direction!,
    balanceMinor: parseStatementBalance(balance)!,
    description: cleanStatementDescription(`${remarks} ${wrapped}`).description,
  };
});

describe("bank statement cells", () => {
  it("reads one-decimal amounts, the Type column and the balance", () => {
    expect(lines.map((l) => [l.date, l.amountMinor, l.direction, l.balanceMinor])).toEqual([
      ["2026-10-28", 8_000, "debit", 1_142_000],
      ["2026-10-27", 150_000, "credit", 1_150_000],
      ["2026-10-25", 200_000, "debit", 1_000_000],
      ["2026-10-20", 1_200_000, "credit", 1_200_000],
    ]);
    expect(parseStatementAmount("80.0")).toEqual({ minor: 8_000, direction: null });
  });

  it.each([
    ["DR", "debit"], ["dr", "debit"], ["D", "debit"], ["Debit", "debit"], ["Dr.", "debit"],
    ["CR", "credit"], ["c", "credit"], ["Credit", "credit"], ["", null], ["X", null], ["DRCR", null],
  ] as const)("Type %j -> %s", (text, direction) => expect(parseStatementDirection(text)).toBe(direction));

  it("takes the direction from the Type column, refusing a conflict with the amount's own marker", () => {
    expect(parseStatementAmountWithType("450.0", "CR")).toEqual({ minor: 45_000, direction: "credit" });
    expect(parseStatementAmountWithType("450.0 Cr", "CR")).toEqual({ minor: 45_000, direction: "credit" });
    expect(parseStatementAmountWithType("450.0 Dr", "")).toEqual({ minor: 45_000, direction: "debit" });
    expect(parseStatementAmountWithType("450.0", "")).toEqual({ minor: 45_000, direction: null });
    expect(parseStatementAmountWithType("450.0 Dr", "CR")).toBeNull();
    expect(parseStatementAmountWithType("-450.0", "DR")).toBeNull();
    expect(parseStatementAmountWithType("450.0", "XX")).toBeNull();
    expect(parseStatementAmountWithType("", "DR")).toBeNull();
  });

  it("signs balances: Dr or a minus is overdrawn, zero is allowed", () => {
    expect(parseStatementBalance("0.0")).toBe(0);
    expect(parseStatementBalance("12,000.0 Cr")).toBe(1_200_000);
    expect(parseStatementBalance("250.00 Dr")).toBe(-25_000);
    expect(parseStatementBalance("-250.0")).toBe(-25_000);
    expect(parseStatementBalance("abc")).toBeNull();
  });

  it("recognises page footers, whatever page", () => {
    expect(isStatementPageFooter("Date: 29/10/2026 Page 1")).toBe(true);
    expect(isStatementPageFooter("Date : 29/10/2026 10:15 AM   Page 2 of 3")).toBe(true);
    expect(isStatementPageFooter("28/10/2026 80.0 DR 11,420.0 UPI/DR")).toBe(false);
    expect(isStatementPageFooter("Date Instrument ID Amount Type Balance Remarks")).toBe(false);
  });
});

describe("UPI remarks", () => {
  it("keeps only the payee name, joining a wrapped cell", () => {
    expect(lines.map((l) => l.description)).toEqual(["ASHA TEA STALL", "RAVI KUMAR", "ATM CASH WITHDRAWAL", "SALARY EXAMPLE PVT LTD"]);
  });

  it("drops the reference, bank code and handle, including a phone number in the handle", () => {
    const { description } = cleanStatementDescription("UPI/DR/600000000003/MEERA S/EXMB/98000000@okexample");
    expect(description).toBe("MEERA S");
    expect(cleanStatementDescription("upi / cr / 600000000004 / GOPAL STORES / EXMB / gopal@okexample").description).toBe("GOPAL STORES");
  });

  it("strips digits from the payee too, and never returns an empty note", () => {
    expect(cleanStatementDescription("UPI/DR/600000000005/9800000002/EXMB/x@okexample").description).toBe("UPI");
    expect(cleanStatementDescription("UPI/DR/600000000006/SHOP 24/EXMB/y@okexample").description).toBe("SHOP 24");
    for (const l of lines) expect(hasDigitRun(l.description, 4)).toBe(false);
  });

  it("leaves remarks that are not UPI to the usual cleaning", () => {
    expect(cleanStatementDescription("NEFT EXAMPLE PVT LTD 600000000007").description).toBe("NEFT EXAMPLE PVT LTD");
  });
});

describe("checkBalanceChain", () => {
  it("passes a newest-first statement whose balances follow", () => {
    expect(checkBalanceChain(lines, "newest_first")).toEqual({ status: "ok" });
    expect(checkBalanceChain([...lines].reverse(), "oldest_first")).toEqual({ status: "ok" });
  });

  it("flags the line where the chain breaks, in the order given", () => {
    const broken = lines.map((l, i) => (i === 1 ? { ...l, amountMinor: 140_000 } : l));
    expect(checkBalanceChain(broken, "newest_first")).toEqual({ status: "broken", lines: [1] });
    // The same lines read in the wrong order do not chain.
    expect(checkBalanceChain(lines, "oldest_first").status).toBe("broken");
  });

  it("handles an overdrawn balance", () => {
    const overdrawn: Pick<StatementLine, "amountMinor" | "direction" | "balanceMinor">[] = [
      { amountMinor: 50_000, direction: "credit", balanceMinor: 25_000 },
      { amountMinor: 30_000, direction: "debit", balanceMinor: -25_000 },
      { amountMinor: 5_000, direction: "credit", balanceMinor: 5_000 },
    ];
    expect(checkBalanceChain(overdrawn, "newest_first")).toEqual({ status: "ok" });
  });

  it("does not check without balances on every line or with fewer than two lines", () => {
    expect(checkBalanceChain([lines[0]!], "newest_first")).toEqual({ status: "unchecked" });
    expect(checkBalanceChain([lines[0]!, { amountMinor: 1, direction: "debit" }], "newest_first")).toEqual({ status: "unchecked" });
  });
});
