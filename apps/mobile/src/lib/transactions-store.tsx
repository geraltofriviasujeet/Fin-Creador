import { type RecurringData, type TransactionsContext, loadRecurringData, loadTransactionsContext } from "@fin-creador/api";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { NETWORK_ERROR } from "./income-store";
import { getSupabase } from "./supabase";

// Accounts, categories, "today" and the recurring rules for the Activity tab, the Recurring
// screen and their sheets, through the loaders shared with the web (RLS applies). `version`
// goes up after every save, so the Activity list reloads its page and totals.

type ContextState =
  | { status: "loading" }
  | { status: "ready"; data: TransactionsContext; recurring: RecurringData | null }
  | { status: "error"; message: string };

type Store = { state: ContextState; version: number; refresh: () => Promise<void> };

const TransactionsStore = createContext<Store>({ state: { status: "loading" }, version: 0, refresh: async () => {} });

export const useTransactions = () => useContext(TransactionsStore);

async function load(): Promise<ContextState> {
  try {
    const [result, recurring] = await Promise.all([loadTransactionsContext(getSupabase()), loadRecurringData(getSupabase())]);
    // Recurring items are optional for Activity: if they can't load, the screen still shows.
    if (result.ok) return { status: "ready", data: result.data, recurring: recurring.ok ? recurring.data : null };
    return { status: "error", message: result.reason === "unauthenticated" ? "Your session has ended. Please sign in again." : NETWORK_ERROR };
  } catch {
    // fetch throws when the device is offline.
    return { status: "error", message: NETWORK_ERROR };
  }
}

export function TransactionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ContextState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    setState(await load());
    setVersion((v) => v + 1);
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
