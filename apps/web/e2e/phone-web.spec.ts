import { type Locator, type Page, expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { syntheticPdf } from "../test-support/synthetic-pdf"
import { paytmDefaultPayments, paytmPages } from "../test-support/synthetic-upi"
import { PASSWORD, addBank, addCash, addEntry, dialog, signUpConfirmed, toast, tourDialog, uniqueEmail, welcomeDialog } from "./helpers"

// Sprint 12a-2, phone web: runs in the phone-360 and phone-430 projects (playwright.config.ts)
// with touch on. Every page: no sideways page scroll, tap targets at least 44×44px, no text
// under 12px, inputs at least 16px. Sheets: Save stays on screen when the keyboard takes the
// bottom of the screen and the page behind does not scroll. The keyboard is simulated by
// shrinking the viewport (headless Chrome has no on-screen keyboard); the owner checks a real
// phone by hand. Screenshots (made-up test users only) go to e2e-screenshots/ for the CI artifact.

const SHOTS = "e2e-screenshots"
/** Height left by an on-screen keyboard on a 360 × 780 phone (about 45% of the screen). */
const KEYBOARD_LEFT = 420

const width = (page: Page) => page.viewportSize()!.width
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: `${SHOTS}/phone-${width(page)}-${name}.png`, fullPage, animations: "disabled" })

const PAGES = [
  ["overview", "/"],
  ["income", "/income"],
  ["transactions", "/transactions"],
  ["recurring", "/recurring"],
  ["goals", "/goals"],
  ["investments", "/investments"],
  ["loans", "/loans-liabilities"],
  ["reports", "/reports"],
  ["roma", "/roma"],
  ["settings", "/settings"],
  ["upi-import", "/transactions/import/upi"],
] as const

async function expectNoSideScroll(page: Page, where: string) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(scroll, `${where}: page scrolls sideways`).toBeLessThanOrEqual(client)
}

/**
 * Tap targets under 44×44px, text under 12px and inputs under 16px among the visible elements
 * (inside `scope` when given). Inline text links are exempt (WCAG 2.5.8); a radio or checkbox
 * is measured by its label.
 */
async function phoneAudit(page: Page, scope?: string) {
  return page.evaluate((scopeSelector) => {
    const root = scopeSelector ? document.querySelector(scopeSelector) : document.body
    if (!root) return [`no ${scopeSelector}`]
    const problems: string[] = []
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute("type") ? `[${el.getAttribute("type")}]` : ""}${el.getAttribute("name") ? `#${el.getAttribute("name")}` : ""} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}"`
    const shown = (el: Element) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && !el.closest("[inert], [aria-hidden=true]")
    const targets = root.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=tab], [role=switch]")
    for (const el of targets) {
      if (!shown(el)) continue
      const type = el.getAttribute("type")
      if (el instanceof HTMLInputElement && (type === "hidden" || type === "file")) continue
      if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue
      const box = (el instanceof HTMLInputElement && (type === "radio" || type === "checkbox") ? (el.closest("label") ?? el) : el).getBoundingClientRect()
      if (box.width <= 1 && box.height <= 1) continue // visually hidden (sr-only)
      if (box.width < 43.5 || box.height < 43.5) problems.push(`tap ${Math.round(box.width)}×${Math.round(box.height)} ${name(el)}`)
      if ((el instanceof HTMLInputElement && type !== "radio" && type !== "checkbox") || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        const size = parseFloat(getComputedStyle(el).fontSize)
        if (size < 16) problems.push(`input font ${size}px ${name(el)}`)
      }
    }
    for (const el of root.querySelectorAll("*")) {
      if (el.closest("svg") && el.tagName.toLowerCase() !== "text") continue
      const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "")
      if (!ownText || !shown(el)) continue
      const box = el.getBoundingClientRect()
      if (box.width <= 1 && box.height <= 1) continue
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size < 12) problems.push(`text ${size}px ${name(el)}`)
    }
    return [...new Set(problems)]
  }, scope)
}

