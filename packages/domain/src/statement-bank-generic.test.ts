import { describe, expect, it } from "vitest";
import { type PdfTextItem, statementPages } from "./pdf-rows";
import { bankStatementNeedsCheck, csvRows } from "./statement-bank";
import { type BankTableRow, bankReadFailureText, bankTableColumns, parseGenericBankStatement, readBankStatement } from "./statement-bank-generic";

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

describe("parseGenericBankStatement: PDF, a page's customer block and legal text", () => {
  // Shapes from a real statement's "Copy layout" (no text or digits from it): the customer block printed
  // above the table header on every page (pieces at x39, x61, x148, x317, x368, x430, some in the value
  // date and withdrawal columns), two wide rows of legal text at the foot of each page, a text-only cell
  // in the deposit column, and narration wrapped onto its own row.
  const p = (str: string, x: number, y: number, width: number): PdfTextItem => ({ str, x, y, width, height: 8 });
  const tableHeader = (y: number) => [
    p("Date", 39, y, 20), p("Narration", 61, y, 40), p("Chq./Ref.No.", 230, y, 50), p("Value Dt", 317, y, 30),
    p("Withdrawal Amt.", 368, y, 62), p("Deposit Amt.", 440, y, 50), p("Closing Balance", 500, y, 60),
  ];
  // One type size on a transaction row: 4.5 units a character.
  const t = (str: string, x: number, y: number) => p(str, x, y, str.length * 4.5);
  const line = (y: number, date: string, narration: string, ref: string, withdrawal: string | null, deposit: string | null, balance: string) => [
    t(date, 39, y), t(narration, 85, y), t(ref, 230, y), t(date, 317, y),
    ...(withdrawal ? [t(withdrawal, 380, y)] : []), ...(deposit ? [t(deposit, 450, y)] : []), t(balance, 505, y),
  ];
  const customerBlock = (top: number) => [
    p("EXAMPLE BANK BRANCH KOLKATA EAST", 317, top, 120),
    p("Address", 317, top - 14, 24), p(":", 368, top - 14, 20), p("EXAMPLE ROAD", 373, top - 22, 45),
    p("MR", 39, top - 39, 11), p("EXAMPLE PERSON", 61, top - 39, 54), p("City", 317, top - 36, 12), p("KOLKATA 700001", 368, top - 36, 69), p("ABCDE", 373, top - 28, 63),
    p("1 EXAMPLE ROAD EXAMPLE AREA", 39, top - 56, 109), p("State", 317, top - 58, 29), p("WEST BENGAL", 368, top - 58, 65),
    p("NEAR EXAMPLE PARK KOLKATA", 39, top - 71, 125), p("Phone no.", 317, top - 70, 28), p("98765XXXXX", 368, top - 70, 18),
    p("JOINT HOLDERS : EXAMPLE", 39, top - 86, 58), p("ABC", 148, top - 86, 50), p("Account No :50100012345678", 317, top - 86, 92),
  ];
  const legal = (y: number) => [p("Contents of this statement will be considered correct if no error is reported within 30 days of receipt of statement. The address on this statement is that on record with the Bank as at the day of requesting this statement.", 34, y, 511), p("State account branch GSTN: 19AAACE0000X1Z0. Registered office address: Example House, Example Road, Example City 400001", 34, y - 28, 384)];
  const pages: PdfTextItem[][] = [
    [
      ...customerBlock(800),
      ...tableHeader(690),
      ...line(670, "01/10/26", "UPI-FRESH BASKET-FRESHBASKET", "0000412345678901", "1,784.00", null, "8,216.00"),
      t("@OKHDFC-HDFC0000001-PAYMENT", 85, 652),
      ...line(630, "02/10/26", "NEFT CR-EXAMPLE EMPLOYER", "N275260012345678", null, "50,000.00", "58,216.00"),
      ...line(610, "03/10/26", "ATM WDL-EXAMPLE ROAD", "000000123456", "2,000.00", null, "56,216.00"),
      ...legal(120),
    ],
    [
      ...customerBlock(800),
      ...tableHeader(690),
      p("**Continued**", 439, 670, 62),
      ...line(650, "04/10/26", "UPI-RAVI KUMAR-RAVI", "0000412345678902", "649.00", null, "55,567.00"),
      ...line(630, "05/10/26", "INTEREST PAID TILL 30-SEP", "000000000000", null, "120.00", "55,687.00"),
      p("STATEMENT SUMMARY", 34, 590, 80),
      p("Opening Balance", 34, 570, 60), p("Dr Count", 120, 570, 35), p("Cr Count", 190, 570, 35), p("Debits", 260, 570, 30), p("Credits", 350, 570, 30), p("Closing Bal", 440, 570, 45),
      p("10,000.00", 34, 556, 40), p("3", 120, 556, 5), p("2", 190, 556, 5), p("4,433.00", 260, 556, 40), p("50,120.00", 350, 556, 40), p("55,687.00", 440, 556, 40),
      ...legal(120),
    ],
  ];

  it("reads every line, joins the wrapped narration, and neither reports nor keeps the customer block or legal text", () => {
    const parsed = parseGenericBankStatement(statementPages(pages).rows);
    expect(read(parsed)).toEqual([
      ["2026-10-01", 178_400, "debit", 821_600, "UPI-FRESH BASKET-FRESHBASKET @OKHDFC-HDFC-PAYMENT"],
      ["2026-10-02", 5_000_000, "credit", 5_821_600, "NEFT CR-EXAMPLE EMPLOYER"],
      ["2026-10-03", 200_000, "debit", 5_621_600, "ATM WDL-EXAMPLE ROAD"],
      ["2026-10-04", 64_900, "debit", 5_556_700, "UPI-RAVI KUMAR-RAVI"],
      ["2026-10-05", 12_000, "credit", 5_568_700, "INTEREST PAID TILL 30-SEP"],
    ]);
    expect(parsed?.issues).toEqual([]);
    expect(parsed?.checks.map((c) => c.status)).toEqual(["ok", "ok"]);
    const kept = JSON.stringify(parsed);
    for (const secret of ["EXAMPLE PERSON", "EXAMPLE AREA", "WEST BENGAL", "50100012345678", "Contents of this statement", "GSTN", "Continued", "N275260012345678"]) {
      expect(kept).not.toContain(secret);
    }
  });

  it("a row with an amount or a date that can't be used is still reported", () => {
    const broken = pages.map((page) => page.map((item) => (item.str === "649.00" ? { ...item, str: "649.0O" } : item)));
    const parsed = parseGenericBankStatement(statementPages(broken).rows);
    // The amount can't be used, so the totals fail and the file is not read; the row is not taken as narration.
    expect(parsed).toBeNull();
  });
});

