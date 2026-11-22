import { type Page, expect, test } from "@playwright/test"
import { addBank, addCash, addEntry, dialog, signUpConfirmed, tourDialog, uniqueEmail, welcomeDialog } from "./helpers"

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
      `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}"`
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
