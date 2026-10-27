// refresh-prices: loads the latest AMFI NAVs and BSE closes into public.instruments.
// Runtime-agnostic (no Deno or Node globals): index.ts wires it to the Edge Function, and the
// same code can run elsewhere (e.g. a GitHub Actions fallback) with another fetch and store.
//
// Rules (docs/sprint-plan.md, Sprint 7 decisions 2026-10-27):
//   * Fixed source URLs only; nothing from the request decides what is fetched.
//   * Every row goes through the shared parser (packages/domain/src/market-files.ts) and the
//     load rules below; invalid or excluded rows are skipped and counted, never sent.
//   * A day without a file (BSE answers 404 or an HTML page) is "no_file", not an error.
//   * A missing column, an unreadable file or no valid rows is an error and writes nothing,
//     so old prices stay. The database guard keeps newer prices and known ISINs.
//   * Rows are upserted on (source, source_code) in batches; one run log row per source.
//   * Errors are logged as our own text, with anything key-like removed; never the secret.
import {
  parseAmfiNavAll,
  parseBseBhavcopy,
  type AmfiScheme,
  type BseSecurity,
} from "../../../packages/domain/src/market-files.ts";

export const AMFI_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
const BSE_BASE = "https://www.bseindia.com/download/BhavCopy/Equity/";

/** The BSE equity bhavcopy (UDiFF) for an ISO date, e.g. 2026-10-26. */
export function bseUrl(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
  return `${BSE_BASE}BhavCopy_BSE_CM_0_0_0_${date.replaceAll("-", "")}_F_0000.CSV`;
}

// Both sites serve plain requests today; browser-like headers make a block less likely.
const REQUEST_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Accept: "text/plain,text/csv,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
};
const BSE_HEADERS = { ...REQUEST_HEADERS, Referer: "https://www.bseindia.com/" };

export const BATCH_SIZE = 1000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;
const MAX_PRICE_SCALED = 10_000_000_000_000n;
const MIN_PRICE_DATE = "1990-01-01";

export type Source = "amfi" | "bse";
export type RunStatus = "ok" | "no_file" | "error";

/** One row for public.instruments (columns the refresh writes). */
export interface InstrumentRow {
  source: Source;
  source_code: string;
  isin: string | null;
  symbol: string | null;
  name: string;
  kind: "fund" | "share" | "etf";
  last_price_scaled: number;
  price_date: string;
}

export interface RunRecord {
  source: Source;
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  priceDate: string | null;
  rowsSeen: number;
  rowsLoaded: number;
  rowsSkipped: number;
  skipReasons: Record<string, number>;
  error: string | null;
}

export interface Store {
  upsertInstruments(rows: InstrumentRow[]): Promise<void>;
  logRun(run: RunRecord): Promise<void>;
}

export interface Deps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  store: Store;
  now: () => Date;
  log: (line: string) => void;
  batchSize?: number;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** The calendar date in India (Asia/Kolkata) at `instant`. */
export function istDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Load rules
// ---------------------------------------------------------------------------

type Mapped = { row: InstrumentRow } | { skip: string };

function priceOf(scaled: bigint | null): number | null {
  return scaled === null || scaled <= 0n || scaled > MAX_PRICE_SCALED ? null : Number(scaled);
}

function dateOk(date: string | null, latest: string): date is string {
  return date !== null && date >= MIN_PRICE_DATE && date <= latest;
}

/** AMFI scheme name with its plan and option when the name doesn't already say them. */
export function amfiName(s: AmfiScheme): string {
  const parts = [s.name.trim()];
  for (const extra of [s.plan, s.option]) {
    if (extra && !parts[0]!.toLowerCase().includes(extra.toLowerCase())) parts.push(extra.trim());
  }
  return parts.join(" - ").slice(0, 200);
}

export function amfiRow(s: AmfiScheme, latestDate: string): Mapped {
  if (s.schemeCode.length > 12) return { skip: "bad_code" };
  if (!s.name.trim()) return { skip: "no_name" };
  const price = priceOf(s.navScaled);
  if (price === null) return { skip: "no_price" };
  if (!dateOk(s.navDate, latestDate)) return { skip: "bad_date" };
  return {
    row: {
      source: "amfi",
      source_code: s.schemeCode,
      isin: s.isins[0] ?? null,
      symbol: null,
      name: amfiName(s),
      kind: "fund",
      last_price_scaled: price,
      price_date: s.navDate,
    },
  };
}

/** Shares (INE) and ETFs / fund units (INF); no government securities or debt series. */
export function bseRow(s: BseSecurity, latestDate: string): Mapped {
  if (s.scripCode.length > 12) return { skip: "bad_code" };
  if (!s.isin) return { skip: "no_isin" };
  const kind = s.isin.startsWith("INE") ? "share" : s.isin.startsWith("INF") ? "etf" : null;
  if (!kind) return { skip: "not_equity" };
  if (s.series === "F" || s.series === "G") return { skip: "debt_series" };
  if (!s.name.trim()) return { skip: "no_name" };
  const price = priceOf(s.closeScaled);
  if (price === null) return { skip: "no_price" };
  if (!dateOk(s.tradeDate, latestDate)) return { skip: "bad_date" };
  const symbol = s.symbol && s.symbol.length <= 40 ? s.symbol : null;
  return {
    row: {
      source: "bse",
      source_code: s.scripCode,
      isin: s.isin,
      symbol,
      name: s.name.trim().slice(0, 200),
      kind,
      last_price_scaled: price,
      price_date: s.tradeDate,
    },
  };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

type Fetched = { kind: "file"; text: string } | { kind: "no_file"; reason: string };

async function fetchFile(deps: Deps, url: string, headers: Record<string, string>): Promise<Fetched> {
  const response = await deps.fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (response.status === 404) return { kind: "no_file", reason: "HTTP 404" };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_FILE_BYTES) throw new Error("File too large");
  const text = await response.text();
  if (text.length > MAX_FILE_BYTES) throw new Error("File too large");
  // BSE answers a missing day with its HTML site page and status 200.
  if ((response.headers.get("content-type") ?? "").includes("html") || text.trimStart().startsWith("<")) {
    return { kind: "no_file", reason: "HTML page instead of a file" };
  }
  return { kind: "file", text };
}

