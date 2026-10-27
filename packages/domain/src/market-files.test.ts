import { describe, expect, it } from "vitest";
import {
  cleanIsin,
  parseAmfiNavAll,
  parseBseBhavcopy,
  parseMarketDate,
  parsePriceScaled,
} from "./market-files";

// Tiny made-up fixtures in the real layouts (no full files in the repo).

describe("parsePriceScaled", () => {
  it("scales to 4 decimals exactly", () => {
    expect(parsePriceScaled("28.7924")).toBe(287924n);
    expect(parsePriceScaled("6350.00")).toBe(63500000n);
    expect(parsePriceScaled("10")).toBe(100000n);
    expect(parsePriceScaled(" 0.0001 ")).toBe(1n);
  });

  it("rounds extra decimals once, half away from zero", () => {
    expect(parsePriceScaled("14.86269632")).toBe(148627n);
    expect(parsePriceScaled("12.00004999")).toBe(120000n);
    expect(parsePriceScaled("12.00005")).toBe(120001n);
    expect(parsePriceScaled("9.99995")).toBe(100000n);
  });

  it("gives null for missing, zero and malformed prices", () => {
    for (const text of ["", "-", "0", "0.0000", "0.00004", "N.A.", "-5.00", "1,234.50", "1e3", "12."]) {
      expect(parsePriceScaled(text)).toBeNull();
    }
  });
});

describe("parseMarketDate", () => {
  it("reads the AMFI, legacy BSE and UDiFF date forms", () => {
    expect(parseMarketDate("26-Oct-2026")).toBe("2026-10-26");
    expect(parseMarketDate("28-Jun-24")).toBe("2024-06-28");
    expect(parseMarketDate("2026-10-26")).toBe("2026-10-26");
    expect(parseMarketDate("29-feb-2028")).toBe("2028-02-29");
  });

  it("rejects impossible dates", () => {
    for (const text of ["29-Feb-2026", "31-Apr-2026", "2026-13-01", "26/10/2026", "", "26-Okt-2026"]) {
      expect(parseMarketDate(text)).toBeNull();
    }
  });
});

describe("cleanIsin", () => {
  it("trims and keeps only ISIN-shaped values", () => {
    expect(cleanIsin("INF178L01BT0 ")).toBe("INF178L01BT0");
    expect(cleanIsin("ine117a01022")).toBe("INE117A01022");
    for (const text of ["-", "", "Redeemed", "HDFCNIVODG", "US0378331005", "INE117A0102X"]) {
      expect(cleanIsin(text)).toBeNull();
    }
  });
});

const AMFI = [
  "﻿Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
  " ",
  "Open Ended Schemes(Equity Scheme - ELSS)",
  " ",
  "Example Mutual Fund",
  " ",
  "100001;INF000A01AA1;-;Example Tax Saver Fund;Direct Plan;Growth Option;28.7924;26-Oct-2026",
  "100002;INF000A01AB9;INF000A01AC7;Example Tax Saver Fund;Regular Plan;IDCW Option;N.A.;26-Oct-2026",
  "",
  "Close Ended Schemes(Income)",
  "",
  "OLD MUTUAL FUND (IDF)",
  "100003;INF000A01AD5 ;Redeemed;Old Fixed Term Plan;;;14.86269632;17-Feb-2017",
  "100004;INF000A01AD5;-;Old Fixed Term Plan II;;;0;02-Jul-2018",
  "x100005;;;Broken row;;;10;26-Oct-2026",
  "",
].join("\r\n");

