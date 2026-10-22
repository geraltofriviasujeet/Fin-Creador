import { expect, test } from "@playwright/test"
import { CONFIRM_SUBJECT, PASSWORD, signIn, signUpConfirmed, submitSignUp, uniqueEmail } from "./helpers"
import { countEmails, waitForAuthLink } from "./mailpit"

test("sign-up validates input and keeps what was typed", async ({ page }) => {
  await page.goto("/sign-up")
  await page.getByLabel("Email").fill("not-an-email")
  await page.getByLabel("Password", { exact: true }).fill("short")
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page.getByText("Please fix the highlighted fields.")).toBeVisible()
  await expect(page.getByText("Enter your name")).toBeVisible()
  await expect(page.getByText("Enter a valid email address")).toBeVisible()
  await expect(page.getByText("Use at least 8 characters")).toBeVisible()
  await expect(page.getByLabel("Email")).toHaveValue("not-an-email")
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("") // passwords are never echoed
})

test("sign-up with email confirmation lands in the app with the user's name", async ({ page }) => {
  const email = uniqueEmail("signup")
  await signUpConfirmed(page, "Asha Rao", email)
  await expect(page.getByText("Asha Rao").first()).toBeVisible() // sidebar profile row
  await expect(page.getByText(email).first()).toBeVisible()
})

test("signing up again with a registered email gives the same answer (no account enumeration)", async ({ page }) => {
  const email = uniqueEmail("dupe")
  await signUpConfirmed(page, "First Person", email)
  await page.context().clearCookies()

  await submitSignUp(page, { name: "Someone Else", email, password: "another-pass-99" })
  await expect(page.getByText("Check your email for a link to confirm your account")).toBeVisible()
})

test("an unconfirmed account cannot sign in and can resend the confirmation", async ({ page }) => {
  const email = uniqueEmail("unconfirmed")
  const startedAt = Date.now() - 1000
  await submitSignUp(page, { name: "Not Yet", email })
  await expect(page.getByText("Check your email for a link to confirm your account")).toBeVisible()
  await waitForAuthLink(email, CONFIRM_SUBJECT, { after: startedAt })
  const before = await countEmails(email, CONFIRM_SUBJECT)

  await page.goto("/sign-in")
  await signIn(page, email, PASSWORD)
  await expect(page.getByText("Please confirm your email first.")).toBeVisible()

  await page.getByRole("button", { name: "Resend confirmation email" }).click()
  await expect(page.getByText("If that email still needs confirming, we’ve sent a new link.")).toBeVisible()
  await expect.poll(() => countEmails(email, CONFIRM_SUBJECT)).toBeGreaterThan(before)
})

test("a tampered confirmation link is rejected", async ({ page }) => {
  await page.goto("/auth/callback?token_hash=not-a-real-token&type=email&next=/")
  await expect(page).toHaveURL(/\/sign-in/)
  await expect(page.getByText("That link is invalid or has expired.")).toBeVisible()
})
