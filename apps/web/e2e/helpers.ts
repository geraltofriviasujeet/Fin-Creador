import { type Page, expect } from "@playwright/test"
import { waitForAuthLink } from "./mailpit"

export const PASSWORD = "correct-horse-42"
export const CONFIRM_SUBJECT = "Confirm your FinCreador account"
export const RESET_SUBJECT = "Reset your FinCreador password"

/** A fresh address per test, so tests never share users. */
export function uniqueEmail(label: string) {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

export async function submitSignUp(page: Page, { name, email, password = PASSWORD }: { name: string; email: string; password?: string }) {
  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill(name)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
}

/**
 * Signs up and finishes email confirmation (or skips it if the project has confirmation
 * off and signs the user straight in). Ends signed in on the Overview page.
 */
export async function signUpConfirmed(page: Page, name: string, email: string) {
  const startedAt = Date.now() - 1000
  await submitSignUp(page, { name, email })
  const confirmationNeeded = page.getByText("Check your email for a link to confirm your account")
  await expect(confirmationNeeded.or(overviewHeading(page))).toBeVisible()
  if (await confirmationNeeded.isVisible()) {
    const link = await waitForAuthLink(email, CONFIRM_SUBJECT, { after: startedAt })
    await page.goto(link)
  }
  await expect(page).toHaveURL(/\/$/)
  await expect(overviewHeading(page)).toBeVisible()
}

/** The Overview page's greeting ("Good morning, Asha"). */
export const overviewHeading = (page: Page) => page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ })

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).first().click()
  await expect(page).toHaveURL(/\/sign-in/)
}

export const dialog = (page: Page, title: string) => page.getByRole("dialog", { name: title })
export const toast = (page: Page, text: string) => page.getByRole("region", { name: "Notifications" }).getByText(text)

/** Adds a bank account on the Income page (the page must be open). */
export async function addBank(page: Page, { bank, last4, opening, type = "Savings account" }: { bank: string; last4: string; opening: string; type?: string }) {
  await page.getByRole("button", { name: "Add bank account" }).first().click()
  const d = dialog(page, "Add bank account")
  await d.getByLabel("Bank name").selectOption(bank)
  await d.getByLabel("Account type").selectOption({ label: type })
  await d.getByLabel("Last 4 digits").fill(last4)
  await d.getByLabel("Opening balance").fill(opening)
  await d.getByRole("button", { name: "Add account" }).click()
  await expect(toast(page, "Account added.")).toBeVisible()
  await expect(d).toBeHidden()
}

/** Adds Cash in hand on the Income page (the page must be open). */
export async function addCash(page: Page, amount: string) {
  await page.getByRole("button", { name: "Add cash" }).first().click()
  const d = dialog(page, "Add cash")
  await d.getByLabel("Amount").fill(amount)
  await d.getByRole("button", { name: "Add cash" }).click()
  await expect(d).toBeHidden()
}

export type Entry = { type?: "Expense" | "Income" | "Transfer"; amount: string; category?: string; from: string; to?: string; note?: string; mode?: string }

/** Opens Add transaction from the topbar and saves one entry. */
export async function addEntry(page: Page, e: Entry) {
  await page.getByRole("link", { name: "Add transaction" }).first().click()
  await expect(dialog(page, "Add expense")).toBeVisible()
  const type = e.type ?? "Expense"
  if (type !== "Expense") await dialog(page, "Add expense").getByRole("radio", { name: type }).click()
  const d = dialog(page, `Add ${type.toLowerCase()}`)
  await d.getByLabel("Amount").fill(e.amount)
  if (type === "Transfer") {
    await d.getByLabel("From").selectOption({ label: e.from })
    await d.getByLabel("To").selectOption({ label: e.to! })
  } else {
    await d.getByLabel(type === "Income" ? "Source" : "Category").selectOption({ label: e.category! })
    await d.getByLabel(type === "Income" ? "Received into" : "Paid from").selectOption({ label: e.from })
  }
  if (e.mode) await d.getByLabel("Payment mode (optional)").selectOption({ label: e.mode })
  if (e.note) await d.getByLabel("Note").fill(e.note)
  await d.getByRole("button", { name: `Save ${type.toLowerCase()}` }).click()
  await expect(toast(page, `${type} saved.`)).toBeVisible()
  await expect(d).toBeHidden()
}
