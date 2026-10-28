import { type Page, expect, test } from "@playwright/test"
import { addBank, addEntry, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Credit cards and informal borrowing end to end (Sprint 8b, web), against the throwaway local
// Supabase. A card added owing ₹6,000; a ₹2,000 purchase; a statement of ₹10,000 with a ₹1,000
// card EMI (bill ₹9,000) and ₹8,000 recorded, so ₹1,000 is added as the difference. Borrowing
// with a one-time settlement and with instalments (Sprint 8b follow-up). Screenshots in
// e2e-screenshots/ for the owner's review.

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
  await add.getByLabel("Card issuer").selectOption("HDFC Bank")
  await add.getByLabel("Card", { exact: true }).selectOption("HDFC Regalia Gold")
  await add.getByLabel("Label if you hold two of the same card (optional)").fill("Holiday card 9")
  await add.getByLabel("Credit limit (₹)").fill("1,00,000")
  await add.getByLabel("Statement day").fill(dayOfMonth())
  await add.getByLabel("Due day").fill("28")
  await add.getByLabel("Owed now (₹)").fill("6,000")
  await add.getByRole("button", { name: "Add card" }).click()
  await expect(add.getByText("Leave out numbers: no card or account digits in names")).toBeVisible()
  await add.getByLabel("Label if you hold two of the same card (optional)").fill("Holiday card")
  await shot(page, "card-add-product")
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
  // The page has refreshed once the badge is no longer "Minimum paid" (₹9,000 is also the bill shown).
  await expect(row.getByText("Minimum paid")).toHaveCount(0)
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

test("a card typed under Other is named after its issuer", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("cardother"))
  await openPage(page)
  await box(page).getByRole("button", { name: "Add card" }).click()
  const add = dialog(page, "Add card")
  await add.getByLabel("Card issuer").selectOption("Axis Bank")
  await add.getByLabel("Card", { exact: true }).selectOption("Other")
  await add.getByLabel("Card name").fill("Card 123")
  await add.getByLabel("Credit limit (₹)").fill("50,000")
  await add.getByLabel("Statement day").fill("5")
  await add.getByLabel("Due day").fill("25")
  await add.getByRole("button", { name: "Add card" }).click()
  await expect(add.getByText("Leave out card numbers: no 3 or more digits in a row")).toBeVisible()
  await add.getByLabel("Card name").fill("Travel Edge")
  await expect(add).toContainText("Shown as “Axis Bank Travel Edge”")
  await add.getByRole("button", { name: "Add card" }).click()
  await expect(toast(page, "Card added.")).toBeVisible()
  await expect(cardRow(page, "Axis Bank Travel Edge")).toContainText("Axis Bank · credit card")
})

