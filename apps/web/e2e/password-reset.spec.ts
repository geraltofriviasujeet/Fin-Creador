import { expect, test } from "@playwright/test"
import { PASSWORD, RESET_SUBJECT, overviewHeading, signIn, signOut, signUpConfirmed, uniqueEmail } from "./helpers"
import { waitForAuthLink } from "./mailpit"

const NEW_PASSWORD = "brand-new-pass-77"
const GENERIC = "If an account exists for that email, we’ve sent a link to reset your password."

test("password reset by email, then sign in with the new password only", async ({ page }) => {
  const email = uniqueEmail("reset")
  await signUpConfirmed(page, "Forgetful User", email)
  await signOut(page)

  const startedAt = Date.now() - 1000
  await page.goto("/forgot-password")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Send reset link" }).click()
  await expect(page.getByText(GENERIC)).toBeVisible()

  await page.goto(await waitForAuthLink(email, RESET_SUBJECT, { after: startedAt }))
  await expect(page).toHaveURL(/\/update-password/)
  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel("Confirm new password").fill("does-not-match-1")
  await page.getByRole("button", { name: "Update password" }).click()
  await expect(page.getByText("Passwords do not match")).toBeVisible()

  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD)
  await page.getByRole("button", { name: "Update password" }).click()
  await expect(page.getByText("Password updated.")).toBeVisible()

  await signOut(page)
  await signIn(page, email, PASSWORD)
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible()
  await signIn(page, email, NEW_PASSWORD)
  await expect(overviewHeading(page)).toBeVisible()
})

test("forgot password gives the same answer for unknown emails", async ({ page }) => {
  await page.goto("/forgot-password")
  await page.getByLabel("Email").fill(uniqueEmail("unknown"))
  await page.getByRole("button", { name: "Send reset link" }).click()
  await expect(page.getByText(GENERIC)).toBeVisible()
})

test("the update-password page needs a reset link", async ({ page }) => {
  await page.goto("/update-password")
  await expect(page).toHaveURL(/\/forgot-password\?notice=link-expired|\/forgot-password/)
  await expect(page.getByText("Your reset link has expired.")).toBeVisible()
})
