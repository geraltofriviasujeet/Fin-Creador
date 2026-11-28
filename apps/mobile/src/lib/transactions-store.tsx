import { type RecurringData, type SpendLimit, type TransactionsContext, loadRecurringData, loadSpendLimit, loadTransactionsContext } from "@fin-creador/api";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { SESSION_ENDED, backendUnreachable } from "./home-data";
import { NETWORK_ERROR } from "./income-store";
import { getSupabase } from "./supabase";

// Accounts, categories, "today" and the recurring rules for the Activity tab, the Recurring
// screen and their sheets, through the loaders shared with the web (RLS applies). `version`
// goes up after every save, so the Activity list reloads its page and totals. The daily spend
// limit (pre-13b 2 PR 4) is read here too: `spendLimit` is { limit: null } when none is set and
// null when it couldn't be read, so the Activity button and the sheet never offer "Set" over a
// saved limit. A refresh that fails keeps what was shown (so pull to refresh offline never
// empties a screen) and resolves false; `offline` says the server couldn't be reached at all.

type ContextState =
  | { status: "loading" }
  | { status: "ready"; data: TransactionsContext; recurring: RecurringData | null; spendLimit: { limit: SpendLimit | null } | null }
  | { status: "error"; message: string; offline: boolean };

type Store = { state: ContextState; version: number; refresh: () => Promise<boolean> };

const TransactionsStore = createContext<Store>({ state: { status: "loading" }, version: 0, refresh: async () => false });

export const useTransactions = () => useContext(TransactionsStore);

async function load(): Promise<ContextState> {
  try {
    const [result, recurring, spendLimit] = await Promise.all([
      loadTransactionsContext(getSupabase()),
      loadRecurringData(getSupabase()),
      loadSpendLimit(getSupabase()),
    ]);
    // Recurring items and the spend limit are optional for Activity: if they can't load, the screen still shows.
    if (result.ok) {
      return {
        status: "ready",
        data: result.data,
        recurring: recurring.ok ? recurring.data : null,
        spendLimit: spendLimit.ok ? { limit: spendLimit.data } : null,
      };
    }
    // Offline, the session check fails first: say "offline", never "Your session has ended".
    if (await backendUnreachable()) return { status: "error", message: NETWORK_ERROR, offline: true };
    return { status: "error", message: result.reason === "unauthenticated" ? SESSION_ENDED : NETWORK_ERROR, offline: false };
  } catch {
    // fetch throws when the device is offline.
    return { status: "error", message: NETWORK_ERROR, offline: await backendUnreachable() };
  }
}

export function TransactionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ContextState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    const next = await load();
    setState((s) => (next.status === "error" && s.status === "ready" ? s : next));
    setVersion((v) => v + 1);
    return next.status === "ready";
  }, []);

  useEffect(() => {
    let active = true;
    void load().then((s) => active && setState(s));
    return () => {
      active = false;
    };
  }, []);

  return <TransactionsStore.Provider value={{ state, version, refresh }}>{children}</TransactionsStore.Provider>;
}