test("borrowing: one-time settlement with interest, pay prefilled from the plan, delete with its receipt", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("borrow"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "10,000" })
  await openPage(page)

  await box(page).getByRole("button", { name: "Add borrowing" }).click()
  let add = dialog(page, "Add borrowing")
  await add.getByLabel("Borrowed from").fill("Ravi 7")
  await add.getByLabel("Who they are to you").selectOption({ label: "Friends" })
  await add.getByLabel("Borrowed for (optional)").fill("Bike repair")
  await add.getByLabel("Amount borrowed (₹)").fill("20,000")
  await add.getByRole("radio", { name: "Money received into an account" }).check()
  await add.getByLabel("Received into", { exact: true }).selectOption({ label: "HDFC Bank · ₹10,000" })
  await expect(add.getByRole("radio", { name: "One-time settlement" })).toHaveCount(0) // only after a return date
  await add.getByLabel("Return the same as borrowed").uncheck()
  await add.getByLabel("How much to return (₹)").fill("21,000")
  await expect(add).toContainText("Interest or charges ₹1,000")
  await add.getByLabel("Return date (optional)").fill(daysAhead(10))
  await add.getByRole("radio", { name: "One-time settlement" }).check()
  await add.getByLabel("Return from").selectOption({ label: "HDFC Bank · ₹10,000" })
  await expect(add.getByRole("list", { name: "Return schedule" }).getByRole("listitem")).toHaveCount(1)
  await expect(add.getByRole("list", { name: "Return schedule" })).toContainText("₹21,000 · interest ₹1,000")
  await expect(add).toContainText("Nothing is deducted until you confirm Paid.")
  await add.getByRole("button", { name: "Add borrowing" }).click()
  await expect(add.getByText("Leave out numbers: no card or account digits in names")).toBeVisible()
  await add.getByLabel("Borrowed from").fill("Ravi")
  await shot(page, "borrowing-add-once")
  await add.getByRole("button", { name: "Add borrowing" }).click()
  await expect(toast(page, "Borrowing added.")).toBeVisible()
  const ravi = cardRow(page, "Ravi")
  await expect(ravi).toContainText("₹20,000")
  await expect(ravi).toContainText("Friends · Bike repair")
  await expect(ravi).toContainText("₹21,000 due")
  await expect(ravi.locator("[data-slot=badge]")).toHaveText("Due")

  // Nothing is deducted by the plan: the bank holds what it had plus what was received.
  await page.goto("/income")
  await expect(page.getByText("₹30,000").first()).toBeVisible()
  await openPage(page)

  // Pay: the plan's account, the principal and the interest are prefilled; change and confirm.
  await ravi.getByRole("button", { name: "Repay Ravi" }).click()
  const pay = dialog(page, "Pay")
  await expect(pay.getByLabel("Paid from")).toHaveValue(/.+/)
  await expect(pay.getByLabel("Paid from").locator("option:checked")).toHaveText("HDFC Bank · ₹30,000")
  await expect(pay.getByLabel("Repaid (₹)")).toHaveValue("20,000")
  await expect(pay.getByLabel("Interest (₹, optional)")).toHaveValue("1,000")
  await pay.getByLabel("Repaid (₹)").fill("5,000")
  await pay.getByLabel("Interest (₹, optional)").fill("100")
  await expect(pay).toContainText("Total ₹5,100")
  await pay.getByRole("button", { name: "Paid", exact: true }).click()
  await expect(toast(page, "Repayment saved.")).toBeVisible()
  await expect(ravi).toContainText("₹15,000") // what is still owed
  await expect(ravi).toContainText("₹15,900 due") // what is left of the settlement
  await ravi.getByRole("button", { name: /^Ravi/ }).click()
  await expect(ravi.getByRole("button", { name: "Delete Ravi" })).toHaveCount(0) // it has a repayment

  // A second borrowing into the bank, deleted: its money-received entry goes too.
  await box(page).getByRole("button", { name: "Add borrowing" }).click()
  add = dialog(page, "Add borrowing")
  await add.getByLabel("Borrowed from").fill("Meera")
  await add.getByLabel("Who they are to you").selectOption({ label: "Family" })
  await add.getByLabel("Amount borrowed (₹)").fill("3,000")
  await add.getByRole("radio", { name: "Money received into an account" }).check()
  await add.getByRole("button", { name: "Add borrowing" }).click()
  await expect(toast(page, "Borrowing added.")).toBeVisible()
  const meera = cardRow(page, "Meera")
  await meera.getByRole("button", { name: /^Meera/ }).click()
  await meera.getByRole("button", { name: "Delete Meera" }).click()
  const del = dialog(page, "Delete Meera?")
  await expect(del).toContainText("It also removes the money-received entry and lowers HDFC Bank by ₹3,000.")
  await del.getByRole("button", { name: "Delete borrowing" }).click()
  await expect(toast(page, "Borrowing deleted.")).toBeVisible()
  await expect(box(page).getByText("Meera")).toHaveCount(0)
})

