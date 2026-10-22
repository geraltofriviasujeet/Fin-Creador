import { type IncomePageData, loadIncomeData } from "@fin-creador/api";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { getSupabase } from "./supabase";

// One copy of the Income data for the Income screen, the Overview card and the sheets.
// Loaded through the loader shared with the web (RLS applies); refreshed after each save.

export const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";

type IncomeState =
  | { status: "loading" }
  | { status: "ready"; data: IncomePageData; refreshing: boolean }
  | { status: "error"; message: string };

type IncomeStore = { state: IncomeState; refresh: () => Promise<void> };

const IncomeContext = createContext<IncomeStore>({ state: { status: "loading" }, refresh: async () => {} });

export const useIncome = () => useContext(IncomeContext);

export function IncomeDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<IncomeState>({ status: "loading" });

  const refresh = useCallback(async () => {
    setState((s) => (s.status === "ready" ? { ...s, refreshing: true } : { status: "loading" }));
    try {
      const result = await loadIncomeData(getSupabase());
      if (result.ok) setState({ status: "ready", data: result.data, refreshing: false });
      else setState({ status: "error", message: result.reason === "unauthenticated" ? "Your session has ended. Please sign in again." : NETWORK_ERROR });
    } catch {
      // fetch throws when the device is offline.
      setState({ status: "error", message: NETWORK_ERROR });
    }
  }, []);

  useEffect(() => {
    let active = true;
    loadIncomeData(getSupabase())
      .then((result) => {
        if (!active) return;
        if (result.ok) setState({ status: "ready", data: result.data, refreshing: false });
        else setState({ status: "error", message: NETWORK_ERROR });
      })
      .catch(() => active && setState({ status: "error", message: NETWORK_ERROR }));
    return () => {
      active = false;
    };
  }, []);

  return <IncomeContext.Provider value={{ state, refresh }}>{children}</IncomeContext.Provider>;
}
