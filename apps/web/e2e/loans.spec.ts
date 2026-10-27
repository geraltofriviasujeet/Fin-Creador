import { type Page, expect, test } from "@playwright/test"
import { addBank, addCash, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Loans & liabilities end to end (Sprint 8a, web), against the throwaway local Supabase.
// Expected figures come from packages/domain (loanEmiEstimate, defaultPaymentSplit,
// loanSchedule): ₹3,00,000 at 12% a year over 12 EMIs is an EMI of ₹26,654.64, the first
// split ₹23,654.64 principal + ₹3,000 interest, ₹19,855.63 interest in all. At most 8
// screenshots in e2e-screenshots/ for the owner's review.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

const PATH = "/loans-liabilities"
/** Today in the profile's default time zone (Asia/Kolkata), as the database computes it. */
const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
const firstOfMonth = () => `${todayInIndia().slice(0, 8)}01`
/** A date `months` ahead on the 5th (always valid, always after today for months ≥ 1). */
function monthsAhead(months: number) {
  const [y, m] = todayInIndia().split("-").map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + months, 5))
  return d.toISOString().slice(0, 10)
}

const loansList = (page: Page) => page.getByRole("region", { name: "Loans" })
const dueSoon = (page: Page) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Due soon" }) })

async function newUser(page: Page, label: string) {
  await signUpConfirmed(page, "Ravi Iyer", uniqueEmail(label))
}

async function openLoans(page: Page) {
  await page.goto(PATH)
  await expect(page.getByRole("heading", { level: 1, name: "Loans & liabilities" })).toBeVisible()
}

/** Adds the ₹3,00,000 personal loan (ongoing, this month's EMI still due on the 1st). */
async function addPersonalLoan(page: Page, { emi, shots = false }: { emi?: string; shots?: boolean } = {}) {
  await page.getByRole("button", { name: "Add loan" }).first().click()
  const d = dialog(page, "Add loan")
  await d.getByRole("radio", { name: "Personal loan" }).check()
  if (shots) await shot(page, "loans-add-type")
  await d.getByRole("button", { name: "Next" }).click()
  await d.getByLabel("Lender").fill("State Bank of India")
  await d.getByLabel("Sanctioned amount (₹)").fill("3,00,000")
  await d.getByLabel("Amount taken (₹)").fill("3,00,000")
  await d.getByLabel("Interest rate (% a year)").fill("12")
  await d.getByLabel("Tenure (months)").fill("12")
  await d.getByLabel("Owed today (₹)").fill("3,00,000")
  await d.getByLabel("EMIs left").fill("12")
  await d.getByRole("radio", { name: "Still due" }).check()
  await d.getByLabel("This month's EMI date").fill(firstOfMonth())
  // The estimate fills the EMI field until the person types their bank's EMI.
  await expect(d.getByLabel("EMI (₹)")).toHaveValue("26654.64")
  await expect(d).toContainText("Interest ₹19,855.63")
  if (emi) {
    await d.getByLabel("EMI (₹)").fill(emi)
    await expect(d).toContainText("Our estimate is ₹26,654.64")
  }
  if (shots) await shot(page, "loans-add-details")
  // Twice, quickly: the request key adds the loan once.
  await d.getByRole("button", { name: "Add loan" }).dblclick()
  await expect(toast(page, "Loan added.").first()).toBeVisible()
  await expect(d).toBeHidden()
}

test("navigation, empty state, and the Liabilities tab on a phone", async ({ browser, baseURL }) => {
  const page = await (await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })).newPage()
  await newUser(page, "loans-nav")
  const nav = page.getByRole("navigation", { name: "Main" }).first()
  // After Investments, same title as the page.
  const links = nav.getByRole("link")
  await expect(links.nth(5)).toHaveText("Investments")
  await expect(links.nth(6)).toHaveText("Loans & liabilities")
  await links.nth(6).click()
  await expect(page).toHaveURL(new RegExp(`${PATH}$`))
  await expect(page.getByRole("heading", { level: 1, name: "Loans & liabilities" })).toBeVisible()
  await expect(page.getByText("No loans yet")).toBeVisible()
  await expect(page).toHaveTitle(/Loans & liabilities/)
  // No loans: no Due soon card on the Overview.
  await page.goto("/")
  await expect(dueSoon(page)).toHaveCount(0)
  await page.close()

  const phone = await (await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })).newPage()
  await newUser(phone, "loans-phone")
  const tabs = phone.getByRole("navigation", { name: "Main" }).last()
  await expect(tabs.getByRole("link", { name: "Liabilities" })).toHaveAttribute("href", PATH)
  await tabs.getByRole("link", { name: "Liabilities" }).click()
  await expect(phone.getByRole("heading", { level: 1, name: "Loans & liabilities" })).toBeVisible()
  await expect(tabs.getByRole("link", { name: "Liabilities" })).toHaveAttribute("aria-current", "page")
  await phone.screenshot({ path: `${SHOTS}/loans-phone.png` }) // the viewport, with the tab bar at the bottom
  await phone.close()
})

