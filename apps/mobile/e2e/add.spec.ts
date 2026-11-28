import { type Locator, type Page, expect, test } from "@playwright/test";
import { addCard, newRequestKey } from "@fin-creador/api";
import { type Demo, demoClient, seedDueToday, seedNormal } from "./demo-data";
import { createConfirmedUser } from "./demo-user";

// Sprint 13b PRs 2–3: the full-screen Add for new entries, edits, recurring confirm and card
// expenses, on Expo web at 390×844 against CI's
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

async function newUser(label: string, seed: (demo: Demo) => Promise<void> = seedNormal) {
  if (process.env.CI) expect(process.env.MOBILE_E2E_BACKEND, "CI must run these tests against the local Supabase").toBeTruthy();
  const { email, password } = await createConfirmedUser(label);
  const demo = await demoClient(email, password);
  await seed(demo);
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
  page.getByRole("heading", { name: /^(Add|Edit) (expense|income|transfer|refund)$/ }).locator("xpath=ancestor::div[.//*[@aria-label='Number keypad']][1]");

const mainTab = (page: Page, name: string) => page.getByRole("tablist", { name: "Main" }).getByRole("tab", { name, exact: true });

async function type(page: Page, digits: string) {
  for (const d of digits) await addScreen(page).getByRole("button", { name: d === "." ? "Decimal point" : d, exact: true }).click();
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Waits until a sheet has slid fully in (its position stops changing) before a screenshot. */
async function settled(locator: Locator) {
  await expect(locator).toBeInViewport({ ratio: 1 });
  let last = "";
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      const now = JSON.stringify(box);
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [100] })
    .toBe(true);
}

/** The account sheet has slid away and is gone. */
const sheetClosed = (page: Page, title: string) => expect(page.getByRole("radiogroup", { name: title, exact: true })).toHaveCount(0);

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
  await expect(add.getByRole("button", { name: "Paid from: HDFC Bank. Balance ₹37,300. Change account", exact: true })).toBeVisible();
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
  await settled(cash);
  await shot(page, "13b-add-account-picker");
  await cash.click();
  await sheetClosed(page, "Paid from");
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
  const warning = add.getByText(/^With this, .+ on \d{1,2} [A-Z][a-z]{2} leaves you ₹1,100 short in HDFC Bank\.$/);
  // On screen above the keypad while typing, not only somewhere in the scrolled page.
  await expect(warning).toBeInViewport({ ratio: 1 });
  // Information only: saving is still allowed.
  await expect(add.getByRole("button", { name: "Save ₹36,000 expense", exact: true })).toBeEnabled();
  await shot(page, "13b-add-runs-short");

  // Income: the amount stays, the tiles become income sources; money in never warns.
  await add.getByRole("tablist", { name: "Entry type" }).getByRole("tab", { name: "Income", exact: true }).click();
  await expect(add.getByRole("heading", { name: "Add income", exact: true })).toBeVisible();
  await add.getByRole("radio", { name: salary, exact: true }).click();
  await add.getByRole("button", { name: /^Received into: / }).click();
  await page.getByRole("radio", { name: "HDFC Bank, balance ₹37,300", exact: true }).click();
  await sheetClosed(page, "Received into");
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
  await sheetClosed(page, "From");
  await add.getByRole("button", { name: "To: choose an account", exact: true }).click();
  // The From account isn't offered as To.
  await expect(page.getByRole("radio", { name: /^HDFC Bank, balance/ })).toHaveCount(0);
  await page.getByRole("radio", { name: "Cash, balance ₹3,500", exact: true }).click();
  await sheetClosed(page, "To");
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