describe("parseGenericBankStatement: an opening balance row with another piece before its label", () => {
  // Shape from a real statement's "Copy layout": "text x107 w167 c25 dy16 | text x306 w92 c15 dy0 |
  // amount x546 w37 c6 dy0", a 15-character label in the description column, the balance alone at the
  // right, and a 25-character note below it starting further left (so the PDF reader joins them).
  const p = (str: string, x: number, y: number, width = str.length * 6.2) => ({ str, x, y, width, height: 10 });
  const pages: PdfTextItem[][] = [
    [
      p("Txn Date", 34, 700, 30), p("Value Date", 70, 700, 30), p("Description", 110, 700, 45), p("Cheque No.", 360, 700, 40),
      p("Branch Code", 410, 700, 45), p("Debit", 460, 700, 25), p("Credit", 500, 700, 30), p("Balance", 546, 700, 35),
      // The note lands in the description column ahead of the label, which sits under Cheque No.
      p("Opening Balance", 306, 680, 92), p("900.00", 546, 680, 37), p("STATEMENT FROM 01-10-2026", 107, 664, 167),
      p("02-10-2026", 34, 640), p("UPI/RAVI KUMAR", 110, 640), p("100.00", 460, 640), p("800.00", 546, 640),
      p("03-10-2026", 34, 620), p("ATM CASH", 110, 620), p("50.00", 460, 620), p("750.00", 546, 620),
      p("Closing Balance", 306, 600, 92), p("750.00", 546, 600, 37),
    ],
  ];

  it("is read as the opening balance, not listed as unreadable, and the totals reconcile", () => {
    const { rows, rowLayouts } = statementPages(pages);
    expect(rowLayouts[1]).toBe("text x107 w167 c25 dy16 | text x306 w92 c15 dy0 | amount x546 w37 c6 dy0");
    const parsed = parseGenericBankStatement(rows);
    expect(parsed?.summary.openingMinor).toBe(90_000);
    expect(parsed?.issues).toEqual([]);
    expect(read(parsed)?.map((l) => l.slice(0, 3))).toEqual([["2026-10-02", 10_000, "debit"], ["2026-10-03", 5_000, "debit"]]);
    expect(parsed?.checks.map((c) => [c.name, c.status])).toEqual([["balance_chain", "ok"], ["totals", "ok"]]);
  });
});

