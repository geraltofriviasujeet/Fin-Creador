import { type Page, expect, test } from "@playwright/test"
import { addBank, addCash, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Transactions page end to end, against the throwaway local Supabase. One user per test.
// Screenshots (final real-data pages only) go to e2e-screenshots/ for visual review.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

const totals = (page: Page) => page.getByRole("region", { name: "Totals for these filters" })
const stat = (page: Page, label: string) => totals(page).locator("[data-slot=card]").filter({ hasText: label })
const row = (page: Page, text: string) => page.locator("main li").filter({ hasText: text })
const holding = (page: Page, label: string) =>
  page.locator("[data-slot=card]").filter({ has: page.getByText("Where your money is", { exact: true }) }).getByRole("listitem").filter({ hasText: label })

type Entry = { type?: "Expense" | "Income" | "Transfer"; amount: string; category?: string; from: string; to?: string; note?: string; mode?: string }

/** Opens Add transaction from the topbar and saves one entry. */
async function addEntry(page: Page, e: Entry) {
  await page.getByRole("link", { name: "Add transaction" }).first().click()
  await expect(dialog(page, "Add expense")).toBeVisible()
  const type = e.type ?? "Expense"
  if (type !== "Expense") await dialog(page, "Add expense").getByRole("radio", { name: type }).click()
  const d = dialog(page, `Add ${type.toLowerCase()}`)
  await d.getByLabel("Amount").fill(e.amount)
  if (type === "Transfer") {
    await d.getByLabel("From").selectOption({ label: e.from })
    await d.getByLabel("To").selectOption({ label: e.to! })
  } else {
    await d.getByLabel(type === "Income" ? "Source" : "Category").selectOption({ label: e.category! })
    await d.getByLabel(type === "Income" ? "Received into" : "Paid from").selectOption({ label: e.from })
  }
  if (e.mode) await d.getByLabel("Payment mode (optional)").selectOption({ label: e.mode })
  if (e.note) await d.getByLabel("Note").fill(e.note)
  await d.getByRole("button", { name: `Save ${type.toLowerCase()}` }).click()
  await expect(toast(page, `${type} saved.`)).toBeVisible()
  await expect(d).toBeHidden()
}

async function newUserWithBank(page: Page, label: string, opening = "10,000") {
  await signUpConfirmed(page, "Test Person", uniqueEmail(label))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening })
  await page.goto("/transactions")
}

test("expenses and transfers: validation, totals and balances follow the money rules", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("tx-flow"))
  await page.goto("/transactions")
  await expect(page.getByText("No transactions yet")).toBeVisible()
  await expect(page.getByRole("link", { name: "Go to Income" })).toBeVisible()

  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addCash(page, "500")

  // The topbar's Add transaction is a real link to Add expense.
  await page.getByRole("link", { name: "Add transaction" }).first().click()
  await expect(page).toHaveURL(/\/transactions\?add=expense/)
  const d = dialog(page, "Add expense")
  await d.getByLabel("Amount").fill("250")
  await d.getByRole("button", { name: "Save expense" }).click()
  await expect(d.locator("#categoryId-error")).toHaveText("Choose a category")
  await expect(d.getByLabel("Amount")).toHaveValue("250") // kept after the error
  await d.getByLabel("Category").selectOption({ label: "Food & dining" })
  await d.getByLabel("Paid from").selectOption({ label: "HDFC Bank ··4821" })
  await d.getByLabel("Payment mode (optional)").selectOption({ label: "UPI" })
  await d.getByLabel("Note").fill("Lunch")
  await expect(d.getByText("₹10,000 → ₹9,750")).toBeVisible()
  await shot(page, "tx-add")
  await d.getByRole("button", { name: "Save expense" }).click()
  await expect(toast(page, "Expense saved.")).toBeVisible()
  await expect(row(page, "Lunch")).toContainText("UPI · HDFC Bank ··4821")
  await expect(stat(page, "Expenses")).toContainText("₹250")

  await addEntry(page, { type: "Transfer", amount: "1,000", from: "HDFC Bank ··4821", to: "Cash in hand", note: "ATM withdrawal" })
  await expect(row(page, "ATM withdrawal")).toContainText("HDFC Bank ··4821 → Cash in hand")
  // A transfer is neither income nor an expense.
  await expect(stat(page, "Income")).toContainText("₹0")
  await expect(stat(page, "Expenses")).toContainText("₹250")
  await expect(page.getByText("Transfers between your accounts (1)")).toBeVisible()
  await shot(page, "tx-list")

  // ...but it moves both balances.
  await page.goto("/income")
  await expect(holding(page, "HDFC Bank ··4821")).toContainText("₹8,750")
  await expect(holding(page, "Cash in hand")).toContainText("₹1,500")

  // The phone layout of the Add sheet.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/transactions?add=expense")
  await expect(dialog(page, "Add expense")).toBeVisible()
  await shot(page, "tx-add-phone")
})

