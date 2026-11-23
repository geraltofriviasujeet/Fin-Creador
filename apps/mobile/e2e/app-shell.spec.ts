import { type Page, expect, test } from "@playwright/test";
import { createConfirmedUser } from "./demo-user";

// Sprint 13a: the signed-in app on Expo web at 390px, against CI's throwaway local Supabase.
// A fresh demo user per run (no real data). Covers the tab shell (Home · Activity · ＋ · Plan ·
// Roma), the ＋ opening Add, and the old screens staying reachable until their part of
// Sprint 13 replaces them.
const SHOTS = "e2e-screenshots";
const DEV_SERVER_SOCKET = /^WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/(hot|message)' failed/;
const HAS_BACKEND = !!process.env.MOBILE_E2E_BACKEND;

// In CI the backend is always there; locally (no Docker on the dev Mac) these tests skip.
test.skip(!HAS_BACKEND && !process.env.CI, "Needs the local Supabase that CI starts (MOBILE_E2E_BACKEND=1).");

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !DEV_SERVER_SOCKET.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function signIn(page: Page) {
  const { email, password } = await createConfirmedUser("shell");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("tablist", { name: "Main" })).toBeVisible();
}

const GREETING = /^Good (morning|afternoon|evening)/;
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Main" }).getByRole("tab", { name, exact: true });

// Expo web keeps tabs you've left mounted and stacked under the current one (phones detach
// them), and their content still matches locators. Scope to the screen whose page heading
// is `heading`: its nearest ancestor that also holds the header's Settings button.
const screen = (page: Page, heading: string) =>
  page.getByRole("heading", { name: heading, exact: true }).locator("xpath=ancestor::div[.//*[@aria-label='Settings']][1]");

test("tab shell: four tabs and the raised ＋, each tab opens its screen", async ({ page }) => {
  if (process.env.CI) expect(HAS_BACKEND, "CI must run these tests against the local Supabase").toBe(true);
  const errors = collectErrors(page);
  await signIn(page);

  await expect(page.getByRole("tablist", { name: "Main" }).getByRole("tab")).toHaveCount(4);
  await expect(tab(page, "Home")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: GREETING })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/13a-home-shell.png` });

  const screens: [string, string | RegExp][] = [
    ["Activity", "Transactions"],
    ["Plan", "Plan"],
    ["Roma", "Roma"],
    ["Home", GREETING],
  ];
  for (const [name, heading] of screens) {
    await tab(page, name).click();
    await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: heading, exact: typeof heading === "string" })).toBeVisible();
    for (const other of ["Home", "Activity", "Plan", "Roma"].filter((n) => n !== name)) {
      await expect(tab(page, other)).toHaveAttribute("aria-selected", "false");
    }
  }

  // ＋ opens the existing add sheet on Expense; closing it returns to the same tab.
  await page.getByRole("button", { name: "Add an entry" }).click();
  await expect(page.getByText("Add expense", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(tab(page, "Home")).toHaveAttribute("aria-selected", "true");

  expect(errors).toEqual([]);
});

test("old screens stay reachable from Plan: Recurring, Settings and Sign out", async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);

  // Home reaches Income, Recurring and Settings through the avatar menu (home.spec.ts). Plan
  // links to Recurring too (bills that repeat) until 13c.
  await tab(page, "Plan").click();
  await screen(page, "Plan").getByRole("button", { name: /^Recurring\./ }).click();
  await expect(page.getByRole("heading", { name: "Recurring", exact: true })).toHaveCount(1);
  await page.goBack();

  // Settings is one tap from every tab's header; Sign out is on it.
  await screen(page, "Plan").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  expect(errors).toEqual([]);
});
