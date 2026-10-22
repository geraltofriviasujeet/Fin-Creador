import { type Page, expect } from "@playwright/test"
import { waitForAuthLink } from "./mailpit"

export const PASSWORD = "correct-horse-42"
export const CONFIRM_SUBJECT = "Confirm your Fin Creador account"
export const RESET_SUBJECT = "Reset your Fin Creador password"

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
  await expect(confirmationNeeded.or(page.getByRole("heading", { name: "Overview" }))).toBeVisible()
  if (await confirmationNeeded.isVisible()) {
    const link = await waitForAuthLink(email, CONFIRM_SUBJECT, { after: startedAt })
    await page.goto(link)
  }
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible()
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).first().click()
  await expect(page).toHaveURL(/\/sign-in/)
}
