import { type RecurringItem, type RecurringView, type TransactionsContext, buildRecurringView } from "@fin-creador/api";
import { useMemo } from "react";
import { useTransactions } from "./transactions-store";

/**
 * The Recurring screen's data, computed from the shared store with the same view builder
 * as the web (packages/api buildRecurringView). Null while loading or if it failed.
 */
export function useRecurringView(): { data: TransactionsContext; view: RecurringView; items: RecurringItem[] } | null {
  const { state } = useTransactions();
  return useMemo(() => {
    if (state.status !== "ready" || !state.recurring) return null;
    const view = buildRecurringView({ ...state.recurring, ...state.data });
    const items = [...view.due, ...view.attention, ...view.soon, ...view.ended, ...view.archived, ...view.groups.subscription, ...view.groups.membership, ...view.groups.other];
    return { data: state.data, view, items };
  }, [state]);
}

/** One rule's item by id (the sheets get the rule id as a route parameter). */
export function useRecurringItem(ruleId: string): RecurringItem | null {
  const result = useRecurringView();
  return result?.items.find((i) => i.rule.id === ruleId) ?? null;
}