async function expectPhoneFriendly(page: Page, where: string, scope?: string) {
  expect(await phoneAudit(page, scope), `${where}: phone audit`).toEqual([])
}

/** The element's box is inside the visible screen and nothing covers its centre. */
async function expectOnScreen(page: Page, locator: ReturnType<Page["locator"]>, where: string) {
  await expect(locator).toBeVisible()
  const box = (await locator.boundingBox())!
  const view = page.viewportSize()!
  expect(box.y, `${where}: above the screen`).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height, `${where}: below the screen`).toBeLessThanOrEqual(view.height)
  const covered = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return !(hit && (hit === el || el.contains(hit)))
  })
  expect(covered, `${where}: covered by something else`).toBe(false)
}

/** The page behind an open sheet does not move when the person scrolls over the sheet. */
async function expectPageLocked(page: Page, sheet: ReturnType<Page["locator"]>) {
  const before = await page.evaluate(() => window.scrollY)
  const box = (await sheet.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 40)
  await page.mouse.wheel(0, 800)
  await page.mouse.wheel(0, 800)
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
}

async function demoUser(page: Page, label: string, opts?: Parameters<typeof signUpConfirmed>[3]) {
  await signUpConfirmed(page, "Phone Demo", uniqueEmail(`phone-${label}`), opts)
}

async function seed(page: Page) {
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "52,300" })
  await addCash(page, "1,500")
  await addEntry(page, { amount: "450", category: "Food & dining", from: "Cash in hand", note: "Lunch" })
  await addEntry(page, { type: "Income", amount: "32,000", category: "Rental income", from: "HDFC Bank ··4821" })
}

test("every page fits the phone: no sideways scroll, 44px targets, readable text", async ({ page }) => {
  test.setTimeout(180_000)
  await demoUser(page, "pages")
  await seed(page)
  const failures: string[] = []
  for (const [name, path] of PAGES) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
    await page.waitForLoadState("networkidle")
    await shot(page, name, true)
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    if (scroll > client) failures.push(`${path}: page scrolls sideways (${scroll} > ${client})`)
    for (const p of await phoneAudit(page, "main")) failures.push(`${path}: ${p}`)
  }
  // The shell (topbar, tab bar) once.
  for (const p of await phoneAudit(page, "header")) failures.push(`topbar: ${p}`)
  for (const p of await phoneAudit(page, "nav[aria-label=Main]")) failures.push(`tab bar: ${p}`)
  expect(failures).toEqual([])
})

test("Add sheet: Save stays above the keyboard, the sheet scrolls, the page behind does not", async ({ page }) => {
  await demoUser(page, "add")
  await seed(page)
  await page.goto("/transactions")
  await page.getByRole("link", { name: "Add expense" }).first().click()
  const sheet = dialog(page, "Add expense")
  const save = sheet.getByRole("button", { name: "Save expense" })
  await expectOnScreen(page, save, "Add sheet")
  await expectNoSideScroll(page, "Add sheet")
  await expectPhoneFriendly(page, "Add sheet", "[role=dialog]")
  await shot(page, "add-sheet")

  // The keyboard opens: Save is still on screen, above it, and the form scrolls inside the sheet.
  await sheet.getByLabel("Amount").focus()
  await page.setViewportSize({ width: width(page), height: KEYBOARD_LEFT })
  await expectOnScreen(page, save, "Add sheet with the keyboard open")
  const body = sheet.locator("[data-sheet-body]")
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await sheet.getByLabel("Note").scrollIntoViewIfNeeded()
  await expectOnScreen(page, save, "Add sheet scrolled to Note")
  await expectPageLocked(page, sheet)
  await shot(page, "add-sheet-keyboard")

  // It still saves from there.
  await sheet.getByLabel("Amount").fill("120")
  await sheet.getByLabel("Category").selectOption({ label: "Food & dining" })
  await sheet.getByLabel("Paid from").selectOption({ label: "Cash in hand" })
  await save.click()
  await expect(sheet).toBeHidden()
})

