import { type Locator, type Page, expect, test } from "@playwright/test"
import { addBank, dialog, incomeAccountRow, incomeAccounts, incomeSourceRow, incomeSources, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Income page end to end, against the throwaway local Supabase. One user per test.
// Screenshots go to e2e-screenshots/ (uploaded by CI for visual review).

const SHOTS = "e2e-screenshots"

// The page has two sections (redesign 2026-11): Accounts (chart, table, Total available) and
// Income by source (period switch, chart, table, period total).
const holding = incomeAccountRow
const totalAvailable = (page: Page) => page.getByTestId("total-available")
const periodTotal = (page: Page) => page.getByTestId("period-total")
const period = (page: Page, name: RegExp) => incomeSources(page).getByRole("group", { name: "Period" }).getByRole("button", { name })

async function shots(page: Page, name: string) {
  for (const [label, width] of [["desktop", 1440], ["tablet", 900], ["phone", 390]] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: `${SHOTS}/${name}-${label}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

async function addIncome(page: Page, { amount, source, into, note }: { amount: string; source: string; into: string; note?: string }) {
  await page.getByRole("button", { name: "Record income" }).first().click()
  const d = dialog(page, "Add income")
  await d.getByLabel("Amount").fill(amount)
  await d.getByLabel("Category").selectOption({ label: source })
  await d.getByLabel("Received into").selectOption({ label: into })
  if (note) await d.getByLabel("Note").fill(note)
  await d.getByRole("button", { name: "Save income" }).click()
  await expect(d).toBeHidden()
}

async function expectCard(c: Locator, ...texts: string[]) {
  for (const t of texts) await expect(c).toContainText(t)
}

test("first run shows empty states, never sample data", async ({ page }) => {
  await signUpConfirmed(page, "New Person", uniqueEmail("income-empty"))
  await page.getByRole("link", { name: "Income", exact: true }).first().click()
  await expect(page.getByRole("heading", { name: "Income", level: 1 })).toBeVisible()

  // Two sections; empty states, no sample data; Total available is ₹0, not hidden.
  await expect(incomeAccounts(page)).toContainText("Add your first account")
  await expect(totalAvailable(page)).toContainText("₹0")
  await expect(period(page, /^This month/)).toHaveAttribute("aria-pressed", "true")
  await expect(incomeSources(page)).toContainText("No income this month yet")
  await expect(periodTotal(page)).toContainText("₹0")
  await expect(page.getByRole("main").getByText("Rental income", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Ananya")).toHaveCount(0)
  await shots(page, "01-income-empty")
})

test("accounts, income and totals follow the money rules", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("income-flow"))
  await page.goto("/income")

  // Validation keeps the dialog open with field messages.
  await page.getByRole("button", { name: "Add bank account" }).first().click()
  const bankDialog = dialog(page, "Add bank account")
  await bankDialog.getByLabel("Last 4 digits").fill("12a4")
  await bankDialog.getByRole("button", { name: "Add account" }).click()
  // The error, not the select's "Select your bank" placeholder option.
  await expect(bankDialog.locator("#bankName-error")).toHaveText("Select your bank")
  // Fields keep what the person had after the error (no React form reset).
  await expect(bankDialog.getByLabel("Bank name")).toHaveValue("")
  await expect(bankDialog.getByLabel("Currency")).toHaveValue("INR")
  await expect(bankDialog.getByLabel("Last 4 digits")).toHaveValue("12a4")
  await shots(page, "02-add-bank-validation")
  await page.keyboard.press("Escape")

  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "2,48,600" })
  await addBank(page, { bank: "ICICI Bank", last4: "0934", opening: "1,76,250", type: "Current account" })
  await expectCard(incomeAccounts(page), "Money in banks", "₹4,24,850", "2 accounts")
  await expect(totalAvailable(page)).toContainText("₹4,24,850")
  // Type and last digits have their own columns.
  await expect(holding(page, "ICICI Bank ··0934")).toContainText("Current")
  await expect(holding(page, "ICICI Bank ··0934")).toContainText("··0934")

  // "2 accounts" opens the bank accounts with their balances.
  await incomeAccounts(page).getByRole("button", { name: "2 accounts" }).click()
  const banks = dialog(page, "Bank accounts")
  await expect(banks.getByRole("listitem")).toHaveCount(2)
  await expect(banks.getByRole("listitem").filter({ hasText: "HDFC Bank ··4821" })).toContainText("₹2,48,600")
  await expect(banks).toContainText("₹4,24,850")
  await page.keyboard.press("Escape")

  // Add cash is just an amount (named "Cash in hand"); cash can't start below zero.
  await page.getByRole("button", { name: "Add cash" }).first().click()
  const cashDialog = dialog(page, "Add cash")
  await expect(cashDialog.getByLabel("Name")).toHaveCount(0)
  await cashDialog.getByLabel("Amount").fill("-5")
  await cashDialog.getByRole("button", { name: "Add cash" }).click()
  await expect(cashDialog.getByText("Only bank accounts can start below zero")).toBeVisible()
  await cashDialog.getByLabel("Amount").fill("20,800")
  await cashDialog.getByRole("button", { name: "Add cash" }).click()
  await expect(cashDialog).toBeHidden()
  await expectCard(incomeAccounts(page), "Cash in hand", "₹20,800")
  await expect(holding(page, "Cash in hand")).toContainText("Cash")
  await expect(totalAvailable(page)).toContainText("₹4,45,650")

  // Income: period income and balances move together; period income stays separate.
  await addIncome(page, { amount: "1,28,000", source: "Salary", into: "HDFC Bank ··4821", note: "October salary" })
  await expect(toast(page, "Income saved.")).toBeVisible()
  await addIncome(page, { amount: "32,000", source: "Rental income", into: "ICICI Bank ··0934" })
  await expect(periodTotal(page)).toContainText("₹1,60,000")
  await period(page, /^This year/).click()
  await expect(incomeSources(page)).toContainText("January – December")
  await expect(periodTotal(page)).toContainText("₹1,60,000")
  await period(page, /^This month/).click()
  // Rent is a row (the old Rental income card showed only this total).
  await expect(incomeSourceRow(page, "Rental income")).toContainText("₹32,000")
  await expect(holding(page, "HDFC Bank ··4821")).toContainText("₹3,76,600")
  await expect(totalAvailable(page)).toContainText("₹6,05,650")

  const salary = incomeSourceRow(page, "Salary")
  await expect(salary).toContainText("HDFC Bank ··4821")
  await expect(salary).toContainText("October salary")
  // Actuals as actuals; no rate without a recurring rule.
  await expect(salary).toContainText("₹1,28,000")
  await expect(salary).toContainText("One-off")
  await expect(incomeSources(page)).not.toContainText("every month")
  // Defaults without income stay out of the list.
  await expect(incomeSourceRow(page, "Business")).toHaveCount(0)
  await shots(page, "03-income-filled")

  // One cash account: "Update cash" sets the amount held now (a correction, not income).
  await page.getByRole("button", { name: "Update cash" }).click()
  const update = dialog(page, "Update cash in hand")
  await expect(update.getByLabel("Cash you have now")).toHaveValue("20800")
  await update.getByLabel("Cash you have now").fill("25,000")
  await update.getByRole("button", { name: "Update cash in hand" }).click()
  await expect(toast(page, "Cash in hand updated.")).toBeVisible()
  await expectCard(incomeAccounts(page), "₹25,000")
  await expect(periodTotal(page)).toContainText("₹1,60,000") // unchanged: not income
  await expect(holding(page, "Cash in hand")).toHaveCount(1)
  await expect(totalAvailable(page)).toContainText("₹6,09,850")

  // "Received cash as income?" opens Add income with Cash in hand pre-selected.
  await page.getByRole("button", { name: "Update cash" }).click()
  await dialog(page, "Update cash in hand").getByRole("button", { name: "Add income" }).click()
  await expect(dialog(page, "Add income").getByLabel("Received into").locator("option:checked")).toHaveText("Cash in hand")
  await page.keyboard.press("Escape")

  // Add income dialog, for visual review.
  await page.getByRole("button", { name: "Record income" }).first().click()
  await shots(page, "04-add-income-dialog")
  await page.keyboard.press("Escape")
})

test("a double-submitted income is recorded once", async ({ page }) => {
  await signUpConfirmed(page, "Double Click", uniqueEmail("income-double"))
  await page.goto("/income")
  await addBank(page, { bank: "State Bank of India", last4: "6618", opening: "0" })

  await page.getByRole("button", { name: "Record income" }).first().click()
  const d = dialog(page, "Add income")
  await d.getByLabel("Amount").fill("5,000")
  await d.getByLabel("Category").selectOption({ label: "Freelance" })
  // Two submissions of the same form (same request key), as a double click or a retry would send.
  await d.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit()
    form.requestSubmit()
  })
  await expect(d).toBeHidden()
  await page.reload()
  await expect(periodTotal(page)).toContainText("₹5,000")
  await expect(holding(page, "State Bank of India ··6618")).toContainText("₹5,000")
})

test("void, archive and restore keep history but change the totals", async ({ page }) => {
  await signUpConfirmed(page, "Fix Mistakes", uniqueEmail("income-void"))
  await page.goto("/income?add=bank")
  const d = dialog(page, "Add bank account")
  await d.getByLabel("Bank name").selectOption("Axis Bank")
  await d.getByLabel("Opening balance").fill("1,000")
  await d.getByRole("button", { name: "Add account" }).click()
  await expect(d).toBeHidden()

  await addIncome(page, { amount: "2,500", source: "Salary", into: "Axis Bank" })
  await expect(periodTotal(page)).toContainText("₹2,500")

  // Void from the source's entries.
  await incomeSources(page).getByRole("button", { name: /Salary/ }).click()
  const entries = dialog(page, "Salary")
  await entries.getByRole("button", { name: "Void" }).click()
  await entries.getByLabel("Reason").fill("Entered twice")
  await shots(page, "05-void-confirm")
  await entries.getByRole("button", { name: "Void income" }).click()
  await expect(toast(page, "Income voided.")).toBeVisible()
  await expect(periodTotal(page)).toContainText("₹0")
  await expect(holding(page, "Axis Bank")).toContainText("₹1,000")

  // The source stays listed (at ₹0, marked) so the voided entry is still reachable.
  const salaryRow = incomeSourceRow(page, "Salary")
  await expect(salaryRow).toContainText("Voided entries only")
  await expect(salaryRow).toContainText("₹0")
  await salaryRow.getByRole("button", { name: /Salary/ }).click()
  await expect(dialog(page, "Salary").getByText("Voided: Entered twice")).toBeVisible()
  await page.keyboard.press("Escape")

  // Archive drops the account from list and totals; restore brings it back.
  await holding(page, "Axis Bank").getByRole("button", { name: "Actions for Axis Bank" }).click()
  await page.getByRole("menuitem", { name: "Archive" }).click()
  await dialog(page, "Archive Axis Bank?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Account archived.")).toBeVisible()
  await expect(holding(page, "Axis Bank")).toHaveCount(0)
  await expect(totalAvailable(page)).toContainText("₹0")

  await page.getByRole("button", { name: "Show archived (1)" }).click()
  await dialog(page, "Archived accounts").getByRole("button", { name: "Restore" }).click()
  await expect(toast(page, "Account restored.")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(holding(page, "Axis Bank")).toContainText("₹1,000")
})

test("'Every month' saves the income and a recurring rule; the rate comes from the rule", async ({ page }) => {
  await signUpConfirmed(page, "Steady Pay", uniqueEmail("income-repeat"))
  await page.goto("/income")
  await addBank(page, { bank: "Canara Bank", last4: "3030", opening: "0" })

  await page.getByRole("button", { name: "Record income" }).first().click()
  const d = dialog(page, "Add income")
  await expect(d.getByRole("radio", { name: "Just once" })).toBeChecked()
  await d.getByLabel("Amount").fill("50,000")
  await d.getByLabel("Category").selectOption({ label: "Salary" })
  await d.getByText("Every month", { exact: true }).click()
  await expect(d.getByRole("radio", { name: "Every month" })).toBeChecked()
  await expect(d).toContainText("Nothing is added by itself")
  await d.getByRole("button", { name: "Save income" }).click()
  await expect(toast(page, "Income saved. It repeats every month.")).toBeVisible()

  // Counted once; the rate is the rule's, shown beside the actuals.
  await expect(periodTotal(page)).toContainText("₹50,000")
  const salary = incomeSourceRow(page, "Salary")
  await expect(salary).toContainText("₹50,000 every month") // Repeats, from the rule
  await expect(salary).not.toContainText("One-off")

  // The rule is on Recurring, with this month already handled.
  await page.goto("/recurring")
  await expect(page.getByText("Salary").first()).toBeVisible()
})

test("income cannot be dated in the future", async ({ page }) => {
  await signUpConfirmed(page, "Time Keeper", uniqueEmail("income-future"))
  await page.goto("/income")
  await addBank(page, { bank: "Kotak Mahindra Bank", last4: "1111", opening: "0" })

  await page.getByRole("button", { name: "Record income" }).first().click()
  const d = dialog(page, "Add income")
  await expect(d).toBeVisible()
  await d.getByLabel("Amount").fill("100")
  await d.getByLabel("Category").selectOption({ label: "Other income" })
  await d.getByLabel("Date").fill("2999-01-01")
  await d.getByRole("button", { name: "Save income" }).click()
  await expect(d.getByText("The date can't be in the future")).toBeVisible()
  await expect(d).toBeVisible()
})

test("another user sees none of this user's accounts or income", async ({ browser, baseURL }) => {
  const newPage = async () => (await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })).newPage()
  const first = await newPage()
  await signUpConfirmed(first, "Owner", uniqueEmail("income-owner"))
  await first.goto("/income")
  await addBank(first, { bank: "Federal Bank", last4: "2222", opening: "9,999" })
  await first.close()

  const second = await newPage()
  await signUpConfirmed(second, "Stranger", uniqueEmail("income-stranger"))
  await second.goto("/income")
  await expect(second.getByText("Add your first account")).toBeVisible()
  await expect(second.getByText("Federal Bank")).toHaveCount(0)
  await second.close()
})

// ---------------------------------------------------------------- charts agree with tables

/** "₹1,28,000" / "-₹12,500" / "₹1,234.50" → minor units (exact: no floating point). */
function minor(text: string): number {
  const t = text.replace(/[^\d.\-−]/g, "").replace("−", "-")
  const [whole, frac = ""] = t.replace("-", "").split(".")
  const value = Number(whole) * 100 + Number((frac + "00").slice(0, 2))
  return t.startsWith("-") ? -value : value
}
const sumOf = async (cells: Locator) => (await cells.allTextContents()).reduce((s, t) => s + minor(t), 0)
const chart = (section: Locator) => section.getByRole("list", { name: /^(Balance by account|Income by source)$/ })
const chartAmounts = (section: Locator) => chart(section).locator("[data-bar-amount]")
const tableTotal = (section: Locator) => section.locator("tfoot [data-total]")

async function demoMoney(page: Page) {
  const lastYear = String(Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date())) - 1)
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "2,48,600" })
  // A current account overdrawn: a negative balance (bars draw left of zero).
  await addBank(page, { bank: "ICICI Bank", last4: "0934", opening: "-12,500", type: "Current account" })
  await page.getByRole("button", { name: "Add cash" }).first().click()
  await dialog(page, "Add cash").getByLabel("Amount").fill("4,250")
  await dialog(page, "Add cash").getByRole("button", { name: "Add cash" }).click()
  await addIncome(page, { amount: "1,28,000", source: "Salary", into: "HDFC Bank ··4821", note: "November salary, demo employer" })
  await addIncome(page, { amount: "32,000", source: "Rental income", into: "HDFC Bank ··4821", note: "Flat 2B rent (demo tenant)" })
  await addIncome(page, { amount: "18,500", source: "Freelance", into: "HDFC Bank ··4821", note: "Logo design for a demo client, paid by UPI" })
  await addIncome(page, { amount: "1,240", source: "Interest & dividends", into: "Cash in hand" })
  // Last year: only in All time (before the opening balance date, so not in any balance).
  await page.getByRole("button", { name: "Record income" }).first().click()
  const d = dialog(page, "Add income")
  await d.getByLabel("Amount").fill("90,000")
  await d.getByLabel("Category").selectOption({ label: "Salary" })
  await d.getByLabel("Received into").selectOption({ label: "HDFC Bank ··4821" })
  await d.getByLabel("Date").fill(`${lastYear}-06-30`)
  await d.getByRole("button", { name: "Save income" }).click()
  await expect(d).toBeHidden()
}

async function expectTotalsAgree(page: Page) {
  // Accounts: chart = table Total = Total available.
  // HDFC 2,48,600 + 1,28,000 + 32,000 + 18,500; ICICI −12,500; cash 4,250 + 1,240 → ₹4,20,090.
  const accounts = incomeAccounts(page)
  const counted = page.getByTestId("amount-total-available")
  await expect(counted).toHaveText("₹4,20,090") // after the count-up
  const available = Number(await counted.getAttribute("data-value"))
  expect(await sumOf(chartAmounts(accounts))).toBe(available)
  expect(minor((await tableTotal(accounts).textContent())!)).toBe(available)
  expect(await sumOf(accounts.locator("tbody [data-balance]"))).toBe(available)

  // Income, in each period: chart bars = table Total = the period total, and = the rows.
  const expected = { month: 1_79_740_00, year: 1_79_740_00, all: 2_69_740_00 }
  for (const [key, name] of [["month", /^This month/], ["year", /^This year/], ["all", /^All time/]] as const) {
    await period(page, name).click()
    await expect(period(page, name)).toHaveAttribute("aria-pressed", "true")
    const sources = incomeSources(page)
    await expect(periodTotal(page)).toContainText(`₹${new Intl.NumberFormat("en-IN").format(expected[key] / 100)}`)
    const total = minor((await periodTotal(page).locator("span").last().textContent())!)
    expect(total).toBe(expected[key])
    expect(await sumOf(chartAmounts(sources))).toBe(total)
    expect(minor((await tableTotal(sources).textContent())!)).toBe(total)
    expect(await sumOf(sources.locator("tbody [data-amount]"))).toBe(total)
  }
  await expect(page).toHaveURL(/\?period=all$/) // All time is rendered by the server on request
}

test.describe("charts agree with the tables", () => {
  test("at 1280px: totals, a negative balance, All time on request", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await signUpConfirmed(page, "Demo Person", uniqueEmail("income-charts"))
    await demoMoney(page)
    await expect(holding(page, "ICICI Bank ··0934")).toContainText("-₹12,500")
    await expectTotalsAgree(page)
    await period(page, /^This month/).click()
    await expect(page).toHaveURL(/\/income$/)
    await expect(page.getByTestId("amount-total-available")).toHaveText("₹4,20,090")
    await page.screenshot({ path: `${SHOTS}/income/1280-income.png`, fullPage: true })
    await period(page, /^All time/).click()
    await page.screenshot({ path: `${SHOTS}/income/1280-income-all-time.png`, fullPage: true })
  })

  test("at 360px: charts full width, tables become cards, no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await signUpConfirmed(page, "Demo Person", uniqueEmail("income-360"))
    await demoMoney(page)
    await page.goto("/income")
    await expectTotalsAgree(page)
    await period(page, /^This month/).click()

    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    expect(scroll).toBeLessThanOrEqual(client)
    for (const section of [incomeAccounts(page), incomeSources(page)]) {
      // Column headers give way to cards.
      await expect(section.locator("thead")).toBeHidden()
      // The chart spans the card's width.
      const plot = (await chart(section).boundingBox())!
      const card = (await section.boundingBox())!
      expect(plot.width).toBeGreaterThan(card.width - 2 * 24)
    }
    // Each card: name and amount on one line, inside the screen.
    for (const [row, name, amount] of [
      [holding(page, "HDFC Bank ··4821"), "HDFC Bank", "[data-balance]"],
      [incomeSourceRow(page, "Salary"), "Salary", "[data-amount]"],
    ] as const) {
      const n = (await row.getByText(name, { exact: true }).first().boundingBox())!
      const a = (await row.locator(amount).boundingBox())!
      expect(Math.abs(n.y + n.height / 2 - (a.y + a.height / 2))).toBeLessThan(12)
      expect(a.x + a.width).toBeLessThanOrEqual(360)
    }
    await expect(incomeSourceRow(page, "Salary")).toContainText("Last received")
    await expect(page.getByTestId("amount-total-available")).toHaveText("₹4,20,090")
    await page.screenshot({ path: `${SHOTS}/income/360-income.png`, fullPage: true })
  })
})
