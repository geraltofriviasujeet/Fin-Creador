import { type Page, expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { PASSWORD, addBank, addCash, addEntry, dialog, incomeAccountRow, incomeSources, signUpConfirmed, textWhenDialogCloses, toast, uniqueEmail } from "./helpers"

// Transactions page end to end, against the throwaway local Supabase. One user per test.
// Screenshots (final real-data pages only) go to e2e-screenshots/ for visual review.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

const totals = (page: Page) => page.getByRole("region", { name: "Totals for these filters" })
// By the card's label ("Income · This month"), not text elsewhere in a card ("No income…").
const stat = (page: Page, label: string) => totals(page).locator("[data-slot=card]").filter({ hasText: new RegExp(`^${label}`) })
const row = (page: Page, text: string) => page.locator("main li").filter({ hasText: text })
const holding = (page: Page, label: string) => incomeAccountRow(page, label)

async function newUserWithBank(page: Page, label: string, opening = "10,000") {
  await signUpConfirmed(page, "Test Person", uniqueEmail(label))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening })
  await page.goto("/transactions")
}

test("expenses and transfers: validation, totals and balances follow the money rules", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("tx-flow"))
  await page.goto("/transactions")
  await expect(page.getByText("Nothing recorded yet")).toBeVisible()
  await expect(page.getByRole("link", { name: "Go to Income" })).toBeVisible()

  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addCash(page, "500")

  // The topbar's Add expense is a real link to the add dialog.
  await page.getByRole("link", { name: "Add expense" }).first().click()
  const d = dialog(page, "Add expense")
  await expect(d).toBeVisible()
  // The ?add= deep link is read once and then dropped from the URL.
  await expect(page).toHaveURL(/\/transactions$/)
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
  // When the dialog closes the page already shows the edit.
  const editedOnClose = await textWhenDialogCloses(page, edit)
  await edit.getByRole("button", { name: "Save changes" }).click()
  const edited = await editedOnClose()
  expect(edited).toContain("Edited")
  expect(edited).toContain("₹300")
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
  const voidedOnClose = await textWhenDialogCloses(page, voiding)
  await voiding.getByRole("button", { name: "Void expense" }).click()
  expect(await voidedOnClose()).not.toContain("Weekly veg") // gone from the list as it closes
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
  await page.getByRole("link", { name: "Add expense" }).first().click()
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
  await addEntry(page, { amount: "400", category: "Transport & Cabs", from: "HDFC Bank ··4821", note: "Bus pass" })

  const search = page.getByRole("searchbox", { name: "Search" }).last()
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
  await page.getByLabel("Category").selectOption({ label: "Transport & Cabs" })
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
  const sources = incomeSources(page)
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

test("the topbar: Add expense first, then a menu for income, transfer and refund", async ({ page }) => {
  await newUserWithBank(page, "tx-menu")
  await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible()
  for (const [item, type] of [["Add income", "income"], ["Transfer", "transfer"], ["Refund", "refund"]] as const) {
    await page.getByRole("button", { name: "More ways to add" }).click()
    await page.getByRole("menuitem", { name: item }).click()
    await expect(dialog(page, `Add ${type}`)).toBeVisible()
    await expect(page).not.toHaveURL(/add=/)
    await page.keyboard.press("Escape")
  }
  // Only income and expenses can repeat from the add form.
  await page.getByRole("link", { name: "Add expense" }).first().click()
  await expect(dialog(page, "Add expense").getByText("Repeat this?")).toBeVisible()
  await dialog(page, "Add expense").getByRole("radio", { name: "Transfer" }).click()
  await expect(dialog(page, "Add transfer").getByText("Repeat this?")).toHaveCount(0)
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
  await expect(second.getByText("Nothing recorded yet")).toBeVisible()
  await expect(second.getByText("Private rent")).toHaveCount(0)
  await second.close()
})

// Sprint 12a-1 bug: switching the Add dialog's type wrote ?add=income to the URL; the Income
// page (kept mounted in the background by the router) read it and, after a void refreshed the
// page, showed an Add income dialog nobody opened. ?add= is consumed once and never re-triggers.
// Any Add dialog (Add expense/income/transfer/refund, Add bank account); toasts are dialogs too.
const addDialogs = (page: Page) => page.getByRole("dialog", { name: /^Add / })

