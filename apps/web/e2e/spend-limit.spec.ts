import { type Page, expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { AFTER_BILLS_LINE, type Database, LIMIT_NOTE, heroText, userToday } from "@fin-creador/api"
// The phone's Home E2E seeders, so the web is checked against the same demo data and figures.
import { type Demo, expectedHome, seedNormal } from "../../mobile/e2e/demo-data"
import { PASSWORD, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Daily spend limit on the web (pre-13b 2 PR 3): set it from the Transactions page, change it
// from the Safe to spend card's link, see the safety note, remove it. Fresh demo user (seedNormal:
// ₹42,000 at the start of today, ₹3,000 of bills before payday in 8 days, ₹1,200 spent today).
// Each card figure is also checked against the shared loader read as the same user.

const SHOTS = "e2e-screenshots"

const card = (page: Page) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Safe to spend today", exact: true }) })
const limitDialog = (page: Page, title: "Set a spend limit" | "Change your spend limit") => dialog(page, title)

async function demoUser(page: Page): Promise<Demo> {
  const email = uniqueEmail("spend-limit")
  await signUpConfirmed(page, "Demo user", email, { hideWelcome: true })
  const client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  expect((await client.auth.signInWithPassword({ email, password: PASSWORD })).error).toBeNull()
  const day = await userToday(client)
  if (!day.ok) throw new Error(`Could not read today: ${day.reason}`)
  const demo = { client, today: day.today }
  await seedNormal(demo)
  return demo
}

/** The card shows what the shared heroText says for this user now. */
async function expectCardMatchesShared(page: Page, demo: Demo) {
  const hero = heroText(await expectedHome(demo))
  await expect(card(page).getByText(hero.suffix, { exact: true })).toBeVisible()
  return hero
}

test("set a weekly limit from Transactions, change it from the card, see the note, remove it", async ({ page }) => {
  const demo = await demoUser(page)

  // 1. Transactions: no limit yet.
  await page.goto("/transactions")
  await page.getByRole("button", { name: "Set daily spend limit" }).click()
  const set = limitDialog(page, "Set a spend limit")
  await expect(set).toBeVisible()
  await expect(set.getByRole("button", { name: "Remove limit" })).toHaveCount(0)
  await set.getByRole("radio", { name: "1 week" }).check()
  await set.getByLabel("Amount").fill("14000")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${SHOTS}/390-spend-limit-dialog.png` })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: `${SHOTS}/1440-spend-limit-dialog.png` })
  await set.getByRole("button", { name: "Save" }).click()
  await expect(toast(page, "Daily spend limit saved.")).toBeVisible()
  await expect(set).toBeHidden()
  // The button shows what was set.
  await expect(page.getByRole("button", { name: "Limit ₹14,000 / week. Change daily spend limit" })).toHaveText("Limit ₹14,000 / week")

  // 2. Overview: ₹14,000 ÷ 7 days = ₹2,000 today, ₹1,200 spent, ₹800 left; no note.
  await page.goto("/")
  let hero = await expectCardMatchesShared(page, demo)
  expect(hero.suffix).toBe("left of your ₹2,000 daily limit")
  await expect(card(page).getByText("₹800", { exact: true }).first()).toBeVisible()
  await expect(card(page).getByRole("progressbar", { name: "₹1,200 spent today of ₹2,000" })).toBeVisible()
  await expect(card(page).getByText(AFTER_BILLS_LINE, { exact: true })).toHaveCount(0)
  await expect(card(page).getByText(LIMIT_NOTE)).toHaveCount(0)
  await card(page).screenshot({ path: `${SHOTS}/1440-overview-spend-limit-card.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await card(page).screenshot({ path: `${SHOTS}/390-overview-spend-limit-card.png` })
  await page.setViewportSize({ width: 1440, height: 900 })

  // 3. Change it from the card's link: the dialog opens with what was set.
  await card(page).getByRole("button", { name: "Change limit" }).click()
  const change = limitDialog(page, "Change your spend limit")
  await expect(change.getByRole("radio", { name: "1 week" })).toBeChecked()
  await expect(change.getByLabel("Amount")).toHaveValue("14000")
  // A custom period of 1 day is refused; what was typed stays.
  await change.getByRole("radio", { name: "Custom" }).check()
  await change.getByLabel("Number of days").fill("1")
  await change.getByLabel("Amount").fill("50000")
  await change.getByRole("button", { name: "Save" }).click()
  await expect(change.getByText("Enter 2 to 365 days")).toBeVisible()
  await expect(change.getByLabel("Number of days")).toHaveValue("1")
  await expect(change.getByLabel("Amount")).toHaveValue("50000")
  // ₹50,000 a day for the 8 days to payday is more than the ₹39,000 left after bills.
  await change.getByRole("radio", { name: "1 day" }).check()
  await change.getByRole("button", { name: "Save" }).click()
  await expect(toast(page, "Daily spend limit saved.")).toBeVisible()
  await expect(change).toBeHidden()

  // 4. The safety note, one quiet line; the big figure is still today's limit.
  hero = await expectCardMatchesShared(page, demo)
  expect(hero.suffix).toBe("left of your ₹50,000 daily limit")
  expect(hero.note).toBe(LIMIT_NOTE)
  await expect(card(page).getByText("₹48,800", { exact: true }).first()).toBeVisible()
  await expect(card(page).getByText(LIMIT_NOTE, { exact: true })).toBeVisible()
  await card(page).screenshot({ path: `${SHOTS}/1440-overview-spend-limit-card-note.png` })

  // 5. Remove it (with a confirm): the card goes back to Safe to spend after bills.
  await card(page).getByRole("button", { name: "Change limit" }).click()
  await change.getByRole("button", { name: "Remove limit" }).click()
  await expect(change).toContainText("Remove your limit of ₹50,000 / day?")
  await change.getByRole("button", { name: "Keep limit" }).click()
  await expect(change.getByLabel("Amount")).toHaveValue("50000")
  await change.getByRole("button", { name: "Remove limit" }).click()
  await change.getByRole("button", { name: "Remove limit" }).click()
  await expect(toast(page, "Daily spend limit removed.")).toBeVisible()
  await expect(change).toBeHidden()

  hero = await expectCardMatchesShared(page, demo)
  expect(hero.suffix).toMatch(/^a day, until \d{1,2} [A-Z][a-z]{2}$/)
  await expect(card(page).getByText("₹4,875", { exact: true }).first()).toBeVisible()
  await expect(card(page).getByText(AFTER_BILLS_LINE, { exact: true })).toBeVisible()
  await expect(card(page).getByText(LIMIT_NOTE)).toHaveCount(0)
  await expect(card(page).getByRole("button", { name: "Set a daily limit" })).toBeVisible()

  await page.goto("/transactions")
  await expect(page.getByRole("button", { name: "Set daily spend limit" })).toBeVisible()
})
