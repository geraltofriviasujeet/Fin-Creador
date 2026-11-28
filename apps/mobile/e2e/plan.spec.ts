import { type Page, expect, test } from "@playwright/test";
import { buildGoalsView, fullDate, goalPaceOf, loadGoalsData, loadNetWorthData, monthLabel } from "@fin-creador/api";
import { addDays, formatDayMonth, formatMoney, netWorth } from "@fin-creador/domain";
import { type Demo, backdateGoal, demoClient, seedPlan, seedPlanGoals } from "./demo-data";
import { createConfirmedUser } from "./demo-user";

// Plan tab (13c PR 2) on Expo web at 390px against CI's throwaway local Supabase, with a fresh
// demo user (seedPlan: Food & dining ₹5,100 of ₹6,000, near limit; Shopping ₹3,600 of ₹3,000,
// over budget; Travel ₹500 of ₹4,000). Net worth and the budget figures are checked against the
// shared loaders read as the same user. Then the Budgets screen, the budget sheet (change, a
// refused amount keeps the input, set a new one, a later month, remove). 13c PR 3: Goals (the
// Goals screen and every goal sheet), Bills that repeat (Confirm through Add, Skip, See all) and
// Recurring's Ended hint (seedPlanGoals, one goal backdated on CI's local database). Screenshots
// for review go to e2e-screenshots (CI artifact).

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
const goalsScreen = (page: Page) => page.getByTestId("goals-screen");
const row = (scope: ReturnType<Page["getByTestId"]>, name: string) => scope.getByRole("button").filter({ has: scope.page().getByText(name, { exact: true }) });
// The fill colour of a progress bar (its first child), as rgb().
const barColour = (bar: ReturnType<Page["getByRole"]>) => bar.evaluate((el) => getComputedStyle(el.firstElementChild as Element).backgroundColor);
const RED = "rgb(194, 65, 45)"; // mobile warning #c2412d: over budget only
const AMBER = "rgb(168, 106, 0)"; // mobile cautionFill #a86a00: near limit
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
  // Red only when over budget; near limit is amber (owner, 13c PR 3). The words say it too.
  expect(await barColour(plan(page).getByRole("progressbar", { name: "Shopping: 120% used, over budget" }))).toBe(RED);
  expect(await barColour(plan(page).getByRole("progressbar", { name: "Food & dining: 85% used, near limit" }))).toBe(AMBER);
  // Plan's header: the title with the bell and Settings, and no add button (the tab bar's + only).
  await expect(plan(page).getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
  await expect(plan(page).getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await expect(plan(page).getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add transaction" })).toHaveCount(0);
  await expect(plan(page).getByText("What you own minus what you owe, today.", { exact: true })).toBeVisible();
  // Over first, then near limit, then the most used.
  // Budget bars only (goal rings are progress bars too, "…: 20% saved").
  const names = await plan(page).getByRole("progressbar", { name: / used/ }).evaluateAll((bars) => bars.map((b) => b.getAttribute("aria-label")?.split(":")[0]));
  expect(names).toEqual(["All budgets", "Shopping", "Food & dining", "Travel"]);
  await shot(page, "13c-plan-01-top");

  // 2. Budgets screen: every budget, the even-spend mark, the levels.
  await plan(page).getByRole("button", { name: "See all budgets" }).click();
  await expect(budgets(page)).toBeVisible();
  await expect(budgets(page).getByText(/^Spending this month \(/)).toBeVisible();
  await expect(budgets(page).getByRole("progressbar", { name: "Travel: 12% used" })).toHaveAttribute("aria-valuetext", /even-spend mark at \d+ percent/);
  await expect(row(budgets(page), "Shopping").getByText("Over budget", { exact: true })).toBeVisible();
  await expect(row(budgets(page), "Food & dining").getByText("Near limit", { exact: true })).toBeVisible();
  // Over budget first, then near limit, then the rest by share used (not by name).
  const listed = await budgets(page).getByRole("progressbar").evaluateAll((bars) => bars.map((b) => b.getAttribute("aria-label")?.split(":")[0]));
  expect(listed).toEqual(["All budgets", "Shopping", "Food & dining", "Travel"]);
  expect(await barColour(budgets(page).getByRole("progressbar", { name: "Shopping: 120% used, over budget" }))).toBe(RED);
  expect(await barColour(budgets(page).getByRole("progressbar", { name: "Food & dining: 85% used, near limit" }))).toBe(AMBER);
  await shot(page, "13c-plan-02-budgets");

  // 3. Budget sheet: change Food & dining to ₹8,000 (a refused amount keeps the input first).
  await row(budgets(page), "Food & dining").click();
  const food = sheet(page, "Budget for Food & dining");
  await expect(food).toBeVisible();
  // The amount with Indian grouping beside the ₹ sign, as Add shows it.
  await expect(food.getByLabel("Monthly budget")).toHaveValue("6,000");
  await expect(food.getByText("₹", { exact: true })).toBeVisible();
  await shot(page, "13c-plan-03-budget-sheet");
  // A refused amount keeps what was typed (only digits and one point can be typed).
  await food.getByLabel("Monthly budget").fill("99999999999999");
  await expect(food.getByLabel("Monthly budget")).toHaveValue("99,99,99,99,99,999");
  await food.getByRole("button", { name: "Save budget" }).click();
  await expect(food.getByText("Amount is too large", { exact: true })).toBeVisible();
  await expect(food.getByLabel("Monthly budget")).toHaveValue("99,99,99,99,99,999");
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

test("Plan: goals and bills that repeat, the Goals screen, goal sheets and Recurring's Ended hint", async ({ page }) => {
  if (process.env.CI) expect(process.env.MOBILE_E2E_BACKEND, "CI must run these tests against the local Supabase").toBeTruthy();
  const errors = collectErrors(page);
  const { email, password } = await createConfirmedUser("plan-goals");
  const demo = await demoClient(email, password);
  const { bikeStartedOn } = await seedPlanGoals(demo);
  backdateGoal(email, "New bike", bikeStartedOn);

  // The pace the shared helper finds for the same user: the bike behind, the trip on track.
  const loaded = await loadGoalsData(demo.client);
  if (!loaded.ok) throw new Error("Shared goals loader failed for the demo user");
  const view = buildGoalsView(loaded.data);
  const goal = (name: string) => view.active.find((g) => g.goal.name === name)!;
  expect(goalPaceOf(goal("New bike"), view)).toEqual({ status: "behind", expectedMinor: 40_000_00, shortMinor: 30_000_00 });
  expect(goalPaceOf(goal("Goa trip"), view)?.status).toBe("on_track");
  expect(goalPaceOf(goal("Emergency fund"), view)).toBeNull();
  expect(goal("Goa trip").goal.targetMinor).toBe(40_000_00);
  expect(goal("New bike").goal.targetMinor).toBe(130_000_00);

  await signIn(page, email, password);
  await tab(page, "Plan").click();

  // 1. Plan → Goals: the pace in words; Bills that repeat: due chips first, then coming up.
  await expect(plan(page).getByText("1 behind · 1 on track", { exact: true })).toBeVisible();
  await expect(row(plan(page), "New bike").getByText("Behind", { exact: true })).toBeVisible();
  await expect(row(plan(page), "Goa trip").getByText("On track", { exact: true })).toBeVisible();
  await expect(plan(page).getByText("2 to confirm", { exact: true })).toBeVisible();
  await expect(plan(page).getByText(`Overdue · ${formatDayMonth(addDays(demo.today, -3))}`, { exact: true })).toBeVisible();
  await expect(plan(page).getByRole("button", { name: "Confirm Internet", exact: true })).toBeVisible();
  await expect(plan(page).getByRole("button", { name: "Skip Newspaper, Today", exact: true })).toBeVisible();
  await expect(plan(page).getByRole("button", { name: /^Electricity, -₹2,400, / })).toBeVisible();
  await plan(page).getByRole("heading", { name: "Goals", exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot(page, "13c-plan-04-goals-bills");

  // 2. Goals screen: rings, saved of target, On track / Behind and how far behind.
  await plan(page).getByRole("button", { name: "See all goals" }).click();
  await expect(goalsScreen(page)).toBeVisible();
  await expect(goalsScreen(page).getByText("₹8,000 of ₹40,000", { exact: true })).toBeVisible();
  await expect(goalsScreen(page).getByText("₹10,000 of ₹1,30,000", { exact: true })).toBeVisible();
  await expect(goalsScreen(page).getByText("Vehicle", { exact: true })).toBeVisible();
  await expect(goalsScreen(page).getByText("₹30,000 behind an even pace since you added it", { exact: true })).toBeVisible();
  await expect(goalsScreen(page).getByRole("progressbar", { name: "New bike: 7% saved" })).toBeVisible();
  await expect(goalsScreen(page).getByRole("progressbar", { name: "Goa trip: 20% saved" })).toBeVisible();
  await expect(goalsScreen(page).getByText("Save ₹5,000 a month, assuming 12 months (no target date)", { exact: true })).toBeVisible();
  // Ask Roma per goal stays hidden until 13d.
  await expect(goalsScreen(page).getByRole("button", { name: /^Ask Roma/ })).toHaveCount(0);
  await shot(page, "13c-plan-05-goals");

  // 3. Plan a goal (Other): the amount to save shows as it is typed.
  await goalsScreen(page).getByRole("button", { name: "Plan a goal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan a goal", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Other", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Diwali gifts");
  await page.getByLabel("What it's for", { exact: true }).fill("Gifts for the family");
  await page.getByLabel("Amount", { exact: true }).fill("15000");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("15,000");
  await expect(page.getByText("Amount to save", { exact: true })).toBeVisible();
  await shot(page, "13c-plan-06-add-goal");
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  await expect(page.getByText("Goal added.", { exact: true })).toBeVisible();
  await expect(goalsScreen(page).getByText("₹0 of ₹15,000", { exact: true })).toBeVisible();

  // 4. Update saved: ₹8,000 → ₹20,000 on the Goa trip.
  await goalsScreen(page).getByRole("button", { name: "Update saved amount for Goa trip" }).click();
  await expect(page.getByLabel("Saved so far", { exact: true })).toHaveValue("8,000");
  await page.getByLabel("Saved so far", { exact: true }).fill("20000");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved amount updated.", { exact: true })).toBeVisible();
  await expect(goalsScreen(page).getByText("₹20,000 of ₹40,000", { exact: true })).toBeVisible();

  // 5. Archive, restore, delete permanently.
  await goalsScreen(page).getByRole("button", { name: "Archive Diwali gifts" }).click();
  await expect(page.getByRole("heading", { name: "Archive Diwali gifts?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText("Goal archived.", { exact: true })).toBeVisible();
  await goalsScreen(page).getByRole("button", { name: "Show archived (2)" }).click();
  await goalsScreen(page).getByRole("button", { name: "Restore Old laptop" }).click();
  await expect(page.getByText("Goal restored.", { exact: true })).toBeVisible();
  await goalsScreen(page).getByRole("button", { name: "Delete Diwali gifts permanently" }).click();
  await expect(page.getByRole("heading", { name: "Delete Diwali gifts permanently?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByText("Goal deleted.", { exact: true })).toBeVisible();
  await expect(goalsScreen(page).getByText("Diwali gifts", { exact: true })).toHaveCount(0);
  const after = await loadGoalsData(demo.client);
  if (!after.ok) throw new Error("Shared goals loader failed for the demo user");
  expect(after.data.goals.map((g) => g.name).sort()).toEqual(["Emergency fund", "Goa trip", "New bike", "Old laptop"]);

  // 6. Bills that repeat: Confirm through Add, Skip through its sheet.
  await page.goBack();
  await plan(page).getByRole("button", { name: "Confirm Internet", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add expense", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save ₹1,000 expense", exact: true }).click();
  await expect(page.getByText("Expense saved.", { exact: true })).toBeVisible();
  await expect(plan(page).getByRole("button", { name: "Confirm Internet", exact: true })).toHaveCount(0);
  await plan(page).getByRole("button", { name: "Skip Newspaper, Today", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Skip ${fullDate(demo.today)}?`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByText("Skipped. Nothing was saved for this date.", { exact: true })).toBeVisible();
  await expect(plan(page).getByRole("button", { name: /^Skip Newspaper/ })).toHaveCount(0);

  // 7. See all → Recurring; an Ended item's Edit says how to restart it.
  // The toast clears first, so the screenshot shows the whole sheet.
  await expect(page.getByText("Skipped. Nothing was saved for this date.", { exact: true })).toBeHidden({ timeout: 10_000 });
  await plan(page).getByRole("button", { name: "See all bills that repeat" }).click();
  await page.getByRole("button", { name: /^Gym membership, / }).click();
  await expect(page.getByRole("heading", { name: "Edit recurring", exact: true })).toBeVisible();
  await expect(
    page.getByText("To restart it, choose a later end date or clear it. Nothing is saved for the dates it missed; if one has passed, the latest shows under Due for you to confirm or skip.", { exact: true }),
  ).toBeVisible();
  await shot(page, "13c-plan-07-recurring-ended");

  expect(errors).toEqual([]);
});
