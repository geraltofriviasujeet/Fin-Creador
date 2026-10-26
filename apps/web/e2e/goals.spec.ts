import { type Page, expect, test } from "@playwright/test"
import { addBank, addEntry, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Goals page end to end (Sprint 6): planned expenses and monthly budgets, against the
// throwaway local Supabase. Expected figures are worked out by hand from the amounts
// entered (and checked independently in packages/domain tests). Five screenshots in
// e2e-screenshots/ for the owner's review.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

const goalCard = (page: Page, name: string) => page.locator("li").filter({ has: page.getByRole("heading", { name, exact: true }) })
const panel = (page: Page, title: string) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: title, exact: true }) })
const budgets = (page: Page) => page.getByRole("region", { name: "Monthly budgets" })

async function newUser(page: Page, label: string) {
  await signUpConfirmed(page, "Meera Shah", uniqueEmail(label))
  await page.goto("/goals")
  await expect(page.getByRole("heading", { level: 1, name: "Goals" })).toBeVisible()
}

async function openPlan(page: Page) {
  await page.getByRole("button", { name: "Plan an expense" }).first().click()
  const d = dialog(page, "Plan an expense")
  await expect(d).toBeVisible()
  return d
}

test("navigation and empty states", async ({ page }) => {
  await newUser(page, "goals-empty")
  const nav = page.getByRole("navigation", { name: "Main" }).first()
  await expect(nav.getByRole("link", { name: "Goals" })).toHaveAttribute("href", "/goals")
  await expect(nav.getByText("Budgets")).toHaveCount(0)
  await expect(page.getByText("Plan your first expense")).toBeVisible()
  await expect(budgets(page)).toContainText("No budgets this month")
})

test("trip: cost lines add up; no target date assumes 12 months; AI insights is disabled", async ({ page }) => {
  await newUser(page, "goals-trip")
  const d = await openPlan(page)
  await d.getByRole("radio", { name: "Trip" }).click()
  await d.getByLabel("Name", { exact: true }).fill("Japan in spring")
  await d.getByRole("radio", { name: "International" }).click()
  await d.getByLabel("Country").selectOption({ label: "Japan" })
  await d.getByLabel("People").fill("2")
  await d.getByLabel("Days").fill("8")
  await d.getByLabel("Travel by").selectOption({ label: "Flight" })
  await d.getByLabel("Stay type").selectOption({ label: "Hotel" })
  await d.getByLabel("Transport").fill("90,000")
  await d.getByLabel("Stay", { exact: true }).fill("64,000")
  await d.getByLabel("Saved so far (optional)").fill("10,000")
  await expect(d.getByText("Amount to save upfront")).toBeVisible()
  await expect(d).toContainText("₹1,54,000") // 90,000 + 64,000
  // The whole Trip form fits a 1440×720 window (a laptop browser): its body doesn't scroll.
  await page.setViewportSize({ width: 1440, height: 720 })
  const body = d.locator("form > div").first()
  expect(await body.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await shot(page, "goals-add-trip")
  await d.getByRole("button", { name: "Add goal" }).click()
  await expect(toast(page, "Goal added.")).toBeVisible()

  const card = goalCard(page, "Japan in spring")
  await expect(card).toContainText("International · Japan · 2 people · 8 days")
  await expect(card).toContainText("₹1,54,000")
  await expect(card).toContainText("₹12,000 a month, assuming 12 months (no target date)") // (1,54,000 − 10,000) ÷ 12
  await expect(card.getByText("AI insights · soon")).toBeVisible()

  // Saved amount, archive and restore.
  await card.getByRole("button", { name: "Update saved amount for Japan in spring" }).click()
  await dialog(page, "Saved for Japan in spring").getByLabel("Saved so far").fill("34,000")
  await dialog(page, "Saved for Japan in spring").getByRole("button", { name: "Save" }).click()
  await expect(toast(page, "Saved amount updated.")).toBeVisible()
  await expect(card).toContainText("₹10,000 a month") // (1,54,000 − 34,000) ÷ 12
  await card.getByRole("button", { name: "Archive Japan in spring" }).click()
  await dialog(page, "Archive Japan in spring?").getByRole("button", { name: "Archive" }).click()
  await expect(page.getByText("Plan your first expense")).toBeVisible()
  await page.getByRole("button", { name: "Show archived (1)" }).click()
  await page.getByRole("button", { name: "Restore Japan in spring" }).click()
  await expect(toast(page, "Goal restored.")).toBeVisible()
  await expect(goalCard(page, "Japan in spring").getByRole("heading")).toBeVisible()

  // Active goals can only be archived; permanent delete is offered for archived goals only.
  const active = goalCard(page, "Japan in spring")
  await expect(active.getByRole("button", { name: /Delete/ })).toHaveCount(0)
  await active.getByRole("button", { name: "Archive Japan in spring" }).click()
  await dialog(page, "Archive Japan in spring?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Goal archived.")).toBeVisible()
  await page.getByRole("button", { name: "Delete Japan in spring permanently" }).click()
  const confirm = dialog(page, "Delete Japan in spring permanently?")
  await expect(confirm).toContainText("This can't be undone.")
  await confirm.getByRole("button", { name: "Delete permanently" }).click()
  await expect(toast(page, "Goal deleted.")).toBeVisible()
  await expect(page.getByText("Japan in spring")).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Show archived/ })).toHaveCount(0)
})