test("tall dialog: loan edit form and its confirm step keep Save on screen with the keyboard open", async ({ page }) => {
  test.setTimeout(120_000)
  await demoUser(page, "loan")
  await page.goto("/loans-liabilities")
  await page.getByRole("button", { name: "Add loan" }).first().click()
  const add = dialog(page, "Add loan")
  await add.getByRole("radio", { name: "Education loan" }).check()
  await expectOnScreen(page, add.getByRole("button", { name: "Next" }), "Add loan, step 1")
  await add.getByRole("button", { name: "Next" }).click()
  await add.getByLabel("Lender").fill("State Bank of India")
  await add.getByLabel("Sanctioned amount (₹)").fill("10,00,000")
  await add.getByLabel("Amount taken (₹)").fill("8,00,000")
  await add.getByLabel("Interest rate (% a year)").fill("10")
  await add.getByLabel("Tenure (months)").fill("60")
  await add.getByRole("radio", { name: "Starts later" }).check()
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).split("-").map(Number) as [number, number]
  await add.getByLabel("First EMI date").fill(new Date(Date.UTC(y, m + 1, 5)).toISOString().slice(0, 10))
  await expectOnScreen(page, add.getByRole("button", { name: "Add loan" }), "Add loan, details")
  await expectPhoneFriendly(page, "Add loan", "[role=dialog]")
  await shot(page, "loan-add")
  await add.getByRole("button", { name: "Add loan" }).click()
  await expect(add).toBeHidden()

  const row = page.getByRole("region", { name: "Long-term liabilities" }).getByRole("listitem").filter({ hasText: "State Bank of India" })
  await row.getByRole("button", { name: /^State Bank of India/ }).click()
  await row.getByRole("button", { name: "Edit State Bank of India" }).click()
  const edit = dialog(page, "Edit State Bank of India")
  await edit.getByLabel("Amount taken (₹)").focus()
  await page.setViewportSize({ width: width(page), height: KEYBOARD_LEFT })
  await edit.getByLabel("Amount taken (₹)").fill("6,00,000")
  await expectOnScreen(page, edit.getByRole("button", { name: "Review changes" }), "Edit loan with the keyboard open")
  await expectPageLocked(page, edit)
  await shot(page, "loan-edit-keyboard")
  await edit.getByRole("button", { name: "Review changes" }).click()
  await expect(edit).toContainText("Check before saving")
  await expectOnScreen(page, edit.getByRole("button", { name: "Save changes" }), "Edit loan, confirm step")
  await shot(page, "loan-edit-confirm")
  await edit.getByRole("button", { name: "Save changes" }).click()
  await expect(edit).toBeHidden()
})

test("search icon in the topbar opens the search field", async ({ page }) => {
  await demoUser(page, "search")
  await seed(page)
  const header = page.getByRole("banner")
  await expect(header.getByRole("searchbox")).toHaveCount(0)
  await header.getByRole("button", { name: "Search" }).click()
  const field = header.getByRole("searchbox", { name: "Search" })
  await expect(field).toBeFocused()
  await expectPhoneFriendly(page, "phone search", "header")
  await shot(page, "search-open")
  await field.fill("Lunch")
  await field.press("Enter")
  await expect(page).toHaveURL(/\/transactions\?q=Lunch/)
  await expect(page.getByRole("main")).toContainText("Lunch")
  await expect(header.getByRole("searchbox")).toHaveCount(0)
})

