import { type Page, expect, test } from "@playwright/test"
import { pnbStatementPages, syntheticPdf } from "../test-support/synthetic-pdf"
import { addBank, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Card statement import, step 9a.3 (web): a statement PDF read in the browser with the bundled
// pdf.js worker. Synthetic PDFs written in the test (never a real statement): a text PDF, a
// password-protected one and one with no text. Screenshots in e2e-screenshots/.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
const box = (page: Page) => page.getByRole("region", { name: "Short-term & operational liabilities" })
const pdf = (name: string, bytes: Uint8Array) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(bytes) })

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
  await add.getByLabel("Statement day").fill("15")
  await add.getByLabel("Due day").fill("4")
  await add.getByLabel("Owed now (₹)").fill("1,500")
  await add.getByRole("button", { name: "Add card" }).click()
  await expect(toast(page, "Card added.").first()).toBeVisible()
}

async function openImport(page: Page, cardName: string) {
  await page.goto("/loans-liabilities")
  await box(page).getByRole("link", { name: `Import a statement PDF for ${cardName}` }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Import statement" })).toBeVisible()
}

const chooser = (page: Page) => page.getByLabel(/statement \(PDF\)$/)
const read = (page: Page) => page.getByRole("region", { name: "What the statement says" })

test("a PNB card: text PDF, password-protected PDF and a scanned PDF", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("import"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "1,00,000" })
  await addCard(page, "Punjab National Bank", { typed: "Rupay Select" })
  await openImport(page, "Punjab National Bank Rupay Select")

  // A text PDF: summary for Enter statement, every line, no "Check this statement".
  await chooser(page).setInputFiles(pdf("statement.pdf", syntheticPdf(pnbStatementPages(true))))
  await expect(read(page)).toContainText("15 Oct 2026")
  await expect(read(page)).toContainText("₹2,334")
  await expect(read(page)).toContainText("₹116.70")
  await expect(read(page)).toContainText("4 Nov 2026")
  await expect(read(page).getByRole("list", { name: "Statement lines" }).getByRole("listitem")).toHaveCount(4)
  await expect(read(page)).toContainText("FRESH BASKET STORES BENGAL")
  await expect(read(page)).toContainText("Skipped: payment")
  await expect(read(page)).not.toContainText("Check this statement")
  await expect(page.getByText("0042")).toHaveCount(0)
  await shot(page, "statement-import-read")

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
  await expect(read(page)).toContainText("₹2,334")
  await expect(page.getByLabel("PDF password")).toHaveCount(0)

  // No text layer.
  await chooser(page).setInputFiles(pdf("scan.pdf", syntheticPdf([[]], { noText: true })))
  await expect(page.getByText("This looks like a scanned PDF; only text PDFs can be read.")).toBeVisible()
  await expect(read(page)).toHaveCount(0)
})

test("another issuer's card offers the PNB reader for a PNB statement", async ({ page }) => {
  await signUpConfirmed(page, "Bala Iyer", uniqueEmail("import-offer"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "1,00,000" })
  await addCard(page, "HDFC Bank", { pick: "HDFC Regalia Gold" })
  await openImport(page, "HDFC Regalia Gold")

  await chooser(page).setInputFiles(pdf("statement.pdf", syntheticPdf(pnbStatementPages(true))))
  await expect(read(page)).toContainText("This looks like a Punjab National Bank statement.")
  await read(page).getByRole("button", { name: "Read it as a PNB statement" }).click()
  await expect(read(page)).toContainText("Read as a Punjab National Bank statement.")
  await expect(read(page)).toContainText("₹2,334")
  await expect(read(page).getByRole("list", { name: "Statement lines" }).getByRole("listitem")).toHaveCount(4)
})
