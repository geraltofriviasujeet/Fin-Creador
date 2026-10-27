import { describe, expect, it } from "vitest";
import {
  AMFI_URL,
  SECRET_HEADER,
  amfiName,
  bseUrl,
  handleRequest,
  istDate,
  runRefresh,
  safeError,
  secretMatches,
  type Deps,
  type InstrumentRow,
  type RunRecord,
} from "./refresh.ts";

// Tiny made-up files in the real layouts. "Now" is 2026-10-27 07:00 IST (01:30 UTC), so the
// BSE file asked for is 2026-10-26's.
const NOW = new Date("2026-10-27T01:30:00Z");
const BSE_URL = bseUrl("2026-10-26");
const SECRET = "s".repeat(40);

const AMFI = [
  "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
  "Open Ended Schemes(Equity Scheme - ELSS)",
  "Example Mutual Fund",
  "100001;INF000A01AA1;-;Example Tax Saver Fund;Direct Plan;Growth Option;28.7924;24-Oct-2026",
  "100002;-;Redeemed;Example Tax Saver Fund - Regular Plan - IDCW;Regular Plan;IDCW;21.25167644;24-Oct-2026",
  "100003;INF000A01AC7;-;Old Plan;;;0;02-Jul-2018",
  "100004;INF000A01AD5;-;Future Fund;;;10;29-Oct-2026",
  "x100005;;;Broken;;;10;24-Oct-2026",
].join("\r\n");

const BSE_HEADER =
  "TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4";
const bseLine = (code: string, isin: string, symbol: string, series: string, name: string, close: string) =>
  `2026-10-26,2026-10-26,CM,BSE,STK,${code},${isin},${symbol},${series},,,,,${name},1,1,1,${close},1,1,,1,,,1,1,1,F1,1,,,,,`;
const BSE = [
  BSE_HEADER,
  bseLine("500001", "INE000X01011", "EXMPL", "A", "EXAMPLE INDUSTRIES LIMITED", "100.55"),
  bseLine("500002", "INF000X01019", "EXETF", "E", "EXAMPLE NIFTY ETF", "250.10"),
  bseLine("700001", "IN0020260001", "GS2036", "G", "GOI 7.10% 2036", "100.10"),
  bseLine("900001", "INE000X01029", "EXNCD", "F", "EXAMPLE NCD", "1000.00"),
  bseLine("500003", "INE000X01037", "NOCLS", "B", "NO CLOSE LTD", ""),
].join("\n");

type Reply = { status?: number; body: string; type?: string } | Error;

function setup(replies: Record<string, Reply>, opts: { failUpsertAt?: number; batchSize?: number } = {}) {
  const fetched: { url: string; init: RequestInit }[] = [];
  const batches: InstrumentRow[][] = [];
  const runs: RunRecord[] = [];
  const logs: string[] = [];
  const deps: Deps = {
    fetch: async (url, init) => {
      fetched.push({ url, init });
      const reply = replies[url];
      if (!reply) return new Response("not found", { status: 404 });
      if (reply instanceof Error) throw reply;
      return new Response(reply.body, { status: reply.status ?? 200, headers: { "content-type": reply.type ?? "text/plain" } });
    },
    store: {
      upsertInstruments: async (rows) => {
        if (opts.failUpsertAt === batches.length) throw new Error("Saving prices failed: 57014 canceling statement due to statement timeout");
        batches.push(rows);
      },
      logRun: async (run) => {
        runs.push(run);
      },
    },
    now: () => NOW,
    log: (line) => logs.push(line),
    batchSize: opts.batchSize,
  };
  return { deps, fetched, batches, runs, logs };
}

const both = { [AMFI_URL]: { body: AMFI }, [BSE_URL]: { body: BSE } };

