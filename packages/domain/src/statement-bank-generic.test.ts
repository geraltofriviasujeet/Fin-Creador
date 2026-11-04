import { describe, expect, it } from "vitest";
import { type PdfTextItem, statementPages } from "./pdf-rows";
import { bankStatementNeedsCheck, csvRows } from "./statement-bank";
import { type BankTableRow, bankTableColumns, parseGenericBankStatement, readBankStatement } from "./statement-bank-generic";

// Invented statements only: banks, people, numbers and handles are made up.
const rowsOf = (text: string): BankTableRow[] => csvRows(text).map((cells) => ({ cells }));
const generic = (lines: string[]) => parseGenericBankStatement(rowsOf(lines.join("\n")));
const read = (p: ReturnType<typeof parseGenericBankStatement>) =>
  p?.lines.map((l) => [l.date, l.amountMinor, l.direction, l.balanceMinor, l.description]);
const roles = (header: string[]) => bankTableColumns({ cells: header })?.map((c) => c.role) ?? null;

// Separate withdrawal and deposit columns, a value date and a reference column, two-digit years,
// the summary as a row of labels with its values below (as some banks print it).
const SEPARATE_COLUMNS = [
  "Example Bank Ltd",
  "Account No : 50100012345678",
  "Customer : EXAMPLE PERSON",
  "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
  "01/10/26,UPI-FRESH BASKET-412345678901,0000412345678901,01/10/26,450.00,,9550.00",
  "02/10/26,NEFT CR-EXAMPLE EMPLOYER PVT LTD SALARY,N275260012345678,02/10/26,,\"50,000.00\",\"59,550.00\"",
  "05/10/26,ATM WDL-EXAMPLE ROAD KOLKATA,000000123456,05/10/26,2000.00,,57550.00",
  "05/10/26,UPI-RAVI KUMAR-412345678902,0000412345678902,05/10/26,649.00,,56901.00",
  "",
  "STATEMENT SUMMARY :-",
  "Opening Balance,Dr Count,Cr Count,Debits,Credits,Closing Bal",
  "10000.00,3,1,3099.00,50000.00,56901.00",
];

describe("bankTableColumns", () => {
  it("finds the table by its header names, whatever the bank", () => {
    expect(roles(["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"])).toEqual([
      "date", "description", "other", "other", "debit", "credit", "balance",
    ]);
    expect(roles(["Txn Date", "Value Date", "Description", "Ref No./Cheque No.", "Debit", "Credit", "Balance"])).toEqual([
      "date", "other", "description", "other", "debit", "credit", "balance",
    ]);
    expect(roles(["S No.", "Value Date", "Transaction Date", "Cheque Number", "Transaction Remarks", "Withdrawal Amount (INR )", "Deposit Amount (INR )", "Balance (INR )"])).toEqual([
      "other", "other", "date", "other", "description", "debit", "credit", "balance",
    ]);
    expect(roles(["Tran Date", "Chq No", "Particulars", "Debit", "Credit", "Balance", "Init. Br"])).toEqual([
      "date", "other", "description", "debit", "credit", "balance", "other",
    ]);
    expect(roles(["Date", "Narration", "Chq/Ref No", "Withdrawal (Dr)", "Deposit (Cr)", "Balance"])).toEqual([
      "date", "description", "other", "debit", "credit", "balance",
    ]);
    expect(roles(["Date", "Instrument ID", "Amount", "Type", "Balance", "Remarks"])).toEqual(["date", "other", "amount", "type", "balance", "description"]);
    expect(roles(["Post Date", "Value Dt", "Details", "Amount", "Dr / Cr", "Running Balance"])).toEqual(["date", "other", "description", "amount", "type", "balance"]);
  });

  it("needs a date, a description, a balance and amounts", () => {
    expect(roles(["Date", "Narration", "Debit", "Credit"])).toBeNull();
    expect(roles(["Date", "Narration", "Debit", "Balance"])).toBeNull();
    expect(roles(["Narration", "Amount", "Balance"])).toBeNull();
    expect(roles(["Opening Balance", "Dr Count", "Cr Count", "Debits", "Credits", "Closing Bal"])).toBeNull();
  });

  it("splits a PDF cell that holds several header names by position", () => {
    const columns = bankTableColumns({ cells: ["Date Narration", "Withdrawal Deposit", "Balance"], spans: [[0, 140], [300, 480], [500, 540]] });
    expect(columns?.map((c) => [c.role, Math.round(c.start)])).toEqual([["date", 0], ["description", 50], ["debit", 300], ["credit", 410], ["balance", 500]]);
  });
});

