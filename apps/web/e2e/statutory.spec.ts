import { type Page, expect, test } from "@playwright/test"
import { addBank, addCash, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Statutory and legal dues end to end (Sprint 8d, web), against the throwaway local Supabase.
// A ₹10,000 income tax due tomorrow, paid in two parts (one with interest) from the bank, one
// part voided; a ₹1,000 traffic fine already overdue, paid from cash with "Pay anyway", then
// archived; a property tax deleted (never paid); the bell opens a due's pay dialog. Screenshots
// in e2e-screenshots/ for the owner's review.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

const PATH = "/loans-liabilities"
const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
function daysAhead(days: number) {
  const [y, m, d] = todayInIndia().split("-").map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

const box = (page: Page) => page.getByRole("region", { name: "Statutory & legal liabilities" })
const dueRow = (page: Page, name: string) => box(page).getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${name}`) }) }).first()

async function openPage(page: Page) {
  await page.goto(PATH)
  await expect(page.getByRole("heading", { level: 1, name: "Loans & Liabilities" })).toBeVisible()
}

test("statutory dues: add, pay in parts with interest, void, Pay anyway, archive, delete, reminders", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("statutory"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "50,000" })
  await addCash(page, "100")
  await openPage(page)
  await expect(box(page)).toContainText("No dues yet")

  // Income tax due tomorrow, to pay from the bank. Nothing is posted yet.
  await box(page).getByRole("button", { name: "Add due" }).click()
  let add = dialog(page, "Add due")
  await add.getByRole("radio", { name: "Income tax payable" }).check()
  await add.getByLabel("Description (optional)").fill("Advance tax")
  await add.getByLabel("Amount (₹)").fill("10,000")
  await add.getByLabel("Due date").fill(daysAhead(1))
  await add.getByLabel("Pay from (optional)").selectOption({ label: "HDFC Bank · ₹50,000" })
  await expect(add).toContainText("Nothing is deducted until you confirm Paid.")
  await expect(add.getByLabel("Vehicle (optional)")).toHaveCount(0) // fine details only on a fine
  await shot(page, "statutory-add-tax")
  // Twice, quickly: the request key adds it once.
  await add.getByRole("button", { name: "Add due" }).dblclick()
  await expect(toast(page, "Due added.").first()).toBeVisible()
  const tax = dueRow(page, "Income tax · Advance tax")
  await expect(box(page).getByRole("listitem").filter({ hasText: "Advance tax" })).toHaveCount(1)
  await expect(tax).toContainText("₹10,000")
  await expect(tax.locator("[data-slot=badge]")).toHaveText("Due")

  // Due soon lists it (due tomorrow); its Pay opens the pay dialog, prefilled from the due.
  const dueSoon = page.getByRole("heading", { name: "Due soon" }).locator("..")
  await dueSoon.getByRole("button", { name: /^Pay .*Income tax · Advance tax$/ }).click()
  let pay = dialog(page, "Pay")
  await expect(pay.getByLabel("Paid from").locator("option:checked")).toHaveText("HDFC Bank · ₹50,000")
  await expect(pay.getByLabel("Amount paid (₹)")).toHaveValue("10,000")
  await pay.getByLabel("Amount paid (₹)").fill("4,000")
  await pay.getByLabel("Interest or penalty (₹, optional)").fill("200")
  await expect(pay).toContainText("Total ₹4,200")
  await shot(page, "statutory-pay-part")
  await pay.getByRole("button", { name: "Paid", exact: true }).click()
  await expect(toast(page, "Payment saved.")).toBeVisible()
  await expect(tax.locator("[data-slot=badge]")).toHaveText("Part-paid, ₹6,000 left")

  // More than is left is refused; the rest closes it.
  await tax.getByRole("button", { name: "Pay Income tax · Advance tax" }).click()
  pay = dialog(page, "Pay the rest")
  await expect(pay.getByLabel("Amount paid (₹)")).toHaveValue("6,000")
  await pay.getByLabel("Amount paid (₹)").fill("6,001")
  await pay.getByRole("button", { name: "Paid", exact: true }).click()
  await expect(pay.getByText("That's more than is still due (₹6,000)")).toBeVisible()
  await pay.getByLabel("Amount paid (₹)").fill("6,000")
  await pay.getByRole("button", { name: "Paid", exact: true }).click()
  await expect(toast(page, "Payment saved.")).toBeVisible()
  await expect(tax.locator("[data-slot=badge]")).toHaveText("Paid")

  // Void the second part: ₹6,000 is due again.
  await tax.getByRole("button", { name: /^Income tax · Advance tax/ }).click()
  await tax.getByRole("button", { name: /^Void the payment of / }).first().click()
  await dialog(page, "Void this payment?").getByRole("button", { name: "Void payment" }).click()
  await expect(toast(page, "Payment voided.")).toBeVisible()
  await expect(tax.locator("[data-slot=badge]")).toHaveText("Part-paid, ₹6,000 left")
  await expect(tax.getByRole("button", { name: "Delete Income tax · Advance tax" })).toHaveCount(0) // it has payments

  // A traffic fine already overdue: no numbers in the description; vehicle, state and city.
  await box(page).getByRole("button", { name: "Add due" }).click()
  add = dialog(page, "Add due")
  await add.getByRole("radio", { name: "Traffic e-challan or other fine" }).check()
  await add.getByLabel("Description (optional)").fill("Challan 1234")
  await add.getByLabel("Amount (₹)").fill("1,000")
  await add.getByLabel("Due date").fill(daysAhead(-2))
  await add.getByLabel("Vehicle (optional)").selectOption({ label: "Two-wheeler" })
  await add.getByLabel("Issued in state (optional)").selectOption("Karnataka")
  await add.getByLabel("City (optional)").selectOption("Bengaluru")
  await add.getByLabel("Pay from (optional)").selectOption({ label: "Cash in hand · ₹100" })
  await add.getByRole("button", { name: "Add due" }).click()
  await expect(add.getByText("Leave out challan, vehicle and account numbers: no 4 or more digits in a row")).toBeVisible()
  await add.getByLabel("Description (optional)").fill("Signal jump")
  await shot(page, "statutory-add-fine")
  await add.getByRole("button", { name: "Add due" }).click()
  await expect(toast(page, "Due added.")).toBeVisible()
  const fine = dueRow(page, "Fine · Signal jump")
  await expect(fine).toContainText("Two-wheeler · Bengaluru")
  await expect(fine.locator("[data-slot=badge]")).toHaveText("Overdue")

  // Pay it from cash (₹100): the shortfall warning, then Pay anyway. A fine has no interest.
  await fine.getByRole("button", { name: "Pay Fine · Signal jump" }).click()
  pay = dialog(page, "Pay")
  await expect(pay.getByLabel("Interest or penalty (₹, optional)")).toHaveCount(0)
  await expect(pay.getByText("You need ₹900 more in Cash in hand to pay this due.")).toBeVisible()
  await shot(page, "statutory-shortfall")
  await pay.getByRole("button", { name: "Pay anyway" }).click()
  await expect(toast(page, "Payment saved.")).toBeVisible()
  await expect(fine.locator("[data-slot=badge]")).toHaveText("Paid")

  // Archive the paid fine; restore it from Archived.
  await fine.getByRole("button", { name: /^Fine · Signal jump/ }).click()
  await fine.getByRole("button", { name: "Archive Fine · Signal jump" }).click()
  await dialog(page, "Archive Fine · Signal jump?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Due archived.")).toBeVisible()
  await expect(box(page).getByRole("button", { name: "Show archived (1)" })).toBeVisible()

  // A property tax never paid is deleted.
  await box(page).getByRole("button", { name: "Add due" }).click()
  add = dialog(page, "Add due")
  await add.getByRole("radio", { name: "Other statutory due" }).check()
  await add.getByRole("button", { name: "Add due" }).click()
  await expect(add.getByText("Say what it is, e.g. Property tax")).toBeVisible()
  await add.getByLabel("What it is").fill("Property tax")
  await add.getByLabel("Amount (₹)").fill("2,000")
  await add.getByLabel("Due date").fill(daysAhead(30))
  await add.getByRole("button", { name: "Add due" }).click()
  await expect(toast(page, "Due added.")).toBeVisible()
  const property = dueRow(page, "Property tax")
  await property.getByRole("button", { name: /^Property tax/ }).click()
  await property.getByRole("button", { name: "Delete Property tax" }).click()
  await dialog(page, "Delete Property tax?").getByRole("button", { name: "Delete due" }).click()
  await expect(toast(page, "Due deleted.")).toBeVisible()
  await expect(box(page).getByText("Property tax")).toHaveCount(0)
  await shot(page, "statutory-box")

  // The bell: the tax (due tomorrow, ₹6,000 left) opens its pay dialog here.
  await page.getByRole("button", { name: /^Notifications/ }).click()
  await page.getByRole("link", { name: /Income tax · Advance tax/ }).click()
  await expect(dialog(page, "Pay the rest")).toBeVisible()
  await expect(dialog(page, "Pay the rest").getByLabel("Amount paid (₹)")).toHaveValue("6,000")
  await shot(page, "statutory-bell")
  await page.keyboard.press("Escape")

  // Payments are expenses: Taxes (₹4,000), Fines & penalties (₹200 interest, ₹1,000 fine).
  await page.goto("/transactions")
  await expect(page.getByText("Taxes").first()).toBeVisible()
  await expect(page.getByText("Fines & penalties").first()).toBeVisible()
  // The bank lost only what was paid from it (₹4,200); cash went ₹900 below zero.
  await page.goto("/income")
  await expect(page.getByText("₹45,800").first()).toBeVisible()
})
