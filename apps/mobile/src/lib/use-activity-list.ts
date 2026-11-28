import {
  type ActivityFilters,
  type LedgerItem,
  type PageCursor,
  type TransactionTotals,
  activityApiFilters,
  activityPreviousRange,
  loadTransactionPage,
  loadTransactionTotals,
} from "@fin-creador/api";
import type { IsoDate } from "@fin-creador/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { backendUnreachable } from "./home-data";
import { getSupabase } from "./supabase";

// The Activity list (Sprint 13b PR 4): the first page, the totals for the tiles and the month
// before's totals for the savings-rate trend, through the loaders shared with the web (RLS
// applies). Held in memory only. A reload that fails keeps the list shown and says whether the
// phone is offline; a first load that fails is an offline or error state with Try again.

export type ActivityList =
  | { status: "loading" }
  | { status: "offline" }
  | { status: "error" }
  | {
      status: "ready";
      items: LedgerItem[];
      nextCursor: PageCursor | null;
      totals: TransactionTotals;
      previous: { totals: TransactionTotals; month: IsoDate } | null;
      loadedAt: Date;
      problem: "offline" | "error" | null;
      more: "idle" | "loading" | "error";
    };

type Loaded = Omit<Extract<ActivityList, { status: "ready" }>, "status" | "loadedAt" | "problem" | "more">;

async function loadFirst(f: ActivityFilters, currency: string): Promise<Loaded | null> {
  const supabase = getSupabase();
  const filters = activityApiFilters(f);
  const prevRange = activityPreviousRange(f);
  try {
    const [page, totals, prev] = await Promise.all([
      loadTransactionPage(supabase, filters, { currency }),
      loadTransactionTotals(supabase, filters, currency),
      // The trend compares the whole month before with the same filters (the type chip doesn't apply to totals).
      prevRange ? loadTransactionTotals(supabase, activityApiFilters({ ...f, q: "", month: null, from: prevRange.start, to: prevRange.end }), currency) : null,
    ]);
    if (!page.ok || !totals.ok) return null;
    return {
      items: page.items,
      nextCursor: page.nextCursor,
      totals: totals.totals,
      // The trend is left out if its read fails, never shown wrong.
      previous: prev?.ok && prevRange ? { totals: prev.totals, month: prevRange.start } : null,
    };
  } catch {
    return null; // fetch throws when the request never left the phone
  }
}

/**
 * `filters` change → the list shows loading and reloads; `version` (after a save or pull to
 * refresh) and `reload()` (back on the tab, Try again) reload and keep what is shown while they do.
 */
export function useActivityList(filters: ActivityFilters, currency: string, version: number) {
  const [list, setList] = useState<ActivityList>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify(filters);
  const latest = useRef(0);
  const shownKey = useRef<string | null>(null);

  useEffect(() => {
    const id = ++latest.current;
    const f = JSON.parse(key) as ActivityFilters;
    // Other filters: start over. The same filters (a save, pull to refresh, retry): keep the list while reloading.
    if (shownKey.current !== key) setList({ status: "loading" });
    void (async () => {
      const loaded = await loadFirst(f, currency);
      if (id !== latest.current) return;
      if (loaded) {
        shownKey.current = key;
        setList({ status: "ready", ...loaded, loadedAt: new Date(), problem: null, more: "idle" });
        return;
      }
      const offline = await backendUnreachable();
      if (id !== latest.current) return;
      setList((l) => {
        if (l.status === "ready" && shownKey.current === key) return { ...l, problem: offline ? "offline" : "error" };
        shownKey.current = null;
        return { status: offline ? "offline" : "error" };
      });
    })();
  }, [key, currency, version, attempt]);

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const loadMore = useCallback(async () => {
    if (list.status !== "ready" || !list.nextCursor || list.more === "loading") return;
    const id = latest.current;
    const cursor = list.nextCursor;
    setList((l) => (l.status === "ready" ? { ...l, more: "loading" } : l));
    let page: Awaited<ReturnType<typeof loadTransactionPage>> | null = null;
    try {
      page = await loadTransactionPage(getSupabase(), activityApiFilters(JSON.parse(key) as ActivityFilters), { currency, cursor });
    } catch {
      page = null;
    }
    if (id !== latest.current) return;
    setList((l) => {
      if (l.status !== "ready") return l;
      if (!page?.ok) return { ...l, more: "error" };
      return { ...l, items: [...l.items, ...page.items], nextCursor: page.nextCursor, more: "idle" };
    });
  }, [list, key, currency]);

  return { list, reload, loadMore };
}
