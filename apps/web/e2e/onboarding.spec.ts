import { expect, test } from "@playwright/test"
import { addBank, addEntry, overviewHeading, signIn, signOut, signUpConfirmed, skipTour, tourDialog, uniqueEmail } from "./helpers"

// First sign-in tour and the Get started card (before Sprint 12a). "Tour done" and "checklist
// dismissed" are saved to the profile by the database, so they follow the person across
// devices and reloads. Profiles that existed before the migration count the tour as done
// (migration backfill; CI starts from an empty database, so here an "existing user" is one who
// already finished the tour and signs in again on another device).

test("a new user sees the tour; Back, Next and Skip work; it doesn't come back after a reload", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("tour-new"), { tour: true })

  const tour = tourDialog(page)
  await expect(tour).toBeVisible()
  await expect(tour).toHaveAccessibleName("Tour, step 1 of 5: Add expense")
  await expect(tour).toBeFocused()
  for (const name of ["Back", "Next", "Skip tour"]) await expect(tour.getByRole("button", { name })).toBeVisible()
  await expect(tour.getByRole("button", { name: "Back" })).toBeDisabled()

  await tour.getByRole("button", { name: "Next" }).click()
  await expect(tour).toHaveAccessibleName("Tour, step 2 of 5: Import a UPI statement")
  await tour.getByRole("button", { name: "Back" }).click()
  await expect(tour).toHaveAccessibleName("Tour, step 1 of 5: Add expense")
  // Keyboard: Tab moves through the card's buttons and wraps (Back is off on step 1).
  await page.keyboard.press("Tab")
  await expect(tour.getByRole("button", { name: "Next" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(tour.getByRole("button", { name: "Skip tour" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(tour.getByRole("button", { name: "Next" })).toBeFocused()

  await skipTour(page)
  await page.reload()
  await expect(overviewHeading(page)).toBeVisible()
  await page.waitForTimeout(500)
  await expect(tourDialog(page)).toHaveCount(0)
})

test("Escape skips the tour, and it stays done on another device", async ({ page, browser }) => {
  const email = uniqueEmail("tour-existing")
  await signUpConfirmed(page, "Kabir Shah", email, { tour: true })
  await expect(tourDialog(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(tourDialog(page)).toBeHidden()
  await signOut(page)

  // An existing user (tour already done) signing in elsewhere: no tour.
  const other = await browser.newContext()
  const phone = await other.newPage()
  await phone.goto("/sign-in")
  await signIn(phone, email)
  await expect(overviewHeading(phone)).toBeVisible()
  await phone.waitForTimeout(500)
  await expect(tourDialog(phone)).toHaveCount(0)
  await other.close()
})

test("Replay the tour from Settings and finish it with Done", async ({ page }) => {
  await signUpConfirmed(page, "Meera Iyer", uniqueEmail("tour-replay"))
  await page.goto("/settings")
  await expect(tourDialog(page)).toHaveCount(0)
  await page.getByRole("button", { name: "Replay the tour" }).click()

  const tour = tourDialog(page)
  await expect(tour).toHaveAccessibleName("Tour, step 1 of 5: Add expense")
  for (let i = 1; i < 5; i++) await tour.getByRole("button", { name: "Next" }).click()
  await expect(tour).toHaveAccessibleName("Tour, step 5 of 5: Ask Roma")
  await tour.getByRole("button", { name: "Done" }).click()
  await expect(tour).toBeHidden()
  await page.reload()
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible()
  await page.waitForTimeout(500)
  await expect(tourDialog(page)).toHaveCount(0)
})

test.describe("at 360px", () => {
  test.use({ viewport: { width: 360, height: 740 } })

  test("the steps are a card above the tab bar and point at what's on screen", async ({ page }) => {
    await signUpConfirmed(page, "Ravi Kumar", uniqueEmail("tour-phone"), { tour: true })
    const tour = tourDialog(page)
    await expect(tour).toHaveAccessibleName("Tour, step 1 of 5: Add expense")
    const box = await tour.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(15)
    expect(box!.x + box!.width).toBeLessThanOrEqual(345)
    const tabBar = await page.getByRole("navigation", { name: "Main" }).last().boundingBox()
    expect(box!.y + box!.height).toBeLessThanOrEqual(tabBar!.y)
    for (let i = 1; i < 5; i++) await tour.getByRole("button", { name: "Next" }).click()
    await expect(tour.getByText("Ask Roma about your money. She's under More.")).toBeVisible()
    await page.screenshot({ path: "e2e-screenshots/tour-phone.png", animations: "disabled" })
    await tour.getByRole("button", { name: "Done" }).click()
    await expect(tour).toBeHidden()
  })
})

test("Get started ticks itself from real data, and Dismiss removes it for good", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("get-started"))
  const card = page.getByRole("region", { name: "Get started" })
  await expect(card).toBeVisible()
  await expect(card.getByText("0 of 4 done.", { exact: false })).toBeVisible()

  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await page.goto("/")
  await expect(page.getByTestId("get-started-account")).toHaveAttribute("data-done", "true")
  await expect(page.getByTestId("get-started-expense")).toHaveAttribute("data-done", "false")
  await expect(card.getByText("1 of 4 done.", { exact: false })).toBeVisible()

  await addEntry(page, { amount: "250", category: "Groceries", from: "HDFC Bank ··4821" })
  await page.goto("/")
  await expect(page.getByTestId("get-started-expense")).toHaveAttribute("data-done", "true")
  await expect(card.getByText("2 of 4 done.", { exact: false })).toBeVisible()
  await expect(card.getByRole("link", { name: "Add your first expense (done)" })).toBeVisible()

  await card.getByRole("button", { name: "Dismiss" }).click()
  await expect(card).toBeHidden()
  await page.reload()
  await expect(overviewHeading(page)).toBeVisible()
  await expect(page.getByRole("region", { name: "Get started" })).toHaveCount(0)
})
