import { type Page, expect, test } from "@playwright/test"
import { pnbStatementPages, syntheticPdf } from "../test-support/synthetic-pdf"
import { addBank, addEntry, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Refunds end to end (Sprint 9c, web), against the throwaway local Supabase: Refund this on an
// expense (part refunds, the cap on linked refunds), an unlinked refund, a category whose refunds
// are more than its spending on the Overview (bars, pie, the spending table), budgets and Reports,
// and a card statement refund linked to the purchase it reverses. Fictional people, synthetic PDFs.
// Screenshots in e2e-screenshots/.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
const HDFC = "HDFC Bank ··4821"
// formatMoney writes a minus sign (U+2212) before the currency.
const minus = (text: string) => new RegExp(`[−-]${text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`)

const panel = (page: Page, title: string) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: title, exact: true }) })
const summaryCard = (page: Page, label: string) =>
  page.getByRole("region", { name: /^Summary/ }).locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: label, exact: true }) })
const statCard = (page: Page, label: RegExp) => page.getByRole("region", { name: "Totals for these filters" }).locator("[data-slot=card]").filter({ hasText: label })

async function refundThis(page: Page, title: string, amount: string) {
  await page.getByRole("button", { name: `Refund ${title}` }).click()
  const d = dialog(page, "Refund this purchase")
  await d.getByLabel("Amount").fill(amount)
  await d.getByRole("button", { name: "Save refund" }).click()
  return d
}