describe("parseGenericBankStatement: shapes from real statements' Copy layout", () => {
  const p = (str: string, x: number, y: number, height = 9) => ({ str, x, y, width: str.length * 4.3, height });

  it("a branch code printed close after the balance is split off, and two-line particulars are read with their date", () => {
    // Header: Tran Date, Chq No, Particulars, Debit, Credit, Balance, Init. / Br (one line lower). Each line:
    // particulars on two lines, the date, amounts and branch code on the lower one (dy9), the branch code
    // 8 units after the balance, so the PDF reader puts both in one cell.
    const line = (y: number, date: string, first: string, second: string, debit: string | null, credit: string | null, balance: string, branch: string) => [
      p(first, 132, y), p(date, 39, y - 9), p(second, 132, y - 9),
      ...(debit ? [p(debit, 346, y - 9)] : []), ...(credit ? [p(credit, 408, y - 9)] : []),
      { ...p(balance, 488, y - 9), width: 43 }, p(branch, 539, y - 9),
    ];
    const pages: PdfTextItem[][] = [
      [
        p("Statement of Axis Account No :50100012345678", 38, 800),
        p("Tran Date", 40, 700), p("Chq No", 92, 700), p("Particulars", 203, 700), p("Debit", 339, 700), p("Credit", 400, 700), p("Balance", 473, 700),
        p("Init.", 538, 700), p("Br", 541, 691),
        p("OPENING BALANCE", 132, 680), { ...p("10,000.00", 483, 680), width: 47 },
        ...line(660, "01-10-2026", "UPI/P2M/412345678901/FRESH", "BASKET/PAYMENT", "1,784.00", null, "8,216.00", "123"),
        ...line(638, "02-10-2026", "NEFT/N275260012345678/EXAMPLE", "EMPLOYER/SALARY", null, "50,000.00", "58,216.00", "123"),
        ...line(616, "03-10-2026", "ATM-CASH/EXAMPLE ROAD", "KOLKATA", "2,000.00", null, "56,216.00", "4567"),
        p("CLOSING BALANCE", 132, 590), { ...p("56,216.00", 483, 590), width: 47 },
      ],
    ];
    const { rows, rowLayouts } = statementPages(pages);
    expect(rowLayouts[3]).toMatch(/^date x39 w43 c10 dy9 \| text x132 w\d+ c26 dy0 \| text x132 w\d+ c14 dy9 \| amount x346 w34 c8 dy9 \| amount x488 w43 c8 dy9 \| number x539 w13 c3 dy9$/);
    const parsed = parseGenericBankStatement(rows);
    expect(read(parsed)).toEqual([
      ["2026-10-01", 178_400, "debit", 821_600, "UPI/P2M//FRESH BASKET/PAYMENT"],
      ["2026-10-02", 5_000_000, "credit", 5_821_600, "NEFT/N/EXAMPLE EMPLOYER/SALARY"],
      ["2026-10-03", 200_000, "debit", 5_621_600, "ATM-CASH/EXAMPLE ROAD KOLKATA"],
    ]);
    expect(parsed?.summary.openingMinor).toBe(1_000_000);
    expect(parsed?.issues).toEqual([]);
    expect(JSON.stringify(parsed)).not.toMatch(/4567|50100012345678|Axis/);
  });

  it("finds the header naming Transaction Reference as the description, with Credit before Debit, after summary pages", () => {
    const header = (y: number) => [
      p("Date", 25, y), p("Transaction Reference", 126, y), p("Ref.No./Chq.No.", 297, y), p("Credit", 397, y), p("Debit", 468, y), p("Balance", 532, y),
    ];
    const line = (y: number, date: string, reference: string, ref: string, credit: string | null, debit: string | null, balance: string) => [
      p(date, 12, y), p(reference, 126, y), p(ref, 297, y), ...(credit ? [p(credit, 397, y)] : []), ...(debit ? [p(debit, 468, y)] : []), p(balance, 532, y),
    ];
    const pages: PdfTextItem[][] = [
      [p("Account Summary", 30, 800), p("Opening Balance", 35, 760), p("Debits", 145, 760), p("Credits", 265, 760), p("Closing Balance", 500, 760)],
      [p("Account Details", 10, 800), p("Name EXAMPLE PERSON", 10, 780)],
      [
        ...header(700),
        p("Opening Balance", 126, 680), p("10,000.00", 532, 680),
        ...line(660, "01 Oct 2026", "UPI/DR/FRESH BASKET", "412345678901", null, "1,784.00", "8,216.00"),
        ...line(640, "02 Oct 2026", "NEFT/EXAMPLE EMPLOYER", "N27526001", "50,000.00", null, "58,216.00"),
        ...line(620, "03 Oct 2026", "ATM WDL/EXAMPLE ROAD", "123456", null, "2,000.00", "56,216.00"),
        p("Closing Balance", 126, 600), p("56,216.00", 532, 600),
      ],
    ];
    expect(roles(["Date", "Transaction Reference", "Ref.No./Chq.No.", "Credit", "Debit", "Balance"])).toEqual(["date", "description", "other", "credit", "debit", "balance"]);
    const parsed = parseGenericBankStatement(statementPages(pages).rows);
    expect(read(parsed)).toEqual([
      ["2026-10-01", 178_400, "debit", 821_600, "UPI/DR/FRESH BASKET"],
      ["2026-10-02", 5_000_000, "credit", 5_821_600, "NEFT/EXAMPLE EMPLOYER"],
      ["2026-10-03", 200_000, "debit", 5_621_600, "ATM WDL/EXAMPLE ROAD"],
    ]);
    expect(parsed?.checks.map((c) => c.status)).toEqual(["ok", "ok"]);
    expect(JSON.stringify(parsed)).not.toMatch(/412345678901|N27526001|EXAMPLE PERSON/);
  });
});