test("borrowing in instalments: pay one from the planned account, void it, plan later, change the plan", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("instal"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "50,000" })
  await openPage(page)

  // ₹12,000 received earlier; ₹12,300 to return in 3 instalments of ₹4,100 (₹100 interest each).
  await box(page).getByRole("button", { name: "Add borrowing" }).click()
  const add = dialog(page, "Add borrowing")
  await add.getByLabel("Borrowed from").fill("Gopal")
  await add.getByLabel("Who they are to you").selectOption({ label: "Family" })
  await add.getByLabel("Amount borrowed (₹)").fill("12,000")
  await add.getByRole("radio", { name: "Already received earlier: record only what I owe" }).check()
  await add.getByLabel("Return the same as borrowed").uncheck()
  await add.getByLabel("How much to return (₹)").fill("12,300")
  await add.getByLabel("Return date (optional)").fill(daysAhead(5))
  await add.getByRole("radio", { name: "Instalments" }).check()
  await expect(add.getByLabel("First instalment on")).toHaveValue(daysAhead(5))
  await add.getByLabel("Number of instalments").fill("3")
  await add.getByLabel("Return from").selectOption({ label: "HDFC Bank · ₹50,000" })
  const preview = add.getByRole("list", { name: "Return schedule" })
  await expect(preview.getByRole("listitem")).toHaveCount(3)
  await expect(preview.getByRole("listitem").nth(2)).toContainText("₹4,100 · interest ₹100")
  await shot(page, "borrowing-add-instalments")
  await add.getByRole("button", { name: "Add borrowing" }).click()
  await expect(toast(page, "Borrowing added.")).toBeVisible()
  const gopal = cardRow(page, "Gopal")
  await expect(gopal).toContainText("Instalment 1 of 3: ₹4,100 due")
  await gopal.getByRole("button", { name: /^Gopal/ }).click()
  await expect(gopal.getByRole("button", { name: /^Pay the .* payment to Gopal$/ })).toHaveCount(3)
  await shot(page, "borrowing-instalments")

  // Pay the first: prefilled from the plan (₹4,000 + ₹100 interest from HDFC Bank).
  await gopal.getByRole("button", { name: /^Pay the .* payment to Gopal$/ }).first().click()
  const pay = dialog(page, "Pay instalment 1")
  await expect(pay.getByLabel("Paid from").locator("option:checked")).toHaveText("HDFC Bank · ₹50,000")
  await expect(pay.getByLabel("Repaid (₹)")).toHaveValue("4,000")
  await expect(pay.getByLabel("Interest (₹, optional)")).toHaveValue("100")
  await shot(page, "borrowing-pay-instalment")
  await pay.getByRole("button", { name: "Paid", exact: true }).click()
  await expect(toast(page, "Repayment saved.")).toBeVisible()
  await expect(gopal).toContainText("Instalment 2 of 3: ₹4,100 due")
  await expect(gopal.getByRole("button", { name: /^Pay the .* payment to Gopal$/ })).toHaveCount(2)

  // Void it: the first instalment is due again.
  await gopal.getByRole("button", { name: /^Void the payment of / }).click()
  await dialog(page, "Void this repayment?").getByRole("button", { name: "Void payment" }).click()
  await expect(toast(page, "Payment voided.")).toBeVisible()
  await expect(gopal).toContainText("Instalment 1 of 3: ₹4,100 due")

  // Will pay later on the first, then a new plan drops it (with a warning).
  await gopal.getByRole("button", { name: /^Will pay the .* payment later$/ }).first().click()
  const later = dialog(page, "Will pay later")
  await later.getByRole("button", { name: "Save plan" }).click()
  await expect(toast(page, "Planned.")).toBeVisible()
  await expect(gopal).toContainText("planned") // the page has refreshed
  await gopal.getByRole("button", { name: "Change the return plan of Gopal" }).click()
  const edit = dialog(page, "Edit return plan")
  await expect(edit).toContainText("the “Will pay later” plan on pending instalments will be dropped")
  await edit.getByRole("radio", { name: "One-time settlement" }).check()
  await expect(edit.getByRole("list", { name: "Return schedule" }).getByRole("listitem")).toHaveCount(1)
  await shot(page, "borrowing-edit-plan")
  await edit.getByRole("button", { name: "Save return plan" }).click()
  await expect(toast(page, "Return plan saved.")).toBeVisible()
  await expect(gopal).toContainText("₹12,300 due")
  await expect(gopal.getByRole("button", { name: /^Pay the .* payment to Gopal$/ })).toHaveCount(1)

  // Nothing left the bank without a confirmed payment.
  await page.goto("/income")
  await expect(page.getByText("₹50,000").first()).toBeVisible()
})
