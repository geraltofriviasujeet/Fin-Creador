import { type Page, expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { PASSWORD, addBank, addEntry, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

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
  // The figures are a table, with where they came from and the period under it.
  await expect(answers.getByRole("cell").first()).toHaveText("₹1,634.50")
  await expect(answers.getByRole("columnheader", { name: "Figure" })).toBeVisible()
  await page.screenshot({ path: "e2e-screenshots/roma-page-answer.png", fullPage: true, animations: "disabled" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: "e2e-screenshots/roma-page-answer-mobile.png", fullPage: true, animations: "disabled" })
  await page.setViewportSize({ width: 1440, height: 900 })
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

test("conversations: follow up, reopen, start a new one, delete one, delete all (10.3)", async ({ page }) => {
  await signUpConfirmed(page, "Kabir Rao", uniqueEmail("roma-history"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addEntry(page, { amount: "250", category: "Groceries", from: "HDFC Bank ··4821" })
  await page.goto("/settings")
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByRole("status").getByText("Roma is on.")).toBeVisible()
  await expect(page.getByText(/^You have no saved conversations with Roma\. Conversations are deleted 180 days after the last message\.$/)).toBeVisible()

  await page.goto("/roma")
  const history = page.getByRole("navigation", { name: "Past conversations" })
  await expect(history.getByText("No past conversations yet.")).toBeVisible()
  await expect(history.getByText("Conversations are deleted 180 days after the last message.")).toBeVisible()

  // Two questions in one conversation: one entry in the list, and the address keeps it.
  const box = page.getByLabel("Your question")
  const answers = page.getByRole("list", { name: "Roma's answers" })
  await box.fill("What did I spend this month?")
  await box.press("Enter")
  await expect(answers.getByText(/^You spent ₹250 from /)).toBeVisible()
  await expect(page).toHaveURL(/\/roma\?c=[0-9a-f-]{36}$/)
  await box.fill("And what did I spend last month?")
  await box.press("Enter")
  await expect(answers.getByText(/^You spent ₹0(\.00)? from /)).toBeVisible()
  await expect(history.getByRole("link")).toHaveCount(1)
  await expect(history.getByRole("link", { name: "What did I spend this month?" })).toHaveAttribute("aria-current", "page")
  // Each conversation is a card with its type and date.
  await expect(history.getByRole("listitem").first()).toContainText(/^What did I spend this month\?Question · \d{1,2} [A-Z][a-z]{2} \d{4}/)

  // Reopened: the stored answers, newest first, dated; no figures panel for stored turns.
  await page.reload()
  await expect(answers.getByRole("listitem")).toHaveCount(2)
  await expect(answers.getByRole("listitem").first()).toContainText("And what did I spend last month?")
  await expect(answers.getByText(/^Answered on \d{4}-\d{2}-\d{2}\. Ask again for today’s figures\.$/).first()).toBeVisible()

  // A new conversation, then a third question: two in the list.
  await history.getByRole("button", { name: "New conversation" }).click()
  await expect(page).toHaveURL(/\/roma$/)
  await expect(page.getByText(/^Good (morning|afternoon|evening), Kabir\.$/)).toBeVisible()
  await box.fill("Find my entries this month")
  await box.press("Enter")
  await expect(answers.getByText(/^I found 1 entries\./)).toBeVisible()
  await expect(history.getByRole("link")).toHaveCount(2)

  // Open the first one from the list, then delete it (asked once more first).
  await history.getByRole("link", { name: "What did I spend this month?" }).click()
  await expect(answers.getByRole("listitem")).toHaveCount(2)
  await history.getByRole("button", { name: "Delete conversation: What did I spend this month?" }).click()
  await history.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(history.getByRole("link")).toHaveCount(1)
  await expect(page).toHaveURL(/\/roma$/)
  await page.goto("/roma")
  await expect(history.getByRole("link")).toHaveCount(1)

  // Settings counts what is left and deletes all of it; turning Roma off would have kept it.
  await page.goto("/settings")
  await expect(page.getByText(/^You have 1 saved conversation with Roma\./)).toBeVisible()
  await page.getByRole("button", { name: "Delete all conversations" }).click()
  await page.getByRole("button", { name: "Delete all", exact: true }).click()
  await expect(page.getByRole("status").getByText("All your conversations with Roma were deleted.")).toBeVisible()
  await page.goto("/roma")
  await expect(history.getByText("No past conversations yet.")).toBeVisible()
})

// The goal check (10.4). Past months can't be entered through the form in bulk, so income for
// earlier months is recorded as the signed-in person (their own session, RLS), as the Reports
// tests do. The mock repeats the tool's code-built verdict summary.

const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
/** The 15th of the month `offset` months from today's month in India. */
function monthDay(offset: number) {
  const [y, m] = todayInIndia().split("-").map(Number) as [number, number]
  const index = y * 12 + (m - 1) + offset
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-15`
}

async function startWithRoma(page: Page, name: string, email: string) {
  await signUpConfirmed(page, name, email)
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000", asOf: monthDay(-8) })
  await page.goto("/settings")
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByRole("status").getByText("Roma is on.")).toBeVisible()
}

async function addOtherGoal(page: Page, name: string, amount: string, date?: string) {
  await page.goto("/goals")
  await page.getByRole("button", { name: "Plan an expense" }).first().click()
  const plan = dialog(page, "Plan an expense")
  await plan.getByRole("radio", { name: "Other" }).click()
  await plan.getByLabel("Name", { exact: true }).fill(name)
  await plan.getByLabel("What it's for").fill(name)
  await plan.getByLabel("Amount", { exact: true }).fill(amount)
  if (date) await plan.getByLabel("Target date (optional)").fill(date)
  await plan.getByRole("button", { name: "Add goal" }).click()
  await expect(toast(page, "Goal added.")).toBeVisible()
  await expect(plan).toBeHidden()
}

async function ask(page: Page, question: string) {
  await page.goto("/roma")
  await page.getByLabel("Your question").fill(question)
  await page.getByLabel("Your question").press("Enter")
  return page.getByRole("list", { name: "Roma's answers" }).getByRole("listitem").first()
}

const figure = (answer: ReturnType<Page["locator"]>, label: string) =>
  answer.getByRole("row").filter({ has: answer.page().getByRole("rowheader", { name: label, exact: true }) }).getByRole("cell")

test("goal check: Yes for a goal within reach, No with what to change, the verdict, figures and assumptions shown (10.4)", async ({ page }) => {
  const email = uniqueEmail("roma-goals")
  await startWithRoma(page, "Nisha Verma", email)
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  expect((await supabase.auth.signInWithPassword({ email, password: PASSWORD })).error).toBeNull()
  const account = await supabase.from("accounts").select("id").eq("kind", "bank").single()
  const salary = await supabase.from("categories").select("id").eq("kind", "income").limit(1).single()
  expect(account.error ?? salary.error).toBeNull()
  // ₹50,000 of income in each of the last 6 complete months: the median net is ₹50,000.
  for (let offset = -6; offset <= -1; offset++) {
    const recorded = await supabase.rpc("record_transaction", {
      p_type: "income",
      p_idempotency_key: crypto.randomUUID(),
      p_amount_minor: 50_000_00,
      p_occurred_on: monthDay(offset),
      p_account_id: account.data!.id,
      p_category_id: salary.data!.id,
    })
    expect(recorded.error).toBeNull()
  }
  const nextYear = Number(todayInIndia().slice(0, 4)) + 1

  // A name with digits in it is a name, not a figure the check refuses.
  await addOtherGoal(page, "Car 2027", "1,00,000", `${nextYear}-12-31`)
  // From the Goals page: the question is filled in, not sent.
  await page.getByRole("link", { name: "Ask Roma about Car 2027" }).click()
  await expect(page.getByLabel("Your question")).toHaveValue("Can I reach Car 2027?")
  const yes = await ask(page, "Can I reach Car 2027?")
  await expect(yes.getByText("Goal check · Car 2027")).toBeVisible()
  await expect(yes.getByText("Yes.", { exact: true })).toBeVisible()
  await expect(yes.getByText(/^Yes\. At your current rate Car 2027 would be reached in \w+ \d{4}, by the target of December \d{4}\. Free for it this month: ₹50,000\./)).toBeVisible()
  await expect(figure(yes, "Median monthly net (income minus spending)")).toHaveText("₹50,000")
  await expect(figure(yes, "Months with records")).toHaveText("6")
  await expect(figure(yes, "Car 2027: target")).toHaveText("₹1,00,000")
  await expect(yes.getByText("Assumptions", { exact: true })).toBeVisible()
  await expect(yes.getByRole("listitem").filter({ hasText: "Only INR entries are counted; entries in other currencies are ignored, not added." })).toBeVisible()
  await expect(yes.getByRole("listitem").filter({ hasText: "so this figure is deliberately conservative" })).toBeVisible()

  // Out of reach, with the other goal's saving shown as an assumption.
  await addOtherGoal(page, "House fund", "50,00,000", `${nextYear}-12-31`)
  const no = await ask(page, "Can I reach House fund?")
  await expect(no.getByText("Goal check · House fund")).toBeVisible()
  await expect(no.getByText("No.", { exact: true })).toBeVisible()
  await expect(no.getByText(/^No\. At your current rate House fund would be reached (in \w+ \d{4}|not within 10 years), after the target of December \d{4}\..* save ₹[\d,]+(\.\d{2})? more a month/)).toBeVisible()
  await expect(figure(no, "Assuming you keep saving for your other goals: Car 2027, a month")).toHaveText(/^₹[\d,]+(\.\d{2})?$/)
  await expect(figure(no, "Save more a month")).toHaveText(/^₹[\d,]+(\.\d{2})?$/)
  await expect(no.getByRole("listitem").filter({ hasText: "Assuming you keep saving for your other goals (Car 2027)" })).toBeVisible()
})

test("goal check: too early to say with under 3 months of records (10.4)", async ({ page }) => {
  await startWithRoma(page, "Arjun Mehta", uniqueEmail("roma-goal-early"))
  await page.goto("/income")
  await addEntry(page, { type: "Income", amount: "20,000", category: "Salary", from: "HDFC Bank ··4821" })
  await addOtherGoal(page, "Trip to Goa", "30,000")
  const early = await ask(page, "Can I reach Trip to Goa?")
  await expect(early.getByText("Goal check · Trip to Goa")).toBeVisible()
  await expect(early.getByText("Too early to say.", { exact: true })).toBeVisible()
  await expect(early.getByText(/^Too early to say\. There are only 0 complete months of records, too few to project from\. Trip to Goa needs ₹2,500 a month\./)).toBeVisible()
  await expect(figure(early, "Months with records")).toHaveText("0")
  await expect(figure(early, "Net recorded so far")).toHaveText("₹20,000")
  await expect(early.getByRole("listitem").filter({ hasText: "At least 3 complete months with records are needed before Roma projects anything." })).toBeVisible()
})

// The trip check (10.5). A past trip is a run of Travel expenses; the person confirms it and
// picks one of its two figures, both added up from the records. Entries for earlier months
// are recorded as the signed-in person, as in the goal check above.

/** `day` of the month `offset` months from today's month in India. */
const dayOf = (offset: number, day: number) => `${monthDay(offset).slice(0, 8)}${String(day).padStart(2, "0")}`

test("trip check: no estimate until a past trip is confirmed, then an estimate from either figure (10.5)", async ({ page }) => {
  const email = uniqueEmail("roma-trip")
  await startWithRoma(page, "Kavya Rao", email)
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  expect((await supabase.auth.signInWithPassword({ email, password: PASSWORD })).error).toBeNull()
  const account = await supabase.from("accounts").select("id").eq("kind", "bank").single()
  const salary = await supabase.from("categories").select("id").eq("kind", "income").limit(1).single()
  const travel = await supabase.from("categories").select("id").eq("kind", "expense").eq("icon", "travel").single()
  const food = await supabase.from("categories").select("id").eq("kind", "expense").eq("icon", "food").single()
  expect(account.error ?? salary.error ?? travel.error ?? food.error).toBeNull()
  const record = async (type: "income" | "expense", minor: number, on: string, categoryId: string) =>
    expect(
      (
        await supabase.rpc("record_transaction", {
          p_type: type,
          p_idempotency_key: crypto.randomUUID(),
          p_amount_minor: minor,
          p_occurred_on: on,
          p_account_id: account.data!.id,
          p_category_id: categoryId,
        })
      ).error,
    ).toBeNull()
  for (let offset = -6; offset <= -1; offset++) await record("income", 50_000_00, monthDay(offset), salary.data!.id)
  // A 3-day trip two months ago: ₹9,000 on Travel and ₹3,000 on food in between.
  await record("expense", 4_000_00, dayOf(-2, 10), travel.data!.id)
  await record("expense", 3_000_00, dayOf(-2, 11), food.data!.id)
  await record("expense", 5_000_00, dayOf(-2, 12), travel.data!.id)
  const from = dayOf(-2, 10)
  const to = dayOf(-2, 12)
  const month = monthDay(3).slice(0, 7)
  const question = `Trip to Kerala, domestic, ${month}, 3 nights, 2 travellers`

  const none = await ask(page, question)
  await expect(none.getByText("Trip check · Kerala")).toBeVisible()
  await expect(none.getByText("No estimate from your records.", { exact: true })).toBeVisible()
  await expect(figure(none, `Travel run ${from} to ${to}: Travel category`)).toHaveText("₹9,000")
  await expect(
    figure(none, `Travel run ${from} to ${to}: all spending in those dates, which may include things unrelated to the trip`),
  ).toHaveText("₹12,000")

  // ₹9,000 over 2 travellers × 3 days, scaled to 2 travellers × 4 days.
  const travelOnly = await ask(page, `${question}; ${from} to ${to} was domestic for 2, travel`)
  await expect(travelOnly.getByText("Yes.", { exact: true })).toBeVisible()
  await expect(figure(travelOnly, "Trip estimate")).toHaveText("₹12,000")
  await expect(travelOnly.getByText(/^Yes\. A 3-night domestic trip to Kerala in \w+ \d{4} for 2 travellers would cost about ₹12,000/)).toBeVisible()
  await expect(travelOnly.getByRole("listitem").filter({ hasText: "Travel category only" })).toBeVisible()

  const allSpending = await ask(page, `${question}; ${from} to ${to} was domestic for 2, all_spending`)
  await expect(figure(allSpending, "Trip estimate")).toHaveText("₹16,000")
  await expect(allSpending.getByRole("listitem").filter({ hasText: "which may include things unrelated to the trip" })).toBeVisible()
})

test("web estimates: the records' verdict first, a marked web-assisted line, prices with their site and link (10.8)", async ({ page }) => {
  const email = uniqueEmail("roma-web")
  await startWithRoma(page, "Kavya Rao", email)
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  expect((await supabase.auth.signInWithPassword({ email, password: PASSWORD })).error).toBeNull()
  const account = await supabase.from("accounts").select("id").eq("kind", "bank").single()
  const salary = await supabase.from("categories").select("id").eq("kind", "income").limit(1).single()
  expect(account.error ?? salary.error).toBeNull()
  for (let offset = -6; offset <= -1; offset++) {
    const { error } = await supabase.rpc("record_transaction", {
      p_type: "income",
      p_idempotency_key: crypto.randomUUID(),
      p_amount_minor: 50_000_00,
      p_occurred_on: monthDay(offset),
      p_account_id: account.data!.id,
      p_category_id: salary.data!.id,
    })
    expect(error).toBeNull()
  }
  const month = monthDay(3).slice(0, 7)

  // No trip in the records: the records can't estimate it; the web prices (mock search) can.
  const answer = await ask(page, `Web prices for a trip to Goa, ${month}, 4 nights, 2 travellers`)
  await expect(answer.getByText("Trip check · Goa · From your records")).toBeVisible()
  await expect(answer.getByText("No estimate from your records.", { exact: true })).toBeVisible()
  const webLine = answer.getByTestId("web-verdict")
  await expect(webLine.getByText("Web estimates only, no basis in your records")).toBeVisible()
  // 4,500 × 4 nights + 18,000 × 2 travellers = 54,000, against ₹50,000 a month for 4 months. The
  // flight is "from about ₹18,000", so the total is a minimum.
  await expect(
    webLine.getByText(
      /^Yes\. Web-only estimate: it rests entirely on web prices, with no basis in your records\. The web prices kept add up to at least ₹54,000, a minimum because some prices are "from" prices, for stay, travel only, not the whole trip\./,
    ),
  ).toBeVisible()

  const block = answer.getByRole("region", { name: "Web estimates" })
  await expect(block.getByText("Web estimates. Check the source.")).toBeVisible()
  await expect(block.getByRole("link", { name: "example.test" })).toHaveCount(2)
  await expect(block.getByRole("link", { name: "example.test" }).first()).toHaveAttribute("href", "https://example.test/hotels")
  await expect(block.getByText("INR 4,500 a night")).toBeVisible()
  await expect(block.getByText("from INR 18,000 a person")).toBeVisible()
  await expect(block.getByText("at least INR 54,000")).toBeVisible()
})
