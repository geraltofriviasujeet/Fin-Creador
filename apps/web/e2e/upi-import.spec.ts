import { type Page, expect, test } from "@playwright/test"
import { syntheticPdf } from "../test-support/synthetic-pdf"
import { type PaytmPayment, paytmDefaultPayments, paytmPages } from "../test-support/synthetic-upi"
import { addBank, dialog, signUpConfirmed, uniqueEmail } from "./helpers"

// UPI app statement import (Sprint 9e, web): a synthetic Paytm statement read in the browser,
// its two bank accounts matched once, consent before payee names are first sent (the mock model
// suggests a category), saved; the same file again adds nothing; a payment within a day of an
// existing entry waits in the duplicates dialog. Never a real statement; the model is the mock.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
const pdf = (name: string, bytes: Uint8Array) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(bytes) })

const withKitchen: PaytmPayment[] = [
  ...paytmDefaultPayments(),
  { day: "17 Oct", type: "Paid to", name: "Blue Kitchen", amount: "Rs.120", sign: "-", tag: "Miscellaneous", ref: "612345678906", account: ["Example Bank - 34"] },
]
const statement = pdf("paytm.pdf", syntheticPdf(paytmPages({ payments: withKitchen })))
// Another statement: one payment of ₹1,000 on the same account a day after the one already saved.
const later = pdf(
  "paytm-later.pdf",
  syntheticPdf(paytmPages({ payments: [{ day: "14 Oct", type: "Paid to", name: "Corner Kitchen", amount: "Rs.1,000", sign: "-", tag: "Food", ref: "612345679999", account: ["Example Bank - 34"] }] })),
)

const chooser = (page: Page) => page.getByLabel("Choose your UPI app statement (PDF)")
const review = (page: Page) => page.getByRole("region", { name: "Review the payments" })
const payment = (page: Page, text: string) => review(page).getByRole("list", { name: "Payments" }).getByRole("listitem").filter({ hasText: new RegExp(`^${text}`) })