describe("runRefresh", () => {
  it("loads valid rows from both files and logs one run per source", async () => {
    const { deps, fetched, batches, runs } = setup(both);
    const result = await runRefresh(deps);
    expect(fetched.map((f) => f.url)).toEqual([AMFI_URL, BSE_URL]);
    expect(fetched[1]?.init.headers).toMatchObject({ Referer: "https://www.bseindia.com/" });
    expect(batches.flat()).toEqual([
      {
        source: "amfi",
        source_code: "100001",
        isin: "INF000A01AA1",
        symbol: null,
        name: "Example Tax Saver Fund - Direct Plan - Growth Option",
        kind: "fund",
        last_price_scaled: 287924,
        price_date: "2026-10-24",
      },
      {
        source: "amfi",
        source_code: "100002",
        isin: null,
        symbol: null,
        name: "Example Tax Saver Fund - Regular Plan - IDCW",
        kind: "fund",
        last_price_scaled: 212517, // 21.25167644 rounded half away from zero to 4 decimals
        price_date: "2026-10-24",
      },
      {
        source: "bse",
        source_code: "500001",
        isin: "INE000X01011",
        symbol: "EXMPL",
        name: "EXAMPLE INDUSTRIES LIMITED",
        kind: "share",
        last_price_scaled: 1005500,
        price_date: "2026-10-26",
      },
      {
        source: "bse",
        source_code: "500002",
        isin: "INF000X01019",
        symbol: "EXETF",
        name: "EXAMPLE NIFTY ETF",
        kind: "etf",
        last_price_scaled: 2501000,
        price_date: "2026-10-26",
      },
    ]);
    expect(result).toEqual(runs);
    expect(runs[0]).toMatchObject({
      source: "amfi",
      status: "ok",
      priceDate: "2026-10-24",
      rowsSeen: 5,
      rowsLoaded: 2,
      rowsSkipped: 3,
      skipReasons: { unreadable: 1, no_price: 1, bad_date: 1 },
      error: null,
    });
    expect(runs[1]).toMatchObject({
      source: "bse",
      status: "ok",
      priceDate: "2026-10-26",
      rowsSeen: 5,
      rowsLoaded: 2,
      rowsSkipped: 3,
      skipReasons: { not_equity: 1, debt_series: 1, no_price: 1 },
    });
  });

  it("writes in batches", async () => {
    const { deps, batches } = setup(both, { batchSize: 1 });
    await runRefresh(deps);
    expect(batches.map((b) => b.length)).toEqual([1, 1, 1, 1]);
  });

  it("logs no_file for a 404 or BSE's HTML page, and still loads the other source", async () => {
    for (const reply of [{ status: 404, body: "" }, { body: "<!DOCTYPE html><html>BSE</html>", type: "text/html; charset=utf-8" }]) {
      const { deps, batches, runs } = setup({ [AMFI_URL]: { body: AMFI }, [BSE_URL]: reply });
      await runRefresh(deps);
      expect(runs.map((r) => r.status)).toEqual(["ok", "no_file"]);
      expect(runs[1]).toMatchObject({ rowsSeen: 0, rowsLoaded: 0, priceDate: null });
      expect(batches.flat().every((r) => r.source === "amfi")).toBe(true);
    }
  });

  it("treats a file with a missing column as an error and writes nothing from it", async () => {
    const broken = BSE.replace("ClsPric", "ClosePrice");
    const { deps, batches, runs } = setup({ [AMFI_URL]: { body: AMFI }, [BSE_URL]: { body: broken } });
    await runRefresh(deps);
    expect(runs[1]).toMatchObject({ status: "error", rowsLoaded: 0, error: 'Market file: column "ClsPric" not found' });
    expect(batches.flat().some((r) => r.source === "bse")).toBe(false);
  });

  it("treats a file without one valid row as an error", async () => {
    const { deps, batches, runs } = setup({ [AMFI_URL]: { body: AMFI.split("\r\n").slice(0, 3).join("\r\n") }, [BSE_URL]: { body: BSE } });
    await runRefresh(deps);
    expect(runs[0]).toMatchObject({ status: "error", error: "No valid rows in the file" });
    expect(batches.flat().some((r) => r.source === "amfi")).toBe(false);
  });

  it("logs HTTP errors, timeouts and network failures as errors", async () => {
    const timeout = Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    const { deps, runs } = setup({ [AMFI_URL]: { status: 403, body: "Forbidden" }, [BSE_URL]: timeout });
    await runRefresh(deps);
    expect(runs.map((r) => [r.status, r.error])).toEqual([
      ["error", "HTTP 403"],
      ["error", "Download timed out"],
    ]);
  });

  it("keeps one row per code, the newest price", async () => {
    const dup = [BSE_HEADER, bseLine("500001", "INE000X01011", "EXMPL", "A", "EXAMPLE", "100.00"), bseLine("500001", "INE000X01011", "EXMPL", "A", "EXAMPLE", "101.00")].join("\n");
    const { deps, batches, runs } = setup({ [AMFI_URL]: { body: AMFI }, [BSE_URL]: { body: dup } });
    await runRefresh(deps);
    expect(batches.flat().filter((r) => r.source === "bse")).toHaveLength(1);
    expect(runs[1]?.skipReasons).toEqual({ duplicate_code: 1 });
  });

  it("reports a failed batch with the rows loaded before it", async () => {
    const { deps, runs } = setup(both, { batchSize: 1, failUpsertAt: 1 });
    await runRefresh(deps);
    expect(runs[0]).toMatchObject({ status: "error", rowsLoaded: 1, error: "Saving prices failed: 57014 canceling statement due to statement timeout" });
  });

  it("still finishes when the run log can't be written", async () => {
    const { deps, logs } = setup(both);
    deps.store.logRun = async () => {
      throw new Error("Writing the run log failed: 42501 permission denied");
    };
    expect((await runRefresh(deps)).map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(logs.filter((l) => l.includes("logRunFailed"))).toHaveLength(2);
  });
});

describe("handleRequest", () => {
  const request = (headers: Record<string, string> = {}, method = "POST") => new Request("https://example.test/refresh-prices", { method, headers });

  it("rejects a call without the secret, with a wrong one, or when none is configured", async () => {
    for (const [headers, secret] of [
      [{}, SECRET],
      [{ [SECRET_HEADER]: "wrong" }, SECRET],
      [{ [SECRET_HEADER]: SECRET.slice(0, -1) }, SECRET],
      [{ [SECRET_HEADER]: "" }, ""],
      [{ [SECRET_HEADER]: "short" }, "short"],
    ] as const) {
      const { deps, fetched } = setup(both);
      let started = false;
      const response = await handleRequest(request(headers), secret, () => (started = true), deps);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(started).toBe(false);
      expect(fetched).toHaveLength(0);
    }
  });

  it("only accepts POST", async () => {
    const { deps } = setup(both);
    expect((await handleRequest(request({ [SECRET_HEADER]: SECRET }, "GET"), SECRET, () => undefined, deps)).status).toBe(405);
  });

  it("starts the refresh in the background and answers 202 without details", async () => {
    const { deps, runs } = setup(both);
    let work: Promise<unknown> | null = null;
    const response = await handleRequest(request({ [SECRET_HEADER]: SECRET }), SECRET, (w) => (work = w), deps);
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('{"status":"accepted"}');
    await work;
    expect(runs.map((r) => r.status)).toEqual(["ok", "ok"]);
  });
});

describe("helpers", () => {
  it("compares secrets exactly", async () => {
    expect(await secretMatches(SECRET, SECRET)).toBe(true);
    expect(await secretMatches(null, SECRET)).toBe(false);
    expect(await secretMatches(`${SECRET} `, SECRET)).toBe(false);
  });

  it("removes key-like text from errors", () => {
    // A JWT-shaped value built at run time, so no token-like literal sits in the repository.
    const jwtShaped = ["eyJ" + "a".repeat(12), "b".repeat(12), "c".repeat(12)].join(".");
    expect(safeError(new Error(`bad key ${jwtShaped}`))).toBe("bad key [removed]");
    expect(safeError(new Error("bad sb_secret_abc123"))).toBe("bad [removed]");
    expect(safeError("text")).toBe("Unknown error");
    expect(safeError(new Error("ab ".repeat(300)))).toHaveLength(500);
  });

  it("uses the date in India and builds the BSE file name", () => {
    expect(istDate(new Date("2026-10-26T18:29:59Z"))).toBe("2026-10-26");
    expect(istDate(new Date("2026-10-26T18:30:00Z"))).toBe("2026-10-27");
    expect(bseUrl("2026-10-26")).toBe("https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_20261026_F_0000.CSV");
    expect(() => bseUrl("../x")).toThrow();
  });

  it("adds plan and option to fund names only when missing", () => {
    const base = { schemeCode: "1", isins: [], category: null, amc: null, navScaled: 1n, navDate: "2026-10-26" };
    expect(amfiName({ ...base, name: "Fund", plan: "Direct Plan", option: "Growth" })).toBe("Fund - Direct Plan - Growth");
    expect(amfiName({ ...base, name: "Fund - Direct Plan - Growth", plan: "Direct Plan", option: "Growth" })).toBe("Fund - Direct Plan - Growth");
    expect(amfiName({ ...base, name: "Fund", plan: null, option: null })).toBe("Fund");
  });
});
