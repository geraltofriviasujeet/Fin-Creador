import { type Page, expect, test } from "@playwright/test"
import { addBank, addEntry, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Credit cards and informal borrowing end to end (Sprint 8b, web), against the throwaway local
// Supabase. A card added owing ₹6,000; a ₹2,000 purchase; a statement of ₹10,000 with a ₹1,000
// card EMI (bill ₹9,000) and ₹8,000 recorded, so ₹1,000 is added as the difference. At most 8
// screenshots in e2e-screenshots/ for the owner's review.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

const PATH = "/loans-liabilities"
const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
const dayOfMonth = () => String(Number(todayInIndia().slice(8, 10)))
function daysAhead(days: number) {
  const [y, m, d] = todayInIndia().split("-").map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

const box = (page: Page) => page.getByRole("region", { name: "Short-term & operational liabilities" })
const cardRow = (page: Page, name: string) => box(page).getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${name}`) }) }).first()

async function openPage(page: Page) {
  await page.goto(PATH)
  await expect(page.getByRole("heading", { level: 1, name: "Loans & Liabilities" })).toBeVisible()
}

test("a card: add, purchase, statement with the difference, minimum, full and a free payment", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("cards"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "1,00,000" })

  await openPage(page)
  await box(page).getByRole("button", { name: "Add card" }).click()
  const add = dialog(page, "Add card")
  await add.getByLabel("Card issuer").fill("HDFC Bank")
  await add.getByLabel("Nickname (optional)").fill("Holiday card 9")
  await add.getByLabel("Credit limit (₹)").fill("1,00,000")
  await add.getByLabel("Statement day").fill(dayOfMonth())
  await add.getByLabel("Due day").fill("28")
  await add.getByLabel("Owed now (₹)").fill("6,000")
  await add.getByRole("button", { name: "Add card" }).click()
  await expect(add.getByText("Leave out numbers: no card or account digits in names")).toBeVisible()
  await add.getByLabel("Nickname (optional)").fill("Holiday card")
  await shot(page, "cards-add")
  // Twice, quickly: the request key adds the card once.
  await add.getByRole("button", { name: "Add card" }).dblclick()
  await expect(toast(page, "Card added.").first()).toBeVisible()
  await expect(add).toBeHidden()
  const row = cardRow(page, "Holiday card")
  await expect(box(page).getByRole("listitem").filter({ hasText: "Holiday card" })).toHaveCount(1)
  await expect(row).toContainText("₹6,000")
  await expect(row).toContainText("6% of ₹1,00,000")
  await expect(row).toContainText("No bill yet")

  // A purchase on the card: offered as "Holiday card (card)" for expenses only, with the limit warning.
  await page.goto("/transactions")
  await page.getByRole("link", { name: "Add transaction" }).first().click()
  const expense = dialog(page, "Add expense")
  await expect(expense.getByLabel("Paid from").locator("option", { hasText: "Holiday card (card)" })).toHaveCount(1)
  await expense.getByLabel("Amount").fill("85,000")
  await expense.getByLabel("Paid from").selectOption({ label: "Holiday card (card)" })
  await expect(expense).toContainText("This takes Holiday card to 91% of its limit.")
  await shot(page, "cards-expense-limit")
  await expense.getByRole("radio", { name: "Income" }).click()
  await expect(dialog(page, "Add income").getByLabel("Received into", { exact: true }).locator("option", { hasText: "(card)" })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await addEntry(page, { amount: "2,000", category: "Shopping", from: "Holiday card (card)" })

  // Not on the Income page (nor in Total available): the bank still holds ₹1,00,000.
  await page.goto("/income")
  await expect(page.getByText("Holiday card")).toHaveCount(0)
  await expect(page.getByText("₹1,00,000").first()).toBeVisible()

  // Statement dated today: bill ₹9,000, ₹8,000 recorded: the ₹1,000 difference becomes an expense.
  await openPage(page)
  await row.getByRole("button", { name: "Enter statement for Holiday card" }).click()
  const st = dialog(page, "Enter statement")
  await st.getByLabel("Statement date", { exact: true }).fill(todayInIndia())
  await st.getByLabel("Total due (₹)").fill("10,000")
  await st.getByLabel("Minimum due (₹)").fill("500")
  await st.getByLabel("Card EMIs included (₹)").fill("1,000")
  await expect(st).toContainText("Card EMIs are paid from the loan row")
  await expect(st).toContainText("Bill ₹9,000")
  await st.getByLabel("Record the difference as an expense").check()
  await st.getByLabel("Category for the difference").selectOption({ label: "Shopping" })
  await shot(page, "cards-statement")
  await st.getByRole("button", { name: "Save statement" }).click()
  await expect(toast(page, "Statement saved, with the difference recorded.")).toBeVisible()
  await expect(row).toContainText("₹9,000")
  await expect(row.getByText(/^(Due|Overdue)$/)).toBeVisible()

  // More than owed: record the missing purchase first.
  await row.getByRole("button", { name: "Pay Holiday card" }).click()
  let pay = dialog(page, "Pay card")
  await pay.getByRole("radio", { name: "Other amount" }).check()
  await pay.getByLabel("Amount (₹)").fill("9,001")
  await pay.getByRole("button", { name: "Pay", exact: true }).click()
  await expect(pay.getByText("That's more than you owe on this card (₹9,000). Record the missing purchase first")).toBeVisible()

  // The minimum closes the bill: Minimum paid.
  await pay.getByRole("radio", { name: "Minimum ₹500" }).check()
  await expect(pay.getByLabel("Paid from").locator("option")).toHaveText(["Choose an account", "HDFC Bank · ₹1,00,000"])
  await shot(page, "cards-pay")
  await pay.getByRole("button", { name: "Pay", exact: true }).click()
  await expect(toast(page, "Bill paid.")).toBeVisible()
  await expect(row.getByText("Minimum paid")).toBeVisible()
  await expect(row).toContainText("₹8,500")

  // Void it, then pay the full bill.
  await row.getByRole("button", { name: /^Holiday card/ }).click()
  await row.getByRole("button", { name: /^Void the payment of / }).click()
  await dialog(page, "Void this payment?").getByRole("button", { name: "Void payment" }).click()
  await expect(toast(page, "Payment voided.")).toBeVisible()
  await expect(row).toContainText("₹9,000")
  await row.getByRole("button", { name: "Pay Holiday card" }).click()
  pay = dialog(page, "Pay card")
  await expect(pay.getByRole("radio", { name: "Full ₹9,000" })).toBeChecked()
  await pay.getByRole("button", { name: "Pay", exact: true }).click()
  await expect(toast(page, "Bill paid.")).toBeVisible()
  await expect(row.getByText("Paid", { exact: true })).toBeVisible()
  await expect(row).toContainText("₹0")

  // Void that too; a free payment ("Other amount") of the whole amount also closes the bill.
  await row.getByRole("button", { name: /^Void the payment of / }).click()
  await dialog(page, "Void this payment?").getByRole("button", { name: "Void payment" }).click()
  await expect(toast(page, "Payment voided.")).toBeVisible()
  await row.getByRole("button", { name: "Pay Holiday card" }).click()
  pay = dialog(page, "Pay card")
  await pay.getByRole("radio", { name: "Other amount" }).check()
  await pay.getByLabel("Amount (₹)").fill("9,000")
  await pay.getByRole("button", { name: "Pay", exact: true }).click()
  await expect(toast(page, "Card payment saved.")).toBeVisible()
  await expect(row.getByText("Paid", { exact: true })).toBeVisible()
  await shot(page, "cards-box")

  // Total available fell only by what was paid from the bank (a transfer, not an expense).
  await page.goto("/income")
  await expect(page.getByText("₹91,000").first()).toBeVisible()
})

test("borrowing: received into an account, repay with interest, delete with its receipt", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("borrow"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "10,000" })
  await openPage(page)

  await box(page).getByRole("button", { name: "Add borrowing" }).click()
  let add = dialog(page, "Add borrowing")
  await add.getByLabel("Borrowed from").fill("Ravi")
  await add.getByLabel("Amount (₹)").fill("20,000")
  await add.getByRole("radio", { name: "Money received into an account" }).check()
  await add.getByLabel("Received into", { exact: true }).selectOption({ label: "HDFC Bank · ₹10,000" })
  await add.getByLabel("Due date (optional)").fill(daysAhead(10))
  await shot(page, "borrowing-add")
  await add.getByRole("button", { name: "Add borrowing" }).click()
  await expect(toast(page, "Borrowing added.")).toBeVisible()
  const ravi = cardRow(page, "Ravi")
  await expect(ravi).toContainText("₹20,000")
  await expect(ravi.locator("[data-slot=badge]")).toHaveText("Due")

  await ravi.getByRole("button", { name: "Repay Ravi" }).click()
  const repay = dialog(page, "Repay")
  await repay.getByLabel("Repaid (₹)").fill("5,000")
  await repay.getByLabel("Interest (₹, optional)").fill("100")
  await expect(repay).toContainText("Total ₹5,100")
  await repay.getByRole("button", { name: "Save repayment" }).click()
  await expect(toast(page, "Repayment saved.")).toBeVisible()
  await expect(ravi).toContainText("₹15,000") // what is still owed
  await ravi.getByRole("button", { name: /^Ravi/ }).click()
  await expect(ravi.getByRole("button", { name: "Delete Ravi" })).toHaveCount(0) // it has a repayment

  // A second borrowing, deleted: its money-received entry goes too.
  await box(page).getByRole("button", { name: "Add borrowing" }).click()
  add = dialog(page, "Add borrowing")
  await add.getByLabel("Borrowed from").fill("Meera")
  await add.getByLabel("Amount (₹)").fill("3,000")
  await add.getByRole("radio", { name: "Money received into an account" }).check()
  await add.getByRole("button", { name: "Add borrowing" }).click()
  await expect(toast(page, "Borrowing added.")).toBeVisible()
  const meera = cardRow(page, "Meera")
  await meera.getByRole("button", { name: /^Meera/ }).click()
  await meera.getByRole("button", { name: "Delete Meera" }).click()
  const del = dialog(page, "Delete Meera?")
  await expect(del).toContainText("It also removes the money-received entry and lowers HDFC Bank by ₹3,000.")
  await shot(page, "borrowing-delete")
  await del.getByRole("button", { name: "Delete borrowing" }).click()
  await expect(toast(page, "Borrowing deleted.")).toBeVisible()
  await expect(box(page).getByText("Meera")).toHaveCount(0)
})
