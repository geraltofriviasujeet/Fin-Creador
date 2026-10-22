import { expect, test } from "@playwright/test"
import { signIn, signOut, signUpConfirmed, uniqueEmail } from "./helpers"

test("profile changes are validated, saved and still there after signing in again", async ({ page }) => {
  const email = uniqueEmail("profile")
  await signUpConfirmed(page, "Profile Person", email)
  await page.goto("/settings")

  // India-first defaults from the sign-up trigger.
  await expect(page.getByLabel("Name")).toHaveValue("Profile Person")
  await expect(page.getByLabel("Country")).toHaveValue("IN")
  await expect(page.getByLabel("Currency")).toHaveValue("INR")
  await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Kolkata")

  await page.getByLabel("Phone (optional)").fill("12345")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Use international format, e.g. +91 98765 43210")).toBeVisible()

  await page.getByLabel("Name").fill("Renamed Person")
  await page.getByLabel("Phone (optional)").fill("+91 98765 43210")
  await page.getByLabel("Currency").selectOption("USD")
  await page.getByLabel("Time zone").selectOption("America/New_York")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Profile saved.")).toBeVisible()

  await signOut(page)
  await signIn(page, email)
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible() // sign-in finished
  await page.goto("/settings")
  await expect(page.getByLabel("Name")).toHaveValue("Renamed Person")
  await expect(page.getByLabel("Phone (optional)")).toHaveValue("+919876543210")
  await expect(page.getByLabel("Currency")).toHaveValue("USD")
  await expect(page.getByLabel("Time zone")).toHaveValue("America/New_York")
  await expect(page.getByText("Renamed Person").first()).toBeVisible() // sidebar
})
