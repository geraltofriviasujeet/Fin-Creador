import { type GoalsView, buildGoalsView, loadGoalsData, loadNetWorthData } from "@fin-creador/api";
import { type NetWorth, netWorth } from "@fin-creador/domain";
import { useCallback } from "react";
import { getSupabase } from "./supabase";
import { useLoaded } from "./use-loaded";

// The Plan tab's data (Sprint 13c), each section on its own so one that fails leaves the others
// to show. Same loaders and builders as the web Overview and Goals page (packages/api), so every
// figure is the web's. In memory only.

export const NET_WORTH_ERROR = "We couldn't load your net worth. Please try again.";
export const BUDGETS_ERROR = "We couldn't load your budgets. Please try again.";

export type NetWorthData = { view: NetWorth; timeZone: string };

export function useNetWorth() {
  const load = useCallback(async () => {
    const r = await loadNetWorthData(getSupabase());
    return r.ok ? { ok: true as const, data: { view: netWorth(r.data), timeZone: r.timeZone } } : r;
  }, []);
  return useLoaded<NetWorthData>(load, NET_WORTH_ERROR);
}

/** Budgets for `month` ("YYYY-MM"; this month when left out), as the web Goals page builds them. */
export function useBudgets(month?: string) {
  const load = useCallback(async () => {
    const r = await loadGoalsData(getSupabase(), month);
    return r.ok ? { ok: true as const, data: buildGoalsView(r.data) } : r;
  }, [month]);
  return useLoaded<GoalsView>(load, BUDGETS_ERROR);
}

export const GOALS_ERROR = "We couldn't load your goals. Please try again.";

/** Goals (13c PR 3): the same view as the budgets (the web Goals page's), loaded on its own. */
export function useGoalsView() {
  const load = useCallback(async () => {
    const r = await loadGoalsData(getSupabase());
    return r.ok ? { ok: true as const, data: buildGoalsView(r.data) } : r;
  }, []);
  return useLoaded<GoalsView>(load, GOALS_ERROR);
}