test("Refund this: part refunds, the cap, an unlinked refund; a category below zero on the Overview, budgets and Reports", async ({ page }) => {
  await signUpConfirmed(page, "Kiran Das", uniqueEmail("refunds"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addEntry(page, { amount: "1,000", category: "Shopping", from: HDFC, note: "Running shoes" })
  await addEntry(page, { amount: "300", category: "Groceries", from: HDFC })

  // Refund this: starts from the purchase (account, category, amount), dated today; a part refund.
  await page.goto("/transactions")
  await page.getByRole("button", { name: "Refund Running shoes" }).click()
  const d = dialog(page, "Refund this purchase")
  await expect(d).toContainText("Refund of Running shoes")
  await expect(d.getByLabel("Category")).toHaveValue(/.+/)
  await expect(d.getByLabel("Refunded to")).toHaveValue(/.+/)
  await expect(d.getByLabel("Date")).toHaveValue(todayInIndia())
  await expect(d.getByRole("radio", { name: "Expense" })).toBeDisabled()
  await shot(page, "refunds-refund-this")
  await d.getByLabel("Amount").fill("400")
  await d.getByRole("button", { name: "Save refund" }).click()
  await expect(toast(page, "Refund saved.")).toBeVisible()
  await expect(d).toBeHidden()

  // A second part refund over what is left: refused with what is left, the input kept.
  const again = await refundThis(page, "Running shoes", "700")
  await expect(again).toContainText("Only ₹600 is left to refund on this purchase.")
  await expect(again.getByLabel("Amount")).toHaveValue("700")
  await again.getByLabel("Amount").fill("600")
  await again.getByRole("button", { name: "Save refund" }).click()
  await expect(toast(page, "Refund saved.").first()).toBeVisible()
  await expect(again).toBeHidden()

  // Fully refunded now: one more rupee is refused.
  const more = await refundThis(page, "Running shoes", "1")
  await expect(more).toContainText("This purchase is already fully refunded.")
  await more.getByRole("button", { name: "Cancel" }).click()

  // Spending nets the refunds: 1,000 + 300 − 1,000.
  await expect(statCard(page, /^Expenses/)).toContainText("₹300")
  await expect(statCard(page, /^Expenses/)).toContainText("2 expenses, less ₹1,000 in 2 refunds")
  await page.getByRole("navigation", { name: "Type" }).getByRole("link", { name: "Refunds" }).click()
  await expect(page).toHaveURL(/type=refund/)
  await expect(page.getByRole("main").getByText("Refund · Shopping")).toHaveCount(2)

  // An unlinked refund, from the add form (a fresh page: no earlier toasts): Shopping is now 1,000 − 1,000 − 500 = −500 this month.
  await page.goto("/transactions")
  await addEntry(page, { type: "Refund", amount: "500", category: "Shopping", from: HDFC, note: "Store credit" })

  // Overview: Spent this month −200 (1,300 − 1,500), Shopping listed apart from the shares, charts still draw.
  await page.goto("/")
  await expect(summaryCard(page, "Spent this month")).toContainText(minus("₹200"))
  await expect(summaryCard(page, "Spent this month")).toContainText("2 expenses, less ₹1,500 refunded")
  const categories = panel(page, "Spending by category")
  await expect(categories).toContainText("Groceries")
  await expect(categories).toContainText(/Refunds were more than the spending in Shopping \([−-]₹500\), so it isn’t in the shares above\./)
  await expect(categories.getByRole("list", { name: "Categories" }).getByRole("listitem")).toHaveCount(1)
  await page.getByRole("navigation", { name: "Chart type for Spending by category" }).getByRole("link", { name: "Pie" }).click()
  await expect(page).toHaveURL(/categories=pie/)
  await expect(categories.getByRole("img", { name: /^Spending by category: Groceries ₹300/ })).toBeVisible()
  await expect(categories).toContainText("Refunds were more than the spending in Shopping")
  const spending = panel(page, "Spending overview")
  await expect(spending).not.toContainText("No spending recorded")
  await spending.getByText("Show as a table").click()
  await expect(spending.getByRole("table")).toContainText(minus("₹200"))
  await page.getByRole("navigation", { name: "Chart type for Spending overview" }).getByRole("link", { name: "Line" }).click()
  await expect(spending.getByRole("img")).toBeVisible()
  await shot(page, "refunds-overview-below-zero")

  // Budgets: Shopping's net below zero counts as nothing spent, never a negative share.
  await page.goto("/goals")
  const budgets = page.getByRole("region", { name: "Monthly budgets" })
  await budgets.getByRole("button", { name: "Set a budget" }).click()
  const b = dialog(page, "Set a budget")
  await b.getByLabel("Category").selectOption({ label: "Shopping" })
  await b.getByLabel("Monthly budget").fill("500")
  await b.getByRole("button", { name: "Save budget" }).click()
  await expect(toast(page, "Budget saved.")).toBeVisible()
  await expect(budgets).toContainText("₹0 / ₹500")
  await expect(budgets.getByRole("progressbar", { name: "Shopping: 0% of budget used" })).toBeVisible()
  await shot(page, "refunds-budget")

  // Reports: the month's expenses are −200; the top categories leave Shopping out (no negative share).
  await page.goto("/reports")
  const cashFlow = panel(page, "Cash flow")
  await expect(cashFlow).toContainText(minus("₹200"))
  await expect(cashFlow.getByRole("list", { name: "Top categories for the range" })).toContainText("Groceries")
  await expect(cashFlow.getByRole("list", { name: "Top categories for the range" })).not.toContainText("Shopping")
  await expect(page.getByText("We couldn't load")).toHaveCount(0)

  // The account: 10,000 − 1,300 + 1,500 (refunds are inflows).
  await page.goto("/income")
  await expect(page.locator("[data-slot=card]").filter({ has: page.getByText("Where your money is", { exact: true }) })).toContainText("₹10,200")
})

// ------------------------------------------------------------ a card statement refund

const box = (page: Page) => page.getByRole("region", { name: "Short-term & operational liabilities" })
const pdf = (name: string, bytes: Uint8Array) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(bytes) })
const PNB_CARD = "Punjab National Bank Rupay Select"
const review = (page: Page) => page.getByRole("region", { name: "Review the statement" })
const lineFor = (page: Page, text: string) => review(page).getByRole("list", { name: "Statement lines" }).getByRole("listitem").filter({ hasText: new RegExp(`^${text}`) })
const cardRow = (page: Page) => box(page).getByRole("listitem").filter({ hasText: PNB_CARD }).first()

