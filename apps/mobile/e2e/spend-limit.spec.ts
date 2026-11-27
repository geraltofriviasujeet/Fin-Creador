import { type Page, expect, test } from "@playwright/test";
import { AFTER_BILLS_LINE, LIMIT_NOTE, heroText } from "@fin-creador/api";
import { type Demo, demoClient, expectedHome, seedNormal } from "./demo-data";
import { createConfirmedUser } from "./demo-user";

// Daily spend limit on the phone (pre-13b 2 PR 4), on Expo web at 390px against CI's throwaway
// local Supabase, with a fresh demo user (seedNormal: ₹42,000 at the start of today, ₹3,000 of
// bills before payday in 8 days, ₹1,200 spent today). Set it from the Activity header, change it
// from Home's Safe to spend link (a refused custom period and an offline save both keep the
// input), see the safety note, remove it with the confirm step. Each Home figure is checked
// against the shared loader and heroText read as the same user, as the web E2E does.

const SUPABASE = /^https?:\/\/(127\.0\.0\.1|localhost):54321\//;
const DEV_SERVER_SOCKET = /^WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/(hot|message)' failed/;
// Requests we fail on purpose (the offline save) show up as console errors.
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

const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Main" }).getByRole("tab", { name, exact: true });
// Expo web keeps other tabs mounted under the current one: scope to the visible screen.
const activity = (page: Page) =>
  page.getByRole("heading", { name: "Transactions", exact: true }).locator("xpath=ancestor::div[.//*[@aria-label='Settings']][1]");
type Title = "Set a spend limit" | "Change your spend limit";
// The sheet's scrolling body: its title row and the form (or the confirm step).
const sheet = (page: Page, title: Title) =>
  page
    .getByRole("heading", { name: title, exact: true })
    .locator("xpath=ancestor::div[.//*[@aria-label='Cancel' or @aria-label='Keep limit']][1]");
const period = (page: Page, title: Title, name: string) => sheet(page, title).getByRole("tablist", { name: "Period" }).getByRole("tab", { name, exact: true });

/** Home's Safe to spend card says what the shared heroText says for this user now. */
async function expectHomeMatchesShared(page: Page, demo: Demo) {
  const hero = heroText(await expectedHome(demo));
  await expect(page.getByLabel(hero.label)).toBeVisible();
  await expect(page.getByText(hero.suffix, { exact: true })).toBeVisible();
  return hero;
}