describe("parseGenericBankStatement: CSV", () => {
  it("reads separate debit and credit columns and reconciles opening + credits − debits with the closing", () => {
    const parsed = generic(SEPARATE_COLUMNS);
    expect(read(parsed)).toEqual([
      ["2026-10-01", 45_000, "debit", 955_000, "UPI-FRESH BASKET-"],
      ["2026-10-02", 5_000_000, "credit", 5_955_000, "NEFT CR-EXAMPLE EMPLOYER PVT LTD SALARY"],
      ["2026-10-05", 200_000, "debit", 5_755_000, "ATM WDL-EXAMPLE ROAD KOLKATA"],
      ["2026-10-05", 64_900, "debit", 5_690_100, "UPI-RAVI KUMAR-"],
    ]);
    expect(parsed?.summary).toEqual({ from: "2026-10-01", to: "2026-10-05", openingMinor: 1_000_000, closingMinor: 5_690_100 });
    expect(parsed?.checks.map((c) => [c.name, c.status])).toEqual([["balance_chain", "ok"], ["totals", "ok"]]);
    expect(parsed?.issues).toEqual([]);
    expect(bankStatementNeedsCheck(parsed!)).toBe(false);
  });

  it("keeps nothing above the header, no value date, account, cheque or reference number", () => {
    const kept = JSON.stringify(generic(SEPARATE_COLUMNS));
    for (const secret of ["Example Bank", "50100012345678", "EXAMPLE PERSON", "412345678901", "0000412345678902", "N275260012345678", "123456"]) {
      expect(kept).not.toContain(secret);
    }
  });

  it("reads one amount column with a Dr / Cr column, newest first, reordering same-date rows to follow the balance", () => {
    // The bank lists the 5th's two rows in the opposite order to the one they were posted in.
    const parsed = generic([
      "Sl. No.,Date,Description,Chq / Ref number,Amount,Dr / Cr,Balance",
      "1,06-10-2026,CARD PAYMENT,,\"3,000.00\",DR,\"41,000.00\"",
      "2,05-10-2026,RENT,,\"10,000.00\",DR,\"4,000.00\"",
      "3,05-10-2026,SALARY,,\"40,000.00\",CR,\"44,000.00\"",
      "4,04-10-2026,GROCERY,,\"1,000.00\",DR,\"14,000.00\"",
    ]);
    expect(read(parsed)).toEqual([
      ["2026-10-06", 300_000, "debit", 4_100_000, "CARD PAYMENT"],
      ["2026-10-05", 1_000_000, "debit", 400_000, "RENT"],
      ["2026-10-05", 4_000_000, "credit", 4_400_000, "SALARY"],
      ["2026-10-04", 100_000, "debit", 1_400_000, "GROCERY"],
    ]);
    expect(parsed?.checks.map((c) => [c.name, c.status])).toEqual([["balance_chain", "ok"], ["totals", "unchecked"]]);
  });

  it("without printed endpoints, a balance that doesn't follow on any row means the file is not read", () => {
    expect(
      generic([
        "Date,Description,Amount,Dr / Cr,Balance",
        "04-10-2026,GROCERY,1000.00,DR,14000.00",
        "05-10-2026,RENT,10000.00,DR,4500.00",
        "06-10-2026,SALARY,40000.00,CR,44500.00",
      ]),
    ).toBeNull();
  });

  it("takes the direction from the balance when the amount carries no marker (a minus sign states none)", () => {
    const parsed = generic([
      "Date,Particulars,Amount,Balance",
      "Opening Balance,,,5000.00",
      "15.10.2026,SHOP,-1000.00,4000.00",
      "16.10.2026,REFUND SHOP,250.00,4250.00",
      "Closing Balance,,,4250.00",
    ]);
    expect(read(parsed)).toEqual([
      ["2026-10-15", 100_000, "debit", 400_000, "SHOP"],
      ["2026-10-16", 25_000, "credit", 425_000, "REFUND SHOP"],
    ]);
    expect(parsed?.checks.map((c) => c.status)).toEqual(["ok", "ok"]);
  });

  it("with no opening and no marker, the first row's direction is unknown: it is flagged, the rest are read", () => {
    const parsed = generic(["Date,Particulars,Amount,Balance", "15.10.2026,SHOP,1000.00,4000.00", "16.10.2026,REFUND SHOP,250.00,4250.00"]);
    expect(read(parsed)).toEqual([["2026-10-16", 25_000, "credit", 425_000, "REFUND SHOP"]]);
    expect(parsed?.issues).toEqual([{ line: 2, reason: "balance_mismatch", shape: "date, text, amount" }]);
    expect(bankStatementNeedsCheck(parsed!)).toBe(true);
  });

  const endpoints = (rows: string[], opening = "1000.00", closing = "1000.00") => [
    "Date,Narration,Debit,Credit,Balance",
    `Opening Balance,,,,${opening}`,
    ...rows,
    `Closing Balance,,,,${closing}`,
  ];

  it("when the totals reconcile, rows whose balance doesn't follow are flagged as unreadable and Save needs the check", () => {
    // The 2nd row's balance is misprinted (750 for 700), so it and the row after it don't follow.
    const parsed = generic(endpoints(["01/10/2026,SHOP,100.00,,900.00", "02/10/2026,FUEL,200.00,,750.00", "03/10/2026,CASHBACK,,300.00,1000.00"]));
    expect(read(parsed)).toEqual([["2026-10-01", 10_000, "debit", 90_000, "SHOP"]]);
    expect(parsed?.issues.map((i) => [i.line, i.reason])).toEqual([[4, "balance_mismatch"], [5, "balance_mismatch"]]);
    expect(parsed?.checks.map((c) => [c.name, c.status])).toEqual([["balance_chain", "mismatch"], ["totals", "ok"]]);
    expect(bankStatementNeedsCheck(parsed!)).toBe(true);
  });

  it("a missed row or a misread amount fails the totals: the file is not read", () => {
    expect(generic(endpoints(["01/10/2026,SHOP,100.00,,900.00", "03/10/2026,CASHBACK,,300.00,1000.00"]))).toBeNull();
    expect(generic(endpoints(["01/10/2026,SHOP,100.00,,900.00", "02/10/2026,FUEL,20.00,,700.00", "03/10/2026,CASHBACK,,300.00,1000.00"]))).toBeNull();
  });

  it("a row in the wrong column is trusted when the totals reconcile with the columns as printed", () => {
    // The balance moves down by 50 on a credit; the totals agree with the credit, so it stays a credit.
    const parsed = generic(endpoints(["01/10/2026,CASHBACK,,50.00,950.00"], "1000.00", "1050.00"));
    expect(read(parsed)).toEqual([["2026-10-01", 5_000, "credit", 95_000, "CASHBACK"]]);
    expect(parsed?.issues).toEqual([]);
  });

  it("a row in the wrong column is flagged when only the balance movement reconciles", () => {
    const parsed = generic(endpoints(["01/10/2026,SHOP,100.00,,900.00", "02/10/2026,FUEL,,50.00,850.00"], "1000.00", "850.00"));
    expect(read(parsed)).toEqual([["2026-10-01", 10_000, "debit", 90_000, "SHOP"]]);
    expect(parsed?.issues.map((i) => [i.line, i.reason])).toEqual([[4, "balance_mismatch"]]);
  });

  it("without endpoints, a row whose column disagrees with its balance movement is flagged", () => {
    const parsed = generic(["Date,Narration,Debit,Credit,Balance", "01/10/2026,SHOP,100.00,,900.00", "02/10/2026,FUEL,,50.00,850.00", "03/10/2026,TEA,10.00,,840.00"]);
    expect(read(parsed)?.map((l) => l[4])).toEqual(["SHOP", "TEA"]);
    expect(parsed?.issues.map((i) => [i.line, i.reason])).toEqual([[3, "balance_mismatch"]]);
  });

  it("reads DD-MON-YYYY, DD-MM-YY and DD/MM/YYYY", () => {
    for (const [a, b] of [["01-Oct-2026", "02-Oct-2026"], ["01-10-26", "02-10-26"], ["01/10/2026", "02/10/2026"], ["1 Oct 2026", "2 Oct 2026"]]) {
      const parsed = generic(["Date,Narration,Debit,Credit,Balance", `${a},SHOP,100.00,,900.00`, `${b},TEA,10.00,,890.00`]);
      expect(parsed?.lines.map((l) => l.date)).toEqual(["2026-10-01", "2026-10-02"]);
    }
  });

  it("one date format a file: a row in another format is unreadable (and then the balances don't follow)", () => {
    expect(generic(["Date,Narration,Debit,Credit,Balance", "01/10/2026,SHOP,100.00,,900.00", "02-Oct-2026,TEA,10.00,,890.00", "03/10/2026,FUEL,10.00,,880.00"])).toBeNull();
  });

  it("dates that run out of order when read day first mean the file is not read (a month-first file)", () => {
    expect(
      generic(["Date,Narration,Debit,Credit,Balance", "10/05/2026,SHOP,100.00,,900.00", "10/12/2026,TEA,10.00,,890.00", "11/02/2026,FUEL,10.00,,880.00"]),
    ).toBeNull();
  });

  it("a row with no date but an amount and a balance takes the date above (date printed once per day); a wrapped description still joins", () => {
    const parsed = generic([
      "Date,Narration,Debit,Credit,Balance",
      "Opening Balance,,,,1000.00",
      "01/10/2026,SHOP,100.00,,900.00",
      ",TEA,10.00,,890.00",
      ",UPI-FRESH BASKET,50.00,,840.00",
      ",STORES KOLKATA,,,",
      "02/10/2026,SALARY,,500.00,1340.00",
      ",FUEL,40.00,,1300.00",
      "Closing Balance,,,,1300.00",
    ]);
    expect(read(parsed)).toEqual([
      ["2026-10-01", 10_000, "debit", 90_000, "SHOP"],
      ["2026-10-01", 1_000, "debit", 89_000, "TEA"],
      ["2026-10-01", 5_000, "debit", 84_000, "UPI-FRESH BASKET STORES KOLKATA"],
      ["2026-10-02", 50_000, "credit", 134_000, "SALARY"],
      ["2026-10-02", 4_000, "debit", 130_000, "FUEL"],
    ]);
    expect(parsed?.issues).toEqual([]);
    expect(parsed?.checks.map((c) => c.status)).toEqual(["ok", "ok"]);
  });

  it("a dateless row with nothing above it, or under a row whose date wasn't read, is unreadable", () => {
    const first = generic(["Date,Narration,Debit,Credit,Balance", ",TEA,10.00,,890.00", "01/10/2026,SHOP,100.00,,790.00", "02/10/2026,FUEL,10.00,,780.00"]);
    expect(first?.issues.map((i) => [i.line, i.reason])).toEqual([[2, "bad_date"]]);
    expect(first?.lines.map((l) => l.description)).toEqual(["SHOP", "FUEL"]);
    const under = generic(["Date,Narration,Debit,Credit,Balance", "01/10/2026,SHOP,100.00,,900.00", "31/02/2026,TEA,10.00,,890.00", ",FUEL,10.00,,880.00"]);
    expect(under?.lines.map((l) => l.description)).toEqual(["SHOP"]);
    expect(under?.issues.map((i) => [i.line, i.reason])).toEqual([[3, "bad_date"], [4, "bad_date"]]);
  });

  it("skips totals and page furniture, and reads nothing without a header", () => {
    const parsed = generic(["Date,Narration,Debit,Credit,Balance", "01/10/2026,SHOP,100.00,,900.00", "02/10/2026,TEA,10.00,,890.00", "Total,,110.00,0.00,", "Page 1 of 1"]);
    expect(parsed?.lines).toHaveLength(2);
    expect(parsed?.issues).toEqual([]);
    expect(generic(["Name,Amount", "Lunch,100"])).toBeNull();
  });
});

