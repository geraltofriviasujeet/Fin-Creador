// UPI app statement readers (Sprint 9e) on synthetic rows: invented people, payees, references and
// account digits. Never a real statement. The PDF path (pdf.js on synthetic PDFs) is tested in
// apps/web/lib/statements/upi-reader.test.ts.
import { describe, expect, it } from "vitest";
import {
  cleanUpiPayee,
  detectUpiApp,
  parseUpiAccount,
  parseUpiAmount,
  parseUpiDate,
  parseUpiPeriod,
  readUpiStatement,
  upiPeriodDays,
  upiReadFailureText,
  upiRowKey,
} from "./index";

/** Rows of cells; each array is one PDF row. */
const rows = (...r: (string | string[])[]): { text: string; rows: { cells: string[] }[] } => {
  const cells = r.map((x) => (typeof x === "string" ? [x] : x));
  return { text: cells.map((c) => c.join(" ")).join("\n"), rows: cells.map((c) => ({ cells: c })) };
};

const PERSON = ["Asha Example", "+91 90000 00042", "asha.example@example.test"];
const noPersonal = (value: unknown) => {
  const json = JSON.stringify(value);
  for (const p of PERSON) expect(json).not.toContain(p);
  expect(json).not.toMatch(/@/);
};

describe("shared pieces", () => {
  it("reads dates with the year in every printed form", () => {
    expect(parseUpiDate("12 Oct 2026")).toBe("2026-10-12");
    expect(parseUpiDate("12 Oct, 2026")).toBe("2026-10-12");
    expect(parseUpiDate("12 Oct'26")).toBe("2026-10-12");
    expect(parseUpiDate("01 October 2026")).toBe("2026-10-01");
    expect(parseUpiDate("Oct 12, 2026")).toBe("2026-10-12");
    expect(parseUpiDate("12/10/2026")).toBe("2026-10-12");
    expect(parseUpiDate("29 Feb 2027")).toBeNull();
    expect(parseUpiDate("29 Feb 2028")).toBe("2028-02-29");
  });

  it("reads periods and amounts", () => {
    expect(parseUpiPeriod("Statement period: 01 Aug 2026 - 31 Oct 2026")).toEqual({ from: "2026-08-01", to: "2026-10-31" });
    expect(parseUpiPeriod("Oct 01, 2026 - Oct 31, 2026")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(parseUpiPeriod("31 Oct 2026 - 01 Aug 2026")).toBeNull();
    expect(parseUpiAmount("Rs.1,234.50")).toBe(123_450);
    expect(parseUpiAmount("INR 139.00")).toBe(13_900);
    expect(parseUpiAmount("₹2,56,640.60")).toBe(25_664_060);
    expect(parseUpiAmount("₹0")).toBeNull();
    expect(upiPeriodDays({ from: "2026-01-01", to: "2026-12-31" })).toBe(365);
  });

  it("cleans payee names: no UPI ids, emails, long digit runs or masks", () => {
    expect(cleanUpiPayee("Jio Prepaid 9000000042")).toBe("Jio Prepaid");
    expect(cleanUpiPayee("Ravi asha.r@okexample")).toBe("Ravi");
    expect(cleanUpiPayee("someone@example.test")).toBe("");
    expect(cleanUpiPayee("Shop XXXX1234 Main")).toBe("Shop Main");
    expect(cleanUpiPayee("Cafe 24")).toBe("Cafe 24");
  });

  it("reads accounts as each app prints them: the bank name and the last 2 to 4 digits only", () => {
    expect(parseUpiAccount("State Bank Of India - 12", "dash")).toEqual({ bankLabel: "State Bank Of India", digits: "12" });
    expect(parseUpiAccount("XX1234", "masked")).toEqual({ bankLabel: "", digits: "1234" });
    expect(parseUpiAccount("Example Bank XXXXXX4321", "masked")).toEqual({ bankLabel: "Example Bank", digits: "4321" });
    expect(parseUpiAccount("Example Bank 4321", "space")).toEqual({ bankLabel: "Example Bank", digits: "4321" });
    expect(parseUpiAccount("Example Bank 123456789", "space")).toBeNull();
  });

  it("keys come from the reference and direction only", () => {
    const a = upiRowKey({ ref: "612345678901", direction: "debit" });
    expect(upiRowKey({ ref: "6123 4567 8901", direction: "debit" })).toBe(a);
    expect(upiRowKey({ ref: "612345678901", direction: "credit" })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("an unknown layout is not read, and Copy layout carries no text", () => {
    const read = rows("Account Statement", ["Date", "Narration", "Balance"]);
    expect(detectUpiApp(read.text)).toBeNull();
    expect(readUpiStatement(read)).toBeNull();
    const failure = upiReadFailureText({ text: read.text, rowLayouts: ["text x40 w90 c17 dy0", "text x40 w20 c4 dy0"], pageRowCounts: [2] });
    expect(failure).toContain("No UPI app layout recognised.");
    expect(failure).toContain("Page 1, row 1: text x40 w90 c17 dy0");
    expect(failure).not.toMatch(/Account Statement|Narration/);
  });
});

describe("Paytm", () => {
  const paytm = (...blocks: (string | string[])[]) =>
    rows(
      "Paytm Statement",
      PERSON[0]!,
      PERSON[1]!,
      "01 Aug 2026 - 31 Oct 2026",
      ["Total Money Paid", "- Rs.1,330"],
      ["Total Money Received", "+ Rs.1,234.50"],
      "Example Bank - 12",
      ["Date & Time", "Transaction Details", "Your Account", "Amount"],
      ...blocks,
    );

  it("reads every row type, tags, and a bank name wrapped over two lines", () => {
    const parse = readUpiStatement(
      paytm(
        ["12 Oct", "Paid to Green Leaf Cafe", "State Bank Of", "- Rs.65"],
        ["10:24 PM", "UPI ID: greenleaf@okexample on 12 Oct", "India - 12"],
        "UPI Ref No: 612345678901",
        "Note: lunch with Asha Example",
        "Tag: # Food",
        ["13 Oct", "Money sent to Ravi Kumar", "Example Bank - 34", "- Rs.1,000"],
        ["9:05 AM", "UPI ID: ravi@okexample"],
        "UPI Ref No: 612345678902",
        "Tag: # Money Transfer",
        ["14 Oct", "Received from Meera N", "Example Bank - 34", "+ Rs.1,234.50"],
        "UPI Ref No: 612345678903",
        "Tag: # Money Received",
        ["15 Oct", "Recharge of Jio Prepaid 9000000042", "Example Bank - 34", "- Rs.265"],
        "UPI Ref No: 612345678904",
        "Tag: # Bill Payments",
        ["Page 2 of 47"],
      ),
    )!;
    expect(parse.app).toBe("paytm");
    expect(parse.period).toEqual({ from: "2026-08-01", to: "2026-10-31" });
    expect(parse.issues).toEqual([]);
    expect(parse.rows.map((r) => [r.date, r.kind, r.direction, r.amountMinor, r.payee, r.tag, r.account.bankLabel, r.account.digits])).toEqual([
      ["2026-10-12", "paid", "debit", 6_500, "Green Leaf Cafe", "Food", "State Bank Of India", "12"],
      ["2026-10-13", "sent", "debit", 100_000, "Ravi Kumar", "Money Transfer", "Example Bank", "34"],
      ["2026-10-14", "received", "credit", 123_450, "Meera N", "Money Received", "Example Bank", "34"],
      ["2026-10-15", "recharge", "debit", 26_500, "Jio Prepaid", "Bill Payments", "Example Bank", "34"],
    ]);
    expect(parse.checks).toEqual([
      { name: "sent_total", status: "ok", foundMinor: 133_000, expectedMinor: 133_000 },
      { name: "received_total", status: "ok", foundMinor: 123_450, expectedMinor: 123_450 },
    ]);
    noPersonal(parse.rows.map(({ ref: _ref, ...r }) => r));
  });

  it("a payment with no reference or amount is listed as unreadable by its masked shape", () => {
    const parse = readUpiStatement(
      paytm(
        ["12 Oct", "Paid to Green Leaf Cafe", "Example Bank - 12", "- Rs.65"],
        "Tag: # Food",
        ["13 Oct", "Paid to Corner Store", "Example Bank - 12"],
        "UPI Ref No: 612345678905",
      ),
    )!;
    expect(parse.rows).toEqual([]);
    expect(parse.issues.map((i) => i.reason)).toEqual(["no_reference", "no_amount"]);
    expect(JSON.stringify(parse.issues)).not.toMatch(/Cafe|Corner/);
  });

  it("failed payments are read and marked, never imported as spending", () => {
    const parse = readUpiStatement(paytm(["12 Oct", "Paid to Green Leaf Cafe", "Example Bank - 12", "- Rs.65"], "UPI Ref No: 612345678906", "Failed"))!;
    expect(parse.rows[0]!.status).toBe("failed");
  });
});

describe("PhonePe", () => {
  it("reads Paid to, Received from and Bill paid with their accounts", () => {
    const parse = readUpiStatement(
      rows(
        "Transaction Statement for 9000000042",
        "Oct 01, 2026 - Oct 31, 2026",
        ["Date", "Transaction Details", "Type", "Amount"],
        ["Oct 12, 2026", "Paid to Tomato Foods", "Debit", "INR 139.00"],
        ["10:24 am", "Transaction ID T2610121024000001", "UTR No. 612345678911"],
        "Debited from XX1234",
        ["Oct 14, 2026", "Received from Meera N", "Credit", "INR 500.00"],
        ["Transaction ID T2610141024000002", "UTR No. 612345678912"],
        "Credited to XX1234",
        ["Oct 15, 2026", "Bill paid - Example Power Ltd", "Debit", "INR 1,200.00"],
        ["Transaction ID T2610151024000003", "UTR No. 612345678913"],
        "Debited from XX5678",
      ),
    )!;
    expect(parse.app).toBe("phonepe");
    expect(parse.issues).toEqual([]);
    expect(parse.rows.map((r) => [r.date, r.kind, r.direction, r.amountMinor, r.payee, r.account.digits, r.ref])).toEqual([
      ["2026-10-12", "paid", "debit", 13_900, "Tomato Foods", "1234", "612345678911"],
      ["2026-10-14", "received", "credit", 50_000, "Meera N", "1234", "612345678912"],
      ["2026-10-15", "bill", "debit", 120_000, "Example Power Ltd", "5678", "612345678913"],
    ]);
    expect(JSON.stringify(parse.rows.map(({ ref: _ref, ...r }) => r))).not.toContain("9000000042");
  });
});

describe("BHIM", () => {
  const header = ["Date", "Time", "Bank", "Account", "Sender", "Receiver", "Payment ID", "Type", "Amount", "Status"];
  it("reads successful rows, marks failed and pending ones, and reads cashback as income", () => {
    const parse = readUpiStatement(
      rows(
        "BHIM Transaction History",
        header,
        ["12/10/2026", "10:24:15", "Example Bank", "XXXXXX1234", "asha@upiexample(Asha Example)", "cafe@okexample(Green Leaf Cafe)", "612345678921", "DEBIT", "139.00", "SUCCESS"],
        ["13/10/2026", "11:00:00", "Example Bank", "XXXXXX1234", "asha@upiexample(Asha Example)", "shop@okexample(Corner Store)", "612345678922", "DEBIT", "80.00", "FAILED"],
        ["13/10/2026", "11:05:00", "Example Bank", "XXXXXX1234", "asha@upiexample(Asha Example)", "shop@okexample(Corner Store)", "612345678923", "DEBIT", "80.00", "PENDING"],
        ["14/10/2026", "09:00:00", "Example Bank", "XXXXXX1234", "NPCI BHIM", "asha@upiexample(Asha Example)", "612345678924", "CREDIT", "25.00", "SUCCESS"],
        ["15/10/2026", "09:30:00", "Example Bank", "XXXXXX1234", "meera@okexample(Meera N)", "asha@upiexample(Asha Example)", "612345678925", "CREDIT", "500.00", "SUCCESS"],
      ),
    )!;
    expect(parse.app).toBe("bhim");
    expect(parse.issues).toEqual([]);
    expect(parse.rows.map((r) => [r.date, r.kind, r.direction, r.amountMinor, r.payee, r.status, r.account.bankLabel, r.account.digits])).toEqual([
      ["2026-10-12", "paid", "debit", 13_900, "Green Leaf Cafe", "success", "Example Bank", "1234"],
      ["2026-10-13", "paid", "debit", 8_000, "Corner Store", "failed", "Example Bank", "1234"],
      ["2026-10-13", "paid", "debit", 8_000, "Corner Store", "pending", "Example Bank", "1234"],
      ["2026-10-14", "cashback", "credit", 2_500, "BHIM cashback", "success", "Example Bank", "1234"],
      ["2026-10-15", "received", "credit", 50_000, "Meera N", "success", "Example Bank", "1234"],
    ]);
    noPersonal(parse.rows.map(({ ref: _ref, ...r }) => r));
  });
});

describe("Google Pay", () => {
  const gpay = (...blocks: (string | string[])[]) =>
    rows("Transaction statement", `${PERSON[1]}, ${PERSON[2]}`, "01 October 2026 - 31 October 2026", ["Sent", "₹1,349"], ["Received", "₹500"], ...blocks);

  it("reads payments, self transfers, UPI Lite top-ups and Lite payments", () => {
    const parse = readUpiStatement(
      gpay(
        ["12 Oct, 2026", "10:24 PM"],
        "Paid to Green Leaf Cafe",
        "UPI Transaction ID: 612345678931",
        "Paid by Example Bank 1234",
        "₹349",
        ["13 Oct, 2026", "9:00 AM"],
        "Self transfer to Other Bank 5678",
        "UPI Transaction ID: 612345678932",
        "Paid by Example Bank 1234",
        "₹500",
        ["14 Oct, 2026", "9:10 AM"],
        "Top-up to UPI Lite",
        "UPI Transaction ID: 612345678933",
        "Paid by Example Bank 1234",
        "₹400",
        ["14 Oct, 2026", "1:10 PM"],
        "Paid to Corner Store",
        "UPI Transaction ID: 612345678934",
        "Paid by UPI Lite | Example Bank 1234",
        "₹100",
        ["15 Oct, 2026", "6:00 PM"],
        "Received from Meera N",
        "UPI Transaction ID: 612345678935",
        "Paid to Example Bank 1234",
        "₹500",
      ),
    )!;
    expect(parse.app).toBe("google_pay");
    expect(parse.issues).toEqual([]);
    expect(parse.rows.map((r) => [r.date, r.kind, r.direction, r.amountMinor, r.payee, r.viaLite, r.toAccount?.digits ?? null])).toEqual([
      ["2026-10-12", "paid", "debit", 34_900, "Green Leaf Cafe", false, null],
      ["2026-10-13", "self_transfer", "debit", 50_000, "", false, "5678"],
      ["2026-10-14", "lite_topup", "debit", 40_000, "", false, null],
      ["2026-10-14", "paid", "debit", 10_000, "Corner Store", true, null],
      ["2026-10-15", "received", "credit", 50_000, "Meera N", false, null],
    ]);
    expect(parse.rows.every((r) => r.account.bankLabel === "Example Bank" && r.account.digits === "1234")).toBe(true);
    expect(parse.checks.find((c) => c.name === "received_total")?.status).toBe("ok");
    noPersonal(parse.rows.map(({ ref: _ref, ...r }) => r));
  });

  it("a self transfer without its receiving account is unreadable, never an expense", () => {
    const parse = readUpiStatement(gpay(["13 Oct, 2026", "9:00 AM"], "Self transfer to Other Bank", "UPI Transaction ID: 612345678936", "Paid by Example Bank 1234", "₹500"))!;
    expect(parse.rows).toEqual([]);
    expect(parse.issues.map((i) => i.reason)).toEqual(["no_account"]);
  });
});