test("?add= deep links are consumed once: a type switch and a void never open Add income elsewhere", async ({ page }) => {
  await newUserWithBank(page, "tx-add-once")
  await addEntry(page, { amount: "250", category: "Groceries", from: "HDFC Bank ··4821", note: "Weekly veg" })

  // Open Add expense, switch the type to Income, close it.
  await page.getByRole("link", { name: "Add expense" }).first().click()
  await dialog(page, "Add expense").getByRole("radio", { name: "Income" }).click()
  await expect(dialog(page, "Add income")).toBeVisible()
  await expect(page).not.toHaveURL(/add=/)
  await page.keyboard.press("Escape")
  await expect(dialog(page, "Add income")).toBeHidden()

  // Void an entry (a server refresh), then open Income from the menu.
  await page.getByRole("button", { name: "Void Weekly veg" }).click()
  await dialog(page, "Void this expense?").getByRole("button", { name: "Void expense" }).click()
  await expect(toast(page, "Expense voided.")).toBeVisible()
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Income", exact: true }).first().click()
  await expect(page.getByRole("heading", { level: 1, name: "Income" })).toBeVisible()
  await expect(addDialogs(page)).toHaveCount(0)

  // Back to Transactions from the menu: the Add dialog doesn't come back from the router cache.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Transactions", exact: true }).first().click()
  await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible()
  await expect(addDialogs(page)).toHaveCount(0)

  // A deep link still opens once, then leaves the URL; going away and back doesn't reopen it.
  await page.getByRole("button", { name: "More ways to add" }).click()
  await page.getByRole("menuitem", { name: "Add income" }).click()
  await expect(dialog(page, "Add income")).toBeVisible()
  await expect(page).not.toHaveURL(/add=/)
  await page.keyboard.press("Escape")
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Income", exact: true }).first().click()
  await expect(page.getByRole("heading", { level: 1, name: "Income" })).toBeVisible()
  await expect(addDialogs(page)).toHaveCount(0)
  await page.goBack()
  await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible()
  await expect(addDialogs(page)).toHaveCount(0)
})