test("welcome carousel, tour, balance card, Continue card and the website link at phone size", async ({ page }) => {
  test.setTimeout(120_000)
  const email = uniqueEmail("phone-onboarding")
  await signUpConfirmed(page, "Phone Demo", email, { tour: true })

  // Welcome: full screen, swipe to the next slide, "Don't show this again" big enough to tap.
  const welcome = welcomeDialog(page)
  await expect(welcome).toBeVisible()
  await expectNoSideScroll(page, "welcome")
  await expectPhoneFriendly(page, "welcome", "[data-testid=welcome]")
  const title = welcome.getByRole("heading", { level: 2 })
  const first = await title.textContent()
  const cdp = await page.context().newCDPSession(page)
  const y = 300
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: width(page) - 40, y }] })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: width(page) / 2, y }] })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 40, y }] })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await expect(title).not.toHaveText(first!)
  await expectOnScreen(page, welcome.getByRole("checkbox", { name: "Don't show this again" }), "Don't show this again")
  await shot(page, "welcome-slide-2")

  // The menu tour from the last slide.
  for (let i = 0; i < 10 && (await welcome.getByRole("button", { name: "Next" }).count()) > 0; i++) await welcome.getByRole("button", { name: "Next" }).click()
  await welcome.getByRole("button", { name: "Show me around" }).click()
  const tour = tourDialog(page)
  await expect(tour).toBeVisible()
  await expectNoSideScroll(page, "tour")
  await expectOnScreen(page, tour.getByRole("button", { name: "Next" }), "tour Next")
  await expectPhoneFriendly(page, "tour", "[role=dialog]")
  await shot(page, "tour-step-1")
  await tour.getByRole("button", { name: "Skip tour" }).click()
  await expect(tour).toBeHidden()

  // Balance card after a save.
  await page.goto("/income")
  await addCash(page, "1,500")
  await addEntry(page, { amount: "450", category: "Food & dining", from: "Cash in hand" })
  const balance = page.getByTestId("balance-card")
  await expect(balance).toBeVisible()
  await expectOnScreen(page, balance, "balance card")
  await expectNoSideScroll(page, "balance card")
  await shot(page, "balance-card")
  // It leaves on its own (about 5s after counting), uncovering the tab bar.
  await expect(balance).toBeHidden({ timeout: 15_000 })

  // The FinCreador website link in More.
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More" }).click()
  const website = page.getByRole("link", { name: /FinCreador website/ })
  await expectOnScreen(page, website, "website link in More")
  const box = (await website.boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(43.5)
  await shot(page, "more-website-link")
  await page.keyboard.press("Escape")

  // Already signed in: the Continue card on /sign-in.
  await page.goto("/sign-in")
  const card = page.getByTestId("continue-card")
  await expect(card).toBeVisible()
  await expectNoSideScroll(page, "Continue card")
  await expectPhoneFriendly(page, "Continue card", "[data-testid=continue-card]")
  await shot(page, "continue-card")
})

test("sign-up form on a phone: inputs 16px, no sideways scroll", async ({ page }) => {
  await page.goto("/sign-up")
  await expectNoSideScroll(page, "sign-up")
  await expectPhoneFriendly(page, "sign-up", "main")
  await shot(page, "sign-up")
})

// ---- Sprint 12a-3: Roma, the UPI import review, the loan schedule and wide tables ----

