import { type Locator, type Page, expect, test } from "@playwright/test"
import { addBank, addCash, addEntry, dialog, signUpConfirmed, uniqueEmail } from "./helpers"

// The Income page and the Overview at 375px (Sprint 10a): cards stack one per row, nothing
// scrolls sideways, and the bank account list is big enough to use with a thumb.

test.use({ viewport: { width: 375, height: 812 } })

const SHOTS = "e2e-screenshots"

async function expectNoSideScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(scroll).toBeLessThanOrEqual(client)
}

/** Each card sits below the previous one, at the same left edge, almost full width. */
async function expectStacked(cards: Locator, count: number) {
  await expect(cards).toHaveCount(count)
  const boxes = await Promise.all((await cards.all()).map((c) => c.boundingBox()))
  for (const [i, box] of boxes.entries()) {
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(375 - 2 * 16 - 8)
    if (i > 0) {
      expect(box!.x).toBeCloseTo(boxes[0]!.x, 0)
      expect(box!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height)
    }
  }
}

test("Income and Overview read well at 375px", async ({ page }) => {
  await signUpConfirmed(page, "Small Screen", uniqueEmail("phone"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "2,48,600" })
  await addBank(page, { bank: "Axis Bank", last4: "7710", opening: "52,000" })
  await addCash(page, "1,500")
  await addEntry(page, { type: "Income", amount: "32,000", category: "Rental income", from: "HDFC Bank ··4821" })
  await addEntry(page, { amount: "450", category: "Food & dining", from: "Cash in hand" })

  // Income: three main cards, then the smaller rental card.
  await page.goto("/income")
  await expectStacked(page.getByRole("region", { name: "Summary" }).locator("[data-slot=card]"), 3)
  await expect(page.getByText("Rental income", { exact: true })).toBeVisible()
  await expectNoSideScroll(page)
  await page.screenshot({ path: `${SHOTS}/phone-375-income.png`, fullPage: true })

  // "2 accounts" opens the bank list; each row is at least 44px tall and fits the screen.
  await page.getByRole("button", { name: "2 accounts" }).click()
  const banks = dialog(page, "Bank accounts")
  const rows = banks.getByRole("listitem").getByRole("button")
  await expect(rows).toHaveCount(2)
  for (const row of await rows.all()) {
    const box = (await row.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
  }
  await expectNoSideScroll(page)
  await page.screenshot({ path: `${SHOTS}/phone-375-bank-accounts.png` })
  await page.keyboard.press("Escape")

  // Overview: the four cards, one per row, and no sideways scroll anywhere on the page.
  await page.goto("/")
  await expectStacked(page.getByRole("region", { name: /^Summary/ }).locator("[data-slot=card]"), 4)
  await expectNoSideScroll(page)
  await page.screenshot({ path: `${SHOTS}/phone-375-overview.png`, fullPage: true })
})
