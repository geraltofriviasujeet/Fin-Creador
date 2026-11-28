import { describe, expect, it } from "vitest";
import { ADD_ENTRY, TAB_ROUTES, tabForRoute } from "./navigation";

describe("tab routes", () => {
  it("maps every tab to its own route", () => {
    expect(TAB_ROUTES).toEqual({ home: "index", activity: "activity", plan: "plan", roma: "roma" });
    expect(new Set(Object.values(TAB_ROUTES)).size).toBe(4);
  });

  it("finds the tab for a route and round-trips", () => {
    for (const [key, route] of Object.entries(TAB_ROUTES)) expect(tabForRoute(route)).toBe(key);
  });

  it("treats unknown or missing routes as Home", () => {
    expect(tabForRoute("goals")).toBe("home");
    expect(tabForRoute(undefined)).toBe("home");
  });

  it("opens the full-screen Add on Expense", () => {
    expect(ADD_ENTRY).toEqual({ pathname: "/add", params: { type: "expense" } });
  });
});