// A two-page PDF of positioned text pieces: separate debit and credit columns (one empty on each
// row), a value date and a reference column, an opening balance row, a description wrapped onto a
// second line (merged by the PDF reader) and one onto its own row, a footer, the header repeated.
const piece = (str: string, x: number, y: number, width: number): PdfTextItem => ({ str, x, y, width, height: 10 });
const header = (y: number) => [
  piece("Txn Date", 20, y, 40), piece("Value Date", 90, y, 50), piece("Description", 160, y, 55),
  piece("Ref No./Cheque No.", 330, y, 60), piece("Debit", 430, y, 25), piece("Credit", 505, y, 30), piece("Balance", 590, y, 35),
];
const row = (y: number, date: string, description: string, ref: string | null, debit: string | null, credit: string | null, balance: string) => [
  piece(date, 20, y, 50), piece(date, 90, y, 50), piece(description, 160, y, Math.min(description.length * 5, 150)),
  ...(ref ? [piece(ref, 330, y, 60)] : []),
  ...(debit ? [piece(debit, 420, y, 40)] : []),
  ...(credit ? [piece(credit, 500, y, 40)] : []),
  piece(balance, 580, y, 45),
];
const PDF_PAGES: PdfTextItem[][] = [
  [
    piece("Example Bank of India", 20, 800, 100),
    piece("Account Number 00000012345678901", 20, 785, 150),
    piece("Name EXAMPLE PERSON", 20, 770, 100),
    ...header(740),
    piece("Opening Balance", 160, 720, 70), piece("25,000.00", 580, 720, 45),
    ...row(700, "01 Oct 2026", "UPI/DR/412345678901/FRESH", "412345678901", "1,500.00", null, "23,500.00"),
    piece("BASKET/HDFC/x", 160, 690, 65),
    ...row(670, "02 Oct 2026", "NEFT EXAMPLE EMPLOYER", "N275260012345678", null, "50,000.00", "73,500.00"),
    piece("PVT LTD SALARY", 160, 660, 70),
    ...row(640, "03 Oct 2026", "ATM CASH EXAMPLE ROAD", null, "5,000.00", null, "68,500.00"),
    piece("KOLKATA", 160, 622, 35),
    piece("Page 1 of 2", 300, 50, 50),
  ],
  [
    ...header(800),
    ...row(780, "04 Oct 2026", "ELECTRICITY BILL EXAMPLE", null, "1,234.50", null, "67,265.50"),
    ...row(760, "05 Oct 2026", "INTEREST CREDIT", null, null, "12.30", "67,277.80"),
    piece("Closing Balance", 160, 740, 70), piece("67,277.80", 580, 740, 45),
    piece("Page 2 of 2", 300, 50, 50),
  ],
];

