import { type Page, expect, test } from "@playwright/test";
import { type Demo, demoClient, seedNormal } from "./demo-data";
import { createConfirmedUser } from "./demo-user";

// Sprint 13b PR 2: the full-screen Add for new entries, on Expo web at 390px against CI's
// throwaway local Supabase, with a fresh demo user (seedNormal: HDFC Bank ₹38,500 and Cash ₹3,500
// opened today, ₹1,200 spent from HDFC Bank today, electricity ₹2,400 in 2 days and phone ₹600 in
// 5 days from HDFC Bank, salary in 8 days). Demo data only. Screenshots for review go to
// e2e-screenshots (CI artifact).

const SHOTS = "e2e-screenshots";
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

async function newUser(label: string) {
  if (process.env.CI) expect(process.env.MOBILE_E2E_BACKEND, "CI must run these tests against the local Supabase").toBeTruthy();
  const { email, password } = await createConfirmedUser(label);
  const demo = await demoClient(email, password);
  await seedNormal(demo);
  return { email, password, demo };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("tablist", { name: "Main" })).toBeVisible();
}

// Add's own screen (the tabs stay mounted under it on Expo web): its title row to its keypad.
const addScreen = (page: Page) =>
  page.getByRole("heading", { name: /^Add (expense|income|transfer)$/ }).locator("xpath=ancestor::div[.//*[@aria-label='Number keypad']][1]");

