import { type Page, expect, test } from "@playwright/test";
import { formatAmount } from "../src/components/ds/logic";
import { heroText, shortWarnings } from "../src/components/home/home-text";
import { type Demo, demoClient, expectedHome, seedNormal, seedShort } from "./demo-data";
import { createConfirmedUser } from "./demo-user";

// Sprint 13a PR 4: Home on Expo web at 390px against CI's throwaway local Supabase, with a fresh
// demo user per test and demo figures only. The figures on screen are checked against the
// shared loader read as the same user, and against the fixed demo arithmetic.
const SHOTS = "e2e-screenshots";
const SUPABASE = /^https?:\/\/(127\.0\.0\.1|localhost):54321\//;
const DEV_SERVER_SOCKET = /^WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/(hot|message)' failed/;
// Requests we block or fail on purpose show up as console errors.
const BLOCKED = /Failed to load resource|net::ERR_|status of 500/;

test.skip(!process.env.MOBILE_E2E_BACKEND && !process.env.CI, "Needs the local Supabase that CI starts (MOBILE_E2E_BACKEND=1).");

function collectErrors(page: Page, { allowBlocked = false } = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error" || DEV_SERVER_SOCKET.test(m.text())) return;
    if (allowBlocked && BLOCKED.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function newUser(label: string, seed?: (demo: Demo) => Promise<void>) {
  const { email, password } = await createConfirmedUser(label);
  const demo = await demoClient(email, password);
  if (seed) await seed(demo);
  return { email, password, demo };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("tablist", { name: "Main" })).toBeVisible();
}

const greeting = (page: Page) => page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ });
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Main" }).getByRole("tab", { name, exact: true });
const money = (minor: number) => formatAmount(minor).text;

/** The whole Home in one picture (Expo web scrolls inside the page, so make the page tall). */
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.setViewportSize({ width: 390, height: 2000 });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.setViewportSize({ width: 390, height: 844 });
}