async function importStatement(page: Page, bytes: Uint8Array) {
  await page.goto("/loans-liabilities")
  await box(page).getByRole("link", { name: `Import a statement PDF for ${PNB_CARD}` }).click()
  await page.getByLabel(/statement \(PDF\)$/).setInputFiles(pdf("statement.pdf", bytes))
  await expect(review(page)).toBeVisible()
}

test("a card statement refund: linked to the purchase it reverses, taken off what the card owes", async ({ page }) => {
  const today = todayInIndia()
  await signUpConfirmed(page, "Meera Pillai", uniqueEmail("refunds-card"))
  await page.goto("/loans-liabilities")
  await box(page).getByRole("button", { name: "Add card" }).click()
  const add = dialog(page, "Add card")
  await add.getByLabel("Card issuer").selectOption("Punjab National Bank")
  await add.getByLabel("Card", { exact: true }).selectOption({ label: "Other" })
  await add.getByLabel("Card name").fill("Rupay Select")
  await add.getByLabel("Credit limit (₹)").fill("50,000")
  await add.getByLabel("Statement day").fill(String(Number(today.slice(8, 10))))
  await add.getByLabel("Due day").fill("28")
  await add.getByLabel("Owed now (₹)").fill("1,500")
  await add.getByRole("button", { name: "Add card" }).click()
  await expect(toast(page, "Card added.").first()).toBeVisible()

  // The purchases first (₹1,500 owed + ₹2,334).
  await importStatement(page, syntheticPdf(pnbStatementPages(false, { invoiceDate: today, lineDate: today })))
  await review(page).getByRole("button", { name: "Save ticked lines" }).click()
  await dialog(page, "Save these purchases?").getByRole("button", { name: "Save 3 lines" }).click()
  await expect(review(page)).toContainText("3 lines saved.")

  // The same statement with a ₹1,784 refund: the purchases are Already imported; the refund is
  // linked to FRESH BASKET (exactly that much left), takes its category and starts ticked.
  await importStatement(page, syntheticPdf(pnbStatementPages(false, { invoiceDate: today, lineDate: today, refundMinor: 178_400 })))
  await expect(lineFor(page, "FRESH BASKET")).toContainText("Already imported")
  const refund = lineFor(page, "REFUND FRESH BASKET STORES")
  await expect(refund).toContainText("Refund")
  await expect(refund.getByRole("checkbox")).toBeChecked()
  await expect(refund.getByRole("combobox", { name: /^Refund of, for / })).toHaveValue(/.+/)
  await expect(refund.getByRole("combobox", { name: /^Refund of, for / }).locator("option:checked")).toContainText("FRESH BASKET STORES BENGAL")
  await expect(refund.getByRole("combobox", { name: /^Category for / })).toHaveValue(/.+/)
  await shot(page, "refunds-card-review")
  await review(page).getByRole("button", { name: "Save ticked lines" }).click()
  const confirm = dialog(page, "Save these lines?")
  await expect(confirm).toContainText(/1 refund, [−-]₹1,784 in all\./)
  await expect(confirm).toContainText("Refunds come off what the card owes")
  await confirm.getByRole("button", { name: "Save 1 line" }).click()
  await expect(review(page)).toContainText("1 line saved.")

  // Owed: 1,500 + 2,334 − 1,784. The refund is listed as a refund, never as income.
  await page.goto("/loans-liabilities")
  await expect(cardRow(page)).toContainText("₹2,050")
  await page.goto("/transactions?type=refund")
  await expect(page.getByRole("main")).toContainText("REFUND FRESH BASKET STORES")
  await expect(page.getByRole("main")).toContainText("Refund · Other expenses")

  // A second import: the refund is Already imported too.
  await importStatement(page, syntheticPdf(pnbStatementPages(false, { invoiceDate: today, lineDate: today, refundMinor: 178_400 })))
  await expect(lineFor(page, "REFUND FRESH BASKET STORES")).toContainText("Already imported")
})