async function type(page: Page, digits: string) {
  for (const d of digits) await addScreen(page).getByRole("button", { name: d === "." ? "Decimal point" : d, exact: true }).click();
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function categoryName(demo: Demo, kind: "expense" | "income", key: string) {
  const { data } = await demo.client.from("categories").select("name, icon, source_type").eq("kind", kind);
  const row = data?.find((c) => (kind === "expense" ? c.icon : c.source_type) === key);
  if (!row) throw new Error(`No ${kind} category ${key}`);
  return row.name;
}

test("expense: last-used tile first, keypad, before → after, account picker, offline keeps the input, saves once", async ({ page }) => {
  const errors = collectErrors(page);
  const { email, password, demo } = await newUser("add-expense");
  const food = await categoryName(demo, "expense", "food");
  await signIn(page, email, password);

  await page.getByRole("button", { name: "Add an entry" }).click();
  const add = addScreen(page);
  await expect(add.getByRole("heading", { name: "Add expense", exact: true })).toBeVisible();
  // The latest expense's account and category come first.
  await expect(add.getByRole("button", { name: /^Paid from: HDFC Bank\. Balance ₹37,300 now\./ })).toBeVisible();
  await expect(add.getByRole("radiogroup", { name: "Category" }).getByRole("radio").first()).toHaveAccessibleName(food);
  await expect(add.getByRole("button", { name: "Save expense", exact: true })).toBeVisible();

  await type(page, "1250");
  await add.getByRole("radio", { name: food, exact: true }).click();
  await expect(add.getByRole("radio", { name: food, exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(add.getByRole("button", { name: "Paid from: HDFC Bank. Balance ₹37,300 now, ₹36,050 after. Change account", exact: true })).toBeVisible();
  await expect(add.getByText("₹37,300 → ₹36,050", { exact: true })).toBeVisible();
  await expect(add.getByRole("button", { name: "Save ₹1,250 expense", exact: true })).toBeVisible();
  await shot(page, "13b-add-expense");

  // The account picker lists each account with its balance now.
  await add.getByRole("button", { name: /^Paid from: HDFC Bank/ }).click();
  const cash = page.getByRole("radio", { name: "Cash, balance ₹3,500", exact: true });
  await expect(cash).toBeVisible();
  await expect(page.getByRole("radio", { name: "HDFC Bank, balance ₹37,300", exact: true })).toHaveAttribute("aria-checked", "true");
  await shot(page, "13b-add-account-picker");
  await cash.click();
  await expect(cash).toBeHidden();
  await expect(add.getByText("₹3,500 → ₹2,250", { exact: true })).toBeVisible();

  // Offline: the save says to check the connection and keeps everything typed.
  await page.route(SUPABASE, (route) => route.abort("internetdisconnected"));
  await add.getByRole("button", { name: "Save ₹1,250 expense", exact: true }).click();
  await expect(add.getByText(/Check your connection/)).toBeVisible();
  await expect(page.getByText(/session has ended/)).toHaveCount(0);
  await expect(add.getByRole("radio", { name: food, exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(add.getByText("₹3,500 → ₹2,250", { exact: true })).toBeVisible();
  await shot(page, "13b-add-offline");

  // Back online the same request saves once.
  await page.unroute(SUPABASE);
  await add.getByRole("button", { name: "Save ₹1,250 expense", exact: true }).click();
  await expect(page.getByText("Expense saved.", { exact: true })).toBeVisible();
  await expect(add).toBeHidden();
  const { data: saved } = await demo.client.from("transactions").select("amount_minor, account_id, occurred_on").eq("type", "expense").eq("amount_minor", 1_250_00);
  const { data: cashRow } = await demo.client.from("accounts").select("id").eq("name", "Cash").single();
  expect(saved).toEqual([{ amount_minor: 1_250_00, account_id: cashRow?.id, occurred_on: demo.today }]);

  expect(errors).toEqual([]);
});

test("runs-short warning, then income and a transfer from Home's quick actions", async ({ page }) => {
  const errors = collectErrors(page);
  const { email, password, demo } = await newUser("add-short");
  const salary = await categoryName(demo, "income", "salary");
  await signIn(page, email, password);

  // ₹36,000 from HDFC Bank leaves ₹1,300 before electricity of ₹2,400 in 2 days: ₹1,100 short.
  await page.getByRole("button", { name: "Expense", exact: true }).click();
  const add = addScreen(page);
  await expect(add.getByRole("heading", { name: "Add expense", exact: true })).toBeVisible();
  await type(page, "36000");
  await expect(add.getByText(/^With this, .+ on \d{1,2} [A-Z][a-z]{2} leaves you ₹1,100 short in HDFC Bank\.$/)).toBeVisible();
  // Information only: saving is still allowed.
  await expect(add.getByRole("button", { name: "Save ₹36,000 expense", exact: true })).toBeEnabled();
  await shot(page, "13b-add-runs-short");

  // Income: the amount stays, the tiles become income sources; money in never warns.
  await add.getByRole("tablist", { name: "Entry type" }).getByRole("tab", { name: "Income", exact: true }).click();
  await expect(add.getByRole("heading", { name: "Add income", exact: true })).toBeVisible();
  await add.getByRole("radio", { name: salary, exact: true }).click();
  await add.getByRole("button", { name: /^Received into: / }).click();
  await page.getByRole("radio", { name: "HDFC Bank, balance ₹37,300", exact: true }).click();
  await expect(add.getByText("₹37,300 → ₹73,300", { exact: true })).toBeVisible();
  await expect(add.getByText(/leaves you .* short/)).toHaveCount(0);
  await expect(add.getByRole("button", { name: "Save ₹36,000 income", exact: true })).toBeVisible();
  await shot(page, "13b-add-income");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(add).toBeHidden();

  // Transfer from Home's quick action: From HDFC Bank, To Cash.
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await expect(add.getByRole("heading", { name: "Add transfer", exact: true })).toBeVisible();
  await type(page, "5000");
  await add.getByRole("button", { name: /^From: / }).click();
  await page.getByRole("radio", { name: "HDFC Bank, balance ₹37,300", exact: true }).click();
  await add.getByRole("button", { name: "To: choose an account", exact: true }).click();
  // The From account isn't offered as To.
  await expect(page.getByRole("radio", { name: /^HDFC Bank, balance/ })).toHaveCount(0);
  await page.getByRole("radio", { name: "Cash, balance ₹3,500", exact: true }).click();
  await expect(add.getByText("₹37,300 → ₹32,300", { exact: true })).toBeVisible();
  await expect(add.getByText("₹3,500 → ₹8,500", { exact: true })).toBeVisible();
  await shot(page, "13b-add-transfer");
  await add.getByRole("button", { name: "Save ₹5,000 transfer", exact: true }).click();
  await expect(page.getByText("Transfer saved.", { exact: true })).toBeVisible();
  await expect(add).toBeHidden();
  const { data: transfers } = await demo.client.from("transactions").select("amount_minor").eq("type", "transfer");
  expect(transfers).toEqual([{ amount_minor: 5_000_00 }]);

  expect(errors).toEqual([]);
});