test("Home shows the demo user's Safe to spend, Coming up, Where it went and Your money", async ({ page }) => {
  if (process.env.CI) expect(process.env.MOBILE_E2E_BACKEND, "CI must run these tests against the local Supabase").toBeTruthy();
  const errors = collectErrors(page);
  const { email, password, demo } = await newUser("home", (d) => seedNormal(d));
  const home = await expectedHome(demo);
  const hero = heroText(home);

  // The fixed demo arithmetic, through the shared loader: (₹42,000 − ₹3,000) ÷ 8 days.
  expect(home.safe.kind).toBe("daily");
  expect(hero.amountMinor).toBe(4_875_00);
  expect(hero.lines).toEqual(["₹3,675 left today"]);
  expect(hero.figures.map((f) => f.minor)).toEqual([42_000_00, 3_000_00, 0]);

  await signIn(page, email, password);
  await expect(greeting(page)).toHaveText(/^Good (morning|afternoon|evening), Demo$/);
  await expect(page.getByLabel(hero.label)).toBeVisible();
  await expect(page.getByText(money(hero.amountMinor), { exact: true }).first()).toBeVisible();
  await expect(page.getByText(hero.suffix!, { exact: true })).toBeVisible();
  await expect(page.getByText("₹3,675 left today", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Money left: ₹42,000")).toBeVisible();
  await expect(page.getByLabel("Bills due: ₹3,000")).toBeVisible();

  // Coming up: both bills, soonest first, with the account; Where it went: food with its budget.
  await expect(page.getByLabel(/^Electricity, \d{1,2} [A-Z][a-z]{2} · HDFC Bank, Money out, ₹2,400$/)).toBeVisible();
  await expect(page.getByLabel(/^Phone, \d{1,2} [A-Z][a-z]{2} · HDFC Bank, Money out, ₹600$/)).toBeVisible();
  await expect(page.getByLabel("Food & dining, ₹1,200")).toBeVisible();
  await expect(page.getByText("Spent this month")).toBeVisible();
  await expect(page.getByText("Total available")).toBeVisible();
  await expect(page.getByLabel("HDFC Bank, ₹37,300")).toBeVisible();
  await expect(page.getByLabel("Cash, ₹3,500")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask Roma" })).toBeVisible();
  await shot(page, "13a-home-normal");

  // Quick actions open the existing sheet on the right type; Import UPI is coming soon.
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add income", exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add transfer", exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole("button", { name: "Import UPI" }).click();
  await expect(page.getByText("Import UPI is coming in a later update.")).toBeVisible();

  // Ask Roma opens the Roma tab.
  await page.getByRole("button", { name: "Ask Roma" }).click();
  await expect(tab(page, "Roma")).toHaveAttribute("aria-selected", "true");

  expect(errors).toEqual([]);
});

test("short: ₹0 a day, the shortfall before payday and the account named", async ({ page }) => {
  const errors = collectErrors(page);
  const { email, password, demo } = await newUser("short", seedShort);
  const home = await expectedHome(demo);
  const hero = heroText(home);
  expect(hero.amountMinor).toBe(0);
  expect(hero.lines[0]).toMatch(/^₹3,000 short before \d{1,2} [A-Z][a-z]{2} in HDFC Bank$/);
  const [warning] = shortWarnings(home);
  expect(warning).toMatch(/^Rent on \d{1,2} [A-Z][a-z]{2} leaves you ₹3,000 short in HDFC Bank$/);

  await signIn(page, email, password);
  await expect(page.getByText(hero.lines[0]!, { exact: true })).toBeVisible();
  await expect(page.getByRole("alert", { name: `Warning: ${warning}` })).toBeVisible();
  await shot(page, "13a-home-short");
  expect(errors).toEqual([]);
});

test("no income date: money left this month and 'Set your income date' opens the income setup", async ({ page }) => {
  const errors = collectErrors(page);
  const { email, password, demo } = await newUser("no-income", (d) => seedNormal(d, { income: false }));
  const hero = heroText(await expectedHome(demo));
  expect(hero.title).toBe("Money left this month");

  await signIn(page, email, password);
  await expect(page.getByText("Money left this month", { exact: true })).toBeVisible();
  await expect(page.getByLabel(hero.label)).toBeVisible();
  await expect(page.getByText(/a day, until/)).toHaveCount(0);
  await shot(page, "13a-home-no-income-date");

  await page.getByRole("button", { name: "Set your income date" }).click();
  await expect(page.getByRole("heading", { name: "Add recurring", exact: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Type" }).getByRole("tab", { name: "Income" })).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

test("a new user sees the first-run state with Add an account and Add expense", async ({ page }) => {
  const errors = collectErrors(page);
  const { email, password } = await newUser("empty");
  await signIn(page, email, password);
  await expect(page.getByRole("heading", { name: "Start with an account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add expense" })).toBeVisible();
  await shot(page, "13a-home-empty");
  await page.getByRole("button", { name: "Add an account" }).click();
  await expect(page.getByRole("heading", { name: "Add bank account", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("error: a server failure shows Retry, and Retry loads Home", async ({ page }) => {
  const errors = collectErrors(page, { allowBlocked: true });
  const { email, password } = await newUser("error", (d) => seedNormal(d));
  await signIn(page, email, password);
  await expect(page.getByText("Safe to spend today", { exact: true })).toBeVisible();

  // Every database request fails (the auth server still answers): a reload shows the error.
  await page.route(/\/rest\/v1\//, (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"demo failure"}' }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "We couldn't load Home" })).toBeVisible();
  await page.unroute(/\/rest\/v1\//);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Safe to spend today", { exact: true })).toBeVisible();
  expect(errors.filter((e) => !BLOCKED.test(e))).toEqual([]);
});

test("offline: keeps what was loaded with the time; a cold start offline shows Try again", async ({ page }) => {
  const errors = collectErrors(page, { allowBlocked: true });
  const { email, password } = await newUser("offline", (d) => seedNormal(d));
  await signIn(page, email, password);
  await expect(page.getByText("₹3,675 left today", { exact: true })).toBeVisible();

  // Network to the backend blocked; coming back to Home refreshes it.
  await page.route(SUPABASE, (route) => route.abort("internetdisconnected"));
  await tab(page, "Activity").click();
  await tab(page, "Home").click();
  const banner = page.getByRole("alert", { name: /^You're offline\. Showing what was loaded at \d{1,2}:\d{2} (AM|PM)\.$/ });
  await expect(banner).toBeVisible();
  await expect(page.getByText("₹3,675 left today", { exact: true })).toBeVisible();
  await shot(page, "13a-home-offline");

  // Cold start offline (the session is still in the tab): nothing to show, Try again.
  await page.reload();
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await page.unroute(SUPABASE);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("₹3,675 left today", { exact: true })).toBeVisible();
  await expect(banner).toHaveCount(0);
  expect(errors.filter((e) => !BLOCKED.test(e))).toEqual([]);
});

test("avatar menu: Accounts, Recurring and Settings open, coming soon items say so, Sign out", async ({ page }) => {
  const errors = collectErrors(page);
  const { email, password } = await newUser("menu", (d) => seedNormal(d));
  await signIn(page, email, password);
  await expect(greeting(page)).toBeVisible();

  const menu = async () => {
    await page.getByRole("button", { name: "Profile menu" }).click();
    await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  };

  // Income and Recurring: one title each (the stack header), not two.
  await menu();
  await page.getByRole("button", { name: /^Accounts and income/ }).click();
  await expect(page.getByRole("heading", { name: "Income", exact: true })).toHaveCount(1);
  await page.goBack();
  await menu();
  await page.getByRole("button", { name: /^Recurring/ }).click();
  await expect(page.getByRole("heading", { name: "Recurring", exact: true })).toHaveCount(1);
  await page.goBack();

  await menu();
  await page.getByRole("button", { name: /^Investments/ }).click();
  await expect(page.getByText("Investments is coming in a later update.")).toBeVisible();
  await menu();
  await page.getByRole("button", { name: /^Reports/ }).click();
  await expect(page.getByText("Reports is coming in a later update.")).toBeVisible();

  await menu();
  await page.getByRole("button", { name: /^Settings/ }).click();
  // The Settings screen's own Sign out (the menu sheet is portalled outside #root while it slides away).
  await expect(page.locator("#root").getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.goBack();

  // The bell: same reminders as the web (none for this user).
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByText("Nothing due today or tomorrow.")).toBeVisible();
  await page.getByRole("button", { name: "Close Due soon" }).click();

  await menu();
  await page.getByRole("button", { name: /^Sign out/ }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(errors).toEqual([]);
});
