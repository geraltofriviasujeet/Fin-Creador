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

  // The plan opens in a modal, from the checked plan: every line, where it came from, its sources.
  await answers.getByRole("button", { name: "Open the plan" }).click()
  const plan = page.getByRole("dialog")
  await expect(plan.getByRole("heading", { name: /^Plan: trip to Goa in January \d{4}$/ })).toBeVisible()
  await expect(plan.getByText(/^Estimates, not quotes or bookings\. Web prices are as pages listed them/)).toBeVisible()
  await expect(plan.locator('[data-line="stay"]')).toContainText("No estimate: the travel style was skipped.")
  await expect(plan.locator('[data-line="transport"]')).toContainText("Web estimate")
  await expect(plan.locator('[data-line="transport"]')).toContainText("listed on example.test")
  await expect(plan.locator('[data-line="buffer"]')).toContainText("Worked out by the app")
  await expect(plan.getByText("From your records", { exact: true })).toBeVisible()
  await expect(plan.getByText("With web estimates, not your records", { exact: true })).toBeVisible()
  await expect(plan.getByRole("region", { name: "Sources" }).getByRole("link", { name: "https://example.test/hotels" })).toBeVisible()
  await expect(plan.getByRole("region", { name: "Airlines listed for this route" })).toContainText("No airlines could be confirmed on the pages looked up, so none is suggested.")

  // Save as PDF: the browser's print, showing only the plan's copy, every link written out.
  await page.evaluate(() => {
    window.print = () => {}
  })
  await plan.getByRole("button", { name: "Save as PDF" }).click()
  await page.emulateMedia({ media: "print" })
  const printed = page.getByTestId("plan-print")
  await expect(printed).toBeVisible()
  await expect(page.getByRole("list", { name: "Roma's answers" })).toBeHidden()
  await expect(printed.getByText(/^Made on \d{4}-\d{2}-\d{2}\. Figures marked “From your goal”/)).toBeVisible()
  await expect(printed.getByRole("note").filter({ hasText: /^Estimates, not quotes or bookings\./ })).toBeVisible()
  await expect(printed.locator('[data-line="stay"]')).toContainText("No estimate")
  const after = await printed.locator('[data-line="transport"] a').first().evaluate((a) => getComputedStyle(a, "::after").content)
  expect(after).toContain("https://example.test/")
  await page.emulateMedia({ media: "screen" })
  await plan.getByRole("button", { name: "Close" }).click()

  // Reopened from the conversation, it says when it was made and that prices may have changed.
  await expect(page).toHaveURL(/\/roma\?c=/)
  await page.reload()
  await page.getByRole("list", { name: "Roma's answers" }).getByRole("button", { name: "Open the plan" }).click()
  await expect(page.getByRole("dialog").getByText(/^Made on \d{4}-\d{2}-\d{2}\. Web prices may have changed since this plan was made\./)).toBeVisible()
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