const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
/** The 15th of the month `offset` months from today's month in India. */
function monthDay(offset: number) {
  const [y, m] = todayInIndia().split("-").map(Number) as [number, number]
  const index = y * 12 + (m - 1) + offset
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-15`
}
const dayOf = (offset: number, day: number) => `${monthDay(offset).slice(0, 8)}${String(day).padStart(2, "0")}`

/** A demo user with a bank, six months of ₹50,000 income, a past 3-day trip, a goal and Roma on. */
async function romaUser(page: Page, label: string) {
  const email = uniqueEmail(`phone-${label}`)
  await signUpConfirmed(page, "Phone Demo", email)
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000", asOf: monthDay(-8) })
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  expect((await supabase.auth.signInWithPassword({ email, password: PASSWORD })).error).toBeNull()
  const account = await supabase.from("accounts").select("id").eq("kind", "bank").single()
  const salary = await supabase.from("categories").select("id").eq("kind", "income").limit(1).single()
  const travel = await supabase.from("categories").select("id").eq("kind", "expense").eq("icon", "travel").single()
  expect(account.error ?? salary.error ?? travel.error).toBeNull()
  const record = async (type: "income" | "expense", minor: number, on: string, categoryId: string) =>
    expect(
      (await supabase.rpc("record_transaction", { p_type: type, p_idempotency_key: crypto.randomUUID(), p_amount_minor: minor, p_occurred_on: on, p_account_id: account.data!.id, p_category_id: categoryId })).error,
    ).toBeNull()
  for (let offset = -6; offset <= -1; offset++) await record("income", 50_000_00, monthDay(offset), salary.data!.id)
  await record("expense", 4_000_00, dayOf(-2, 10), travel.data!.id)
  await record("expense", 5_000_00, dayOf(-2, 12), travel.data!.id)

  await page.goto("/goals")
  await page.getByRole("button", { name: "Plan an expense" }).first().click()
  const plan = dialog(page, "Plan an expense")
  await plan.getByRole("radio", { name: "Other" }).click()
  await plan.getByLabel("Name", { exact: true }).fill("Car 2027")
  await plan.getByLabel("What it's for").fill("Car 2027")
  await plan.getByLabel("Amount", { exact: true }).fill("3,00,000")
  await plan.getByLabel("Target date (optional)").fill(`${Number(todayInIndia().slice(0, 4)) + 1}-12-31`)
  await plan.getByRole("button", { name: "Add goal" }).click()
  await expect(toast(page, "Goal added.")).toBeVisible()

  await page.goto("/settings")
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByRole("status").getByText("Roma is on.")).toBeVisible()
}

async function askRoma(page: Page, question: string) {
  await page.goto("/roma")
  await page.getByLabel("Your question").fill(question)
  await page.getByRole("button", { name: "Ask Roma" }).click()
  return page.getByRole("list", { name: "Roma's answers" }).getByRole("listitem").first()
}

/** Nothing inside `scope` is wider than its box (a clipped or sideways-scrolling figure). */
async function expectNothingClipped(scope: Locator, where: string) {
  const clipped = await scope.evaluate((root) =>
    [...root.querySelectorAll("*")]
      .filter((el) => el.closest("[data-scroll-table]") === null && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible")
      .map((el) => `${el.tagName.toLowerCase()} ${el.scrollWidth}>${el.clientWidth} "${(el.textContent ?? "").trim().slice(0, 40)}"`),
  )
  expect(clipped, `${where}: clipped or scrolling sideways`).toEqual([])
  const box = (await scope.boundingBox())!
  expect(box.x + box.width, `${where}: wider than the screen`).toBeLessThanOrEqual(width(scope.page()) + 0.5)
}

test("Roma at phone size: goal, what-if, trip and tax cards fit; History opens as a sheet", async ({ page }) => {
  test.setTimeout(180_000)
  await romaUser(page, "roma-cards")

  // The question box comes first; the conversation list is behind History.
  await page.goto("/roma")
  await expect(page.getByRole("navigation", { name: "Past conversations" })).toHaveCount(0)
  await expectOnScreen(page, page.getByLabel("Your question"), "Roma question box")

  const goal = await askRoma(page, "Can I reach Car 2027?")
  await expect(goal.getByText("Goal check · Car 2027")).toBeVisible()
  await goal.locator("details").getByText("How this was worked out").click()
  await expect(goal.getByRole("table", { name: "Figures from your records" })).toBeVisible()
  await expectNoSideScroll(page, "Roma goal check")
  await expectNothingClipped(goal, "Roma goal check")
  await shot(page, "roma-goal", true)

  const whatIf = await askRoma(page, "What if I save 10k more a month for Car 2027?")
  await expect(whatIf.getByText("What if · Car 2027")).toBeVisible()
  // Below md the before/after rows stack instead of three squeezed columns.
  const stacked = whatIf.getByTestId("what-if-stacked")
  await expect(stacked).toBeVisible()
  await expect(stacked).toContainText("For this goal a month")
  await expect(whatIf.getByRole("table", { name: "The goal as it is and with the change" })).toBeHidden()
  await whatIf.locator("details").getByText("How this was worked out").click()
  await expectNoSideScroll(page, "Roma what if")
  await expectNothingClipped(whatIf, "Roma what if")
  await shot(page, "roma-what-if", true)

  const month = monthDay(3).slice(0, 7)
  const trip = await askRoma(page, `Trip to Kerala, domestic, ${month}, 3 nights, 2 travellers; ${dayOf(-2, 10)} to ${dayOf(-2, 12)} was domestic for 2, travel`)
  await expect(trip.getByText("Trip check · Kerala")).toBeVisible()
  await expectNoSideScroll(page, "Roma trip check")
  await expectNothingClipped(trip, "Roma trip check")
  await shot(page, "roma-trip", true)

  const tax = await askRoma(page, "my in hand salary is 1415000 how much i have to pay tax calculate it in old and new tax regime")
  const card = tax.getByRole("region", { name: "Tax estimate" })
  await expect(card.getByRole("row", { name: /^Total tax/ })).toHaveText([/₹84,240/, /₹2,30,880/])
  await expectNoSideScroll(page, "Roma tax estimate")
  await expectNothingClipped(card, "Roma tax estimate")
  await shot(page, "roma-tax", true)

  // History: a sheet with the past conversations; opening one closes it.
  await page.getByRole("button", { name: /^History \(\d+\)$/ }).click()
  const sheet = dialog(page, "History")
  const list = sheet.getByRole("navigation", { name: "Past conversations" })
  await expect(list.getByRole("listitem")).toHaveCount(4)
  await expectNoSideScroll(page, "History sheet")
  await expectPhoneFriendly(page, "History sheet", "[role=dialog]")
  await shot(page, "roma-history-sheet")
  await list.getByRole("link", { name: "What if I save 10k more a month for Car 2027?" }).click()
  await expect(sheet).toBeHidden()
  await expect(page).toHaveURL(/\/roma\?c=/)
  await expect(page.getByRole("list", { name: "Roma's answers" }).getByText("What if · Car 2027")).toBeVisible()
})

test("Roma plan at phone size: a full-height sheet, its own scroll, Save as PDF and Close in a fixed footer", async ({ page }) => {
  test.setTimeout(120_000)
  await demoUser(page, "roma-plan")
  await page.goto("/settings")
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByRole("status").getByText("Roma is on.")).toBeVisible()
  await page.goto("/roma")
  await page.getByLabel("Your question").fill("Plan my trip to Goa in January for 2 people, 4 nights")
  await page.getByRole("button", { name: "Ask Roma" }).click()
  const intake = page.getByRole("form", { name: "Plan questions" })
  await intake.getByLabel("Travelling from which city?", { exact: true }).fill("Delhi")
  await intake.getByRole("button", { name: "Skip: What kind of stay?" }).click()
  await intake.getByRole("button", { name: "Make the plan" }).click()
  const answers = page.getByRole("list", { name: "Roma's answers" })
  await expectNothingClipped(answers.getByTestId("plan-summary"), "plan summary card")
  await answers.getByRole("button", { name: "Open the plan" }).click()

  const plan = page.getByRole("dialog")
  await expect(plan.getByRole("heading", { name: /^Delhi to Goa/ })).toBeVisible()
  // Full height: the sheet fills the screen.
  const box = (await plan.boundingBox())!
  expect(box.height).toBeGreaterThan(page.viewportSize()!.height * 0.9)
  const footer = plan.getByTestId("plan-footer")
  const pdf = footer.getByRole("button", { name: "Save as PDF" })
  await expectOnScreen(page, pdf, "plan footer Save as PDF")
  await expectOnScreen(page, footer.getByRole("button", { name: "Close" }), "plan footer Close")
  const body = plan.locator("[data-sheet-body]")
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await expectNoSideScroll(page, "plan sheet")
  expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth), "plan sheet scrolls sideways").toBeLessThanOrEqual(0)
  await expectPageLocked(page, plan)
  await shot(page, "roma-plan-sheet")
  // Scrolled halfway down the plan, the footer is still there.
  await plan.getByRole("region", { name: "Cost breakdown" }).scrollIntoViewIfNeeded()
  await expectOnScreen(page, pdf, "plan footer, scrolled")
  await shot(page, "roma-plan-sheet-scrolled")
})

test("UPI import review at phone size: rows as cards, filters and Save in sticky bars, no sideways scroll", async ({ page }) => {
  test.setTimeout(120_000)
  await demoUser(page, "upi")
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "1,00,000", asOf: "2026-09-01" })
  await addBank(page, { bank: "State Bank of India", last4: "", opening: "50,000", asOf: "2026-09-01" })
  await page.goto("/transactions/import/upi")
  const statement = { name: "paytm.pdf", mimeType: "application/pdf", buffer: Buffer.from(syntheticPdf(paytmPages({ payments: paytmDefaultPayments() }))) }
  await page.getByLabel("Choose your UPI app statement (PDF)").setInputFiles(statement)
  await page.getByLabel("Account for State Bank Of India ··12").selectOption({ label: "State Bank of India" })
  await page.getByLabel("Account for Example Bank ··34").selectOption({ label: "HDFC Bank" })
  await expectNoSideScroll(page, "UPI account matching")
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByRole("button", { name: "Not now" }).click()

  const review = page.getByRole("region", { name: "Review the payments" })
  const rows = review.getByRole("list", { name: "Payments" }).getByRole("listitem")
  await expect(rows.first()).toBeVisible()
  await review.getByRole("heading", { name: "Review the payments" }).scrollIntoViewIfNeeded()
  await expectNoSideScroll(page, "UPI review")
  // Each card: payee, amount, date, and the category to choose.
  const cafe = rows.filter({ hasText: /^Green Leaf Cafe/ })
  await expect(cafe.getByLabel(/^Category for/)).toBeVisible()
  await expectNothingClipped(cafe, "UPI payment card")
  // Save is reachable at once, above the tab bar, and stays there as the list scrolls.
  const save = review.getByRole("button", { name: "Save ticked payments" })
  await expectOnScreen(page, save, "UPI Save")
  await shot(page, "upi-review")
  await rows.nth(2).scrollIntoViewIfNeeded()
  await page.mouse.wheel(0, 300)
  await expectOnScreen(page, save, "UPI Save, scrolled")
  await expectOnScreen(page, review.getByTestId("review-filters"), "UPI filters, scrolled")
  await expectPhoneFriendly(page, "UPI review bars", "[data-testid=review-save-bar]")
  await shot(page, "upi-review-scrolled")
  await review.getByRole("radio", { name: "Need a choice" }).check()
  await expectNoSideScroll(page, "UPI review, filtered")
})

test("loan schedule stacks on phones; Reports and Investments tables scroll inside their box with the first column pinned", async ({ page }) => {
  test.setTimeout(180_000)
  await demoUser(page, "tables")
  await seed(page)

  // Loans: one stacked row per instalment, no seven-column table.
  await page.goto("/loans-liabilities")
  await page.getByRole("button", { name: "Add loan" }).first().click()
  const add = dialog(page, "Add loan")
  await add.getByRole("radio", { name: "Education loan" }).check()
  await add.getByRole("button", { name: "Next" }).click()
  await add.getByLabel("Lender").fill("State Bank of India")
  await add.getByLabel("Sanctioned amount (₹)").fill("10,00,000")
  await add.getByLabel("Amount taken (₹)").fill("8,00,000")
  await add.getByLabel("Interest rate (% a year)").fill("10")
  await add.getByLabel("Tenure (months)").fill("12")
  await add.getByRole("radio", { name: "Starts later" }).check()
  const [y, m] = todayInIndia().split("-").map(Number) as [number, number]
  await add.getByLabel("First EMI date").fill(new Date(Date.UTC(y, m + 1, 5)).toISOString().slice(0, 10))
  await add.getByRole("button", { name: "Add loan" }).click()
  await expect(add).toBeHidden()
  const loan = page.getByRole("region", { name: "Long-term liabilities" }).getByRole("listitem").filter({ hasText: "State Bank of India" }).first()
  await loan.getByRole("button", { name: /^State Bank of India/ }).click()
  const show = loan.getByRole("button", { name: /^Show schedule \(\d+\)$/ })
  const count = Number((await show.textContent())!.match(/\((\d+)\)/)![1])
  await show.click()
  const schedule = page.getByTestId("loan-schedule-stacked")
  await expect(schedule.getByRole("listitem")).toHaveCount(count)
  await expect(schedule.getByRole("listitem").first()).toContainText("EMI 1")
  await expect(schedule.getByRole("listitem").first()).toContainText("Due")
  await expect(page.getByRole("table", { name: "Schedule of State Bank of India" })).toBeHidden()
  await expectNoSideScroll(page, "loan schedule")
  await expectNothingClipped(schedule, "loan schedule")
  await expectPhoneFriendly(page, "loan schedule", "[data-testid=loan-schedule-stacked]")
  await shot(page, "loan-schedule")

  // Reports: the cash flow table scrolls in its own box, the month column stays put.
  await page.goto("/reports")
  const cashFlow = page.getByRole("region", { name: "Cash flow by month" })
  await expect(cashFlow.getByRole("table")).toBeVisible()
  await expectPinnedTable(page, cashFlow, "cash flow table")
  await shot(page, "reports-table")

  // Investments: the By category table the same way.
  await page.goto("/investments")
  await page.getByRole("button", { name: "Add holding" }).first().click()
  const holding = dialog(page, "Add holding")
  await holding.getByLabel("Search a fund or share").fill("lotus")
  await holding.getByRole("list", { name: "Search results" }).getByRole("button", { name: /^Lotus Test Industries Ltd/ }).click()
  await holding.getByLabel("Units").fill("10")
  await holding.getByLabel("Buy price per unit (₹)").fill("1,000")
  await holding.getByRole("button", { name: "Add holding" }).click()
  await expect(holding).toBeHidden()
  const byCategory = page.getByRole("region", { name: "Investments by category" })
  await expect(byCategory.getByRole("table")).toBeVisible()
  await expectPinnedTable(page, byCategory, "investments table")
  await shot(page, "investments-table")
})

/** The table scrolls sideways in its box (not the page) and its first column stays in place. */
async function expectPinnedTable(page: Page, box: Locator, where: string) {
  await expectNoSideScroll(page, where)
  expect(await box.evaluate((el) => el.scrollWidth > el.clientWidth), `${where}: wider than its box`).toBe(true)
  const first = box.locator("tbody tr").first().locator(":scope > *").first()
  const before = (await first.boundingBox())!.x
  await box.evaluate((el) => el.scrollBy({ left: 200 }))
  await expect.poll(() => box.evaluate((el) => el.scrollLeft), { message: `${where}: scrolls` }).toBeGreaterThan(0)
  expect(Math.round((await first.boundingBox())!.x), `${where}: first column pinned`).toBe(Math.round(before))
  await box.evaluate((el) => el.scrollTo({ left: 0 }))
}