describe("parseGenericBankStatement: PDF", () => {
  it("places each cell under its header across pages: repeated header, footer, wrapped descriptions", () => {
    const parsed = parseGenericBankStatement(statementPages(PDF_PAGES).rows);
    expect(read(parsed)).toEqual([
      ["2026-10-01", 150_000, "debit", 2_350_000, "FRESH BASKET"],
      ["2026-10-02", 5_000_000, "credit", 7_350_000, "NEFT EXAMPLE EMPLOYER PVT LTD SALARY"],
      ["2026-10-03", 500_000, "debit", 6_850_000, "ATM CASH EXAMPLE ROAD KOLKATA"],
      ["2026-10-04", 123_450, "debit", 6_726_550, "ELECTRICITY BILL EXAMPLE"],
      ["2026-10-05", 1_230, "credit", 6_727_780, "INTEREST CREDIT"],
    ]);
    expect(parsed?.summary.openingMinor).toBe(2_500_000);
    expect(parsed?.checks.map((c) => c.status)).toEqual(["ok", "ok"]);
    expect(parsed?.issues).toEqual([]);
  });

  it("keeps no account number, name, reference or UPI id", () => {
    const kept = JSON.stringify(parseGenericBankStatement(statementPages(PDF_PAGES).rows));
    for (const secret of ["Example Bank", "00000012345678901", "EXAMPLE PERSON", "412345678901", "N275260012345678", "HDFC"]) expect(kept).not.toContain(secret);
  });
});

