import { type Page, expect, test } from "@playwright/test"
import { pnbDueDate, pnbStatementPages, syntheticPdf } from "../test-support/synthetic-pdf"
import { addBank, addEntry, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Card statement import (Sprint 9a.3 and 9a.4, web): a statement PDF read in the browser with
// the bundled pdf.js worker, then reviewed. Synthetic PDFs written in the test (never a real
// statement): a text PDF, a password-protected one and one with no text. Nothing is saved yet
// (9a.5). Screenshots in e2e-screenshots/.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
const box = (page: Page) => page.getByRole("region", { name: "Short-term & operational liabilities" })
const pdf = (name: string, bytes: Uint8Array) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(bytes) })
const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
const PNB_CARD = "Punjab National Bank Rupay Select"

async function addCard(page: Page, issuer: string, product: { pick?: string; typed?: string }) {
  await page.goto("/loans-liabilities")
  await box(page).getByRole("button", { name: "Add card" }).click()
  const add = dialog(page, "Add card")
  await add.getByLabel("Card issuer").selectOption(issuer)
  if (product.typed) {
    await add.getByLabel("Card", { exact: true }).selectOption({ label: "Other" })
    await add.getByLabel("Card name").fill(product.typed)
  } else await add.getByLabel("Card", { exact: true }).selectOption(product.pick!)
  await add.getByLabel("Credit limit (₹)").fill("50,000")
  await add.getByLabel("Statement day").fill(String(Number(todayInIndia().slice(8, 10))))
  await add.getByLabel("Due day").fill("28")
  await add.getByLabel("Owed now (₹)").fill("1,500")
  await add.getByRole("button", { name: "Add card" }).click()
  await expect(toast(page, "Card added.").first()).toBeVisible()
}

async function setUp(page: Page, who: string, issuer = "Punjab National Bank", product: { pick?: string; typed?: string } = { typed: "Rupay Select" }) {
  await signUpConfirmed(page, who, uniqueEmail("import"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "1,00,000" })
  await addCard(page, issuer, product)
}

