import { type Locator, type Page, expect, test } from "@playwright/test"
import { addBank, addEntry, overviewHeading, signIn, signOut, signUpConfirmed, tourDialog, uniqueEmail, welcomeDialog } from "./helpers"

// First sign-in welcome, the tour and the Get started card (before Sprint 12a). "Tour done" and
// "checklist dismissed" are saved to the profile by the database, so they follow the person
// across devices and reloads. Profiles that existed before the migration count the tour as done
// (migration backfill; CI starts from an empty database, so here an "existing user" is one who
// already skipped the welcome and signs in again on another device).

// Desktop: + Add, then every sidebar item in nav order. Phones: + Add, the four tabs and More.
const DESKTOP_STEPS = ["Add", "Overview", "Income", "Recurring", "Transactions", "Goals", "Investments", "Loans & Liabilities", "Reports", "Ask Roma"]
const PHONE_STEPS = ["Add", "Overview", "Activity", "Goals", "Investments", "More"]

const stepName = (n: number, steps: string[]) => `Tour, step ${n} of ${steps.length}: ${steps[n - 1]}`

async function expectNoTourAfterReload(page: Page, heading: Locator) {
  await page.reload()
  await expect(heading).toBeVisible()
  await page.waitForTimeout(500)
  await expect(welcomeDialog(page)).toHaveCount(0)
  await expect(tourDialog(page)).toHaveCount(0)
}

test("welcome → Skip for now: it closes, focus was trapped, and it doesn't come back after a reload", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("welcome-skip"), { tour: true })

  const welcome = welcomeDialog(page)
  await expect(welcome).toBeVisible()
  await expect(welcome.getByText("Track every rupee across your bank accounts, cash and UPI apps.")).toBeVisible()
  const take = welcome.getByRole("button", { name: "Take the tour" })
  const skip = welcome.getByRole("button", { name: "Skip for now" })
  await expect(take).toBeFocused()
  // Keyboard: Tab stays inside the welcome.
  await page.keyboard.press("Tab")
  await expect(skip).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(take).toBeFocused()

  await skip.click()
  await expect(welcome).toBeHidden()
  await expect(tourDialog(page)).toHaveCount(0)
  await expectNoTourAfterReload(page, overviewHeading(page))
})