test("add a loan (estimate, double submit once), pay an EMI, edit and void the payment", async ({ page }) => {
  await newUser(page, "loans-pay")
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addCash(page, "1,00,000")
  await openLoans(page)
  await addPersonalLoan(page, { shots: true })

  const row = loansList(page).getByRole("listitem").filter({ hasText: "State Bank of India" })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText("Personal loan")
  await expect(row).toContainText("₹3,00,000")
  await expect(row).toContainText("₹26,654.64")
  await expect(row.getByText(/^(Due|Overdue)$/)).toBeVisible()
  await expect(dueSoon(page)).toContainText("EMI 1")
  await expect(page.getByText("Loans are not in Total available")).toBeVisible()

  // The bell lists the same reminder (the shell's data loads with the page).
  await page.reload()
  await page.getByRole("button", { name: /^Notifications, 1 due$/ }).click()
  await expect(page.getByRole("dialog", { name: "Due soon" })).toContainText("EMI 1")
  await expect(page.getByRole("dialog", { name: "Due soon" })).toContainText("₹26,654.64")
  await page.keyboard.press("Escape")

  // Pay from Due soon: every account is offered with its balance, never any digits.
  await dueSoon(page).getByRole("button", { name: "Pay EMI 1 of State Bank of India" }).click()
  const pay = page.getByRole("dialog", { name: /^EMI 1, due / })
  const from = pay.getByLabel("Paid from")
  await expect(from.locator("option")).toHaveText(["HDFC Bank · ₹10,000", "Cash in hand · ₹1,00,000"])
  await expect(pay).not.toContainText("4821")
  await from.selectOption({ label: "Cash in hand · ₹1,00,000" })
  await expect(pay.getByLabel("Principal (₹)")).toHaveValue("23654.64")
  await expect(pay.getByLabel("Interest (₹)")).toHaveValue("3000")
  await expect(pay).toContainText("Total ₹26,654.64")
  await shot(page, "loans-pay")
  await pay.getByRole("button", { name: "Mark as paid" }).click()
  await expect(toast(page, "EMI paid.")).toBeVisible()
  await expect(pay).toBeHidden()
  await expect(row).toContainText("₹2,76,345.36") // 3,00,000 − 23,654.64
  await expect(dueSoon(page)).not.toContainText("EMI 1")

  // Posted from Cash in hand: principal as a transfer to the loan, interest as an expense.
  await page.goto("/transactions")
  await expect(page.getByText("EMI 1 · State Bank of India").first()).toBeVisible()
  await openLoans(page)

  // The schedule shows the payment; edit it (all parts together), then void it.
  await row.getByRole("button", { name: /^State Bank of India/ }).click()
  await row.getByRole("button", { name: "Show schedule (12)" }).click()
  const schedule = row.getByRole("table", { name: "Schedule of State Bank of India" })
  await expect(schedule.getByRole("row", { name: /^EMI 1 / })).toContainText("Paid")
  await shot(page, "loans-detail")
  await schedule.getByRole("button", { name: "Edit payment for EMI 1" }).click()
  const edit = dialog(page, "Edit payment for EMI 1")
  await expect(edit.getByLabel("Principal (₹)")).toHaveValue("23654.64")
  await edit.getByLabel("Fees (₹)").fill("100")
  await expect(edit).toContainText("Total ₹26,754.64")
  await edit.getByRole("button", { name: "Save payment" }).click()
  await expect(toast(page, "Payment saved.")).toBeVisible()
  await expect(schedule.getByRole("row", { name: /^EMI 1 / })).toContainText("₹26,754.64")

  await schedule.getByRole("button", { name: "Void payment for EMI 1" }).click()
  const voiding = dialog(page, "Void the payment for EMI 1?")
  await voiding.getByLabel("Reason (optional)").fill("Paid twice by mistake")
  await voiding.getByRole("button", { name: "Void payment" }).click()
  await expect(toast(page, "Payment voided.")).toBeVisible()
  await expect(row).toContainText("₹3,00,000")
  await expect(dueSoon(page)).toContainText("EMI 1")
})

