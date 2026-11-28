import { type Locator, type Page, expect, test } from "@playwright/test";
import { dayHeading, monthLabel, saveAccount } from "@fin-creador/api";
import { addDays, monthRange, previousMonthRange } from "@fin-creador/domain";
import { type Demo, demoClient, seedActivity, seedNormal } from "./demo-data";
import { createConfirmedUser } from "./demo-user";

// Sprint 13b PR 4: the Activity tab on Expo web at 390×844 against CI's throwaway local
// Supabase, with a fresh demo user per test (demo data only, see seedActivity). Month chips and
// the picker, Money in / Money out with net and savings rate, the chips and More filters, day
// groups with day totals, Edited / Voided tags, Load more, search over all time, and the empty,
// no-matches and offline states. PR 5: swipe a row for Edit and Void, and the Import UPI sheet.
// Screenshots for review go to e2e-screenshots (CI artifact).

const SHOTS = "e2e-screenshots";
const SUPABASE = /^https?:\/\/(127\.0\.0\.1|localhost):54321\//;
const DEV_SERVER_SOCKET = /^WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/(hot|message)' failed/;
// Requests we fail on purpose (offline) show up as console errors.
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

async function newUser<T>(label: string, seed: (demo: Demo) => Promise<T>) {
  if (process.env.CI) expect(process.env.MOBILE_E2E_BACKEND, "CI must run these tests against the local Supabase").toBeTruthy();
  const { email, password } = await createConfirmedUser(label);
  const demo = await demoClient(email, password);
  const seeded = await seed(demo);
  return { email, password, demo, seeded };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("tablist", { name: "Main" })).toBeVisible();
}

const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Main" }).getByRole("tab", { name, exact: true });
// Expo web keeps other tabs mounted under the current one: scope to Activity.
const activity = (page: Page) => page.getByTestId("activity-screen");

