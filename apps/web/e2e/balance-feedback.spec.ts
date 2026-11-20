import { type Page, expect, test } from "@playwright/test"
import { addBank, addCash, addEntry, signUpConfirmed, uniqueEmail } from "./helpers"

// Balance feedback after a save (before Sprint 12a): a card with the account's balance before →
// after, counting to the new value (from 0.3s after it appears, for 1.5s, eased out), and the
// change; it stays about 5 seconds after the count and waits while hovered or focused. Both figures come from the server after the
// save; screen readers hear one line. Total available counts to its new value too.

const card = (page: Page) => page.getByTestId("balance-card")
const row = (page: Page, account: string) => card(page).locator(`[data-testid="balance-row"][data-account="${account}"]`)
const announced = (page: Page, line: string) => page.getByRole("region", { name: "Notifications" }).getByText(line, { exact: true })

test("after an expense and an income: the right before and after, the change, and one line for screen readers", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("balance-card"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "52,300" })

  // Expense: money out, counts down.
  await addEntry(page, { amount: "500", category: "Groceries", from: "HDFC Bank ··4821" })
  const hdfc = row(page, "HDFC Bank ··4821")
  await expect(hdfc.getByTestId("balance-before")).toHaveText("₹52,300")
  // Mid-count (for review): part way between the two figures.
  await page.waitForTimeout(900)
  await page.screenshot({ path: "e2e-screenshots/1440-balance-card-mid-count.png" })
  await expect(hdfc.getByTestId("balance-after")).toHaveText("₹51,800")
  await expect(hdfc.getByTestId("balance-change")).toHaveText("−₹500")
  await expect(announced(page, "Saved. HDFC Bank balance now ₹51,800.")).toHaveCount(1)
  // Still there well after the count ends, then gone (0.3 + 1.5 + 5 seconds).
  await page.waitForTimeout(3500)
  await expect(card(page)).toBeVisible()
  await expect(card(page)).toBeHidden({ timeout: 8000 })

  // Income: money in, counts up.
  await addEntry(page, { type: "Income", amount: "10,000", category: "Salary", from: "HDFC Bank ··4821" })
  await expect(hdfc.getByTestId("balance-before")).toHaveText("₹51,800")
  await expect(hdfc.getByTestId("balance-after")).toHaveText("₹61,800")
  await expect(hdfc.getByTestId("balance-change")).toHaveText("+₹10,000")
  await expect(announced(page, "Saved. HDFC Bank balance now ₹61,800.")).toHaveCount(1)

  // Overview's Money left (Total available) shows the server's new figure.
  await page.goto("/")
  await expect(page.getByTestId("amount-total-available")).toHaveText("₹61,800")
})

test("reduced motion: a transfer shows both accounts at once, no counting", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await signUpConfirmed(page, "Kabir Shah", uniqueEmail("balance-transfer"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addCash(page, "500")

  await addEntry(page, { type: "Transfer", amount: "1,000", from: "HDFC Bank ··4821", to: "Cash in hand" })
  const hdfc = row(page, "HDFC Bank ··4821")
  const cash = row(page, "Cash in hand")
  await expect(hdfc).toBeVisible()
  // The first frame already shows the new values.
  expect(await hdfc.getByTestId("balance-after").textContent()).toBe("₹9,000")
  expect(await cash.getByTestId("balance-after").textContent()).toBe("₹1,500")
  await expect(hdfc.getByTestId("balance-change")).toHaveText("−₹1,000")
  await expect(cash.getByTestId("balance-before")).toHaveText("₹500")
  await expect(cash.getByTestId("balance-change")).toHaveText("+₹1,000")
  await expect(announced(page, "Saved. HDFC Bank balance now ₹9,000. Cash in hand balance now ₹1,500.")).toHaveCount(1)
})

test("hovering the card keeps it open; it goes once the pointer leaves", async ({ page }) => {
  await signUpConfirmed(page, "Neha Joshi", uniqueEmail("balance-hover"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addEntry(page, { amount: "300", category: "Groceries", from: "HDFC Bank ··4821" })
  await expect(card(page)).toBeVisible()
  await card(page).hover()
  await page.waitForTimeout(9000)
  await expect(card(page)).toBeVisible()
  await page.mouse.move(5, 5)
  await expect(card(page)).toBeHidden({ timeout: 10_000 })
})

test.describe("at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("the card mid-count", async ({ page }) => {
    await signUpConfirmed(page, "Arjun Das", uniqueEmail("balance-1280"))
    await page.goto("/income")
    await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "52,300" })
    await addEntry(page, { amount: "500", category: "Groceries", from: "HDFC Bank ··4821" })
    await expect(card(page)).toBeVisible()
    await page.waitForTimeout(900)
    await page.screenshot({ path: "e2e-screenshots/1280-balance-card-mid-count.png" })
    await expect(row(page, "HDFC Bank ··4821").getByTestId("balance-after")).toHaveText("₹51,800")
  })
})

test.describe("at 360px", () => {
  test.use({ viewport: { width: 360, height: 740 } })

  test("the card after an expense fits the phone layout", async ({ page }) => {
    await signUpConfirmed(page, "Ravi Kumar", uniqueEmail("balance-phone"))
    await page.goto("/income")
    await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "52,300" })
    await addEntry(page, { amount: "500", category: "Groceries", from: "HDFC Bank ··4821" })
    const hdfc = row(page, "HDFC Bank ··4821")
    await expect(card(page)).toBeVisible()
    await page.waitForTimeout(900)
    await page.screenshot({ path: "e2e-screenshots/360-balance-card-mid-count.png" })
    await expect(hdfc.getByTestId("balance-after")).toHaveText("₹51,800")
    const box = (await card(page).boundingBox())!
    const tabBar = (await page.getByRole("navigation", { name: "Main" }).last().boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(360)
    expect(box.y + box.height).toBeLessThanOrEqual(tabBar.y)
    await page.screenshot({ path: "e2e-screenshots/360-balance-card.png", animations: "disabled" })
  })
})
