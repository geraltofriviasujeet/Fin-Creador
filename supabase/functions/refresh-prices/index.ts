// Edge Function entry (Deno). Called once a day by pg_cron through pg_net (migration
// 20261027180000) with the shared secret header; see refresh.ts for the rules.
//
// Environment (Supabase sets the first two for every function; the secret is set by hand
// with `supabase secrets set`, never in the repository):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REFRESH_PRICES_SECRET
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { handleRequest, type InstrumentRow, type RunRecord, type Store } from "./refresh.ts";

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void };

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Database errors carry only their code and message (no request data or keys).
const fail = (what: string, error: { code?: string; message?: string }) => new Error(`${what}: ${error.code ?? "?"} ${error.message ?? ""}`);

const store: Store = {
  async upsertInstruments(rows: InstrumentRow[]) {
    const { error } = await db.from("instruments").upsert(rows, { onConflict: "source,source_code" });
    if (error) throw fail("Saving prices failed", error);
  },
  async logRun(run: RunRecord) {
    const { error } = await db.from("price_refresh_runs").insert({
      source: run.source,
      status: run.status,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
      price_date: run.priceDate,
      rows_seen: run.rowsSeen,
      rows_loaded: run.rowsLoaded,
      rows_skipped: run.rowsSkipped,
      skip_reasons: run.skipReasons,
      error: run.error,
    });
    if (error) throw fail("Writing the run log failed", error);
  },
};

Deno.serve((request) =>
  handleRequest(request, Deno.env.get("REFRESH_PRICES_SECRET"), (work) => EdgeRuntime.waitUntil(work), {
    fetch: (url, init) => fetch(url, init),
    store,
    now: () => new Date(),
    // eslint-disable-next-line no-console -- function logs (counts only, no secrets)
    log: (line) => console.log(line),
  }),
);
