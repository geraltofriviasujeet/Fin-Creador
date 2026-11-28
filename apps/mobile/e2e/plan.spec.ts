import { type Page, expect, test } from "@playwright/test";
import { buildGoalsView, loadGoalsData, loadNetWorthData, monthLabel } from "@fin-creador/api";
import { formatMoney, netWorth } from "@fin-creador/domain";
import { type Demo, demoClient, seedPlan } from "./demo-data";
import { createConfirmedUser } from "./demo-user";

// Plan tab (13c PR 2) on Expo web at 390px against CI's throwaway local Supabase, with a fresh
// demo user (seedPlan: Food & dining ₹5,100 of ₹6,000, near limit; Shopping ₹3,600 of ₹3,000,
// over budget; Travel ₹500 of ₹4,000). Net worth and the budget figures are checked against the
// shared loaders read as the same user. Then the Budgets screen, the budget sheet (change, a
// refused amount keeps the input, set a new one, a later month, remove). Screenshots for review
// go to e2e-screenshots (CI artifact).

const SHOTS = "e2e-screenshots";
const SUPABASE = /^https?:\/\/(127\.0\.0\.1|localhost):54321\//;
const DEV_SERVER_SOCKET = /^WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/(hot|message)' failed/;
const BLOCKED = /Failed to load resource|net::ERR_/;

test.skip(!process.env.MOBILE_E2E_BACKEND && !process.env.CI, "Needs the local Supabase that CI starts (MOBILE_E2E_BACKEND=1).");

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error" || DEV_SERVER_SOCKET.test(m.text()) || BLOCKED.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("tablist", { name: "Main" })).toBeVisible();
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Main" }).getByRole("tab", { name, exact: true });
// Expo web keeps other screens mounted under the current one: scope to the visible screen.
const plan = (page: Page) => page.getByTestId("plan-screen");
const budgets = (page: Page) => page.getByTestId("budgets-screen");
// The sheet's scrolling body: its title row and the form (or the confirm step).
const sheet = (page: Page, title: string) =>
  page.getByRole("heading", { name: title, exact: true }).locator("xpath=ancestor::div[.//*[@aria-label='Cancel' or @aria-label='Keep budget']][1]");
const row = (scope: ReturnType<Page["getByTestId"]>, name: string) => scope.getByRole("button").filter({ has: scope.page().getByText(name, { exact: true }) });
const inr = (minor: number) => formatMoney(minor, { currency: "INR" });

async function expectedFigures(demo: Demo) {
  const [worth, goals] = await Promise.all([loadNetWorthData(demo.client), loadGoalsData(demo.client)]);
  if (!worth.ok || !goals.ok) throw new Error("Shared loaders failed for the demo user");
  return { worth: netWorth(worth.data), budgets: buildGoalsView(goals.data) };
}