test("Escape on the welcome skips it, and it stays done on another device", async ({ page, browser }) => {
  const email = uniqueEmail("welcome-escape")
  await signUpConfirmed(page, "Kabir Shah", email, { tour: true })
  await expect(welcomeDialog(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(welcomeDialog(page)).toBeHidden()
  await expect(overviewHeading(page)).toBeVisible()
  await signOut(page)

  // An existing user (tour already done) signing in elsewhere: no welcome.
  const other = await browser.newContext()
  const phone = await other.newPage()
  await phone.goto("/sign-in")
  await signIn(phone, email)
  await expect(overviewHeading(phone)).toBeVisible()
  await phone.waitForTimeout(500)
  await expect(welcomeDialog(phone)).toHaveCount(0)
  await other.close()
})

test("welcome → Take the tour: every nav item in order, Back and Next, Done; no page change", async ({ page }) => {
  await signUpConfirmed(page, "Meera Iyer", uniqueEmail("tour-full"), { tour: true })
  await welcomeDialog(page).getByRole("button", { name: "Take the tour" }).click()
  await expect(welcomeDialog(page)).toBeHidden()

  const tour = tourDialog(page)
  await expect(tour).toHaveAccessibleName(stepName(1, DESKTOP_STEPS))
  await expect(tour).toBeFocused()
  await expect(tour.getByRole("button", { name: "Back" })).toBeDisabled()
  // Keyboard: Tab moves through the card's buttons and wraps (Back is off on step 1).
  await page.keyboard.press("Tab")
  await expect(tour.getByRole("button", { name: "Next" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(tour.getByRole("button", { name: "Skip tour" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(tour.getByRole("button", { name: "Next" })).toBeFocused()

  await tour.getByRole("button", { name: "Next" }).click()
  await expect(tour).toHaveAccessibleName(stepName(2, DESKTOP_STEPS))
  await tour.getByRole("button", { name: "Back" }).click()
  await expect(tour).toHaveAccessibleName(stepName(1, DESKTOP_STEPS))

  for (let n = 2; n <= DESKTOP_STEPS.length; n++) {
    await tour.getByRole("button", { name: "Next" }).click()
    await expect(tour).toHaveAccessibleName(stepName(n, DESKTOP_STEPS))
  }
  await expect(tour.getByText("Ask Roma about your money in plain words", { exact: false })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  await tour.getByRole("button", { name: "Done" }).click()
  await expect(tour).toBeHidden()
  await expectNoTourAfterReload(page, overviewHeading(page))
})

test("Replay the tour in Settings opens the welcome again", async ({ page }) => {
  await signUpConfirmed(page, "Ravi Menon", uniqueEmail("tour-replay"))
  await page.goto("/settings")
  await expect(welcomeDialog(page)).toHaveCount(0)
  await page.getByRole("button", { name: "Replay the tour" }).click()

  const welcome = welcomeDialog(page)
  await expect(welcome).toBeVisible()
  await welcome.getByRole("button", { name: "Take the tour" }).click()
  const tour = tourDialog(page)
  await expect(tour).toHaveAccessibleName(stepName(1, DESKTOP_STEPS))
  await tour.getByRole("button", { name: "Skip tour" }).click()
  await expect(tour).toBeHidden()
  await expectNoTourAfterReload(page, page.getByRole("heading", { level: 1, name: "Settings" }))
})

test.describe("at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("the welcome is centred; each step sits beside its nav item with an arrow, never over it", async ({ page }) => {
    await signUpConfirmed(page, "Nisha Pillai", uniqueEmail("tour-desktop"), { tour: true })
    const welcome = welcomeDialog(page)
    await expect(welcome).toBeVisible()
    const w = (await welcome.boundingBox())!
    expect(w.x + w.width / 2).toBeCloseTo(640, -1)
    expect(w.y + w.height / 2).toBeCloseTo(400, -1)
    await page.screenshot({ path: "e2e-screenshots/1280-welcome.png", animations: "disabled" })
    await welcome.getByRole("button", { name: "Take the tour" }).click()

    const tour = tourDialog(page)
    const arrow = page.getByTestId("tour-arrow")

    // Step 1, + Add in the top bar: the card is below it, the arrow pointing up at it.
    await expect(tour).toHaveAccessibleName(stepName(1, DESKTOP_STEPS))
    const add = (await page.locator('[data-tour="add"]').boundingBox())!
    let card = (await tour.boundingBox())!
    expect(card.y).toBeGreaterThanOrEqual(add.y + add.height)
    let tip = (await arrow.boundingBox())!
    expect(tip.x + tip.width / 2).toBeGreaterThanOrEqual(add.x)
    expect(tip.x + tip.width / 2).toBeLessThanOrEqual(add.x + add.width)

    // Every sidebar step: the card to the right of the item, the arrow at the item's middle.
    for (let n = 2; n <= DESKTOP_STEPS.length; n++) {
      await tour.getByRole("button", { name: "Next" }).click()
      await expect(tour).toHaveAccessibleName(stepName(n, DESKTOP_STEPS))
      const item = page.locator("aside").getByRole("link", { name: DESKTOP_STEPS[n - 1], exact: true })
      await expect(async () => {
        const link = (await item.boundingBox())!
        card = (await tour.boundingBox())!
        tip = (await arrow.boundingBox())!
        expect(card.x).toBeGreaterThanOrEqual(link.x + link.width)
        expect(card.y + card.height).toBeLessThanOrEqual(800)
        expect(Math.abs(tip.y + tip.height / 2 - (link.y + link.height / 2))).toBeLessThanOrEqual(2)
      }).toPass()
      if (n === 2) await page.screenshot({ path: "e2e-screenshots/1280-tour-step-2.png", animations: "disabled" })
    }
    await tour.getByRole("button", { name: "Done" }).click()
    await expect(tour).toBeHidden()
  })
})

test.describe("at 360px", () => {
  test.use({ viewport: { width: 360, height: 740 } })

  test("the welcome is a bottom sheet; the steps are a card above the tab bar; the ring stays on screen", async ({ page }) => {
    await signUpConfirmed(page, "Ravi Kumar", uniqueEmail("tour-phone"), { tour: true })
    const welcome = welcomeDialog(page)
    await expect(welcome).toBeVisible()
    const w = (await welcome.boundingBox())!
    expect(w.x).toBeCloseTo(0, 0)
    expect(w.width).toBeCloseTo(360, 0)
    expect(w.y + w.height).toBeCloseTo(740, 0)
    await page.screenshot({ path: "e2e-screenshots/360-welcome.png", animations: "disabled" })
    await welcome.getByRole("button", { name: "Take the tour" }).click()

    const tour = tourDialog(page)
    await expect(tour).toHaveAccessibleName(stepName(1, PHONE_STEPS))
    const box = (await tour.boundingBox())!
    // The page's own side gutter: px-4 is 1rem, and the root font size is 87.5% (14px).
    const main = (await page.locator("main").boundingBox())!
    const gutter = await page.locator("main").evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
    expect(box.x).toBeCloseTo(main.x + gutter, 0)
    expect(box.x + box.width).toBeCloseTo(main.x + main.width - gutter, 0)
    // Covers neither the bottom nav nor the Add button it points at.
    const tabBar = (await page.getByRole("navigation", { name: "Main" }).last().boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(tabBar.y)
    const add = (await page.locator('[data-tour="add"]').boundingBox())!
    expect(add.y + add.height).toBeLessThanOrEqual(box.y)
    await page.screenshot({ path: "e2e-screenshots/360-tour-step-1.png", animations: "disabled" })

    const ring = page.getByTestId("tour-highlight")
    for (let n = 2; n <= PHONE_STEPS.length; n++) {
      await tour.getByRole("button", { name: "Next" }).click()
      await expect(tour).toHaveAccessibleName(stepName(n, PHONE_STEPS))
      const card = (await tour.boundingBox())!
      expect(card.y + card.height).toBeLessThanOrEqual(tabBar.y)
      // The ring is fully inside the window, even on the edge item (More).
      const r = (await ring.boundingBox())!
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.x + r.width).toBeLessThanOrEqual(360)
      expect(r.y + r.height).toBeLessThanOrEqual(740)
    }
    await expect(tour.getByText("Income and accounts, Recurring, Loans & Liabilities, Reports and Ask Roma.", { exact: false })).toBeVisible()
    await page.screenshot({ path: "e2e-screenshots/360-tour-step-6.png", animations: "disabled" })
    await tour.getByRole("button", { name: "Done" }).click()
    await expect(tour).toBeHidden()

    // The Get started card on Overview at this width.
    const card = page.getByRole("region", { name: "Get started" })
    await card.scrollIntoViewIfNeeded()
    await expect(card).toBeVisible()
    await page.screenshot({ path: "e2e-screenshots/360-get-started.png", animations: "disabled" })
  })
})

test("Get started: each row links to where you do it, ticks from real data, and Hide removes it for good", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("get-started"))
  const card = page.getByRole("region", { name: "Get started" })
  await expect(card).toBeVisible()
  await expect(card.getByText("0 of 4 done.", { exact: false })).toBeVisible()
  await expect(card.getByRole("link", { name: "Add an account (not done yet)" })).toHaveAttribute("href", "/income?add=bank")
  await expect(card.getByRole("link", { name: "Add your first expense (not done yet)" })).toHaveAttribute("href", "/transactions?add=expense")
  await expect(card.getByRole("link", { name: "Import a statement (not done yet)" })).toHaveAttribute("href", "/transactions/import/upi")
  await expect(card.getByRole("link", { name: "Ask Roma a question (not done yet)" })).toHaveAttribute("href", "/roma")

  // The account row opens Add bank account on Income.
  await card.getByRole("link", { name: "Add an account (not done yet)" }).click()
  await expect(page).toHaveURL(/\/income$/)
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await page.goto("/")
  await expect(page.getByTestId("get-started-account")).toHaveAttribute("data-done", "true")
  await expect(page.getByTestId("get-started-expense")).toHaveAttribute("data-done", "false")
  await expect(card.getByText("1 of 4 done.", { exact: false })).toBeVisible()

  await addEntry(page, { amount: "250", category: "Groceries", from: "HDFC Bank ··4821" })
  await page.goto("/")
  await expect(page.getByTestId("get-started-expense")).toHaveAttribute("data-done", "true")
  await expect(card.getByText("2 of 4 done.", { exact: false })).toBeVisible()
  // Ticked rows stay, ticked.
  await expect(card.getByRole("link", { name: "Add an account (done)" })).toBeVisible()
  await expect(card.getByRole("link", { name: "Add your first expense (done)" })).toBeVisible()

  await card.getByRole("button", { name: "Hide Get started" }).click()
  await expect(card).toBeHidden()
  await page.reload()
  await expect(overviewHeading(page)).toBeVisible()
  await expect(page.getByRole("region", { name: "Get started" })).toHaveCount(0)
})