describe("parseGenericBankStatement: PDF, date once per day", () => {
  it("reads the dateless rows on the day above, and a wrapped description after one joins it", () => {
    const dateless = (y: number, description: string, debit: string | null, credit: string | null, balance: string) => [
      piece(description, 160, y, Math.min(description.length * 5, 150)),
      ...(debit ? [piece(debit, 420, y, 40)] : []),
      ...(credit ? [piece(credit, 500, y, 40)] : []),
      piece(balance, 580, y, 45),
    ];
    const pages: PdfTextItem[][] = [
      [
        ...header(740),
        piece("Opening Balance", 160, 720, 70), piece("10,000.00", 580, 720, 45),
        ...row(700, "01 Oct 2026", "UPI-FRESH BASKET", null, "500.00", null, "9,500.00"),
        ...dateless(680, "UPI-RAVI KUMAR", "649.00", null, "8,851.00"),
        piece("KOLKATA BRANCH", 160, 662, 70),
        ...dateless(640, "NEFT EXAMPLE EMPLOYER", null, "50,000.00", "58,851.00"),
        ...row(620, "02 Oct 2026", "ATM CASH", null, "2,000.00", null, "56,851.00"),
        ...dateless(600, "INTEREST CREDIT", null, "12.30", "56,863.30"),
        piece("Closing Balance", 160, 580, 70), piece("56,863.30", 580, 580, 45),
      ],
    ];
    const parsed = parseGenericBankStatement(statementPages(pages).rows);
    expect(read(parsed)).toEqual([
      ["2026-10-01", 50_000, "debit", 950_000, "UPI-FRESH BASKET"],
      ["2026-10-01", 64_900, "debit", 885_100, "UPI-RAVI KUMAR KOLKATA BRANCH"],
      ["2026-10-01", 5_000_000, "credit", 5_885_100, "NEFT EXAMPLE EMPLOYER"],
      ["2026-10-02", 200_000, "debit", 5_685_100, "ATM CASH"],
      ["2026-10-02", 1_230, "credit", 5_686_330, "INTEREST CREDIT"],
    ]);
    expect(parsed?.issues).toEqual([]);
    expect(parsed?.checks.map((c) => c.status)).toEqual(["ok", "ok"]);
  });
});