test("edit keeps the history; void stops counting and stays visible on request", async ({ page }) => {
  await newUserWithBank(page, "tx-edit")
  await addEntry(page, { amount: "250", category: "Groceries", from: "HDFC Bank ··4821", note: "Weekly veg" })

  await page.getByRole("button", { name: "Edit Weekly veg" }).click()
  const edit = dialog(page, "Edit expense")
  await edit.getByRole("button", { name: "Save changes" }).click()
  await expect(edit.getByText("Nothing has changed yet.")).toBeVisible()
  await edit.getByLabel("Amount").fill("300")
  await edit.getByRole("button", { name: "Save changes" }).click()
  await expect(toast(page, "Changes saved.")).toBeVisible()
  await expect(row(page, "Weekly veg")).toContainText("Edited")
  await expect(row(page, "Weekly veg")).toHaveCount(1)
  await expect(stat(page, "Expenses")).toContainText("₹300")

  await page.getByRole("button", { name: "History of Weekly veg" }).click()
  const history = dialog(page, "Weekly veg")
  await expect(history.getByText("Version 2")).toBeVisible()
  await expect(history.getByText("Current")).toBeVisible()
  await expect(history.getByText("Replaced by an edit")).toBeVisible()
  await expect(history.getByText("Amount:")).toBeVisible()
  await shot(page, "tx-edit-history")
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Void Weekly veg" }).click()
  const voiding = dialog(page, "Void this expense?")
  await voiding.getByLabel("Reason (optional)").fill("Entered twice")
  await shot(page, "tx-void")
  await voiding.getByRole("button", { name: "Void expense" }).click()
  await expect(toast(page, "Expense voided.")).toBeVisible()
  await expect(row(page, "Weekly veg")).toHaveCount(0)
  await expect(stat(page, "Expenses")).toContainText("₹0")

  await page.getByLabel("Show voided entries").check()
  await expect(row(page, "Weekly veg")).toContainText("Reason: Entered twice")
  await expect(row(page, "Weekly veg").getByRole("button", { name: "Edit Weekly veg" })).toHaveCount(0)
  await expect(stat(page, "Expenses")).toContainText("₹0")
})

test("a double-submitted entry is saved once, and a stale edit is refused", async ({ page, context }) => {
  await newUserWithBank(page, "tx-double")
  await page.getByRole("link", { name: "Add transaction" }).first().click()
  const d = dialog(page, "Add expense")
  await d.getByLabel("Amount").fill("80")
  await d.getByLabel("Category").selectOption({ label: "Food & dining" })
  await d.getByLabel("Paid from").selectOption({ label: "HDFC Bank ··4821" })
  await d.getByLabel("Note").fill("Coffee")
  // Two submissions of the same form (same request key), as a double click or a retry would send.
  await d.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit()
    form.requestSubmit()
  })
  await expect(d).toBeHidden()
  await page.reload()
  await expect(row(page, "Coffee")).toHaveCount(1)
  await expect(stat(page, "Expenses")).toContainText("₹80")

  // A second tab still shows the first version; editing it there after this tab saved fails.
  const other = await context.newPage()
  await other.goto("/transactions")
  await other.getByRole("button", { name: "Edit Coffee" }).click()

  await page.getByRole("button", { name: "Edit Coffee" }).click()
  await dialog(page, "Edit expense").getByLabel("Amount").fill("90")
  await dialog(page, "Edit expense").getByRole("button", { name: "Save changes" }).click()
  await expect(toast(page, "Changes saved.")).toBeVisible()

  const stale = dialog(other, "Edit expense")
  await stale.getByLabel("Amount").fill("95")
  await stale.getByRole("button", { name: "Save changes" }).click()
  await expect(stale.getByText("This entry was changed elsewhere. Reload to see the latest version.")).toBeVisible()
  await other.close()

  await page.reload()
  await expect(stat(page, "Expenses")).toContainText("₹90")
})

