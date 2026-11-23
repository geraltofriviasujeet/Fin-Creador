import type { TabKey } from "@/components/ds/tab-bar";

// Bottom tabs (design-spec §5): Home · Activity · ＋ · Plan · Roma. The ds TabBar draws them;
// this maps each tab to its Expo Router route in app/(app)/(tabs). The ＋ is not a route: it
// opens Add (the existing transaction sheet until Sprint 13b).
export const TAB_ROUTES: Readonly<Record<TabKey, string>> = {
  home: "index",
  activity: "activity",
  plan: "plan",
  roma: "roma",
};

/** The tab for a route name; anything unknown counts as Home. */
export function tabForRoute(routeName: string | undefined): TabKey {
  const match = (Object.keys(TAB_ROUTES) as TabKey[]).find((key) => TAB_ROUTES[key] === routeName);
  return match ?? "home";
}

/** Where the ＋ goes: the existing add sheet, on Expense. */
export const ADD_ENTRY = { pathname: "/sheets/transaction", params: { type: "expense" } } as const;

export function comingSoonMessage(label: string) {
  return `${label} is coming in a later update.`;
}