describe("readBankStatement", () => {
  const pnb = [
    "Date Instrument ID Amount Type Balance Remarks",
    "28/10/2026 649.00 DR 65,384.00 UPI/DR/412345678904/RAVI KUMAR/SBIN/x",
    "27/10/2026 2334.00 DR 66,033.00 CARD PAYMENT PNB RUPAY",
  ].join("\n");

  it("keeps the PNB and CSV readers first when they read the file and their checks pass", () => {
    expect(readBankStatement({ format: "pdf", text: pnb })?.reader).toBe("pnb");
    expect(readBankStatement({ format: "csv", text: SEPARATE_COLUMNS.join("\n") })?.reader).toBe("csv");
  });

  it("falls back to the generic reader for other layouts", () => {
    const { text, rows } = statementPages(PDF_PAGES);
    const result = readBankStatement({ format: "pdf", text, rows });
    expect(result?.reader).toBe("generic");
    expect(result?.parse.lines).toHaveLength(5);
    expect(readBankStatement({ format: "csv", text: "Date,Particulars,Amount,Balance\nOpening Balance,,,5000.00\n15.10.2026,SHOP,-1000.00,4000.00\nClosing Balance,,,4000.00" })?.reader).toBe("generic");
  });

  it("falls back when a known reader's checks fail, and keeps its result when the generic one can't read the file either", () => {
    // The CSV reader reads it but its chain breaks; the totals reconcile, so the generic reader flags the rows.
    const csv = ["Date,Narration,Debit,Credit,Balance", "Opening Balance,,,,1000.00", "01/10/2026,SHOP,100.00,,900.00", "02/10/2026,FUEL,200.00,,750.00", "03/10/2026,CASHBACK,,300.00,1000.00", "Closing Balance,,,,1000.00"].join("\n");
    expect(readBankStatement({ format: "csv", text: csv })?.reader).toBe("generic");
    // A missed row: the totals fail, so the CSV reader's result (with its Check this statement) stays.
    const missed = ["Date,Narration,Debit,Credit,Balance", "01/10/2026,SHOP,100.00,,900.00", "03/10/2026,CASHBACK,,300.00,1000.00"].join("\n");
    expect(readBankStatement({ format: "csv", text: missed })?.reader).toBe("csv");
  });

  it("is null when nothing can read the file", () => {
    expect(readBankStatement({ format: "csv", text: "Name,Amount\nLunch,100" })).toBeNull();
    expect(readBankStatement({ format: "pdf", text: "Hello", rows: [{ cells: ["Hello"], spans: [[0, 20]] }] })).toBeNull();
  });
});