describe("bankReadFailureText", () => {
  const csv = (lines: string[]) => bankReadFailureText({ format: "csv", text: lines.join("\n") });

  it("says no header row was found, and lists each row's cells by kind, column and characters only", () => {
    const text = csv(["Name,Amount", "Lunch,100", "Account No,50100012345678"]);
    expect(text).toBe(
      [
        "Why: No header row found: no row names a date, a description, a balance and amounts.",
        "Row 1: text col1 c4 | text col2 c6",
        "Row 2: text col1 c5 | number col2 c3",
        "Row 3: text col1 c10 | number col2 c14",
      ].join("\n"),
    );
  });

  it("names the closest header row and the column it lacks", () => {
    expect(csv(["Date,Narration,Debit,Credit", "01/10/2026,SHOP,100.00,"]).split("\n")[0]).toBe("Why: No header row found. Closest: row 1, missing the balance column.");
    expect(csv(["Date,Narration,Balance", "01/10/2026,SHOP,900.00"]).split("\n")[0]).toBe(
      "Why: No header row found. Closest: row 1, missing the debit and credit columns or an amount column.",
    );
  });

  it("says when reconciliation failed, or the balances don't follow without printed endpoints", () => {
    const head = "Date,Narration,Debit,Credit,Balance";
    expect(csv([head, "Opening Balance,,,,1000.00", "01/10/2026,SHOP,100.00,,900.00", "03/10/2026,CASHBACK,,300.00,1000.00", "Closing Balance,,,,1000.00"]).split("\n")[0]).toBe(
      "Why: Header row at row 1. Reconciliation failed: opening + credits − debits is not the closing balance.",
    );
    expect(csv([head, "01/10/2026,SHOP,100.00,,900.00", "02/10/2026,TEA,10.00,,800.00", "03/10/2026,FUEL,10.00,,790.00"]).split("\n")[0]).toBe(
      "Why: Header row at row 1. No opening and closing balance printed, and 1 row's balance doesn't follow from the row before.",
    );
    expect(csv([head, "10/05/2026,SHOP,100.00,,900.00", "10/12/2026,TEA,10.00,,890.00", "11/02/2026,FUEL,10.00,,880.00"]).split("\n")[0]).toBe(
      "Why: Header row at row 1. The dates run out of order when read day first.",
    );
  });

  it("for a PDF: page and row, and the masked layout of the first 30 rows plus the closest header further down", () => {
    const p = (str: string, x: number, y: number) => ({ str, x, y, width: str.length * 4.5, height: 10 });
    const top = Array.from({ length: 34 }, (_, i) => p(`EXAMPLE PERSON LINE ${i}`, 30, 800 - i * 20));
    const header = [p("Txn Date", 30, 100), p("Description", 120, 100), p("Debit", 300, 100), p("Credit", 360, 100)];
    const { text, rows, rowLayouts, pageRowCounts } = statementPages([top, header]);
    const out = bankReadFailureText({ format: "pdf", text, rows, rowLayouts, pageRowCounts }).split("\n");
    expect(out[0]).toBe("Why: No header row found. Closest: page 2, row 1, missing the balance column.");
    expect(out).toHaveLength(1 + 30 + 1);
    expect(out[1]).toBe("Page 1, row 1: text x30 w95 c21 dy0");
    expect(out[31]).toBe("Page 2, row 1: text x30 w36 c8 dy0 | text x120 w50 c11 dy0 | text x300 w23 c5 dy0 | text x360 w27 c6 dy0");
    expect(out.join("\n")).not.toMatch(/EXAMPLE|PERSON|Txn|Debit/);
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
