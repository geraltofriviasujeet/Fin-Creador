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
  await expect(answers.getByText("From the knowledge base", { exact: true })).toBeVisible()
  await expect(answers.getByText("From your records", { exact: true })).toHaveCount(0)
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
})
