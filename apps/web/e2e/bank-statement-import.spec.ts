import { type Page, expect, test } from "@playwright/test"
import { type SavingsRow, isoDaysBefore, pnbSavingsPages, savingsDefaultRows, syntheticPdf } from "../test-support/synthetic-pdf"
import { addBank, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Bank account statement import (Sprint 9b, web): a PNB savings statement PDF read in the browser,
// each line labelled (expense, income, transfer, card payment, refund, skip), reviewed and saved.
// Synthetic PDFs written in the test (never a real statement). Screenshots in e2e-screenshots/.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
const pdf = (name: string, bytes: Uint8Array) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(bytes) })
const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
const PNB = "Punjab National Bank ··4821"
const SBI = "State Bank of India ··1111"

const chooser = (page: Page) => page.getByLabel(/statement \(PDF\)$/)
const review = (page: Page) => page.getByRole("region", { name: "Review the statement" })
const lines = (page: Page) => review(page).getByRole("list", { name: "Statement lines" }).getByRole("listitem")
// A line by the start of its text (its description): option labels such as "Credit card payment" would match anywhere.
const startsWith = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`)
const lineAt = (page: Page, text: string, nth = 0) => lines(page).filter({ hasText: startsWith(text) }).nth(nth)
const holding = (page: Page, label: string) =>
  page.locator("[data-slot=card]").filter({ has: page.getByText("Where your money is", { exact: true }) }).getByRole("listitem").filter({ hasText: label })

async function setUp(page: Page, who: string) {
  const today = todayInIndia()
  await signUpConfirmed(page, who, uniqueEmail("bank-import"))
  await page.goto("/income")
  await addBank(page, { bank: "Punjab National Bank", last4: "4821", opening: "24,600", asOf: isoDaysBefore(today, 10) })
  await addBank(page, { bank: "State Bank of India", last4: "1111", opening: "10,000", asOf: isoDaysBefore(today, 10) })
}

async function openImport(page: Page, account: string) {
  await page.goto("/income")
  await holding(page, account).getByRole("button", { name: `Actions for ${account}` }).click()
  await page.getByRole("menuitem", { name: "Import statement" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Import statement" })).toBeVisible()
}

async function addCard(page: Page) {
  await page.goto("/loans-liabilities")
  await page.getByRole("region", { name: "Short-term & operational liabilities" }).getByRole("button", { name: "Add card" }).click()
  const add = dialog(page, "Add card")
  await add.getByLabel("Card issuer").selectOption("Punjab National Bank")
  await add.getByLabel("Card", { exact: true }).selectOption({ label: "Other" })
  await add.getByLabel("Card name").fill("Rupay Select")
  await add.getByLabel("Credit limit (₹)").fill("50,000")
  await add.getByLabel("Statement day").fill("15")
  await add.getByLabel("Due day").fill("28")
  await add.getByLabel("Owed now (₹)").fill("5,000")
  await add.getByRole("button", { name: "Add card" }).click()
  await expect(toast(page, "Card added.").first()).toBeVisible()
}

/** The default rows, the newest on today, with the card payment dated today too (after the card was added). */
function rowsEndingToday(): SavingsRow[] {
  const today = todayInIndia()
  return savingsDefaultRows(today).map((row) => (row.remarks[0] === "CARD PAYMENT PNB RUPAY" ? { ...row, date: today } : row))
}

const whatIs = (page: Page, text: string, nth = 0) => lineAt(page, text, nth).getByRole("combobox", { name: /^What is / })
const tickOf = (page: Page, text: string, nth = 0) => lineAt(page, text, nth).getByRole("checkbox", { name: /^Import / })

test("label each line: expenses ticked, credits need a choice, transfer and card payment paths, refund skipped, payee remembered", async ({ page }) => {
  await setUp(page, "Asha Rao")
  await addCard(page)
  await openImport(page, PNB)
  await expect(page.getByText("Choose your Punjab National Bank statement (PDF)", { exact: true })).toBeVisible()
  await chooser(page).setInputFiles(pdf("statement.pdf", syntheticPdf(pnbSavingsPages({ rows: rowsEndingToday() }))))
  await expect(lines(page)).toHaveCount(7)

  // Nothing from above the column header, and the UPI payee only.
  for (const secret of ["EXAMPLE PERSON", "0000111122223333", "EXAMPLE ROAD", "9876543210", "okaxis", "412345678", "N123456789"]) {
    await expect(page.getByText(secret)).toHaveCount(0)
  }
  await expect(lineAt(page, "RAVI KUMAR")).toBeVisible()

  // Debits start ticked as expenses; the two credits need a choice and can't be ticked yet.
  await expect(tickOf(page, "FRESH BASKET")).toBeChecked()
  await expect(review(page)).toContainText("2 credits need a choice")
  await expect(lineAt(page, "NEFT/SALARY").getByRole("checkbox")).toHaveCount(0)
  // The app's balance differs from the statement's closing: a soft warning, Save stays possible.
  await expect(review(page)).toContainText("This doesn't stop Save.")
  // Card payment is offered on debits only.
  await expect(whatIs(page, "NEFT/SALARY").locator("option", { hasText: "Credit card payment" })).toHaveCount(0)

  await whatIs(page, "NEFT/SALARY").selectOption({ label: "Income" })
  await lineAt(page, "NEFT/SALARY").getByRole("combobox", { name: /^Income source for / }).selectOption({ label: "Salary" })
  await tickOf(page, "NEFT/SALARY").check()

  // The RAVI KUMAR credit: a refund can't be saved yet; it says so and has no tick.
  const raviCredit = lines(page).filter({ hasText: startsWith("RAVI KUMAR") }).filter({ hasText: "₹1,200 Cr" })
  await raviCredit.getByRole("combobox", { name: /^What is / }).selectOption({ label: "Refund" })
  await expect(raviCredit).toContainText("Refunds can't be saved yet")
  await expect(raviCredit.getByRole("checkbox")).toHaveCount(0)

  await whatIs(page, "IMPS/TRANSFER TO OWN ACCOUNT").selectOption({ label: "Transfer to my own account" })
  await lineAt(page, "IMPS/TRANSFER TO OWN ACCOUNT").getByRole("combobox", { name: /^To account for / }).selectOption({ label: SBI })
  await tickOf(page, "IMPS/TRANSFER TO OWN ACCOUNT").check()

  await whatIs(page, "CARD PAYMENT").selectOption({ label: "Credit card payment" })
  await lineAt(page, "CARD PAYMENT").getByRole("combobox", { name: /^Card for / }).selectOption({ label: "Punjab National Bank Rupay Select" })
  await tickOf(page, "CARD PAYMENT").check()

  // Labelling one RAVI KUMAR debit offers the same on the other: unticked until the person ticks it.
  const raviDebits = lines(page).filter({ hasText: startsWith("RAVI KUMAR") }).filter({ hasText: "₹649 Dr" })
  await raviDebits.nth(0).getByRole("combobox", { name: /^Category for / }).selectOption({ label: "Shopping" })
  await expect(raviDebits.nth(1).getByRole("combobox", { name: /^Category for / })).toHaveValue(/.+/)
  await expect(raviDebits.nth(1)).toContainText("Tick it to use it")
  await expect(raviDebits.nth(1).getByRole("checkbox")).not.toBeChecked()
  await raviDebits.nth(1).getByRole("checkbox").check()
  await shot(page, "bank-import-review")

  await review(page).getByRole("button", { name: "Save ticked lines" }).click()
  const confirm = dialog(page, "Save these lines?")
  await expect(confirm).toContainText("Transfers move money between your own accounts")
  await expect(confirm).toContainText("Card payments are recorded on the card")
  await confirm.getByRole("button", { name: "Save 6 lines" }).click()
  await expect(review(page)).toContainText("6 lines saved.")

  // PNB: 24,600 + 50,000 − 1,784 − 649 − 5,000 − 2,334 − 649 = 64,184; SBI: 10,000 + 5,000 (a transfer, not income).
  await page.goto("/income")
  await expect(holding(page, PNB)).toContainText("₹64,184")
  await expect(holding(page, SBI)).toContainText("₹15,000")

  // The same file again: every saved line is Already imported.
  await openImport(page, PNB)
  await chooser(page).setInputFiles(pdf("statement.pdf", syntheticPdf(pnbSavingsPages({ rows: rowsEndingToday() }))))
  await expect(lines(page).filter({ hasText: "Already imported" })).toHaveCount(6)
  await expect(review(page).getByRole("checkbox", { name: /^Import / })).toHaveCount(0)
})

test("a transfer between two own accounts is posted once when both statements are imported", async ({ page }) => {
  const today = todayInIndia()
  await setUp(page, "Bala Iyer")
  const day = isoDaysBefore(today, 2)
  const fromA: SavingsRow[] = [{ date: day, amountMinor: 500_000, direction: "DR", remarks: ["IMPS/TO OWN SBI ACCOUNT"] }]
  const intoB: SavingsRow[] = [{ date: day, amountMinor: 500_000, direction: "CR", remarks: ["IMPS/FROM OWN PNB ACCOUNT"] }]

  await openImport(page, PNB)
  await chooser(page).setInputFiles(pdf("a.pdf", syntheticPdf(pnbSavingsPages({ rows: fromA, openingMinor: 2_460_000 }))))
  await whatIs(page, "IMPS/TO OWN SBI ACCOUNT").selectOption({ label: "Transfer to my own account" })
  await lineAt(page, "IMPS/TO OWN SBI ACCOUNT").getByRole("combobox", { name: /^To account for / }).selectOption({ label: SBI })
  await review(page).getByRole("button", { name: "Save ticked lines" }).click()
  await dialog(page, "Save these lines?").getByRole("button", { name: "Save 1 line" }).click()
  await expect(review(page)).toContainText("1 line saved.")

  // B's statement: its credit is the same transfer, already recorded from A's import.
  await openImport(page, SBI)
  await chooser(page).setInputFiles(pdf("b.pdf", syntheticPdf(pnbSavingsPages({ rows: intoB, openingMinor: 1_000_000 }))))
  const shared = lineAt(page, "IMPS/FROM OWN PNB ACCOUNT")
  await expect(shared).toContainText("Already imported")
  await expect(shared).toContainText("recorded as a transfer")
  await expect(shared.getByRole("checkbox")).toHaveCount(0)
  await expect(shared.getByRole("combobox")).toHaveCount(0)

  await page.goto("/income")
  await expect(holding(page, PNB)).toContainText("₹19,600")
  await expect(holding(page, SBI)).toContainText("₹15,000")
})

test("a broken balance chain needs a check and unticks nothing; a year of lines is paged and saved in chunks", async ({ page }) => {
  test.setTimeout(240_000)
  const today = todayInIndia()
  await setUp(page, "Chitra Nair")
  await openImport(page, PNB)
  await chooser(page).setInputFiles(pdf("broken.pdf", syntheticPdf(pnbSavingsPages({ rows: savingsDefaultRows(today), breakChainAt: 3 }))))
  await expect(review(page).getByRole("alert")).toContainText("Check this statement")
  await expect(review(page).getByRole("alert")).toContainText("The balances don't follow line by line")
  await expect(tickOf(page, "FRESH BASKET")).toBeChecked()
  const save = review(page).getByRole("button", { name: "Save ticked lines" })
  await expect(save).toBeDisabled()
  await review(page).getByLabel("I have compared these lines with my PDF").check()
  await expect(save).toBeEnabled()

  // A year: 52 weeks of the seven lines, oldest first, within the account's dates.
  const rows = Array.from({ length: 52 }, (_, week) => savingsDefaultRows(isoDaysBefore(today, 7 * (51 - week)))).flat()
  await page.goto("/income")
  await addBank(page, { bank: "Bank of Baroda", last4: "2222", opening: "1,00,000", asOf: isoDaysBefore(today, 400) })
  await openImport(page, "Bank of Baroda ··2222")
  await chooser(page).setInputFiles(pdf("year.pdf", syntheticPdf(pnbSavingsPages({ rows }))))
  await expect(review(page).getByRole("navigation", { name: "Pages of lines" })).toContainText("Lines 1–100 of 364")
  await expect(lines(page)).toHaveCount(100)
  await review(page).getByRole("radio", { name: "Need a choice" }).check()
  await expect(review(page).getByRole("navigation", { name: "Pages of lines" })).toContainText("of 104")
  await review(page).getByRole("radio", { name: "All lines" }).check()
  await review(page).getByRole("button", { name: "Next" }).click()
  await expect(review(page).getByRole("navigation", { name: "Pages of lines" })).toContainText("Lines 101–200 of 364")

  await save.click()
  await dialog(page, "Save these lines?").getByRole("button", { name: "Save 260 lines" }).click()
  await expect(review(page)).toContainText("260 lines saved.", { timeout: 200_000 })
})