async function openImport(page: Page) {
  await page.goto("/transactions")
  await page.getByRole("main").getByRole("link", { name: "Import UPI statement" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Import UPI statement" })).toBeVisible()
}

/** The import page, however it was reached: under Transactions (its address, Back, and on wide screens the left menu's highlight). */
async function expectImport(page: Page, wide = true) {
  await expect(page).toHaveURL(/\/transactions\/import\/upi$/)
  await expect(page.getByRole("heading", { level: 1, name: "Import UPI statement" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Back to Transactions" })).toBeVisible()
  if (wide) await expect(page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]')).toHaveAccessibleName(/^Transactions/)
}

/** Opens the Add expense menu (again until the page has hydrated) and returns its UPI item. */
const menuItem = async (page: Page) => {
  const item = page.getByRole("menuitem", { name: "Import UPI statement" })
  await expect(async () => {
    if (!(await item.isVisible())) await page.getByRole("button", { name: "More ways to add" }).click()
    await expect(item).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  return item
}

test("Paytm: match accounts, allow suggestions, save; the same file adds nothing; a near duplicate waits for an answer", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("upi"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "1,00,000", asOf: "2026-09-01" })
  await addBank(page, { bank: "State Bank of India", last4: "", opening: "50,000", asOf: "2026-09-01" })

  // 1. Upload and match the two accounts the statement names (asked once).
  await openImport(page)
  await chooser(page).setInputFiles(statement)
  await expect(page.getByRole("heading", { name: "Which of your accounts are these?" })).toBeVisible()
  await page.getByLabel("Account for State Bank Of India ··12").selectOption({ label: "State Bank of India" })
  await page.getByLabel("Account for Example Bank ··34").selectOption({ label: "HDFC Bank" })
  await page.getByRole("button", { name: "Continue" }).click()

  // 2. Consent before the first payee name is sent; Allow is remembered.
  await expect(page.getByRole("heading", { name: "Suggest categories with Claude?" })).toBeVisible()
  await expect(page.getByText("Amounts, dates, account details and your name are never sent.", { exact: false })).toBeVisible()
  await page.getByRole("button", { name: "Allow" }).click()

  // 3. Review: each row typed, its category's source shown; failed and received rows not ticked.
  await expect(review(page)).toBeVisible()
  await expect(payment(page, "Green Leaf Cafe").getByLabel(/^Category for/).locator("option:checked")).toHaveText("Food & dining")
  await expect(payment(page, "Green Leaf Cafe")).toContainText("Paytm tag")
  await expect(payment(page, "Ravi Kumar").getByLabel(/^Category for/).locator("option:checked")).toHaveText("Money sent to people")
  await expect(payment(page, "Blue Kitchen").getByLabel(/^Category for/).locator("option:checked")).toHaveText("Food & dining")
  await expect(payment(page, "Blue Kitchen")).toContainText("Suggested by Claude")
  await expect(payment(page, "Corner Store")).toContainText("Skipped: failed payment")
  await expect(review(page).getByRole("checkbox", { name: /^Import Meera N/ })).toHaveCount(0)
  await expect(review(page).getByText("1 payment received needs a choice", { exact: false })).toBeVisible()
  await expect(page.getByText("9000000042")).toHaveCount(0)
  await shot(page, "upi-review")

  await review(page).getByRole("button", { name: "Save ticked payments" }).click()
  await dialog(page, "Save these payments?").getByRole("button", { name: "Save 4 lines" }).click()
  await expect(review(page).getByText("4 lines saved.")).toBeVisible()

  // 4. The same file again: accounts and consent remembered, every payment already imported.
  await openImport(page)
  await chooser(page).setInputFiles(statement)
  await expect(review(page)).toBeVisible()
  await expect(page.getByRole("heading", { name: "Which of your accounts are these?" })).toHaveCount(0)
  await expect(payment(page, "Ravi Kumar")).toContainText("Already imported")
  await expect(payment(page, "Blue Kitchen")).toContainText("Already imported")
  await expect(review(page).getByRole("button", { name: "Save ticked payments" })).toBeDisabled()

  // 5. A ₹1,000 payment on the same account a day after the saved one: one dialog, nothing added until answered.
  await openImport(page)
  await chooser(page).setInputFiles(later)
  const dups = dialog(page, "1 payment may already be recorded")
  await expect(dups).toBeVisible()
  await expect(dups).toContainText("Corner Kitchen")
  await expect(dups).toContainText("Ravi Kumar")
  await shot(page, "upi-duplicates")
  await dups.getByRole("button", { name: "Skip all" }).click()
  await expect(dups).toBeHidden()
  await expect(payment(page, "Corner Kitchen")).toContainText("Possible duplicate")
  await expect(review(page).getByRole("checkbox", { name: /^Import Corner Kitchen/ })).not.toBeChecked()
  await expect(review(page).getByRole("button", { name: "Save ticked payments" })).toBeDisabled()

  // Add it after all: tick it and save.
  await review(page).getByRole("checkbox", { name: /^Import Corner Kitchen/ }).check()
  await review(page).getByRole("button", { name: "Save ticked payments" }).click()
  await dialog(page, "Save these payments?").getByRole("button", { name: "Save 1 line" }).click()
  await expect(review(page).getByText("1 line saved.")).toBeVisible()
})

test("payments before an account's opening date: move it back and import them, the balance today unchanged", async ({ page }) => {
  await signUpConfirmed(page, "Kiran Rao", uniqueEmail("upi-opening"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "1,00,000", asOf: "2026-09-01" })
  // Opened on 14 Oct: the statement's Green Leaf Cafe payment (₹65, 12 Oct) is earlier.
  await addBank(page, { bank: "State Bank of India", last4: "", opening: "1,000", asOf: "2026-10-14" })

  await openImport(page)
  await chooser(page).setInputFiles(statement)
  await page.getByLabel("Account for State Bank Of India ··12").selectOption({ label: "State Bank of India" })
  await page.getByLabel("Account for Example Bank ··34").selectOption({ label: "HDFC Bank" })
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByRole("button", { name: "Not now" }).click()

  await expect(payment(page, "Green Leaf Cafe")).toContainText("Skipped: before the account's opening balance date")
  await review(page).getByRole("button", { name: /^Move opening date to .+ and import 1 payment$/ }).click()
  const move = dialog(page, "Move the opening date?")
  await expect(move.getByText("Only the payments in this statement are added. Other money in or out of this account before", { exact: false })).toBeVisible()
  await expect(move).toContainText("₹1,000")
  await expect(move).toContainText("₹1,065")
  await shot(page, "upi-opening-move")
  await move.getByRole("button", { name: "Move and import 1 payment" }).click()
  await expect(review(page).getByText("1 line added; the opening date is now", { exact: false })).toBeVisible()
  await expect(payment(page, "Green Leaf Cafe")).toContainText("Already imported")
})

test("an unknown file gets the honest message with Copy layout", async ({ page }) => {
  await signUpConfirmed(page, "Ravi Rao", uniqueEmail("upi-unknown"))
  await openImport(page)
  await chooser(page).setInputFiles(pdf("other.pdf", syntheticPdf([[[{ x: 40, text: "Monthly account summary" }], [{ x: 40, text: "Opening balance 1,000.00" }]]])))
  await expect(page.getByText("We couldn't read this file as a Paytm, PhonePe, BHIM or Google Pay statement.", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "Copy layout" })).toBeVisible()
})

test("reach the import from Transactions and the Add expense menu (any page, phones too); always under Transactions", async ({ page }) => {
  await signUpConfirmed(page, "Meena Rao", uniqueEmail("upi-entry"))

  // Transactions: the button beside Add expense.
  await page.goto("/transactions")
  await page.getByRole("main").getByRole("link", { name: "Import UPI statement" }).click()
  await expectImport(page)
  await page.getByRole("link", { name: "Back to Transactions" }).click()
  await expect(page).toHaveURL(/\/transactions$/)

  // The Add expense menu on Income: still under Transactions. Income has no import button.
  await page.goto("/income")
  await expect(page.getByRole("main").getByRole("link", { name: "Import UPI statement" })).toHaveCount(0)
  await (await menuItem(page)).click()
  await expectImport(page)

  // The first address redirects.
  await page.goto("/income/import/upi")
  await expectImport(page)

  // Phones: the same item in the add menu.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await (await menuItem(page)).click()
  await expectImport(page, false)
})