test("set a weekly limit from Activity, change it from Home, see the note, remove it", async ({ page }) => {
  if (process.env.CI) expect(process.env.MOBILE_E2E_BACKEND, "CI must run these tests against the local Supabase").toBeTruthy();
  const errors = collectErrors(page);
  const { email, password } = await createConfirmedUser("spend-limit");
  const demo = await demoClient(email, password);
  await seedNormal(demo);
  await signIn(page, email, password);

  // 1. Activity: no limit yet; set ₹14,000 a week.
  await expect(page.getByRole("button", { name: "Set a daily limit", exact: true })).toBeVisible();
  await tab(page, "Activity").click();
  await activity(page).getByRole("button", { name: "Set daily spend limit", exact: true }).click();
  const set = sheet(page, "Set a spend limit");
  await expect(set).toBeVisible();
  await expect(set.getByRole("button", { name: "Remove limit" })).toHaveCount(0);
  // The default period is 1 week, as on the web.
  await expect(period(page, "Set a spend limit", "1 week")).toHaveAttribute("aria-selected", "true");
  await set.getByLabel("Amount").fill("14000");
  await set.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Daily spend limit saved.", { exact: true })).toBeVisible();
  await expect(set).toBeHidden();
  // The button shows what was set.
  await expect(activity(page).getByRole("button", { name: "Limit ₹14,000 / week", exact: true })).toBeVisible();

  // 2. Home: ₹14,000 ÷ 7 days = ₹2,000 today, ₹1,200 spent, ₹800 left; no note.
  await tab(page, "Home").click();
  let hero = await expectHomeMatchesShared(page, demo);
  expect(hero.suffix).toBe("left of your ₹2,000 daily limit");
  expect(hero.amountMinor).toBe(800_00);
  await expect(page.getByText("₹1,200 spent today of ₹2,000", { exact: true })).toBeVisible();
  await expect(page.getByText(AFTER_BILLS_LINE, { exact: true })).toHaveCount(0);
  await expect(page.getByText(LIMIT_NOTE, { exact: true })).toHaveCount(0);

  // 3. Change it from the card's link: the sheet opens with what was set.
  await page.getByRole("button", { name: "Change limit", exact: true }).click();
  const change = sheet(page, "Change your spend limit");
  await expect(period(page, "Change your spend limit", "1 week")).toHaveAttribute("aria-selected", "true");
  await expect(change.getByLabel("Amount")).toHaveValue("14000");
  // A custom period of 1 day is refused; what was typed stays.
  await period(page, "Change your spend limit", "Custom").click();
  await change.getByLabel("Number of days").fill("1");
  await change.getByLabel("Amount").fill("50000");
  await change.getByRole("button", { name: "Save", exact: true }).click();
  await expect(change.getByText("Enter 2 to 365 days", { exact: true })).toBeVisible();
  await expect(change.getByLabel("Number of days")).toHaveValue("1");
  await expect(change.getByLabel("Amount")).toHaveValue("50000");

  // Offline: the save fails with a message and keeps the input; back online it saves.
  // ₹50,000 a day for the 8 days to payday is more than the ₹39,000 left after bills.
  await period(page, "Change your spend limit", "1 day").click();
  await page.route(SUPABASE, (route) => route.abort("internetdisconnected"));
  await change.getByRole("button", { name: "Save", exact: true }).click();
  await expect(change.getByText(/Check your connection/)).toBeVisible();
  await expect(change.getByText(/session has ended/)).toHaveCount(0);
  await expect(change).toBeVisible();
  await expect(period(page, "Change your spend limit", "1 day")).toHaveAttribute("aria-selected", "true");
  await expect(change.getByLabel("Amount")).toHaveValue("50000");
  await page.unroute(SUPABASE);
  await change.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Daily spend limit saved.", { exact: true })).toBeVisible();
  await expect(change).toBeHidden();

  // 4. The safety note, one quiet line; the big figure is still today's limit.
  hero = await expectHomeMatchesShared(page, demo);
  expect(hero.suffix).toBe("left of your ₹50,000 daily limit");
  expect(hero.note).toBe(LIMIT_NOTE);
  await expect(page.getByText(LIMIT_NOTE, { exact: true })).toBeVisible();

  // 5. Remove it (with a confirm): Home goes back to Safe to spend after bills.
  await page.getByRole("button", { name: "Change limit", exact: true }).click();
  await change.getByRole("button", { name: "Remove limit", exact: true }).click();
  await expect(change).toContainText("Remove your limit of ₹50,000 / day?");
  await change.getByRole("button", { name: "Keep limit", exact: true }).click();
  await expect(change.getByLabel("Amount")).toHaveValue("50000");
  await change.getByRole("button", { name: "Remove limit", exact: true }).click();
  await change.getByRole("button", { name: "Remove limit", exact: true }).click();
  await expect(page.getByText("Daily spend limit removed.", { exact: true })).toBeVisible();
  await expect(change).toBeHidden();

  hero = await expectHomeMatchesShared(page, demo);
  expect(hero.suffix).toMatch(/^a day, until \d{1,2} [A-Z][a-z]{2}$/);
  expect(hero.amountMinor).toBe(4_875_00);
  await expect(page.getByText(AFTER_BILLS_LINE, { exact: true })).toBeVisible();
  await expect(page.getByText(LIMIT_NOTE, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Set a daily limit", exact: true })).toBeVisible();

  await tab(page, "Activity").click();
  await expect(activity(page).getByRole("button", { name: "Set daily spend limit", exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});
