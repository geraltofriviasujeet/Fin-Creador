import { expect, test } from "@playwright/test"
import { signUpConfirmed, uniqueEmail } from "./helpers"

// Roma's detailed plans (10.9) end to end on the mock provider and mock search (playwright.config.ts):
// no paid API, no credit. The intake asks only what the question didn't say, each question can
// be skipped, and a skipped field comes back as "no estimate" while the plan still runs.
// Screenshots of the modal and its PDF go to e2e-screenshots/ for comparison with docs/design/roma.

const SHOTS = "e2e-screenshots"

test("a trip plan: only the missing question is asked, it can be skipped, and the plan comes back", async ({ page }) => {
  await signUpConfirmed(page, "Kabir Rao", uniqueEmail("roma-plan"))
  await page.goto("/settings")
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByRole("status").getByText("Roma is on.")).toBeVisible()

  await page.goto("/roma")
  await page.getByLabel("Your question").fill("Plan my trip to Goa in January for 2 people, 4 nights")
  await page.getByRole("button", { name: "Ask Roma" }).click()

  // The intake, not an answer: where from (always asked) and the stay style.
  const intake = page.getByRole("form", { name: "Plan questions" })
  await expect(intake).toBeVisible()
  await expect(intake.getByText(/From your question: Goa, \d{4}-01, 4 nights, 2 travellers\./)).toBeVisible()
  await expect(intake.getByRole("combobox")).toHaveCount(1)
  await expect(intake.getByLabel("What kind of stay?", { exact: true })).toBeVisible()
  await expect(intake.getByLabel("Travelling from which city?", { exact: true })).toHaveValue("")
  await intake.getByLabel("Travelling from which city?", { exact: true }).fill("Delhi")
  await expect(page.getByRole("list", { name: "Roma's answers" })).toHaveCount(0)

  await intake.getByRole("button", { name: "Skip: What kind of stay?" }).click()
  await expect(intake.getByText("Skipped: this shows as no estimate.")).toBeVisible()
  await intake.getByRole("button", { name: "Make the plan" }).click()

  const answers = page.getByRole("list", { name: "Roma's answers" })
  await expect(answers.getByText(/^Plan: trip from Delhi to Goa in January \d{4}\. 2 of 6 cost lines have an estimate\./)).toBeVisible()
  await expect(answers.getByText(/These are estimates, not quotes or bookings\./)).toBeVisible()
  await expect(intake).toHaveCount(0)

  // The plan opens in a modal, from the checked plan: the verdict card, the figures, every line, where it came from, its sources.
  await answers.getByRole("button", { name: "Open the plan" }).click()
  const plan = page.getByRole("dialog")
  await expect(plan.getByRole("heading", { name: /^Delhi to Goa · January \d{4}$/ })).toBeVisible()
  await expect(plan.getByText(/^4 nights · 2 travellers · Created \d{1,2} [A-Z][a-z]{2} \d{4}$/)).toBeVisible()
  await expect(plan.getByText(/^Estimates, not quotes or bookings\. Web prices are as pages listed them/)).toBeVisible()
  // The records-only verdict comes first in the verdict card, then Roma's verdict in plain words.
  const verdict = plan.getByRole("region", { name: "Roma's verdict" })
  await expect(verdict.getByText("From your records:", { exact: true })).toBeVisible()
  await expect(verdict.getByText(/^(This trip fits your current plan\.|This trip does not fit your current plan yet\.|Roma can't say yet whether this trip fits\.)$/)).toBeVisible()
  await expect(verdict.getByTestId("plan-status")).toHaveText(/^(Fits|Needs adjustment|Can't say)$/)
  await expect(plan.getByRole("region", { name: "Plan figures" })).toContainText("Estimated trip cost")
  await expect(plan.getByRole("region", { name: "Plan figures" })).toContainText("Extra saving needed")
  await page.screenshot({ path: `${SHOTS}/roma-plan-modal.png` })
  // A line with no estimate says why without being opened.
  await expect(plan.locator('[data-line="stay"]')).toContainText("No estimate: the travel style was skipped.")
  await expect(plan.locator('[data-line="transport"]')).toContainText("Web estimate")
  await plan.locator('[data-line="transport"]').getByRole("button").first().click()
  await expect(plan.locator('[data-line="transport"]')).toContainText("IndiGo, from INR 18,000 a person")
  await expect(plan.locator('[data-line="transport"]')).toContainText("listed on example.test")
  // Food is a per-day line: the test pages' hotel and flight prices aren't per day, so they aren't used, and the line says why.
  await expect(plan.locator('[data-line="food"]')).toContainText("2 prices weren't per day (1 per night, 1 no unit given), so they weren't used.")
  await verdict.getByRole("button", { name: "How Roma decided" }).click()
  await expect(verdict.getByText("Free money by the travel month", { exact: true })).toBeVisible()
  await expect(verdict.getByText("Against your past trip", { exact: true })).toBeVisible()
  await expect(verdict.getByText("With web estimates, not your records", { exact: true })).toBeVisible()
  await expect(plan.locator('[data-line="buffer"]')).toContainText("Calculated")
  await verdict.screenshot({ path: `${SHOTS}/roma-plan-verdict-open.png` })
  await plan.getByRole("region", { name: "Cost breakdown" }).screenshot({ path: `${SHOTS}/roma-plan-breakdown-open.png` })
  await plan.getByRole("button", { name: "View data sources" }).click()
  await expect(plan.getByRole("region", { name: "Sources" }).getByRole("link", { name: "https://example.test/hotels" })).toBeVisible()
  await plan.getByRole("region", { name: "Data sources" }).screenshot({ path: `${SHOTS}/roma-plan-sources.png` })
  // Phone width: a bottom sheet, the figures stacked, the footer kept in view.
  await page.setViewportSize({ width: 390, height: 844 })
  await plan.getByRole("region", { name: "Roma's verdict" }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/roma-plan-modal-mobile.png` })
  await page.setViewportSize({ width: 1440, height: 900 })
  // The test pages name IndiGo; the mock model picks no names, so none is suggested.
  await expect(plan.getByRole("region", { name: "Airlines listed for this route" })).toContainText("No airlines on the pages found could be confirmed, so none is suggested.")
  await expect(plan.getByRole("region", { name: "What the plan is for" })).toContainText("FromDelhi")

  // Save as PDF: the browser's print, showing only the plan's copy, every link written out.
  await page.evaluate(() => {
    window.print = () => {}
  })
  await plan.getByRole("button", { name: "Save as PDF" }).click()
  await page.emulateMedia({ media: "print" })
  const printed = page.getByTestId("plan-print")
  await expect(printed).toBeVisible()
  await expect(page.getByRole("list", { name: "Roma's answers" })).toBeHidden()
  await expect(printed.getByText(/^Made on \d{4}-\d{2}-\d{2}\. Figures marked “From your records”/)).toBeVisible()
  await expect(printed.getByText(/^Delhi to Goa · January \d{4}$/)).toBeVisible()
  await printed.screenshot({ path: `${SHOTS}/roma-plan-pdf.png` })
  // The open modal hides the rest of the page from assistive technology, so the copy is found by CSS, not role.
  await expect(printed.locator('[role="note"]').filter({ hasText: /^Estimates, not quotes or bookings\./ })).toBeVisible()
  await expect(printed.locator('[data-line="stay"]')).toContainText("No estimate")
  const after = await printed.locator('[data-line="transport"] a').first().evaluate((a) => getComputedStyle(a, "::after").content)
  expect(after).toContain("https://example.test/")
  await page.emulateMedia({ media: "screen" })
  // The footer's Close (the header's close button has the same name).
  await plan.getByRole("button", { name: "Close", exact: true }).last().click()

  // Reopened from the conversation, it says when it was made and that prices may have changed.
  await expect(page).toHaveURL(/\/roma\?c=/)
  await page.reload()
  await page.getByRole("list", { name: "Roma's answers" }).getByRole("button", { name: "Open the plan" }).click()
  await expect(page.getByRole("dialog").getByText(/^Made on \d{4}-\d{2}-\d{2}\. Web prices may have changed since this plan was made\./)).toBeVisible()

  // Create travel goal: the normal goal form, filled in from the plan; nothing is added until the person adds it.
  const reopened = page.getByRole("dialog")
  await reopened.getByRole("button", { name: "Create travel goal" }).click()
  await expect(reopened.getByText(/^Filled in from the plan\./)).toBeVisible()
  await expect(reopened.getByLabel("Name", { exact: true })).toHaveValue("Trip to Goa")
  await expect(reopened.getByLabel("People")).toHaveValue("2")
  await expect(reopened.getByLabel("Days")).toHaveValue("5")
  await expect(reopened.getByLabel("Transport")).not.toHaveValue("")
  // Cancel goes back to the plan, and nothing was added.
  await reopened.getByRole("button", { name: "Cancel" }).click()
  await expect(reopened.getByRole("region", { name: "Cost breakdown" })).toBeVisible()
  await reopened.getByRole("button", { name: "Create travel goal" }).click()
  // The plan skipped the stay style and doesn't know how they travel: the person chooses, then adds.
  await reopened.getByLabel("Name", { exact: true }).fill("Goa in January")
  await reopened.getByLabel("Travel by").selectOption({ label: "Flight" })
  await reopened.getByLabel("Stay type").selectOption({ label: "Hotel" })
  await reopened.getByRole("button", { name: "Add goal" }).click()
  await expect(reopened.getByTestId("plan-goal")).toContainText("Added to your goals as “Goa in January”.")
  await expect(reopened.getByRole("button", { name: "Create travel goal" })).toHaveCount(0)

  // Reopened again, the plan still shows its goal; the goal is an ordinary goal on the Goals page.
  await page.reload()
  await page.getByRole("list", { name: "Roma's answers" }).getByRole("button", { name: "Open the plan" }).click()
  await expect(page.getByRole("dialog").getByTestId("plan-goal")).toContainText("“Goa in January”")
  await page.getByRole("dialog").getByRole("link", { name: "Open Goals" }).click()
  await expect(page).toHaveURL(/\/goals$/)
  await expect(page.getByText("Goa in January").first()).toBeVisible()
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