// ---------------------------------------------------------------------------
// One source
// ---------------------------------------------------------------------------

const KEY_LIKE = [/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, /sb_(secret|publishable)_[\w-]+/g, /[A-Za-z0-9+/_-]{40,}/g];

/** Our error text, at most 500 characters, with anything that looks like a key removed. */
export function safeError(error: unknown): string {
  let text = error instanceof Error ? error.message : "Unknown error";
  if (error instanceof Error && error.name === "TimeoutError") text = "Download timed out";
  for (const pattern of KEY_LIKE) text = text.replace(pattern, "[removed]");
  return text.slice(0, 500);
}

function count(reasons: Record<string, number>, reason: string, n = 1) {
  if (n > 0) reasons[reason] = (reasons[reason] ?? 0) + n;
}

async function refreshSource(deps: Deps, source: Source): Promise<RunRecord> {
  const startedAt = deps.now().toISOString();
  const today = istDate(deps.now());
  const latestAllowed = shiftDate(today, 1);
  const reasons: Record<string, number> = {};
  let rowsSeen = 0;
  let rowsLoaded = 0;
  let priceDate: string | null = null;
  let status: RunStatus = "ok";
  let error: string | null = null;

  try {
    // BSE: the previous day's closes in India (the job runs at 07:00 IST).
    const fetched =
      source === "amfi" ? await fetchFile(deps, AMFI_URL, REQUEST_HEADERS) : await fetchFile(deps, bseUrl(shiftDate(today, -1)), BSE_HEADERS);
    if (fetched.kind === "no_file") {
      status = "no_file";
      error = fetched.reason;
    } else {
      const mapped: Mapped[] = [];
      if (source === "amfi") {
        const parsed = parseAmfiNavAll(fetched.text);
        rowsSeen = parsed.schemes.length + parsed.issues.length;
        count(reasons, "unreadable", parsed.issues.length);
        for (const s of parsed.schemes) mapped.push(amfiRow(s, latestAllowed));
      } else {
        const parsed = parseBseBhavcopy(fetched.text);
        rowsSeen = parsed.securities.length + parsed.issues.length;
        count(reasons, "unreadable", parsed.issues.length);
        for (const s of parsed.securities) mapped.push(bseRow(s, latestAllowed));
      }

      // One row per code (a batch can't update the same row twice): keep the newest price.
      const byCode = new Map<string, InstrumentRow>();
      for (const m of mapped) {
        if ("skip" in m) {
          count(reasons, m.skip);
          continue;
        }
        const seen = byCode.get(m.row.source_code);
        if (seen) count(reasons, "duplicate_code");
        if (!seen || m.row.price_date > seen.price_date) byCode.set(m.row.source_code, m.row);
      }
      const rows = [...byCode.values()];
      if (rows.length === 0) throw new Error("No valid rows in the file");
      priceDate = rows.reduce((max, r) => (r.price_date > max ? r.price_date : max), rows[0]!.price_date);

      const size = deps.batchSize ?? BATCH_SIZE;
      for (let i = 0; i < rows.length; i += size) {
        const batch = rows.slice(i, i + size);
        await deps.store.upsertInstruments(batch);
        rowsLoaded += batch.length;
      }
    }
  } catch (e) {
    status = "error";
    error = safeError(e);
  }

  const run: RunRecord = {
    source,
    status,
    startedAt,
    finishedAt: deps.now().toISOString(),
    priceDate,
    rowsSeen,
    rowsLoaded,
    rowsSkipped: Object.values(reasons).reduce((a, b) => a + b, 0),
    skipReasons: reasons,
    error,
  };
  deps.log(JSON.stringify({ event: "refresh-prices", ...run }));
  try {
    await deps.store.logRun(run);
  } catch (e) {
    deps.log(JSON.stringify({ event: "refresh-prices", source, logRunFailed: safeError(e) }));
  }
  return run;
}

/** AMFI then BSE; one failing source never stops the other. */
export async function runRefresh(deps: Deps): Promise<RunRecord[]> {
  return [await refreshSource(deps, "amfi"), await refreshSource(deps, "bse")];
}

// ---------------------------------------------------------------------------
// The HTTP call
// ---------------------------------------------------------------------------

export const SECRET_HEADER = "x-refresh-secret";
const MIN_SECRET_LENGTH = 32;

/** Constant-time comparison: both sides are hashed to 32 bytes and every byte is compared. */
export async function secretMatches(provided: string | null, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < MIN_SECRET_LENGTH) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided ?? "")),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = provided === null ? 1 : 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

const json = (status: number, body: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * POST with the shared secret header starts a refresh in the background (`background`
 * keeps it alive after the response) and answers 202 at once. The body is ignored.
 */
export async function handleRequest(
  request: Request,
  secret: string | undefined,
  background: (work: Promise<unknown>) => void,
  deps: Deps,
): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!(await secretMatches(request.headers.get(SECRET_HEADER), secret))) return json(401, { error: "unauthorized" });
  background(runRefresh(deps));
  return json(202, { status: "accepted" });
}
