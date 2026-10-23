import { type Page, expect, test } from "@playwright/test"
import { addBank, addCash, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Recurring items end to end, against the throwaway local Supabase. One user per test.

// Dates in the app's default time zone (India, UTC+5:30), as the database computes "today".
const kolkataToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
const daysAgo = (n: number) => {
  const d = new Date(`${kolkataToday()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

const panel = (page: Page, title: RegExp | string) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: title }) })
const tile = (page: Page, label: string) => page.locator("[data-slot=card]").filter({ hasText: new RegExp(`^${label}`) })

type Rule = { type?: "Expense" | "Income" | "Transfer"; amount: string; category?: string; from: string; to?: string; frequency?: string; start: string; note: string }

async function addRule(page: Page, r: Rule) {
  await page.getByRole("button", { name: "Add recurring" }).first().click()
  const d = dialog(page, "Add recurring")
  if (r.type && r.type !== "Expense") await d.getByRole("radio", { name: r.type }).click()
  await d.getByLabel("Amount").fill(r.amount)
  if (r.type === "Transfer") {
    await d.getByLabel("From").selectOption({ label: r.from })
    await d.getByLabel("To").selectOption({ label: r.to! })
  } else {
    await d.getByLabel(r.type === "Income" ? "Source" : "Category").selectOption({ label: r.category! })
    await d.getByLabel(r.type === "Income" ? "Received into" : "Paid from").selectOption({ label: r.from })
  }
  if (r.frequency) await d.getByLabel("Repeats").selectOption({ label: r.frequency })
  await d.getByLabel("Starts on").fill(r.start)
  await d.getByLabel("Note").fill(r.note)
  await d.getByRole("button", { name: "Add recurring" }).click()
  await expect(toast(page, "Recurring item added.")).toBeVisible()
  await expect(d).toBeHidden()
}

async function newUser(page: Page, label: string) {
  await signUpConfirmed(page, "Test Person", uniqueEmail(label))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "50,000" })
  await page.getByRole("link", { name: "Recurring", exact: true }).first().click()
  await expect(page.getByRole("heading", { name: "Recurring", level: 1 })).toBeVisible()
}

test("a recurring expense is due, confirmed through the Add dialog, and costed", async ({ page }) => {
  await newUser(page, "rec-flow")
  // Zero tiles for the profile currency before anything is added.
  await expect(tile(page, "Subscriptions")).toContainText("₹0 / month")

  await addRule(page, { amount: "649", category: "Subscription", from: "HDFC Bank ··4821", start: daysAgo(40), note: "Streaming" })
  await expect(panel(page, /^Due/)).toContainText("Streaming")
  await expect(panel(page, /^Due/)).toContainText("Missed")
  await expect(panel(page, /^Subscriptions/)).toContainText("Streaming")
  await expect(tile(page, "Subscriptions")).toContainText("₹649 / month")
  await expect(tile(page, "Subscriptions")).toContainText("₹7,788 a year")

  await panel(page, /^Due/).getByRole("button", { name: "Confirm Streaming" }).click()
  const add = dialog(page, "Add expense")
  await expect(add.getByLabel("Amount")).toHaveValue("649")
  await expect(add.getByLabel("Category")).toBeDisabled()
  await add.getByLabel("Amount").fill("699")
  await add.getByRole("button", { name: "Save expense" }).click()
  await expect(toast(page, "Expense saved.")).toBeVisible()
  await expect(panel(page, /^Due/)).toContainText("Nothing is due.")
  await expect(panel(page, /^Coming in 30 days/)).toContainText("Streaming")
  await page.screenshot({ path: "e2e-screenshots/recurring-page.png", fullPage: true })

  // The entry is a normal expense; the Upcoming card on Transactions links to Recurring.
  await page.goto("/transactions")
  await expect(page.locator("main li").filter({ hasText: "Streaming" }).first()).toContainText("699")
  await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Open Recurring" })).toHaveAttribute("href", "/recurring")
})

test("skip and undo; archive and restore; a fixed rule posts again", async ({ page }) => {
  await newUser(page, "rec-skip")
  await addRule(page, { amount: "25,000", category: "Rent & housing", from: "HDFC Bank ··4821", frequency: "Weekly", start: daysAgo(14), note: "Flat rent" })
  await expect(panel(page, /^Due/)).toContainText("Flat rent")

  await panel(page, /^Due/).getByRole("button", { name: "Skip Flat rent" }).click()
  await page.getByRole("dialog", { name: /^Skip / }).getByLabel("Reason (optional)").fill("Paid by hand")
  await page.getByRole("dialog", { name: /^Skip / }).getByRole("button", { name: "Skip", exact: true }).click()
  await expect(toast(page, "Skipped. Nothing was saved for this date.")).toBeVisible()
  await expect(panel(page, /^Due/)).toContainText("Nothing is due.")
  await panel(page, /^Other recurring/).getByRole("button", { name: "Undo skip of Flat rent" }).click()
  await expect(toast(page, "Skip undone. The date is due again.")).toBeVisible()
  await expect(panel(page, /^Due/)).toContainText("Flat rent")

  await panel(page, /^Other recurring/).getByRole("button", { name: "Archive Flat rent" }).click()
  await dialog(page, "Archive Flat rent?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Recurring item archived.")).toBeVisible()
  await expect(panel(page, /^Due/)).toContainText("Nothing is due.")
  await page.getByRole("button", { name: "Show archived (1)" }).click()
  await page.getByRole("button", { name: "Restore Flat rent" }).click()
  await expect(toast(page, "Recurring item restored.")).toBeVisible()
  await expect(panel(page, /^Due/)).toContainText("Flat rent")

  // Archiving the account makes the rule need attention until it is fixed.
  await page.goto("/income")
  await addCash(page, "1,000")
  const holding = page.locator("[data-slot=card]").filter({ has: page.getByText("Where your money is", { exact: true }) }).getByRole("listitem").filter({ hasText: "HDFC Bank ··4821" })
  await holding.getByRole("button", { name: "Actions for HDFC Bank ··4821" }).click()
  await page.getByRole("menuitem", { name: "Archive" }).click()
  await dialog(page, "Archive HDFC Bank ··4821?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Account archived.")).toBeVisible()
  await page.goto("/recurring")
  await expect(panel(page, /^Needs attention/)).toContainText("is archived")
  await panel(page, /^Needs attention/).getByRole("button", { name: "Fix Flat rent" }).click()
  const fix = dialog(page, "Edit Flat rent")
  await fix.getByLabel("Paid from").selectOption({ label: "Cash in hand" })
  await fix.getByRole("button", { name: "Save changes" }).click()
  await expect(toast(page, "Recurring item saved.")).toBeVisible()
  await expect(panel(page, /^Needs attention/)).toContainText("All recurring items can save.")
  await expect(panel(page, /^Due/)).toContainText("Flat rent")
})

test("a double-submitted confirm saves one entry", async ({ page }) => {
  await newUser(page, "rec-double")
  await addRule(page, { amount: "1,500", category: "Membership", from: "HDFC Bank ··4821", start: daysAgo(35), note: "Sports club" })
  await panel(page, /^Due/).getByRole("button", { name: "Confirm Sports club" }).click()
  const add = dialog(page, "Add expense")
  await add.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit()
    form.requestSubmit()
  })
  await expect(add).toBeHidden()
  await page.goto("/transactions")
  await expect(page.locator("main li").filter({ hasText: "Sports club" })).toHaveCount(1)
})

test("the Income page shows recurring income only", async ({ page }) => {
  await newUser(page, "rec-income")
  await addRule(page, { type: "Income", amount: "95,000", category: "Salary", from: "HDFC Bank ··4821", start: daysAgo(40), note: "Monthly salary" })
  await addRule(page, { amount: "649", category: "Subscription", from: "HDFC Bank ··4821", start: daysAgo(40), note: "Streaming" })
  await page.goto("/income")
  const card = panel(page, "Upcoming")
  await expect(card).toContainText("Monthly salary")
  await expect(card).not.toContainText("Streaming")
  await page.goto("/transactions")
  await expect(panel(page, "Upcoming")).toContainText("Streaming")
})

test("another user sees none of these rules; the prototype is gone", async ({ browser, baseURL }) => {
  const newPage = async () => (await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })).newPage()
  const first = await newPage()
  await newUser(first, "rec-owner")
  await addRule(first, { amount: "999", category: "Subscription", from: "HDFC Bank ··4821", start: daysAgo(5), note: "Private plan" })
  await first.close()

  const second = await newPage()
  await second.goto("/dev/recurring")
  await expect(second).toHaveURL(/\/sign-in\?next=%2Fdev%2Frecurring/)
  await signUpConfirmed(second, "Stranger", uniqueEmail("rec-stranger"))
  expect((await second.goto("/dev/recurring"))?.status()).toBe(404)
  await second.goto("/recurring")
  await expect(second.getByText("Private plan")).toHaveCount(0)
  await expect(panel(second, /^Due/)).toContainText("Nothing is due.")
  await second.close()
})
