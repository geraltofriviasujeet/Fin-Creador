import { type Page, expect, test } from "@playwright/test"
import { addBank, addCash, addEntry, overviewHeading, signOut, signUpConfirmed, uniqueEmail } from "./helpers"

// Overview dashboard end to end (Sprint 5), against the throwaway local Supabase. Entries
// are dated today (the Add dialog's default), so they all fall in this week, month and year.
// Screenshots go to e2e-screenshots/ for the owner's review.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

const summary = (page: Page) => page.getByRole("region", { name: /^Summary/ })
const card = (page: Page, label: string) =>
  summary(page).locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: label, exact: true }) })
const panel = (page: Page, title: string) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: title, exact: true }) })

/** Today in the profile's default time zone (Asia/Kolkata), as the app's date inputs take it. */
const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())

test("first run: empty states and no invented figures", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("overview-empty"))
  await expect(overviewHeading(page)).toHaveText(/, Asha$/)
  await expect(page.getByRole("heading", { name: "Nothing recorded yet" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Go to Income" })).toBeVisible()

  await expect(card(page, "Total balance")).toContainText("₹0")
  await expect(card(page, "Income")).toContainText("₹0")
  await expect(card(page, "Savings rate")).toContainText("—")
  await expect(card(page, "Savings rate")).toContainText("No income in this period")
  await expect(panel(page, "Spending overview")).toContainText("No spending recorded this month.")
  await expect(panel(page, "Spending by category")).toContainText("No spending recorded this month.")
  await expect(panel(page, "Income vs expenses")).toContainText("No income or expenses recorded this month.")
  await expect(page.getByRole("main").getByRole("img")).toHaveCount(0) // no chart without data
  await expect(panel(page, "Monthly budget")).toContainText("Coming soon")
  await expect(panel(page, "Your goals")).toContainText("Coming soon")
  await expect(panel(page, "Recent transactions")).toContainText("No entries yet")
  await shot(page, "overview-empty")
})

test("figures reconcile with the Transactions page; periods, links and other users", async ({ page }) => {
  await signUpConfirmed(page, "Bala Iyer", uniqueEmail("overview-flow"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addCash(page, "500")
  await addEntry(page, { amount: "250", category: "Groceries", from: "HDFC Bank ··4821" })
  await addEntry(page, { amount: "400", category: "Transport", from: "HDFC Bank ··4821" })
  await addEntry(page, { type: "Income", amount: "5,000", category: "Salary", from: "HDFC Bank ··4821" })
  await addEntry(page, { type: "Transfer", amount: "1,000", from: "HDFC Bank ··4821", to: "Cash in hand" })

  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Nothing recorded yet" })).toBeHidden()
  // 10,000 + 500 − 250 − 400 + 5,000; the transfer moves money without changing the total.
  await expect(card(page, "Total balance")).toContainText("₹14,850")
  await expect(card(page, "Income")).toContainText("₹5,000")
  await expect(card(page, "Income")).toContainText("1 income entry")
  await expect(card(page, "Expenses")).toContainText("₹650")
  await expect(card(page, "Expenses")).toContainText("2 expenses")
  await expect(card(page, "Savings rate")).toContainText("87%")
  await expect(card(page, "Savings rate")).toContainText("+₹4,350")
  // Nothing last month: changes show "—", never infinity.
  await expect(card(page, "Income")).toContainText("vs same days last month (nothing to compare)")

  const categories = panel(page, "Spending by category").getByRole("listitem")
  await expect(categories).toHaveCount(2)
  await expect(categories.first()).toContainText("Transport")
  await expect(categories.first()).toContainText("₹400 · 61.5%")
  await expect(categories.nth(1)).toContainText("₹250 · 38.5%")

  const spending = panel(page, "Spending overview")
  await expect(spending.getByRole("img")).toHaveAttribute("aria-label", /₹650 in total/)
  await spending.getByText("Show as a table").click()
  await expect(spending.getByRole("table")).toContainText("₹650")
  await expect(panel(page, "Recent transactions").getByRole("listitem")).toHaveCount(4)
  await shot(page, "overview-month")
  await page.setViewportSize({ width: 375, height: 812 })
  await shot(page, "overview-month-mobile")
  await page.setViewportSize({ width: 1440, height: 900 })

  // A category opens the Transactions page with the same range; its totals match.
  await categories.first().getByRole("link").click()
  await expect(page).toHaveURL(/\/transactions\?type=expense&period=custom&from=.*&category=/)
  await expect(page.getByRole("region", { name: "Totals for these filters" })).toContainText("₹400")

  await page.goto("/")
  await page.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "Year" }).click()
  await expect(page).toHaveURL(/\?period=year/)
  await expect(card(page, "Expenses")).toContainText("₹650")
  await expect(card(page, "Expenses")).toContainText("vs same days last year")
  await expect(panel(page, "Spending overview")).toContainText("by month")
  await shot(page, "overview-year")

  await page.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "Week" }).click()
  await expect(page).toHaveURL(/\?period=week/)
  await expect(card(page, "Income")).toContainText("₹5,000")

  // A custom range over 62 days is charted by month; a partial first month is labelled.
  const today = todayInIndia()
  const [y, m] = today.split("-").map(Number) as [number, number]
  const start = new Date(Date.UTC(y, m - 4, 15)).toISOString().slice(0, 10)
  await page.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "Custom" }).click()
  await page.getByLabel("From", { exact: true }).fill(start)
  await page.getByLabel("To", { exact: true }).fill(today)
  await page.getByRole("button", { name: "Show range" }).click()
  await expect(page).toHaveURL(new RegExp(`period=custom&from=${start}&to=${today}`))
  await expect(card(page, "Expenses")).toContainText("₹650")
  await expect(card(page, "Expenses")).toContainText(/vs previous \d+ days/)
  await expect(panel(page, "Spending overview")).toContainText("* Partial month:")
  await shot(page, "overview-custom")

  // Another user sees none of it.
  await signOut(page)
  await signUpConfirmed(page, "Chitra Nair", uniqueEmail("overview-other"))
  await expect(page.getByRole("heading", { name: "Nothing recorded yet" })).toBeVisible()
  await expect(card(page, "Expenses")).toContainText("₹0")
  await expect(panel(page, "Recent transactions")).toContainText("No entries yet")
})
