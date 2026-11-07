import { expect, test } from "@playwright/test"
import { signUpConfirmed, uniqueEmail } from "./helpers"

// Roma's detailed plans (10.9) end to end on the mock provider and mock search (playwright.config.ts):
// no paid API, no credit. The intake asks only what the question didn't say, each question can
// be skipped, and a skipped field comes back as "no estimate" while the plan still runs.

test("a trip plan: only the missing question is asked, it can be skipped, and the plan comes back", async ({ page }) => {
  await signUpConfirmed(page, "Kabir Rao", uniqueEmail("roma-plan"))
  await page.goto("/settings")
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByRole("status").getByText("Roma is on.")).toBeVisible()

  await page.goto("/roma")
  await page.getByLabel("Your question").fill("Plan my trip to Goa in January for 2 people, 4 nights")
  await page.getByRole("button", { name: "Ask Roma" }).click()

  // The intake, not an answer: only the stay style is missing.
  const intake = page.getByRole("form", { name: "Plan questions" })
  await expect(intake).toBeVisible()
  await expect(intake.getByText(/From your question: Goa, \d{4}-01, 4 nights, 2 travellers\./)).toBeVisible()
  await expect(intake.getByRole("combobox")).toHaveCount(1)
  await expect(intake.getByLabel("What kind of stay?", { exact: true })).toBeVisible()
  await expect(page.getByRole("list", { name: "Roma's answers" })).toHaveCount(0)

  await intake.getByRole("button", { name: "Skip: What kind of stay?" }).click()
  await expect(intake.getByText("Skipped: this shows as no estimate.")).toBeVisible()
  await intake.getByRole("button", { name: "Make the plan" }).click()

  const answers = page.getByRole("list", { name: "Roma's answers" })
  await expect(answers.getByText(/^Plan: trip to Goa in January \d{4}\. 6 of 7 cost lines have an estimate\./)).toBeVisible()
  await expect(answers.getByText(/These are estimates, not quotes or bookings\./)).toBeVisible()
  await expect(intake).toHaveCount(0)

})

test("a plan question can be sent as an ordinary question instead", async ({ page }) => {
  await signUpConfirmed(page, "Asha Menon", uniqueEmail("roma-plan-ask"))
  await page.goto("/settings")
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByRole("status").getByText("Roma is on.")).toBeVisible()

  await page.goto("/roma")
  await page.getByLabel("Your question").fill("Can I buy a car?")
  await page.getByRole("button", { name: "Ask Roma" }).click()
  const intake = page.getByRole("form", { name: "Plan questions" })
  await expect(intake.getByLabel("Which make?", { exact: true })).toBeVisible()
  await expect(intake.getByLabel("Which model?", { exact: true })).toBeDisabled()
  await intake.getByLabel("Which make?", { exact: true }).selectOption("Hyundai")
  await expect(intake.getByLabel("Which model?", { exact: true })).toBeEnabled()
  await intake.getByRole("button", { name: "Cancel" }).click()
  await expect(intake).toHaveCount(0)
  await expect(page.getByRole("list", { name: "Roma's answers" })).toHaveCount(0)
})