describe("parseAmfiNavAll", () => {
  const { schemes, issues } = parseAmfiNavAll(AMFI);

  it("reads data rows with their AMC and category headings", () => {
    expect(schemes).toHaveLength(4);
    expect(schemes[0]).toEqual({
      schemeCode: "100001",
      isins: ["INF000A01AA1"],
      name: "Example Tax Saver Fund",
      plan: "Direct Plan",
      option: "Growth Option",
      category: "Open Ended Schemes(Equity Scheme - ELSS)",
      amc: "Example Mutual Fund",
      navScaled: 287924n,
      navDate: "2026-10-26",
    });
    expect(schemes[2]?.amc).toBe("OLD MUTUAL FUND (IDF)");
    expect(schemes[2]?.category).toBe("Close Ended Schemes(Income)");
  });

  it("keeps both ISINs, drops placeholders, and leaves bad NAVs null", () => {
    expect(schemes[1]?.isins).toEqual(["INF000A01AB9", "INF000A01AC7"]);
    expect(schemes[1]?.navScaled).toBeNull();
    expect(schemes[2]?.isins).toEqual(["INF000A01AD5"]);
    expect(schemes[2]?.navScaled).toBe(148627n);
    expect(schemes[3]?.navScaled).toBeNull();
    expect(schemes[3]?.navDate).toBe("2018-07-02");
  });

  it("passes duplicate ISINs through (one ISIN, two scheme codes)", () => {
    expect(schemes.filter((s) => s.isins.includes("INF000A01AD5")).map((s) => s.schemeCode)).toEqual([
      "100003",
      "100004",
    ]);
  });

  it("reports rows it can't read", () => {
    expect(issues).toEqual([{ line: 15, reason: "scheme code is not a number" }]);
  });

  it("reads the older layout without Plan and Option", () => {
    const old = parseAmfiNavAll(
      "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date\n" +
        "Example Mutual Fund\n100001;INF000A01AA1;-;Example Fund - Growth;12.5;01-Jul-2024\n",
    );
    expect(old.schemes[0]).toMatchObject({ plan: null, option: null, navScaled: 125000n, navDate: "2024-07-01" });
  });

  it("throws when the header or a required column is missing", () => {
    expect(() => parseAmfiNavAll("100001;INF000A01AA1;-;Fund;12.5;01-Jul-2024")).toThrow(/header/);
    expect(() => parseAmfiNavAll("Scheme Code;Scheme Name;Date\n")).toThrow(/column "ISIN Div Payout/);
  });
});

const BSE_UDIFF = [
  "TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4",
  "2026-10-26,2026-10-26,CM,BSE,STK,500001,INE000X01011,EXAMPLE,A,,,,,EXAMPLE INDUSTRIES LIMITED,100.00,101.00,99.00,100.55,100.50,99.80,,100.52,,,1200,120000.00,30,F1,1,,,,,",
  '2026-10-26,2026-10-26,CM,BSE,STK,500002,INE000X01029,SAMPLE,B,,,,,"Sample & Co, Ltd",10.00,10.00,10.00,10.05,10.05,10.00,,10.05,,,10,100.00,1,F1,1,EX-BONUS,,,,',
  "2026-10-26,2026-10-26,CM,BSE,STK,700001,IN0020260001,GS2036,G,,,,,GOI 7.10% 2036,100.10,100.10,100.10,,100.10,100.00,,100.10,,,1,100.00,1,F1,1,,,,,",
  "",
].join("\n");

const BSE_LEGACY = [
  "SC_CODE,SC_NAME,SC_GROUP,SC_TYPE,OPEN,HIGH,LOW,CLOSE,LAST,PREVCLOSE,NO_TRADES,NO_OF_SHRS,NET_TURNOV,TDCLOINDI,ISIN_CODE,TRADING_DATE,FILLER2,FILLER3",
  "500001,EXAMPLE IND ,A ,Q,100.00,101.00,99.00,100.55,100.50,99.80,30,1200,120000.00,,INE000X01011,28-Jun-24,,",
  "ABC,BROKEN     ,A ,Q,1,1,1,1,1,1,1,1,1,,INE000X01029,28-Jun-24,,",
].join("\r\n");

describe("parseBseBhavcopy", () => {
  it("reads the UDiFF layout (July 2024 onward)", () => {
    const { format, securities, issues } = parseBseBhavcopy(BSE_UDIFF);
    expect(format).toBe("udiff");
    expect(issues).toEqual([]);
    expect(securities[0]).toEqual({
      scripCode: "500001",
      isin: "INE000X01011",
      symbol: "EXAMPLE",
      name: "EXAMPLE INDUSTRIES LIMITED",
      series: "A",
      instrumentType: "STK",
      closeScaled: 1005500n,
      tradeDate: "2026-10-26",
      remarks: null,
    });
    expect(securities[1]).toMatchObject({ name: "Sample & Co, Ltd", remarks: "EX-BONUS", closeScaled: 100500n });
    expect(securities[2]).toMatchObject({ series: "G", isin: "IN0020260001", closeScaled: null });
  });

  it("reads the legacy EQ_ISINCODE layout (before July 2024)", () => {
    const { format, securities, issues } = parseBseBhavcopy(BSE_LEGACY);
    expect(format).toBe("legacy");
    expect(securities).toEqual([
      {
        scripCode: "500001",
        isin: "INE000X01011",
        symbol: null,
        name: "EXAMPLE IND",
        series: "A",
        instrumentType: "Q",
        closeScaled: 1005500n,
        tradeDate: "2024-06-28",
        remarks: null,
      },
    ]);
    expect(issues).toEqual([{ line: 3, reason: "scrip code is not a number" }]);
  });

  it("throws on an unknown header or a missing required column", () => {
    expect(() => parseBseBhavcopy("Symbol,Close\nABC,1\n")).toThrow(/unknown BSE/);
    expect(() => parseBseBhavcopy("FinInstrmId,ISIN,TckrSymb\n500001,INE000X01011,X\n")).toThrow(/FinInstrmNm/);
  });
});