/** A finger swipe to the left across a row (touch events, as on a phone). */
async function swipeLeft(page: Page, row: Locator) {
  const box = await row.boundingBox();
  if (!box) throw new Error("row not on screen");
  const y = box.y + box.height / 2;
  const from = box.x + box.width - 24;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from - i * 22, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Waits until something that slides (a row's actions, a sheet) stops moving. `whole`: also fully on screen. */
async function settled(locator: Locator, whole = true) {
  if (whole) await expect(locator).toBeInViewport({ ratio: 1 });
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await locator.boundingBox());
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [100] })
    .toBe(true);
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test("a month with data: tiles, day groups and totals, tags, Load more, chips, More filters, search", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const { email, password, demo, seeded } = await newUser("activity", seedActivity);
  const { today } = demo;
  const { month } = seeded;
  const m = monthLabel(month, today);
  const day = (n: number) => dayHeading(addDays(month, n - 1), today);
  await signIn(page, email, password);
  await tab(page, "Activity").click();
  const a = activity(page);

  // This month has nothing yet; last month's chip shows the seeded month.
  await expect(a.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(a.getByRole("heading", { name: `Nothing in ${monthLabel(monthRange(today).start, today)}` })).toBeVisible();
  await a.getByRole("button", { name: m, exact: true }).click();
  await expect(a.getByRole("button", { name: m, exact: true })).toHaveAttribute("aria-selected", "true");

  // Money in / Money out (whole rupees), net and the savings rate; transfers are said, not added.
  await expect(a.getByLabel(`Money in, ${m}: ₹80,000`, { exact: true })).toBeVisible();
  await expect(a.getByLabel(`Money out, ${m}: ₹22,600`, { exact: true })).toBeVisible();
  await expect(a.getByLabel("Net +₹57,400. 72% saved", { exact: true })).toBeVisible();
  await expect(a.getByText("1 transfer between your accounts isn't money in or out.", { exact: true })).toBeVisible();

  // Newest first: the 5th (50 teas fill the first page, so its total waits for the rest).
  await expect(a.getByRole("heading", { name: day(5), exact: true })).toBeVisible();
  await expect(a.getByText("Showing 50", { exact: true })).toBeVisible();
  await shot(page, "13b-activity");

  await a.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(a.getByText("54 entries", { exact: true })).toBeVisible();
  await expect(a.getByRole("heading", { name: `${day(5)}. Money out ₹1,000`, exact: true })).toBeVisible();
  await expect(a.getByRole("heading", { name: `${day(3)}. Money out ₹1,600`, exact: true })).toBeVisible();
  await expect(a.getByRole("heading", { name: `${day(1)}. Money in ₹80,000`, exact: true })).toBeVisible();
  // The edited entry carries "Edited"; the transfer moves money without a sign; the voided dinner is hidden.
  await expect(a.getByRole("button", { name: /^Groceries, .+ · HDFC Bank, Edited, Money out, ₹1,600$/ })).toBeVisible();
  await expect(a.getByRole("button", { name: "Transfer, Transfer · HDFC Bank → Cash, Moved, ₹5,000", exact: true })).toBeVisible();
  await expect(a.getByRole("button", { name: /^Dinner,/ })).toHaveCount(0);

  // Received: only the salary. The tiles don't change with the chip.
  await a.getByRole("button", { name: "Received", exact: true }).click();
  await expect(a.getByRole("button", { name: /^Salary, .+, Money in, ₹80,000$/ })).toBeVisible();
  await expect(a.getByRole("button", { name: /^Rent,/ })).toHaveCount(0);
  await expect(a.getByLabel(`Money out, ${m}: ₹22,600`, { exact: true })).toBeVisible();

  // Spent + More filters → Show voided: the voided dinner shows, tagged and not counted.
  await a.getByRole("button", { name: "Spent", exact: true }).click();
  await a.getByRole("button", { name: "More filters", exact: true }).click();
  await page.getByRole("switch", { name: "Show voided entries" }).click();
  await page.getByRole("button", { name: "Show results", exact: true }).click();
  await expect(a.getByRole("button", { name: "More filters · 1", exact: true })).toBeVisible();
  // The 50 teas on the 5th fill the first page again; the dinner (the 4th) is on the next.
  await a.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(a.getByRole("button", { name: /^Dinner, .+, Voided, not counted, Reason: Entered twice, Money out, ₹900$/ })).toBeVisible();
  await expect(a.getByRole("button", { name: /^Salary,/ })).toHaveCount(0);
  // Every day is loaded now, so each has its total: the 5th's teas, and ₹0 for the 4th (only the voided dinner).
  await expect(a.getByRole("heading", { name: `${day(5)}. Money out ₹1,000`, exact: true })).toBeVisible();
  await expect(a.getByRole("heading", { name: `${day(4)}. No money in or out`, exact: true })).toBeVisible();
  await a.getByRole("button", { name: /^Dinner,/ }).scrollIntoViewIfNeeded();
  await shot(page, "13b-activity-filters");

  // Back to everything, then search: all time, the month chips show "All time".
  await a.getByRole("button", { name: "All", exact: true }).click();
  await a.getByRole("button", { name: "More filters · 1", exact: true }).click();
  await page.getByRole("button", { name: "Reset these filters", exact: true }).click();
  await page.getByRole("button", { name: "Show results", exact: true }).click();
  await expect(a.getByRole("button", { name: "More filters", exact: true })).toBeVisible();

  await a.getByRole("button", { name: "Search entries", exact: true }).click();
  await a.getByLabel("Search all time", { exact: true }).fill("Rent");
  await a.getByLabel("Search all time", { exact: true }).press("Enter");
  await expect(a.getByRole("button", { name: "All time", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(a.getByRole("button", { name: m, exact: true })).toHaveAttribute("aria-selected", "false");
  await expect(a.getByText("Matching “Rent” in all time", { exact: true })).toBeVisible();
  await expect(a.getByRole("button", { name: /^Rent, .+, Money out, ₹20,000$/ })).toBeVisible();
  await expect(a.getByText("1 entry", { exact: true })).toBeVisible();
  await expect(a.getByLabel("Money out, All time: ₹20,000", { exact: true })).toBeVisible();
  await shot(page, "13b-activity-search");

  // No matches → Clear filters: back to the month, search closed.
  await a.getByLabel("Search all time", { exact: true }).fill("zzz");
  await a.getByLabel("Search all time", { exact: true }).press("Enter");
  await expect(a.getByRole("heading", { name: "No matches", exact: true })).toBeVisible();
  await a.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(a.getByLabel("Search all time", { exact: true })).toHaveCount(0);
  await expect(a.getByRole("button", { name: m, exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(a.getByLabel(`Money in, ${m}: ₹80,000`, { exact: true })).toBeVisible();

  // The month picker: an older month (two months back has nothing).
  const older = previousMonthRange(month).start;
  await a.getByRole("button", { name: "Pick a month", exact: true }).click();
  if (older.slice(0, 4) !== today.slice(0, 4)) await page.getByRole("button", { name: /^Previous year/ }).click();
  await page.getByRole("radio", { name: `${monthLabel(older, older)} ${older.slice(0, 4)}`, exact: true }).click();
  await expect(a.getByRole("button", { name: monthLabel(older, today), exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(a.getByRole("heading", { name: `Nothing in ${monthLabel(older, today)}`, exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});

test("empty: no entries yet, with Add expense", async ({ page }) => {
  const errors = collectErrors(page);
  const { email, password } = await newUser("activity-empty", async (d) => {
    const r = await saveAccount(d.client, { kind: "bank", bankType: "savings", bankName: "HDFC Bank", currency: "INR", openingBalance: "38500", openingBalanceDate: d.today });
    if (r.status !== "success") throw new Error(r.message);
  });
  await signIn(page, email, password);
  await tab(page, "Activity").click();
  const a = activity(page);
  await expect(a.getByRole("heading", { name: "No entries yet", exact: true })).toBeVisible();
  await expect(a.getByRole("button", { name: "Add expense", exact: true })).toBeVisible();
  await shot(page, "13b-activity-empty");
  await a.getByRole("button", { name: "Add expense", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add expense", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("offline: the list stays with the time it was loaded; another month offline shows Try again", async ({ page }) => {
  const errors = collectErrors(page);
  const { email, password } = await newUser("activity-offline", (d) => seedNormal(d));
  await signIn(page, email, password);
  await tab(page, "Activity").click();
  const a = activity(page);
  await expect(a.getByRole("button", { name: /^Groceries, .+, Money out, ₹1,200$/ })).toBeVisible();

  // Network to the backend blocked; coming back to Activity reloads it and keeps the list.
  await page.route(SUPABASE, (route) => route.abort("internetdisconnected"));
  await tab(page, "Home").click();
  await tab(page, "Activity").click();
  await expect(a.getByRole("alert", { name: /^You're offline\. Showing what was loaded at \d{1,2}:\d{2} (AM|PM)\.$/ })).toBeVisible();
  await expect(a.getByRole("button", { name: /^Groceries,/ })).toBeVisible();
  await shot(page, "13b-activity-offline");

  // Another month (the second chip) can't load offline: Try again once back online.
  await a.getByLabel("Months", { exact: true }).getByRole("button").nth(1).click();
  await expect(a.getByRole("heading", { name: "You're offline", exact: true })).toBeVisible();
  await page.unroute(SUPABASE);
  await a.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(a.getByRole("heading", { name: /^Nothing in / })).toBeVisible();
  expect(errors).toEqual([]);
});

test("swipe a row for Edit and Void; Import UPI opens the web's import page", async ({ page }) => {
  const errors = collectErrors(page);
  const { email, password } = await newUser("activity-swipe", (d) => seedNormal(d));
  await signIn(page, email, password);
  await tab(page, "Activity").click();
  const a = activity(page);
  const groceries = a.getByRole("button", { name: /^Groceries, .+, Money out, ₹1,200$/ });
  const edit = a.getByRole("button", { name: "Edit", exact: true });
  const voidAction = a.getByRole("button", { name: "Void", exact: true });
  await expect(groceries).toBeVisible();
  // A closed row has no hidden buttons.
  await expect(voidAction).toHaveCount(0);

  await swipeLeft(page, groceries);
  await settled(voidAction);
  await expect(edit).toBeInViewport({ ratio: 1 });
  await shot(page, "13b-activity-swipe");

  // Tapping the open row closes it; it doesn't open the entry.
  await settled(groceries, false);
  await groceries.click();
  await expect(voidAction).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Void expense", exact: true })).toHaveCount(0);

  // Edit opens Add on that entry.
  await swipeLeft(page, groceries);
  await edit.click();
  await expect(page.getByRole("heading", { name: "Edit expense", exact: true })).toBeVisible();
  // Add's own close button (a quick browser Back can race expo-router's push on the web).
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit expense", exact: true })).toHaveCount(0);
  await settled(groceries, false);

  // Void opens the entry at its void step (reason, one-way warning); voiding takes it off the list.
  await swipeLeft(page, groceries);
  await voidAction.click();
  await expect(page.getByText(/^Void this expense\? It stops counting/)).toBeVisible();
  await page.getByLabel("Reason (optional)").fill("Entered twice");
  await page.getByRole("button", { name: "Void expense", exact: true }).click();
  await expect(a.getByRole("button", { name: /^Groceries,/ })).toHaveCount(0);

  // Import UPI: a sheet, and Open on the web opens the web's import page (stubbed: no web app here).
  await page.context().route(/^http:\/\/localhost:3000\//, (route) => route.fulfill({ contentType: "text/html", body: "<title>Import UPI statement</title>" }));
  await a.getByRole("button", { name: "Import UPI", exact: true }).click();
  const openWeb = page.getByRole("button", { name: "Open on the web", exact: true });
  await expect(page.getByText("Import UPI is on the web for now", { exact: true })).toBeVisible();
  await settled(openWeb);
  await shot(page, "13b-activity-import-upi");
  const popup = page.waitForEvent("popup");
  await openWeb.click();
  await (await popup).waitForURL(/\/transactions\/import\/upi$/);
  await expect(openWeb).toHaveCount(0);

  expect(errors).toEqual([]);
});
