import { expect, test } from "@playwright/test";

// Renders every design-system component on the preview screen at 390px without errors,
// checks the accessibility roles and labels reach the page, and saves screenshots
// (apps/mobile/e2e-screenshots, uploaded as a CI artifact).
const SECTIONS = ["type", "buttons", "add", "categories", "chips", "rows", "progress", "banners", "empty", "sheet", "tabbar"];
const SHOTS = "e2e-screenshots";
// A development export still tries to reach the Metro dev server for hot reload; the static
// server has none. Only these two messages are ignored, nothing else.
const DEV_SERVER_SOCKET = /^WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/(hot|message)' failed/;

test("design-system preview renders every component without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !DEV_SERVER_SOCKET.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  await page.goto("/dev/design-system");
  await expect(page.getByTestId(/^fc-design-system-preview/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
  // Fonts are loaded before the first screen (the splash waits for them).
  await page.evaluate(() => document.fonts.ready);

  for (const id of SECTIONS) {
    const section = page.getByTestId(`ds-${id}`);
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();
    await section.screenshot({ path: `${SHOTS}/${String(SECTIONS.indexOf(id) + 1).padStart(2, "0")}-${id}.png` });
  }
  await page.screenshot({ path: `${SHOTS}/00-top.png` });

  expect(errors).toEqual([]);
});

test("components expose roles, labels and signs", async ({ page }) => {
  await page.goto("/dev/design-system");
  await expect(page.getByTestId(/^fc-design-system-preview/)).toBeVisible();

  // Amounts: sign in the text, meaning in the label (never colour alone).
  await expect(page.getByLabel("Money out, ₹420").first()).toHaveText("−₹420");
  await expect(page.getByLabel("Money in, ₹42,000").first()).toHaveText("+₹42,000");
  await expect(page.getByLabel("₹12,34,567")).toBeVisible();

  // Buttons, disabled state, segmented tabs, category radios, tab bar.
  await expect(page.getByRole("button", { name: "Save ₹1,250 expense" })).toBeEnabled();
  await expect(page.getByTestId("ds-buttons").getByRole("button", { name: "Disabled" })).toBeDisabled();
  await expect(page.getByRole("tab", { name: "Expense" }).first()).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("radio", { name: "Food" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("progressbar", { name: "Shopping budget used" })).toHaveAttribute("aria-valuenow", "94");
  await expect(page.getByRole("tablist", { name: "Main" }).getByRole("tab")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Add an entry" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "short in Sample bank" })).toBeVisible();

  // Keypad edits the amount: 1250 → 12505 → 1250.
  const amount = page.getByLabel(/^Amount, ₹1,250$/);
  await expect(amount).toBeVisible();
  await page.getByRole("button", { name: "5", exact: true }).click();
  await expect(page.getByLabel("Amount, ₹12,505")).toBeVisible();
  await page.getByRole("button", { name: "Delete last digit" }).click();
  await expect(page.getByLabel(/^Amount, ₹1,250$/)).toBeVisible();

  // Every tap target is at least 44×44. The only exception is the 36px "small" size (small
  // buttons, chips), which adds hitSlop on native to reach 44; web does not draw hitSlop, and
  // the unit tests (logic.test.ts) prove hitSlopFor(36) reaches 44.
  const SMALL = 36;
  const tooSmall = await page.evaluate(
    (small) =>
      [...document.querySelectorAll('[role="button"],[role="tab"],[role="radio"]')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { name: el.getAttribute("aria-label") ?? "", w: Math.round(r.width), h: Math.round(r.height) };
        })
        .filter((b) => b.w > 0 && (b.w < 44 || (b.h < 44 && b.h !== small))),
    SMALL,
  );
  expect(tooSmall).toEqual([]);
});
