import { type Page, expect, test } from "@playwright/test"
import { pnbDueDate, pnbStatementPages, syntheticPdf } from "../test-support/synthetic-pdf"
import { addBank, addEntry, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Card statement import (Sprint 9a.3 to 9a.5, web): a statement PDF read in the browser with
// the bundled pdf.js worker, reviewed and saved. Synthetic PDFs written in the test (never a real
// statement): text PDFs, password-protected ones and one with no text. Screenshots in
// e2e-screenshots/.

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
  await expect(review(page).getByRole("button", { name: "Save ticked lines" })).toBeEnabled()
  await shot(page, "statement-import-review")

  // Nothing ticked and the statement not entered either: Save is blocked (with the statement
  // ticked, Save enters the statement only).
  for (const text of ["FRESH BASKET", "LATE PAYMENT FEE", "IGST"]) await tick(page, text).uncheck()
  await expect(review(page).getByRole("button", { name: "Save statement only" })).toBeEnabled()
  await review(page).getByLabel("Also enter this statement").uncheck()
  await expect(review(page)).toContainText("Tick at least one line.")
  await expect(review(page).getByRole("button", { name: "Save ticked lines" })).toBeDisabled()
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

async function readLocked(page: Page, bytes: Uint8Array, password: string) {
  await chooser(page).setInputFiles(pdf("locked.pdf", bytes))
  await page.getByLabel("PDF password").fill(password)
  await page.getByRole("button", { name: "Open PDF" }).click()
  await expect(review(page)).toBeVisible()
}

const cardRow = (page: Page) => box(page).getByRole("listitem").filter({ hasText: PNB_CARD }).first()

test("save: confirm, saved once, re-import changes nothing, a deleted line stays blocked", async ({ page }) => {
  const today = todayInIndia()
  await setUp(page, "Eshan Shah")
  const locked = syntheticPdf(pnbStatementPages(false, { invoiceDate: today, lineDate: today }), { password: "fake-pass-2" })

  await openImport(page, PNB_CARD)
  await readLocked(page, locked, "fake-pass-2")
  await review(page).getByRole("button", { name: "Save ticked lines" }).click()
  const confirm = dialog(page, "Save these purchases?")
  await expect(confirm).toContainText("3 purchases, ₹2,334 in all.")
  await expect(confirm).toContainText("These are purchases already made on the card. No money moves from any bank account")
  await expect(confirm).toContainText("the difference is added in Bank charges & interest")
  await shot(page, "statement-import-confirm")
  await confirm.getByRole("button", { name: "Save 3 lines" }).click()
  await expect(review(page)).toContainText("3 lines saved. Statement saved.")
  await expect(lineFor(page, "FRESH BASKET")).toContainText("Saved")
  await expect(review(page)).toContainText("The statement is entered.")
  await shot(page, "statement-import-saved")

  // Owed: the ₹1,500 owed when the card was added plus the ₹2,334 imported, counted once; bill ₹2,334.
  await page.goto("/loans-liabilities")
  await expect(cardRow(page)).toContainText("₹3,834")
  await expect(cardRow(page)).toContainText("₹2,334")

  // The same statement again: every line already imported, nothing to tick, the statement already entered.
  await openImport(page, PNB_CARD)
  await readLocked(page, locked, "fake-pass-2")
  for (const text of ["FRESH BASKET", "LATE PAYMENT FEE", "IGST"]) await expect(lineFor(page, text)).toContainText("Already imported")
  await expect(review(page).getByRole("checkbox", { name: /^Import / })).toHaveCount(0)
  await expect(review(page).getByRole("button", { name: "Save ticked lines" })).toBeDisabled()
  await expect(review(page)).toContainText("is already entered for this card. Only the lines will be saved.")

  // Delete (void) one imported line: it stays blocked as "Already imported (deleted)".
  await page.goto("/transactions")
  await page.getByRole("button", { name: "Void FRESH BASKET STORES BENGAL" }).click()
  await dialog(page, "Void this expense?").getByRole("button", { name: "Void expense" }).click()
  await expect(toast(page, "Expense voided.")).toBeVisible()
  await openImport(page, PNB_CARD)
  await readLocked(page, locked, "fake-pass-2")
  await expect(lineFor(page, "FRESH BASKET")).toContainText("Already imported (deleted)")
  await expect(tick(page, "FRESH BASKET")).toHaveCount(0)
  await expect(lineFor(page, "IGST")).toContainText("Already imported")
  await shot(page, "statement-import-deleted")
  await page.goto("/loans-liabilities")
  await expect(cardRow(page)).toContainText("₹2,050")
})

test("a cut-off save is finished by saving again, with no line posted twice", async ({ page }) => {
  const today = todayInIndia()
  await setUp(page, "Farah Khan")
  await openImport(page, PNB_CARD)
  await chooser(page).setInputFiles(pdf("statement.pdf", syntheticPdf(pnbStatementPages(true, { invoiceDate: today, lineDate: today, extraPurchases: 13 }))))
  await expect(lines(page)).toHaveCount(17)

  // The second chunk of ten never reaches the server.
  let actions = 0
  await page.route("**/loans-liabilities/import**", async (route) => {
    const request = route.request()
    if (request.method() === "POST" && request.headers()["next-action"] && ++actions === 2) return route.abort()
    return route.continue()
  })
  await review(page).getByRole("button", { name: "Save ticked lines" }).click()
  await dialog(page, "Save these purchases?").getByRole("button", { name: "Save 16 lines" }).click()
  await expect(review(page)).toContainText("Saved 10 lines of 16. 6 lines not saved: check them and press Save again to finish.")
  await expect(lineFor(page, "FRESH BASKET")).toContainText("Saved")
  await expect(tick(page, "SHOP 13")).toBeChecked()
  await shot(page, "statement-import-partial")

  await page.unroute("**/loans-liabilities/import**")
  await review(page).getByRole("button", { name: "Save ticked lines" }).click()
  await dialog(page, "Save these purchases?").getByRole("button", { name: "Save 6 lines" }).click()
  await expect(review(page)).toContainText("6 lines saved. Statement saved.")

  // ₹1,500 owed when added + ₹2,334 + 13 × ₹100, each line once.
  await page.goto("/loans-liabilities")
  await expect(cardRow(page)).toContainText("₹5,134")
})

test("an imported line edited, then its edited version deleted, stays blocked as deleted on re-import", async ({ page }) => {
  const today = todayInIndia()
  await setUp(page, "Gita Pillai")
  const statement = syntheticPdf(pnbStatementPages(false, { invoiceDate: today, lineDate: today }))
  await openImport(page, PNB_CARD)
  await chooser(page).setInputFiles(pdf("statement.pdf", statement))
  await review(page).getByRole("button", { name: "Save ticked lines" }).click()
  await dialog(page, "Save these purchases?").getByRole("button", { name: "Save 3 lines" }).click()
  await expect(review(page)).toContainText("3 lines saved. Statement saved.")

  // Edit the imported line (a new version under a new key), then delete that edited version.
  await page.goto("/transactions")
  await page.getByRole("button", { name: "Edit FRESH BASKET STORES BENGAL" }).click()
  const edit = dialog(page, "Edit expense")
  await edit.getByLabel("Amount").fill("1,800")
  await edit.getByRole("button", { name: "Save changes" }).click()
  await expect(toast(page, "Changes saved.")).toBeVisible()
  await page.getByRole("button", { name: "Void FRESH BASKET STORES BENGAL" }).click()
  await dialog(page, "Void this expense?").getByRole("button", { name: "Void expense" }).click()
  await expect(toast(page, "Expense voided.")).toBeVisible()

  await openImport(page, PNB_CARD)
  await chooser(page).setInputFiles(pdf("statement.pdf", statement))
  await expect(lineFor(page, "FRESH BASKET")).toContainText("Already imported (deleted)")
  await expect(tick(page, "FRESH BASKET")).toHaveCount(0)
  await expect(lineFor(page, "IGST")).toContainText("Already imported")
  await expect(review(page).getByRole("button", { name: "Save ticked lines" })).toBeDisabled()
  await page.goto("/loans-liabilities")
  await expect(cardRow(page)).toContainText("₹2,050")
})

test("phone width: no sideways scroll, Save reachable; a session ended mid-save keeps the review", async ({ page }) => {
  const today = todayInIndia()
  await setUp(page, "Hari Das")
  await page.setViewportSize({ width: 375, height: 812 })
  await openImport(page, PNB_CARD)
  await chooser(page).setInputFiles(pdf("statement.pdf", syntheticPdf(pnbStatementPages(true, { invoiceDate: today, lineDate: today }))))
  await expect(lines(page)).toHaveCount(4)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  const save = review(page).getByRole("button", { name: "Save ticked lines" })
  await save.scrollIntoViewIfNeeded()
  await expect(save).toBeInViewport()
  await expect(save).toBeEnabled()
  await shot(page, "statement-import-phone")

  // The session ends before Save: the person is asked to sign in again and nothing on screen is lost.
  await page.context().clearCookies()
  await save.click()
  await dialog(page, "Save these purchases?").getByRole("button", { name: "Save 3 lines" }).click()
  await expect(review(page)).toContainText("Sign in again; your file is still here.")
  await expect(review(page)).toContainText("Saved 0 lines of 3.")
  await expect(lines(page)).toHaveCount(4)
  await expect(tick(page, "FRESH BASKET")).toBeChecked()
  await expect(tick(page, "IGST")).toBeChecked()
  await expect(tick(page, "LATE PAYMENT FEE")).toBeChecked()
  await expect(save).toBeEnabled()
})

test("wrapped network-column rows read cleanly; a dates warning; Save with no line ticked enters the statement only", async ({ page }) => {
  const today = todayInIndia()
  await setUp(page, "Indu Varma")
  await openImport(page, PNB_CARD)
  const wrapped = { date: 0, network: -1.5, line1: 5, line2: -5 }
  await chooser(page).setInputFiles(pdf("statement.pdf", syntheticPdf(pnbStatementPages(true, { invoiceDate: today, lineDate: today, wrapped }))))
  await expect(lines(page)).toHaveCount(4)
  await expect(lineFor(page, "FRESH BASKET STORES BENGAL")).toHaveCount(1)
  await expect(review(page)).not.toContainText("RUPAY")
  await expect(review(page)).not.toContainText("could not be read")

  // A due date before the statement date is flagged.
  const due = review(page).getByLabel("Due date")
  const prefilled = await due.inputValue()
  await due.fill("2020-01-01")
  await expect(review(page)).toContainText("Check statement dates: the due date is before the statement date.")
  await due.fill(prefilled)
  await expect(review(page)).not.toContainText("Check statement dates")

  // Nothing ticked, statement ticked: the statement only.
  for (const text of ["FRESH BASKET", "LATE PAYMENT FEE", "IGST"]) await tick(page, text).uncheck()
  await expect(review(page)).not.toContainText("Tick at least one line.")
  await review(page).getByRole("button", { name: "Save statement only" }).click()
  const confirm = dialog(page, "Enter this statement?")
  await expect(confirm).toContainText("No lines are saved: only the statement is entered.")
  await confirm.getByRole("button", { name: "Enter statement" }).click()
  await expect(review(page)).toContainText("Statement saved")
  await expect(review(page)).toContainText("The statement is entered.")
  await expect(review(page).getByRole("button", { name: "Save ticked lines" })).toBeDisabled()
  // ₹1,500 owed and a ₹2,334 bill: the ₹834 difference is added in Bank charges & interest.
  await page.goto("/loans-liabilities")
  await expect(cardRow(page)).toContainText("₹2,334")
})

test("a statement date that can't be read is left empty and blocks Save until entered", async ({ page }) => {
  const today = todayInIndia()
  await setUp(page, "Jaya Bose")
  await openImport(page, PNB_CARD)
  const pages = pnbStatementPages(false, { invoiceDate: today, lineDate: today, dateLayout: "unreadable" })
  await chooser(page).setInputFiles(pdf("statement.pdf", syntheticPdf(pages)))
  await expect(lines(page)).toHaveCount(4)
  await expect(review(page).getByLabel("Also enter this statement")).toBeChecked()
  const date = review(page).getByLabel("Statement date")
  await expect(date).toHaveValue("")
  await expect(review(page)).toContainText("Couldn't read the statement date; enter it")
  await expect(review(page).getByLabel("Due date")).toHaveValue(pnbDueDate(today))
  const save = review(page).getByRole("button", { name: "Save ticked lines" })
  await expect(save).toBeDisabled()
  await expect(review(page)).toContainText("Enter the statement date.")
  await shot(page, "statement-import-no-date")

  await date.fill(today)
  await expect(review(page)).not.toContainText("Couldn't read the statement date")
  await expect(save).toBeEnabled()
  // Lines only also works: unticking Also enter this statement lifts the block.
  await date.fill("")
  await expect(save).toBeDisabled()
  await review(page).getByLabel("Also enter this statement").uncheck()
  await expect(save).toBeEnabled()
})