test("search treats symbols as text; filters narrow the list and the totals", async ({ page }) => {
  await newUserWithBank(page, "tx-search")
  await addEntry(page, { amount: "1,200", category: "Shopping", from: "HDFC Bank ··4821", note: "Shoes 50% off" })
  await addEntry(page, { amount: "400", category: "Transport", from: "HDFC Bank ··4821", note: "Bus pass" })

  const search = page.getByRole("searchbox", { name: "Search transactions" }).last()
  await search.fill("%")
  await search.press("Enter")
  await expect(page).toHaveURL(/q=%25/)
  await expect(row(page, "Shoes 50% off")).toBeVisible()
  await expect(row(page, "Bus pass")).toHaveCount(0)
  await expect(stat(page, "Expenses")).toContainText("₹1,200")

  await search.fill("400")
  await search.press("Enter")
  await expect(row(page, "Bus pass")).toBeVisible()
  await expect(row(page, "Shoes 50% off")).toHaveCount(0)

  await page.getByRole("button", { name: "Clear search" }).click()
  await page.getByLabel("Category").selectOption({ label: "Transport" })
  await expect(row(page, "Shoes 50% off")).toHaveCount(0)
  await expect(stat(page, "Expenses")).toContainText("₹400")
  await page.getByRole("link", { name: "Clear filters" }).first().click()
  await expect(row(page, "Shoes 50% off")).toBeVisible()
  await expect(row(page, "Bus pass")).toBeVisible()
  await expect(stat(page, "Expenses")).toContainText("₹1,600")
})

test("income is edited from the Income page, once, with its history", async ({ page }) => {
  await newUserWithBank(page, "tx-income", "0")
  await addEntry(page, { type: "Income", amount: "50,000", category: "Salary", from: "HDFC Bank ··4821" })

  await page.goto("/income")
  const sources = page.locator("[data-slot=card]").filter({ has: page.getByText("Income sources", { exact: true }) })
  await sources.getByRole("button", { name: /Salary/ }).click()
  await dialog(page, "Salary").getByRole("link", { name: "Edit" }).click()
  await expect(page).toHaveURL(/\/transactions\?edit=/)
  const edit = dialog(page, "Edit income")
  await edit.getByLabel("Amount").fill("52,000")
  await edit.getByRole("button", { name: "Save changes" }).click()
  await expect(toast(page, "Changes saved.")).toBeVisible()

  await page.goto("/income")
  await expect(holding(page, "HDFC Bank ··4821")).toContainText("₹52,000") // replaced, not added
  await sources.getByRole("button", { name: /Salary/ }).click()
  const entries = dialog(page, "Salary")
  await expect(entries.getByText("Edited")).toHaveCount(1)
  await entries.getByRole("link", { name: "History" }).click()
  await expect(dialog(page, "Salary").getByText("Version 2")).toBeVisible()
})

test("the removed prototype is not in the production build", async ({ page }) => {
  await page.goto("/dev/transactions")
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdev%2Ftransactions/) // no sign-in exception
  await signUpConfirmed(page, "Prod Check", uniqueEmail("tx-prod"))
  const response = await page.goto("/dev/transactions")
  expect(response?.status()).toBe(404)
})

test("another user sees none of this user's entries", async ({ browser, baseURL }) => {
  const newPage = async () => (await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })).newPage()
  const first = await newPage()
  await newUserWithBank(first, "tx-owner")
  await addEntry(first, { amount: "9,999", category: "Rent & housing", from: "HDFC Bank ··4821", note: "Private rent" })
  await first.close()

  const second = await newPage()
  await signUpConfirmed(second, "Stranger", uniqueEmail("tx-stranger"))
  await second.goto("/transactions?q=Private")
  await expect(second.getByText("No transactions yet")).toBeVisible()
  await expect(second.getByText("Private rent")).toHaveCount(0)
  await second.close()
})