test("shortfall: the warning on the EMI card and in the form, then Pay anyway", async ({ page }) => {
  await newUser(page, "loans-short")
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "10,000" })
  await openLoans(page)
  await addPersonalLoan(page, { emi: "27,000" })
  const row = loansList(page).getByRole("listitem").filter({ hasText: "State Bank of India" })
  // With the bank's EMI (₹27,000) the first EMI is still ₹27,000; no account covers it.
  await expect(row).toContainText("₹27,000")
  await expect(row.getByRole("note")).toHaveText("You need ₹17,000 more in HDFC Bank to pay this EMI")

  await row.getByRole("button", { name: "Pay EMI 1 of State Bank of India" }).click()
  const pay = page.getByRole("dialog", { name: /^EMI 1, due / })
  await expect(pay.getByRole("alert")).toContainText("You need ₹17,000 more in HDFC Bank to pay this EMI")
  await expect(pay.getByRole("button", { name: "Mark as paid" })).toHaveCount(0)
  await shot(page, "loans-shortfall")
  await pay.getByRole("button", { name: "Pay anyway" }).click()
  await expect(toast(page, "EMI paid.")).toBeVisible()
  await expect(pay).toBeHidden()
  await expect(row).toContainText("₹2,76,000") // 3,00,000 − (27,000 − 3,000 interest)

  // Will pay later: a planned date and account for EMI 2.
  await row.getByRole("button", { name: /^State Bank of India/ }).click()
  await row.getByRole("button", { name: "Will pay EMI 2 of State Bank of India later" }).click()
  const plan = page.getByRole("dialog", { name: /^EMI 2, due / })
  await expect(plan.getByRole("radio", { name: "Will pay later" })).toBeChecked()
  await plan.getByLabel("Pay on").fill(todayInIndia())
  await plan.getByRole("button", { name: "Save plan" }).click()
  await expect(toast(page, "Planned.")).toBeVisible()
  await expect(dueSoon(page)).toContainText("You planned to pay today")
  await expect(row).toContainText("planned for")

  // The Overview shows the same Due soon item.
  await page.goto("/")
  await expect(dueSoon(page)).toContainText("EMI 2")
  await expect(dueSoon(page).getByRole("link", { name: "Pay from Loans & liabilities" })).toHaveAttribute("href", PATH)
  await dueSoon(page).screenshot({ path: `${SHOTS}/loans-overview-due-soon.png` })
})

test("starts later with a moratorium, then archive, restore and delete", async ({ page }) => {
  await newUser(page, "loans-later")
  await openLoans(page)
  await page.getByRole("button", { name: "Add loan" }).first().click()
  const d = dialog(page, "Add loan")
  await d.getByRole("button", { name: "Next" }).click()
  await expect(d).toContainText("Choose a loan type")
  await d.getByRole("radio", { name: "Education loan" }).check()
  await d.getByRole("button", { name: "Next" }).click()
  await d.getByLabel("Lender").fill("Avanse Financial Services")
  await d.getByLabel("Sanctioned amount (₹)").fill("5,00,000")
  await d.getByLabel("Amount taken (₹)").fill("5,00,000")
  await d.getByLabel("Interest rate (% a year)").fill("10")
  await d.getByLabel("Tenure (months)").fill("60")
  await d.getByRole("radio", { name: "Starts later" }).check()
  await d.getByLabel("First EMI date").fill(monthsAhead(7))
  await d.getByLabel("Moratorium (months)").fill("6")
  await d.getByRole("radio", { name: "Added to the loan when EMIs start" }).check()
  // Simple interest for 6 months: 5,00,000 × 10% × 6 / 12.
  await expect(d).toContainText("Interest added when EMIs start (estimate ₹25,000)")
  await expect(d.getByLabel("EMI (₹)")).toHaveValue("11154.70")
  // No card or account numbers in names.
  await d.getByLabel("Nickname (optional)").fill("Card 1234")
  await d.getByRole("button", { name: "Add loan" }).click()
  await expect(d.getByText("Leave out card and account numbers")).toBeVisible()
  await d.getByLabel("Nickname (optional)").fill("Masters")
  await d.getByRole("button", { name: "Add loan" }).click()
  await expect(toast(page, "Loan added.")).toBeVisible()

  const row = loansList(page).getByRole("listitem").filter({ hasText: "Masters" })
  await expect(row.getByText("Not due yet")).toBeVisible()
  await row.getByRole("button", { name: /^Masters/ }).click()
  await expect(row).toContainText("Interest added when EMIs start (estimate ₹25,000)")

  await row.getByRole("button", { name: "Archive Masters" }).click()
  await dialog(page, "Archive Masters?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Loan archived.")).toBeVisible()
  await expect(page.getByText("No loans yet")).toBeVisible()
  await page.getByRole("button", { name: "Show archived (1)" }).click()
  await page.getByRole("button", { name: "Restore Masters" }).click()
  await expect(toast(page, "Loan restored.")).toBeVisible()
  await expect(loansList(page)).toContainText("Masters")

  await loansList(page).getByRole("button", { name: /^Masters/ }).click()
  await loansList(page).getByRole("button", { name: "Archive Masters" }).click()
  await dialog(page, "Archive Masters?").getByRole("button", { name: "Archive" }).click()
  await page.getByRole("button", { name: "Show archived (1)" }).click()
  await page.getByRole("button", { name: "Delete Masters permanently" }).click()
  await dialog(page, "Delete Masters permanently?").getByRole("button", { name: "Delete permanently" }).click()
  await expect(toast(page, "Loan deleted.")).toBeVisible()
  await expect(page.getByRole("button", { name: /^Show archived/ })).toHaveCount(0)
})