test("Plan: net worth and budgets, the Budgets screen and the budget sheet", async ({ page }) => {
  if (process.env.CI) expect(process.env.MOBILE_E2E_BACKEND, "CI must run these tests against the local Supabase").toBeTruthy();
  const errors = collectErrors(page);
  const { email, password } = await createConfirmedUser("plan");
  const demo = await demoClient(email, password);
  await seedPlan(demo);
  const expected = await expectedFigures(demo);
  // The seeded figures, so a change to the seeders is noticed here first.
  expect(expected.worth.totalMinor).toBe(32_800_00);
  expect(expected.budgets.total).toMatchObject({ spentMinor: 9_200_00, budgetMinor: 13_000_00, leftMinor: 3_800_00, level: "ok" });

  await signIn(page, email, password);
  await tab(page, "Plan").click();

  // 1. Plan: Net worth as the shared netWorth says; Budgets: total left, levels in words.
  await expect(plan(page).getByText(inr(expected.worth.totalMinor!), { exact: true }).first()).toBeVisible();
  await expect(plan(page).getByText(/^Assets ₹32,800 · Liabilities ₹0$/)).toBeVisible();
  await expect(plan(page).getByText("Total available", { exact: true })).toBeVisible();
  await expect(plan(page).getByText(`This month · ${monthLabel(demo.today)}`, { exact: true })).toBeVisible();
  await expect(plan(page).getByText("₹3,800", { exact: true })).toBeVisible();
  await expect(plan(page).getByText("1 over budget · 1 near limit", { exact: true })).toBeVisible();
  await expect(row(plan(page), "Shopping").getByText("Over budget", { exact: true })).toBeVisible();
  await expect(row(plan(page), "Food & dining").getByText("Near limit", { exact: true })).toBeVisible();
  await expect(plan(page).getByRole("progressbar", { name: "Shopping: 120% used, over budget" })).toBeVisible();
  await expect(plan(page).getByRole("progressbar", { name: "Food & dining: 85% used, near limit" })).toBeVisible();
  // Over first, then near limit, then the most used.
  const names = await plan(page).getByRole("progressbar").evaluateAll((bars) => bars.map((b) => b.getAttribute("aria-label")?.split(":")[0]));
  expect(names).toEqual(["All budgets", "Shopping", "Food & dining", "Travel"]);
  await shot(page, "13c-plan-01-top");

  // 2. Budgets screen: every budget, the even-spend mark, the levels.
  await plan(page).getByRole("button", { name: "See all budgets" }).click();
  await expect(budgets(page)).toBeVisible();
  await expect(budgets(page).getByText(/^Spending this month \(/)).toBeVisible();
  await expect(budgets(page).getByRole("progressbar", { name: "Travel: 12% used" })).toHaveAttribute("aria-valuetext", /even-spend mark at \d+ percent/);
  await expect(row(budgets(page), "Shopping").getByText("Over budget", { exact: true })).toBeVisible();
  await expect(row(budgets(page), "Food & dining").getByText("Near limit", { exact: true })).toBeVisible();
  await shot(page, "13c-plan-02-budgets");

  // 3. Budget sheet: change Food & dining to ₹8,000 (a refused amount keeps the input first).
  await row(budgets(page), "Food & dining").click();
  const food = sheet(page, "Budget for Food & dining");
  await expect(food).toBeVisible();
  await expect(food.getByLabel("Monthly budget")).toHaveValue("6000");
  await shot(page, "13c-plan-03-budget-sheet");
  await food.getByLabel("Monthly budget").fill("80x");
  await food.getByRole("button", { name: "Save budget" }).click();
  await expect(food.getByLabel("Monthly budget")).toHaveValue("80x");
  await expect(food).toBeVisible();
  await food.getByLabel("Monthly budget").fill("8000");
  await food.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText("Budget saved.", { exact: true })).toBeVisible();
  await expect(food).toBeHidden();
  await expect(budgets(page).getByRole("progressbar", { name: "Food & dining: 63% used" })).toBeVisible();

  // 4. Set a new budget (Groceries ₹2,000) from this month.
  await budgets(page).getByRole("button", { name: "Set a budget" }).click();
  const fresh = sheet(page, "Set a budget");
  await fresh.getByRole("button", { name: /^Category:/ }).click();
  await page.getByRole("button", { name: "Groceries", exact: true }).click();
  await fresh.getByLabel("Monthly budget").fill("2000");
  await fresh.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText("Budget saved.", { exact: true })).toBeVisible();
  await expect(budgets(page).getByRole("progressbar", { name: "Groceries: 0% used" })).toBeVisible();

  // 5. Next month: the budgets carried forward, nothing spent, no even-spend mark.
  const next = (await expectedFigures(demo)).budgets.nextBudgetMonth!;
  await budgets(page).getByRole("button", { name: monthLabel(next), exact: true }).click();
  await expect(budgets(page).getByText(`The budgets that will apply in ${monthLabel(next)}. Nothing is spent yet. A budget continues every month until you change it or remove it.`)).toBeVisible();
  await expect(budgets(page).getByText(`Carried forward · Since ${monthLabel(demo.today)}`).first()).toBeVisible();
  await expect(budgets(page).getByRole("progressbar", { name: "Travel: 0% used" })).not.toHaveAttribute("aria-valuetext", /even-spend/);

  // 6. Remove Shopping from next month on (confirm step); this month keeps it.
  await row(budgets(page), "Shopping").click();
  const shopping = sheet(page, "Budget for Shopping");
  await shopping.getByRole("button", { name: "Remove budget" }).click();
  await expect(page.getByText(`Remove the Shopping budget from ${monthLabel(next)} on? Earlier months keep their amounts.`)).toBeVisible();
  await page.getByRole("button", { name: "Remove budget", exact: true }).click();
  await expect(page.getByText("Budget removed from that month on.", { exact: true })).toBeVisible();
  await expect(row(budgets(page), "Shopping")).toHaveCount(0);
  const after = await expectedFigures(demo);
  expect(after.budgets.budgets.some((b) => b.category.name === "Shopping")).toBe(true);

  // Back on Plan: the figures follow the change (Food & dining no longer near limit).
  await page.goBack();
  await expect(plan(page).getByText("1 over budget", { exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});

test("Plan: a section that can't load says so and the others still show", async ({ page }) => {
  if (process.env.CI) expect(process.env.MOBILE_E2E_BACKEND, "CI must run these tests against the local Supabase").toBeTruthy();
  const { email, password } = await createConfirmedUser("plan-offline");
  const demo = await demoClient(email, password);
  await seedPlan(demo);
  await signIn(page, email, password);
  // Budgets read dashboard_breakdown; failing it leaves Net worth to show.
  await page.route(SUPABASE, (route) => (route.request().url().includes("/rpc/dashboard_breakdown") ? route.abort() : route.fallback()));
  await tab(page, "Plan").click();
  await expect(plan(page).getByText(/^Assets ₹32,800/)).toBeVisible();
  await expect(plan(page).getByText("We couldn't load your budgets. Please try again.", { exact: true })).toBeVisible();
  await page.unroute(SUPABASE);
  await plan(page).getByRole("button", { name: "Retry: your budgets" }).click();
  await expect(plan(page).getByText("1 over budget · 1 near limit", { exact: true })).toBeVisible();
});