// 12a-3: a search opens the results view: a header with the count and Clear search, no Upcoming
// card, the filters folded away, and All time unless another period is picked. Totals cover the
// matching entries only. Clearing the search gives the normal page back.
test("search results view: from the top bar and the search box, all time, totals of the matches only, Clear search", async ({ page }) => {
  const email = uniqueEmail("tx-search")
  await signUpConfirmed(page, "Test Person", email)
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000", asOf: "2025-01-01" })
  await addEntry(page, { amount: "400", category: "Groceries", from: "HDFC Bank ··4821", note: "Groceries run" })
  await addEntry(page, { amount: "90", category: "Food & dining", from: "HDFC Bank ··4821", note: "Tea" })
  // A matching entry from last year, outside This month.
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  expect((await supabase.auth.signInWithPassword({ email, password: PASSWORD })).error).toBeNull()
  const account = await supabase.from("accounts").select("id").eq("kind", "bank").single()
  const groceries = await supabase.from("categories").select("id").eq("kind", "expense").eq("name", "Groceries").single()
  expect(account.error ?? groceries.error).toBeNull()
  const old = await supabase.rpc("record_transaction", {
    p_type: "expense",
    p_idempotency_key: crypto.randomUUID(),
    p_amount_minor: 250_00,
    p_occurred_on: "2025-06-10",
    p_account_id: account.data!.id,
    p_category_id: groceries.data!.id,
    p_note: "Old groceries",
  })
  expect(old.error).toBeNull()

  await page.goto("/transactions")
  const upcomingBefore = await page.getByRole("heading", { name: "Upcoming", exact: true }).count()
  const results = page.getByRole("region", { name: /results? for “groceries”$/ })

  // From the top bar.
  await page.getByRole("banner").getByRole("searchbox").fill("groceries")
  await page.getByRole("banner").getByRole("searchbox").press("Enter")
  await expect(page).toHaveURL(/\/transactions\?q=groceries$/)
  await expect(results.getByRole("heading", { name: "2 results for “groceries”" })).toBeVisible()
  await expect(results).toContainText("All time")
  await expect(page.getByRole("heading", { name: "Upcoming", exact: true })).toHaveCount(0)
  await expect(row(page, "Old groceries")).toBeVisible()
  await expect(row(page, "Groceries run")).toBeVisible()
  await expect(row(page, "Tea")).toHaveCount(0)
  // Totals: the two matches only (₹400 + ₹250), not the ₹90 tea.
  await expect(stat(page, "Expenses")).toContainText("₹650")
  await expect(page.getByText("Totals cover only the entries matching “groceries”.", { exact: false })).toBeVisible()
  // The results header is at the top of the page content, in view.
  await expect(results).toBeInViewport()
  await shot(page, "tx-search-results")

  // The filters open on request and still narrow it.
  await expect(page.getByLabel("Date", { exact: true })).toBeHidden()
  await results.getByRole("button", { name: "Filters" }).click()
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("all-time")
  await page.getByLabel("Date", { exact: true }).selectOption("this-month")
  await expect(page).toHaveURL(/period=this-month/)
  await expect(results.getByRole("heading", { name: "1 result for “groceries”" })).toBeVisible()
  await expect(stat(page, "Expenses")).toContainText("₹400")

  // Clear search: the normal page again.
  await results.getByRole("link", { name: "Clear search" }).click()
  await expect(page).toHaveURL(/\/transactions$/)
  await expect(page.getByRole("region", { name: /results? for/ })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Upcoming", exact: true })).toHaveCount(upcomingBefore)
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("this-month")
  await expect(row(page, "Tea")).toBeVisible()

  // From the Transactions search box: the same view, All time.
  await page.getByRole("main").getByRole("searchbox").fill("groceries")
  await page.getByRole("main").getByRole("button", { name: "Search", exact: true }).click()
  await expect(results.getByRole("heading", { name: "2 results for “groceries”" })).toBeVisible()
  await expect(page).toHaveURL(/\/transactions\?q=groceries$/)
})

// 12a-3 bug: an edited purchase has four actions (Edit, Void, Refund, History); they spilled out
// of their column over the amount, so the amount looked doubled and Edit seemed to vanish.
test("an edited entry shows one amount and every action, none over the amount", async ({ page }) => {
  await newUserWithBank(page, "tx-edited-row")
  await addEntry(page, { amount: "250", category: "Groceries", from: "HDFC Bank ··4821", note: "Weekly veg" })
  await page.getByRole("button", { name: "Edit Weekly veg" }).click()
  const edit = dialog(page, "Edit expense")
  await edit.getByLabel("Amount").fill("300")
  await edit.getByRole("button", { name: "Save changes" }).click()
  await expect(edit).toBeHidden()

  const entry = row(page, "Weekly veg")
  await expect(entry).toContainText("Edited")
  const amount = entry.getByTestId("entry-amount")
  await expect(amount).toHaveText(/^[−-]₹300(\.00)?$/)
  await expect(entry).not.toContainText("₹250")
  const amountBox = (await amount.boundingBox())!
  for (const name of ["Edit Weekly veg", "Void Weekly veg", "Refund Weekly veg", "History of Weekly veg"]) {
    const button = entry.getByRole("button", { name, exact: true })
    await expect(button).toBeVisible()
    const box = (await button.boundingBox())!
    expect(box.x, `${name} starts after the amount`).toBeGreaterThanOrEqual(amountBox.x + amountBox.width)
  }
  // The actions line up with an unedited row's.
  await addEntry(page, { amount: "80", category: "Groceries", from: "HDFC Bank ··4821", note: "Milk" })
  const editX = async (note: string) => (await row(page, note).getByRole("button", { name: `Edit ${note}`, exact: true }).boundingBox())!.x
  expect(await editX("Milk")).toBe(await editX("Weekly veg"))
  await shot(page, "tx-edited-row")
})