test("390×844: Today, the note and the keypad are on screen without scrolling; the note is saved", async ({ page }) => {
  const errors = collectErrors(page);
  const { email, password, demo } = await newUser("add-390");
  const food = await categoryName(demo, "expense", "food");
  const salary = await categoryName(demo, "income", "salary");
  await signIn(page, email, password);

  await page.getByRole("button", { name: "Add an entry" }).click();
  const add = addScreen(page);
  const onScreen = async () => {
    for (const name of ["Today", "Add a note", "Delete last digit"]) await expect(add.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
    await expect(add.getByRole("button", { name: /^Save / })).toBeInViewport({ ratio: 1 });
  };
  await onScreen();

  // With the runs-short warning showing, the date and note row stays on screen too.
  await type(page, "36000");
  await expect(add.getByText(/leaves you ₹1,100 short in HDFC Bank/)).toBeInViewport({ ratio: 1 });
  await onScreen();
  for (let i = 0; i < 5; i++) await add.getByRole("button", { name: "Delete last digit", exact: true }).click();

  // The note opens in a small sheet; the chip then shows it.
  await type(page, "1250");
  await add.getByRole("radio", { name: food, exact: true }).click();
  await add.getByRole("button", { name: "Add a note", exact: true }).click();
  await page.getByLabel("Note", { exact: true }).fill("Dinner with team");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close Note", exact: true })).toHaveCount(0);
  await expect(add.getByRole("button", { name: "Dinner with team", exact: true })).toBeInViewport({ ratio: 1 });
  await onScreenAfterNote(add);
  // The account row is on screen too, with its before → after.
  await expect(add.getByText("₹37,300 → ₹36,050", { exact: true })).toBeInViewport({ ratio: 1 });
  await shot(page, "13b-add-390-expense");

  // Income: the same row above the keypad.
  await add.getByRole("tablist", { name: "Entry type" }).getByRole("tab", { name: "Income", exact: true }).click();
  await expect(add.getByRole("radio", { name: salary, exact: true })).toBeVisible();
  await expect(add.getByRole("button", { name: "Today", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(add.getByRole("button", { name: "Dinner with team", exact: true })).toBeInViewport({ ratio: 1 });
  await add.getByRole("tablist", { name: "Entry type" }).getByRole("tab", { name: "Expense", exact: true }).click();
  await add.getByRole("radio", { name: food, exact: true }).click();

  await add.getByRole("button", { name: "Save ₹1,250 expense", exact: true }).click();
  await expect(page.getByText("Expense saved.", { exact: true })).toBeVisible();
  const { data: saved } = await demo.client.from("transactions").select("note").eq("type", "expense").eq("amount_minor", 1_250_00);
  expect(saved).toEqual([{ note: "Dinner with team" }]);

  expect(errors).toEqual([]);
});

async function onScreenAfterNote(add: Locator) {
  for (const name of ["Today", "Delete last digit", "Save ₹1,250 expense"]) await expect(add.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
}

test("edit from Activity: type locked, figures filled in, Save changes", async ({ page }) => {
  const errors = collectErrors(page);
  const { email, password, demo } = await newUser("add-edit");
  const food = await categoryName(demo, "expense", "food");
  await signIn(page, email, password);

  // Today's ₹1,200 groceries, from Activity's list → details → Edit.
  await mainTab(page, "Activity").click();
  const activity = page.getByRole("heading", { name: "Transactions", exact: true }).locator("xpath=ancestor::div[.//*[@aria-label='Settings']][1]");
  await activity.getByRole("button", { name: /₹1,200$/ }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const add = addScreen(page);
  await expect(add.getByRole("heading", { name: "Edit expense", exact: true })).toBeVisible();
  const types = add.getByRole("tablist", { name: "Entry type" });
  await expect(types.getByRole("tab", { name: "Expense", exact: true })).toHaveAttribute("aria-selected", "true");
  for (const t of ["Income", "Transfer"]) await expect(types.getByRole("tab", { name: t, exact: true })).toHaveAttribute("aria-disabled", "true");
  await expect(add.getByText(/^The type can.t change\./)).toBeVisible();
  await expect(add.getByText("₹1,200", { exact: true })).toBeVisible();
  await expect(add.getByRole("radio", { name: food, exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(add.getByRole("button", { name: "Groceries", exact: true })).toBeVisible();

  // ₹1,200 → ₹1,250: HDFC Bank without this entry is ₹38,500, so ₹38,500 → ₹37,250.
  await add.getByRole("button", { name: "Delete last digit", exact: true }).click();
  await add.getByRole("button", { name: "Delete last digit", exact: true }).click();
  await type(page, "50");
  await expect(add.getByText("₹38,500 → ₹37,250", { exact: true })).toBeVisible();
  await expect(add.getByRole("button", { name: "Save changes", exact: true })).toBeVisible();
  await shot(page, "13b-edit-expense");

  await add.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
  await expect(add).toBeHidden();
  const { data: saved } = await demo.client.from("transactions").select("amount_minor, note").eq("type", "expense").is("voided_at", null);
  expect(saved).toEqual([{ amount_minor: 1_250_00, note: "Groceries" }]);

  expect(errors).toEqual([]);
});

test("recurring confirm: type and category set by the rule, saved against the occurrence", async ({ page }) => {
  const errors = collectErrors(page);
  // The normal month plus Internet ₹1,000 from HDFC Bank, due today.
  const { email, password, demo } = await newUser("add-recurring", seedDueToday);
  const bills = await categoryName(demo, "expense", "bills");
  await signIn(page, email, password);

  await page.getByRole("button", { name: "Profile menu" }).click();
  await page.getByRole("button", { name: /^Recurring/ }).click();
  await expect(page.getByRole("heading", { name: "Recurring", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();

  const add = addScreen(page);
  await expect(add.getByRole("heading", { name: "Add expense", exact: true })).toBeVisible();
  await expect(add.getByText(/^Recurring · \d{1,2} [A-Z][a-z]{2} \d{4}$/)).toBeVisible();
  await expect(add.getByText("₹1,000", { exact: true })).toBeVisible();
  for (const t of ["Income", "Transfer"]) await expect(add.getByRole("tablist", { name: "Entry type" }).getByRole("tab", { name: t, exact: true })).toHaveAttribute("aria-disabled", "true");
  await expect(add.getByLabel(`Category: ${bills}. Set by the recurring item.`, { exact: true })).toBeVisible();
  await expect(add.getByRole("radiogroup", { name: "Category" })).toHaveCount(0);
  await expect(add.getByText("₹37,300 → ₹36,300", { exact: true })).toBeVisible();
  await expect(add.getByRole("button", { name: "Internet", exact: true })).toBeVisible();
  // Confirming pays this bill; it isn't also counted as still to pay (billsWithout, unit-tested).
  await expect(add.getByText(/leaves you .* short/)).toHaveCount(0);
  await shot(page, "13b-recurring-confirm");

  await add.getByRole("button", { name: "Save ₹1,000 expense", exact: true }).click();
  await expect(page.getByText("Expense saved.", { exact: true })).toBeVisible();
  await expect(add).toBeHidden();
  const { data: posted } = await demo.client.from("transactions").select("amount_minor, recurring_rule_id").eq("amount_minor", 1_000_00);
  expect(posted).toHaveLength(1);
  expect(posted?.[0]?.recurring_rule_id).toBeTruthy();

  expect(errors).toEqual([]);
});

test("expense paid by credit card: owed before → after, the limit note, never runs-short", async ({ page }) => {
  const errors = collectErrors(page);
  // The normal month plus a card: ₹50,000 limit, ₹6,000 owed today.
  const { email, password, demo } = await newUser("add-card", async (d) => {
    await seedNormal(d);
    const card = await addCard(d.client, { issuer: "Axis Bank", nickname: "Travel", limit: "50000", statementDay: "20", dueDay: "8", openingOwed: "6000", idempotencyKey: newRequestKey() });
    if (card.status !== "success") throw new Error(`Add card: ${card.message}`);
  });
  await signIn(page, email, password);

  await page.getByRole("button", { name: "Add an entry" }).click();
  const add = addScreen(page);
  await type(page, "36000");
  // From HDFC Bank this runs short of the electricity bill.
  await expect(add.getByText(/leaves you .+ short in HDFC Bank/)).toBeVisible();

  await add.getByRole("button", { name: /^Paid from: HDFC Bank/ }).click();
  const card = page.getByRole("radio", { name: "Travel (card), owed ₹6,000", exact: true });
  await expect(card).toBeVisible();
  await card.click();
  await sheetClosed(page, "Paid from");
  await expect(add.getByText("owed ₹6,000 → owed ₹42,000", { exact: true })).toBeVisible();
  await expect(add.getByText("This takes Travel to 84% of its limit. You can still save it.", { exact: true })).toBeVisible();
  // A card never runs short; payment mode is for bank accounts only.
  await expect(add.getByText(/leaves you .* short/)).toHaveCount(0);
  await expect(add.getByText("Payment mode (optional)")).toHaveCount(0);
  await shot(page, "13b-add-card");

  // Income can't go to a card: switching type clears it.
  await add.getByRole("tablist", { name: "Entry type" }).getByRole("tab", { name: "Income", exact: true }).click();
  await expect(add.getByRole("button", { name: "Received into: choose an account", exact: true })).toBeVisible();
  await add.getByRole("button", { name: "Received into: choose an account", exact: true }).click();
  await expect(page.getByRole("radio", { name: /\(card\)/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Close Received into", exact: true }).click();
  await sheetClosed(page, "Received into");
  await add.getByRole("tablist", { name: "Entry type" }).getByRole("tab", { name: "Expense", exact: true }).click();
  await add.getByRole("button", { name: "Paid from: choose an account", exact: true }).click();
  await card.click();
  await sheetClosed(page, "Paid from");
  const food = await categoryName(demo, "expense", "food");
  await add.getByRole("radio", { name: food, exact: true }).click();
  await add.getByRole("button", { name: "Save ₹36,000 expense", exact: true }).click();
  await expect(page.getByText("Expense saved.", { exact: true })).toBeVisible();
  const { data: cardRow } = await demo.client.from("accounts").select("id").eq("kind", "card").single();
  const { data: saved } = await demo.client.from("transactions").select("account_id").eq("amount_minor", 36_000_00);
  expect(saved).toEqual([{ account_id: cardRow?.id }]);

  expect(errors).toEqual([]);
});
