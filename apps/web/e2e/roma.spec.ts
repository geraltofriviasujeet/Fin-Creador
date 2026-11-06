import { expect, test } from "@playwright/test"
import { addBank, addEntry, signUpConfirmed, uniqueEmail } from "./helpers"

// Roma (Sprints 10.1 and 10.2) end to end on the mock provider (LLM_PROVIDER=mock on the test server, see
// playwright.config.ts): no paid API is called and no key is set. The mock asks the real
// spending tool and repeats its figures, so the answer is checked against the person's records.

test("signed out, the chat endpoint answers 401 JSON instead of redirecting", async ({ request, baseURL }) => {
  const res = await request.post("/api/ai/chat", { data: { question: "What did I spend?" }, headers: { origin: baseURL ?? "" }, maxRedirects: 0 })
  expect(res.status()).toBe(401)
  expect(await res.json()).toEqual({ status: "error", code: "signed_out", message: "Sign in to ask Roma." })
})

test("turn Roma on, ask what I spent this month, find entries, allow descriptions, turn her off", async ({ page }) => {
  await signUpConfirmed(page, "Meera Iyer", uniqueEmail("roma"))

  // Off by default: the page says what is sent and where to turn her on.
  await page.goto("/roma")
  await expect(page.getByRole("heading", { level: 1, name: "Roma" })).toBeVisible()
  await expect(page.getByText("Roma is off", { exact: true })).toBeVisible()
  await expect(page.getByText(/Roma sends your question and summaries of your figures to Anthropic/)).toBeVisible()

  // Signed in but not opted in: the endpoint refuses without a reservation.
  const refused = await page.request.post("/api/ai/chat", { data: { question: "What did I spend?" }, headers: { origin: new URL(page.url()).origin } })
  expect(refused.status()).toBe(403)
  expect(await refused.json()).toMatchObject({ code: "not_enabled" })

  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addEntry(page, { amount: "1,234.50", category: "Groceries", from: "HDFC Bank ··4821" })
  await addEntry(page, { amount: "400", category: "Transport", from: "HDFC Bank ··4821", note: "Auto to office, ride 98765432" })

  await page.goto("/settings")
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByRole("status").getByText("Roma is on.")).toBeVisible()

  await page.getByRole("link", { name: "Ask Roma", exact: true }).first().click()
  await expect(page).toHaveURL(/\/roma$/)
  // Opening screen: static text in her own time zone, with the first name from the profile.
  await expect(page.getByText(/^Good (morning|afternoon|evening), Meera\.$/)).toBeVisible()
  await expect(page.getByText("I’m Roma, your Intelligent Finance Analyst. What do you want to know?", { exact: true })).toBeVisible()

  // Shift+Enter adds a line; Enter sends.
  const box = page.getByLabel("Your question")
  await box.fill("What did I spend")
  await box.press("Shift+Enter")
  await expect(box).toHaveValue("What did I spend\n")
  await expect(page.getByRole("list", { name: "Roma's answers" })).toHaveCount(0)
  await box.fill("What did I spend this month?")
  await box.press("Enter")

  const answers = page.getByRole("list", { name: "Roma's answers" })
  await expect(answers.getByText(/^You spent ₹1,634\.50 from \d{4}-\d{2}-01 to \d{4}-\d{2}-\d{2}, across 2 expenses\./)).toBeVisible()
  await expect(answers.getByText("From your records", { exact: false })).toBeVisible()
  await expect(answers.getByRole("definition").first()).toHaveText("₹1,634.50")
  await expect(page.getByText("Informational only, not financial advice.", { exact: false })).toBeVisible()
  // The opening lines give way once a question is asked; the send button stays.
  await expect(page.getByText(/^Good (morning|afternoon|evening), Meera\.$/)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Ask Roma" })).toBeVisible()

  // Search (10.2): descriptions stay out until she is allowed to send them, asked once in Roma.
  await box.fill("Find my entries this month")
  await box.press("Enter")
  await expect(answers.getByText(/^I found 2 entries\. The newest is ₹400 on \d{4}-\d{2}-\d{2}\./)).toBeVisible()
  await expect(answers.getByText(/Roma left out the descriptions of these entries\./)).toBeVisible()
  await answers.getByRole("button", { name: "Allow descriptions" }).click()
  await expect(answers.getByRole("status").getByText(/^Descriptions allowed\./)).toBeVisible()
  await box.fill("Find my entries this month")
  await box.press("Enter")
  // Sent cleaned: the long number in the note never leaves the app.
  await expect(answers.getByText(/^I found 2 entries\. The newest is ₹400 for Auto to office, ride on \d{4}-\d{2}-\d{2}\./)).toBeVisible()
  await expect(page.getByText("98765432")).toHaveCount(0)
  await expect(answers.getByRole("button", { name: "Allow descriptions" })).toHaveCount(0)

  // Settings shows the consent and withdraws it without turning Roma off.
  await page.goto("/settings")
  await expect(page.getByText(/^Transaction descriptions: sent \(allowed on /)).toBeVisible()
  await page.getByRole("button", { name: "Stop sending descriptions" }).click()
  await expect(page.getByRole("status").getByText("Roma won’t send descriptions.")).toBeVisible()
  await expect(page.getByText(/^Transaction descriptions: not sent\./)).toBeVisible()
  await expect(page.getByText("Roma is on.", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "Turn Roma off" })).toBeVisible()
  await page.goto("/roma")
  await page.getByLabel("Your question").fill("Find my entries this month")
  await page.getByLabel("Your question").press("Enter")
  await expect(answers.getByText(/^I found 2 entries\. The newest is ₹400 on /)).toBeVisible()
  await expect(answers.getByRole("button", { name: "Allow descriptions" })).toBeVisible()

  // Allowed again from Settings; turning Roma off still clears it.
  await page.goto("/settings")
  await page.getByRole("button", { name: "Allow descriptions" }).click()
  await expect(page.getByText(/^Transaction descriptions: sent/)).toBeVisible()
  await page.getByRole("button", { name: "Turn Roma off" }).click()
  await expect(page.getByRole("status").getByText("Roma is off.")).toBeVisible()
  await expect(page.getByText(/^Transaction descriptions:/)).toHaveCount(0)
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByText(/^Transaction descriptions: not sent\./)).toBeVisible()
  await page.getByRole("button", { name: "Turn Roma off" }).click()
  await expect(page.getByRole("status").getByText("Roma is off.")).toBeVisible()
  await page.goto("/roma")
  await expect(page.getByText("Roma is off", { exact: true })).toBeVisible()
})
