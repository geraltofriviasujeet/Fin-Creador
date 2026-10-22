import { type Locator, type Page, expect, test } from "@playwright/test"
import { signUpConfirmed, uniqueEmail } from "./helpers"

// Income page end to end, against the throwaway local Supabase. One user per test.
// Screenshots go to e2e-screenshots/ (uploaded by CI for visual review).

const SHOTS = "e2e-screenshots"

const card = (page: Page, label: string) => page.locator("[data-slot=card]").filter({ has: page.getByText(label, { exact: true }) })
const dialog = (page: Page, title: string) => page.getByRole("dialog", { name: title })
const toast = (page: Page, text: string) => page.getByRole("region", { name: "Notifications" }).getByText(text)
const holding = (page: Page, label: string) => card(page, "Where your money is").getByRole("listitem").filter({ hasText: label })

async function shots(page: Page, name: string) {
  for (const [label, width] of [["desktop", 1440], ["tablet", 900], ["phone", 390]] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: `${SHOTS}/${name}-${label}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

async function addBank(page: Page, { bank, last4, opening, type = "Savings account" }: { bank: string; last4: string; opening: string; type?: string }) {
  await page.getByRole("button", { name: "Add bank account" }).first().click()
  const d = dialog(page, "Add bank account")
  await d.getByLabel("Bank name").selectOption(bank)
  await d.getByLabel("Account type").selectOption({ label: type })
  await d.getByLabel("Last 4 digits").fill(last4)
  await d.getByLabel("Opening balance").fill(opening)
  await d.getByRole("button", { name: "Add account" }).click()
  await expect(toast(page, "Account added.")).toBeVisible()
  await expect(d).toBeHidden()
}

async function addIncome(page: Page, { amount, source, into, note }: { amount: string; source: string; into: string; note?: string }) {
  await page.getByRole("button", { name: "Add income" }).first().click()
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

  await expectCard(card(page, "Income this month"), "₹0")
  await expectCard(card(page, "Bank accounts"), "0", "None added yet")
  await expect(page.getByText("No income recorded yet")).toBeVisible()
  await expect(page.getByText("Add your first account")).toBeVisible()
  await expectCard(card(page, "Where your money is"), "Total available", "₹0")
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
  await expect(bankDialog.getByText("Select your bank")).toBeVisible()
  await shots(page, "02-add-bank-validation")
  await page.keyboard.press("Escape")

  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "2,48,600" })
  await addBank(page, { bank: "ICICI Bank", last4: "0934", opening: "1,76,250", type: "Current account" })
  await expectCard(card(page, "Bank accounts"), "2", "1 savings · 1 current")
  await expectCard(card(page, "Money in banks"), "₹4,24,850", "Across 2 bank accounts")

  // First cash account is pre-filled "Cash in hand"; cash can't start below zero.
  await page.getByRole("button", { name: "Add cash" }).first().click()
  const cashDialog = dialog(page, "Add cash")
  await expect(cashDialog.getByLabel("Name")).toHaveValue("Cash in hand")
  await cashDialog.getByLabel("Opening balance").fill("-5")
  await cashDialog.getByRole("button", { name: "Add account" }).click()
  await expect(cashDialog.getByText("Only bank accounts can start below zero")).toBeVisible()
  await cashDialog.getByLabel("Opening balance").fill("20,800")
  await cashDialog.getByRole("button", { name: "Add account" }).click()
  await expect(cashDialog).toBeHidden()
  await expectCard(card(page, "Cash in hand"), "₹20,800")
  await expectCard(card(page, "Where your money is"), "₹4,45,650")

  // Income: period income and balances move together; period income stays separate.
  await addIncome(page, { amount: "1,28,000", source: "Salary", into: "HDFC Bank ··4821", note: "October salary" })
  await expect(toast(page, "Income saved.")).toBeVisible()
  await addIncome(page, { amount: "32,000", source: "Rental income", into: "ICICI Bank ··0934" })
  await expectCard(card(page, "Income this month"), "₹1,60,000")
  await expectCard(card(page, "Income this year"), "₹1,60,000", "January – December")
  await expectCard(card(page, "Rental income"), "₹32,000", "₹32,000 this year")
  await expect(holding(page, "HDFC Bank ··4821")).toContainText("₹3,76,600")
  await expectCard(card(page, "Where your money is"), "₹6,05,650")

  const sources = card(page, "Income sources")
  await expect(sources.getByRole("button", { name: /Salary/ })).toContainText("HDFC Bank ··4821")
  await expect(sources.getByRole("button", { name: /Rental income/ })).toContainText("₹32,000")
  // Defaults without income stay out of the list.
  await expect(sources.getByText("Business")).toHaveCount(0)
  await shots(page, "03-income-filled")

  // Add income dialog, for visual review.
  await page.getByRole("button", { name: "Add income" }).first().click()
  await shots(page, "04-add-income-dialog")
  await page.keyboard.press("Escape")
})

test("a double-submitted income is recorded once", async ({ page }) => {
  await signUpConfirmed(page, "Double Click", uniqueEmail("income-double"))
  await page.goto("/income")
  await addBank(page, { bank: "State Bank of India", last4: "6618", opening: "0" })

  await page.getByRole("button", { name: "Add income" }).first().click()
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
  await expectCard(card(page, "Income this month"), "₹5,000")
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
  await expectCard(card(page, "Income this month"), "₹2,500")

  // Void from the source's entries.
  await card(page, "Income sources").getByRole("button", { name: /Salary/ }).click()
  const entries = dialog(page, "Salary")
  await entries.getByRole("button", { name: "Void" }).click()
  await entries.getByLabel("Reason").fill("Entered twice")
  await shots(page, "05-void-confirm")
  await entries.getByRole("button", { name: "Void income" }).click()
  await expect(toast(page, "Income voided.")).toBeVisible()
  await expectCard(card(page, "Income this month"), "₹0")
  await expect(holding(page, "Axis Bank")).toContainText("₹1,000")

  // The voided entry is still in history.
  await card(page, "Income sources").getByRole("button", { name: /Salary/ }).click()
  await expect(dialog(page, "Salary").getByText("Voided: Entered twice")).toBeVisible()
  await page.keyboard.press("Escape")

  // Archive drops the account from list and totals; restore brings it back.
  await holding(page, "Axis Bank").getByRole("button", { name: "Actions for Axis Bank" }).click()
  await page.getByRole("menuitem", { name: "Archive" }).click()
  await dialog(page, "Archive Axis Bank?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Account archived.")).toBeVisible()
  await expect(holding(page, "Axis Bank")).toHaveCount(0)
  await expectCard(card(page, "Where your money is"), "₹0")

  await page.getByRole("button", { name: "Show archived (1)" }).click()
  await dialog(page, "Archived accounts").getByRole("button", { name: "Restore" }).click()
  await expect(toast(page, "Account restored.")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(holding(page, "Axis Bank")).toContainText("₹1,000")
})

test("income cannot be dated in the future, and Add transaction opens Add income", async ({ page }) => {
  await signUpConfirmed(page, "Time Keeper", uniqueEmail("income-future"))
  await page.goto("/income")
  await addBank(page, { bank: "Kotak Mahindra Bank", last4: "1111", opening: "0" })

  await page.getByRole("link", { name: "Add transaction" }).first().click()
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
