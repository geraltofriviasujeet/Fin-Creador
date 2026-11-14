import { expect, test } from "@playwright/test"
import { signUpConfirmed, uniqueEmail } from "./helpers"

// Roma's knowledge base (10.6c) end to end on the mock provider and the mock embedder
// (playwright.config.ts): a general question searches the test passage seeded in the CI
// database only (e2e/fixtures/knowledge.sql) through the real match_knowledge_chunks. Its
// figures year (2025-26) has ended, so the out-of-date notice shows. A question about crypto
// finds nothing and gets the code-built line, never the mock's "from memory" figure.

test("a general question is answered from a cited passage, and one with no vetted material is not answered", async ({ page }) => {
  await signUpConfirmed(page, "Tara Sen", uniqueEmail("roma-knowledge"))
  await page.goto("/settings")
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByRole("status").getByText("Roma is on.")).toBeVisible()

  await page.goto("/roma")
  const box = page.getByLabel("Your question")
  const answers = page.getByRole("list", { name: "Roma's answers" })
  await box.fill("What is an emergency fund?")
  await box.press("Enter")

  await expect(answers.getByText(/^Test passage: an emergency fund commonly covers three to six months of essential spending, such as ₹40,000 a month\. \[1\] \(Test answer\.\)\s+General information, not personal advice\.$/)).toBeVisible()
  // The chip says what ran: the knowledge base only, no records tool. The line once, from code.
  const chips = answers.locator("span.text-success")
  await expect(chips).toHaveText(["From the knowledge base"])
  await expect(answers.getByText(/General information, not personal advice\./)).toHaveCount(1)
  await expect(page.getByText("Informational only, not financial advice. Figures come from your own records or the cited source.", { exact: true })).toBeVisible()
  const sources = answers.getByRole("region", { name: "Sources from the knowledge base" })
  const citation = sources.getByTestId("citation")
  await expect(citation.locator("summary")).toHaveText("[1] Test explainer: emergency funds · FinCreador explainer, based on Test Publisher · For FY 2025-26")
  await expect(sources.getByText("[1] is for FY 2025-26, which has ended. It may be out of date.")).toBeVisible()
  // The passage itself opens under the citation, with the read-more link the publisher allows.
  await expect(citation.getByText("The passage Roma used")).toBeHidden()
  await citation.locator("summary").click()
  await expect(citation.locator("blockquote")).toHaveText(/^Test passage: an emergency fund commonly covers three to six months/)
  await expect(citation.getByRole("link", { name: "Read more at the source" })).toHaveAttribute("href", "https://example.com/test-read-more")

  await box.fill("What is crypto staking?")
  await box.press("Enter")
  await expect(answers.getByText("I don't have vetted material on this, so I won't answer it from general knowledge.", { exact: true })).toBeVisible()
  await expect(answers.getByText(/50,00,000/)).toHaveCount(0)
  await expect(answers.getByRole("region", { name: "Sources from the knowledge base" })).toHaveCount(1)

  // 10.6d: the citations are kept with the turn. Reloaded, and reopened from the list, the
  // sources, the chip and the out-of-date notice (worked out when shown) are still there.
  const history = page.getByRole("navigation", { name: "Past conversations" })
  for (const reopen of [() => page.reload(), async () => {
    await history.getByRole("button", { name: "New conversation" }).click()
    await expect(answers).toHaveCount(0)
    await history.getByRole("link", { name: "What is an emergency fund?" }).click()
  }]) {
    await reopen()
    await expect(answers.getByRole("listitem")).toHaveCount(2)
    const kept = answers.getByRole("region", { name: "Sources from the knowledge base" })
    await expect(kept).toHaveCount(1)
    await expect(kept.getByTestId("citation").locator("summary")).toHaveText("[1] Test explainer: emergency funds · FinCreador explainer, based on Test Publisher · For FY 2025-26")
    await expect(kept.getByText("[1] is for FY 2025-26, which has ended. It may be out of date.")).toBeVisible()
    await expect(answers.locator("span.text-success")).toHaveText(["From the knowledge base"])
  }
})

// 10.6e: a tax calculation goes to tax_estimate. The mock passes the amount as typed and gives
// both totals by placeholder in Markdown bold, which shows as bold, never as "**". The card is
// built in code; the not-advice line comes once, from code.
test("a salary tax question gets both regimes worked out in code, with the breakdown and its assumptions", async ({ page }) => {
  await signUpConfirmed(page, "Ira Das", uniqueEmail("roma-tax"))
  await page.goto("/settings")
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByRole("status").getByText("Roma is on.")).toBeVisible()

  await page.goto("/roma")
  const box = page.getByLabel("Your question")
  const answers = page.getByRole("list", { name: "Roma's answers" })
  await box.fill("my in hand salary is 1415000 how much i have to pay tax calculate it in old and new tax regime")
  await box.press("Enter")

  const answer = answers.locator("p").filter({ hasText: "(Test answer.)" })
  await expect(answer).toHaveText(/^New regime: ₹84,240\. Old regime: ₹2,30,880\. \(Test answer\.\)\s+General information, not personal advice\.$/)
  await expect(answer.locator("strong")).toHaveText(["New regime:", "Old regime:"])
  await expect(answers.getByText(/\*\*/)).toHaveCount(0)
  await expect(answers.getByText(/General information, not personal advice\./)).toHaveCount(1)
  // Nothing was read from the records, so no records chip and no records figures table; the
  // tax chip says it was worked out (10.6d), and no passage is cited, so no knowledge chip.
  await expect(answers.locator("span.text-success")).toHaveText(["Calculated from the tax rules"])
  await expect(answers.getByText("Figures from your records")).toHaveCount(0)

  const card = answers.getByRole("region", { name: "Tax estimate" })
  await expect(card.getByText("Tax estimate · Tax year 2026-27")).toBeVisible()
  await expect(card.getByText("The new regime's total is lower by ₹1,46,640.")).toBeVisible()
  await expect(card.getByRole("row", { name: /^Total tax/ })).toHaveText([/₹84,240/, /₹2,30,880/])
  await expect(card.getByText("₹14,15,000 is taken as your annual gross salary (you called it in-hand salary).")).toBeVisible()
  await expect(card.getByText("No deductions given: the old regime is shown with the standard deduction only.")).toBeVisible()
  await expect(card.getByText(/^Rates from the knowledge base: Income tax under the default \(new\) regime, tax year 2026-27; Income tax under the old regime, tax year 2026-27\.$/)).toBeVisible()

  // 10.6d: the card is kept with the turn. Reloaded, and reopened from the list, it is still
  // there with its chip.
  const history = page.getByRole("navigation", { name: "Past conversations" })
  for (const reopen of [() => page.reload(), async () => {
    await history.getByRole("button", { name: "New conversation" }).click()
    await expect(answers).toHaveCount(0)
    await history.getByRole("link", { name: /^my in hand salary is 1415000/ }).click()
  }]) {
    await reopen()
    const kept = answers.getByRole("region", { name: "Tax estimate" })
    await expect(kept.getByText("Tax estimate · Tax year 2026-27")).toBeVisible()
    await expect(kept.getByRole("row", { name: /^Total tax/ })).toHaveText([/₹84,240/, /₹2,30,880/])
    await expect(kept.getByText("The new regime's total is lower by ₹1,46,640.")).toBeVisible()
    await expect(answers.locator("span.text-success")).toHaveText(["Calculated from the tax rules"])
  }
})