async function openImport(page: Page, cardName: string) {
  await page.goto("/loans-liabilities")
  await box(page).getByRole("link", { name: `Import a statement PDF for ${cardName}` }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Import statement" })).toBeVisible()
}

const chooser = (page: Page) => page.getByLabel(/statement \(PDF\)$/)
const review = (page: Page) => page.getByRole("region", { name: "Review the statement" })
const lines = (page: Page) => review(page).getByRole("list", { name: "Statement lines" }).getByRole("listitem")
const lineFor = (page: Page, text: string) => lines(page).filter({ hasText: new RegExp(`^${text}`) })
const tick = (page: Page, text: string) => review(page).getByRole("checkbox", { name: new RegExp(`^Import ${text}`) })

test("a PNB card: text PDF, password-protected PDF and a scanned PDF", async ({ page }) => {
  await setUp(page, "Asha Rao")
  await openImport(page, PNB_CARD)

  // A text PDF dated before the card was added: read, every line listed and skipped.
  await chooser(page).setInputFiles(pdf("statement.pdf", syntheticPdf(pnbStatementPages(true))))
  await expect(lines(page)).toHaveCount(4)
  await expect(review(page)).toContainText("FRESH BASKET STORES BENGAL")
  await expect(review(page)).toContainText("Skipped: payment")
  await expect(review(page)).toContainText("Skipped: before you added the card")
  await expect(review(page)).not.toContainText("Check this statement")
  await expect(page.getByText("0042")).toHaveCount(0)

  // Password-protected: asked for, a wrong one refused with a clear message, the right one opens it.
  await chooser(page).setInputFiles(pdf("locked.pdf", syntheticPdf(pnbStatementPages(false), { password: "fake-pass-1" })))
  await expect(page.getByText("This PDF is protected. Enter the password your bank gave for it.")).toBeVisible()
  await page.getByLabel("PDF password").fill("wrong")
  await page.getByRole("button", { name: "Open PDF" }).click()
  await expect(page.getByText("That password didn't open the PDF. Check it and try again.")).toBeVisible()
  await expect(page.getByLabel("PDF password")).toHaveValue("")
  await shot(page, "statement-import-wrong-password")
  await page.getByLabel("PDF password").fill("fake-pass-1")
  await page.getByRole("button", { name: "Open PDF" }).click()
  await expect(lines(page)).toHaveCount(4)
  await expect(page.getByLabel("PDF password")).toHaveCount(0)

  // No text layer.
  await chooser(page).setInputFiles(pdf("scan.pdf", syntheticPdf([[]], { noText: true })))
  await expect(page.getByText("This looks like a scanned PDF; only text PDFs can be read.")).toBeVisible()
  await expect(review(page)).toHaveCount(0)
})

test("review: ticks, defaults, a possible duplicate, edits, bulk category and the Enter statement prefill", async ({ page }) => {
  const today = todayInIndia()
  await setUp(page, "Bala Iyer")
  // An entry already on the card: same day and amount as the statement's late fee.
  await page.goto("/transactions")
  await addEntry(page, { amount: "500", category: "Shopping", from: `${PNB_CARD} (card)` })

  await openImport(page, PNB_CARD)
  await chooser(page).setInputFiles(pdf("statement.pdf", syntheticPdf(pnbStatementPages(true, { invoiceDate: today, lineDate: today }))))
  await expect(lines(page)).toHaveCount(4)

  // Skipped with a notice (count and total); spending ticked; the duplicate unticked and labelled.
  await expect(review(page)).toContainText("1 line is skipped (₹1,500): payments.")
  await expect(lineFor(page, "PAYMENT RECEIVED").getByRole("checkbox")).toHaveCount(0)
  await expect(tick(page, "FRESH BASKET")).toBeChecked()
  await expect(tick(page, "IGST")).toBeChecked()
  await expect(tick(page, "LATE PAYMENT FEE")).not.toBeChecked()
  await expect(lineFor(page, "LATE PAYMENT FEE")).toContainText("Possible duplicate")

  // Default categories: Other expenses; fees, interest and GST: Bank charges & interest.
  const category = (text: string) => review(page).getByRole("combobox", { name: new RegExp(`^Category for ${text}`) })
  await expect(category("FRESH BASKET").locator("option:checked")).toHaveText("Other expenses")
  await expect(category("IGST").locator("option:checked")).toHaveText("Bank charges & interest")

  // Ticked total beside the bill total; edits change the total.
  const totals = review(page).getByText(/^Ticked:/)
  await expect(totals).toHaveText("Ticked: ₹1,834 (2 lines) · Bill total: ₹2,334")
  await tick(page, "LATE PAYMENT FEE").check()
  await expect(totals).toHaveText("Ticked: ₹2,334 (3 lines) · Bill total: ₹2,334")
  await review(page).getByRole("textbox", { name: /^Amount for FRESH BASKET/ }).fill("1,800")
  await expect(totals).toContainText("Ticked: ₹2,350 (3 lines)")
  await review(page).getByRole("textbox", { name: /^Amount for FRESH BASKET/ }).fill("")
  await expect(review(page)).toContainText("Enter an amount")
  await expect(review(page)).toContainText("Fix the highlighted lines.")
  await review(page).getByRole("textbox", { name: /^Amount for FRESH BASKET/ }).fill("1,784")

  // Bulk category for the ticked lines.
  await review(page).getByLabel("Category for all ticked lines").selectOption({ label: "Groceries" })
  await review(page).getByRole("button", { name: "Apply to ticked" }).click()
  await expect(category("FRESH BASKET").locator("option:checked")).toHaveText("Groceries")
  await expect(category("IGST").locator("option:checked")).toHaveText("Groceries")

  // Enter statement prefilled from the statement.
  await expect(review(page).getByLabel("Also enter this statement")).toBeChecked()
  await expect(review(page).getByLabel("Statement date")).toHaveValue(today)
  await expect(review(page).getByLabel("Bill total (₹)")).toHaveValue("2,334")
  await expect(review(page).getByLabel("Minimum due (₹)")).toHaveValue("116.70")
  await expect(review(page).getByLabel("Due date")).toHaveValue(pnbDueDate(today))
  await expect(review(page)).toContainText("Ready. Saving comes in the next update; nothing is saved yet.")
  await shot(page, "statement-import-review")

  // Nothing ticked: Save is blocked.
  for (const text of ["FRESH BASKET", "LATE PAYMENT FEE", "IGST"]) await tick(page, text).uncheck()
  await expect(review(page)).toContainText("Tick at least one line.")
})

test("Check this statement needs a confirm; a statement already entered offers lines only", async ({ page }) => {
  const today = todayInIndia()
  await setUp(page, "Chitra Nair")
  // The statement for today is already entered.
  await page.goto("/loans-liabilities")
  await box(page).getByRole("button", { name: `Enter statement for ${PNB_CARD}` }).click()
  const st = dialog(page, "Enter statement")
  await st.getByLabel("Statement date", { exact: true }).fill(today)
  await st.getByLabel("Total due (₹)").fill("2,334")
  await st.getByRole("button", { name: "Save statement" }).click()
  await expect(toast(page, "Statement saved")).toBeVisible()

  await openImport(page, PNB_CARD)
  // The printed Total Invoice Value does not match the Dr lines read.
  await chooser(page).setInputFiles(
    pdf("statement.pdf", syntheticPdf(pnbStatementPages(false, { invoiceDate: today, lineDate: today, invoiceTotal: "2,434.00" }))),
  )
  await expect(review(page)).toContainText("Check this statement")
  await expect(review(page)).toContainText("The debit lines read add up to ₹2,334, but the statement's Total Invoice Value is ₹2,434.")
  await expect(review(page)).toContainText("Confirm you have compared the lines with your PDF.")
  await expect(tick(page, "FRESH BASKET")).toBeChecked()
  await review(page).getByLabel("I have compared these lines with my PDF").check()
  await expect(review(page)).not.toContainText("Confirm you have compared the lines with your PDF.")
  // Confirming unticks nothing.
  await expect(tick(page, "FRESH BASKET")).toBeChecked()

  await expect(review(page)).toContainText(`is already entered for this card. Only the lines will be saved.`)
  await expect(review(page).getByLabel("Also enter this statement")).toHaveCount(0)
  await shot(page, "statement-import-check")
})

test("another issuer's card offers the PNB reader for a PNB statement", async ({ page }) => {
  await setUp(page, "Devi Menon", "HDFC Bank", { pick: "HDFC Regalia Gold" })
  await openImport(page, "HDFC Regalia Gold")

  await chooser(page).setInputFiles(pdf("statement.pdf", syntheticPdf(pnbStatementPages(true))))
  await expect(review(page)).toContainText("This looks like a Punjab National Bank statement.")
  await review(page).getByRole("button", { name: "Read it as a PNB statement" }).click()
  await expect(review(page)).toContainText("Read as a Punjab National Bank statement.")
  await expect(review(page).getByText(/^Ticked:/)).toContainText("Bill total: ₹2,334")
  await expect(lines(page)).toHaveCount(4)
})
