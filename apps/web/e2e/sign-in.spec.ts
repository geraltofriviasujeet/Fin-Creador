import { expect, test } from "@playwright/test"
import { signIn, signOut, signUpConfirmed, uniqueEmail } from "./helpers"

test("signed-out visitors are sent to sign-in and returned to the page they wanted", async ({ page }) => {
  const email = uniqueEmail("next")
  await signUpConfirmed(page, "Return Trip", email)
  await signOut(page)
  await expect(page.getByText("You’ve signed out.")).toBeVisible()

  await page.goto("/settings")
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings/)

  await signIn(page, email, "wrong-password-1")
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible()
  await expect(page.getByLabel("Email")).toHaveValue(email)

  await signIn(page, email)
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
})

test("the next parameter cannot send users to another site", async ({ page, baseURL }) => {
  const email = uniqueEmail("redirect")
  await signUpConfirmed(page, "Safe Redirect", email)
  await signOut(page)

  await page.goto("/sign-in?next=//evil.example/steal")
  await signIn(page, email)
  await expect(page).toHaveURL(`${baseURL}/`)
})

test("an unknown email gets the same message as a wrong password", async ({ page }) => {
  await page.goto("/sign-in")
  await signIn(page, uniqueEmail("nobody"), "whatever-123")
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible()
})

test("sign-out ends the session", async ({ page }) => {
  await signUpConfirmed(page, "Leaving Now", uniqueEmail("signout"))
  await signOut(page)
  await page.goto("/")
  await expect(page).toHaveURL(/\/sign-in/)
})