test("wheeler (car) loan with down payment: upfront amount, EMI and the rounding note", async ({ page }) => {
  await newUser(page, "goals-car")
  await page.setViewportSize({ width: 1440, height: 1100 }) // the screenshot shows the EMI lines
  const d = await openPlan(page)
  await d.getByRole("radio", { name: "Wheeler" }).click()
  await d.getByLabel("Name", { exact: true }).fill("Family car")
  await d.getByRole("radio", { name: "Car", exact: true }).click()
  await d.getByRole("radio", { name: "New" }).click()
  await d.getByLabel("Make").fill("Maruti Suzuki") // offered in the list; any make can be typed
  await d.getByLabel("Model").fill("Swift")
  await d.getByLabel("Price").fill("8,00,000")
  await d.getByLabel("Extras (optional)").fill("60,000")
  await d.getByRole("radio", { name: "Loan with down payment" }).click()
  await d.getByLabel("Down payment").fill("2,00,000")
  await d.getByLabel("Yearly interest rate (%)").fill("9.5")
  await d.getByLabel("Loan tenure (months)").fill("60")
  // 6,00,000 at 9.5% for 60 months: EMI ₹12,601.12, interest ₹1,56,067.01 (Decimal, checked in domain tests).
  await expect(d).toContainText("₹2,60,000")
  await expect(d).toContainText("EMI ₹12,601.12 a month for 60 months on ₹6,00,000")
  await expect(d).toContainText("total interest ₹1,56,067.01")
  await expect(d).toContainText("Your bank's EMI can differ by a few paise")
  await shot(page, "goals-add-car-loan")
  // Double click: the request key adds the goal once.
  await d.getByRole("button", { name: "Add goal" }).dblclick()
  await expect(toast(page, "Goal added.")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Family car", exact: true })).toHaveCount(1)
  await expect(goalCard(page, "Family car")).toContainText("EMI ₹12,601.12 × 60 at 9.5%")
  await expect(goalCard(page, "Family car")).toContainText("Wheeler · Car · New · Maruti Suzuki Swift")
  // A long subtitle and EMI line stay inside the card (nothing wider than the card).
  await page.setViewportSize({ width: 1440, height: 900 })
  const carCard = goalCard(page, "Family car").locator("[data-slot=card]")
  expect(await carCard.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test("budgets: warning at 80%, over at 100%, on the page and the Overview", async ({ page }) => {
  await newUser(page, "goals-budget")
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addEntry(page, { amount: "250", category: "Groceries", from: "HDFC Bank ··4821" })

  await page.goto("/goals")
  await budgets(page).getByRole("button", { name: "Set a budget" }).click()
  const d = dialog(page, "Set a budget")
  await d.getByLabel("Category").selectOption({ label: "Groceries" })
  await d.getByLabel("Monthly budget").fill("300")
  await d.getByRole("button", { name: "Save budget" }).click()
  await expect(toast(page, "Budget saved.")).toBeVisible()
  await expect(budgets(page)).toContainText("₹250 / ₹300")
  await expect(budgets(page)).toContainText("Near limit")
  await expect(budgets(page).getByRole("progressbar", { name: "Groceries: 83% of budget used" })).toBeVisible()

  await page.goto("/")
  await expect(panel(page, "Monthly budget")).toContainText("₹50 left")
  await expect(panel(page, "Monthly budget")).toContainText("Near limit")

  await addEntry(page, { amount: "100", category: "Groceries", from: "HDFC Bank ··4821" })
  await page.goto("/goals")
  await expect(budgets(page)).toContainText("₹350 / ₹300")
  await expect(budgets(page)).toContainText("Over budget")

  // A fuller page for the screenshot: a second budget and two planned expenses.
  await budgets(page).getByRole("button", { name: "Set a budget" }).click()
  await dialog(page, "Set a budget").getByLabel("Category").selectOption({ label: "Transport" })
  await dialog(page, "Set a budget").getByLabel("Monthly budget").fill("2,000")
  await dialog(page, "Set a budget").getByRole("button", { name: "Save budget" }).click()
  await expect(toast(page, "Budget saved.")).toBeVisible()
  for (const [name, amount, date] of [["Wedding gift", "25,000", ""], ["Emergency fund", "1,50,000", "2027-09-30"]]) {
    const plan = await openPlan(page)
    await plan.getByRole("radio", { name: "Other" }).click()
    await plan.getByLabel("Name", { exact: true }).fill(name!)
    await plan.getByLabel("What it's for").fill(name!)
    await plan.getByLabel("Amount", { exact: true }).fill(amount!)
    if (date) await plan.getByLabel("Target date (optional)").fill(date)
    await plan.getByRole("button", { name: "Add goal" }).click()
    await expect(toast(page, "Goal added.")).toBeVisible()
    await expect(plan).toBeHidden()
  }
  await shot(page, "goals-page")
  await page.goto("/")
  await expect(panel(page, "Monthly budget")).toContainText("Over budget")
  await panel(page, "Monthly budget").scrollIntoViewIfNeeded()
  await shot(page, "overview-budget-goals")
})

test("a budget in another currency asks to be set again, with no percentage", async ({ page }) => {
  await newUser(page, "goals-currency")
  await budgets(page).getByRole("button", { name: "Set a budget" }).click()
  await dialog(page, "Set a budget").getByLabel("Category").selectOption({ label: "Transport" })
  await dialog(page, "Set a budget").getByLabel("Monthly budget").fill("2,000")
  await dialog(page, "Set a budget").getByRole("button", { name: "Save budget" }).click()
  await expect(toast(page, "Budget saved.")).toBeVisible()

  await page.goto("/settings")
  await page.getByLabel("Currency").selectOption("USD")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Profile saved.")).toBeVisible()

  await page.goto("/goals")
  await expect(budgets(page)).toContainText("Set your budget again")
  await expect(budgets(page).getByRole("progressbar")).toHaveCount(0)
  await expect(budgets(page)).toContainText("INR budget")
  await budgets(page).getByRole("button", { name: "Set your budget again: Transport" }).click()
  const d = dialog(page, "Budget for Transport")
  await expect(d).toContainText("This budget is in INR. Enter it again in USD.")
  await d.getByLabel("Monthly budget").fill("25")
  await d.getByRole("button", { name: "Save budget" }).click()
  await expect(budgets(page).getByRole("progressbar", { name: "Transport: 0% of budget used" })).toBeVisible()
  await expect(budgets(page)).not.toContainText("Set your budget again")
})

test("another user sees none of these goals or budgets; phone layout", async ({ browser, baseURL }) => {
  const newPage = async (width = 1440, height = 900) => (await browser.newContext({ baseURL, viewport: { width, height } })).newPage()
  const first = await newPage()
  await newUser(first, "goals-owner")
  const d = await openPlan(first)
  await d.getByRole("radio", { name: "Other" }).click()
  await d.getByLabel("Name", { exact: true }).fill("Private plan")
  await d.getByLabel("What it's for").fill("Gift")
  await d.getByLabel("Amount", { exact: true }).fill("5,000")
  await d.getByRole("button", { name: "Add goal" }).click()
  await expect(toast(first, "Goal added.")).toBeVisible()
  await first.close()

  const second = await newPage(390, 844)
  await newUser(second, "goals-stranger")
  await expect(second.getByText("Private plan")).toHaveCount(0)
  await expect(second.getByText("Plan your first expense")).toBeVisible()
  await shot(second, "goals-phone")
  await second.close()
})
