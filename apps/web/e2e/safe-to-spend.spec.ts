import { type Page, expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { AFTER_BILLS_LINE, type Database, type HomeData, heroText, shortWarnings, userToday } from "@fin-creador/api"
import { formatMoneyWhole } from "@fin-creador/domain"
// The phone's Home E2E seeders (Sprint 13a PR 4), reused so the web is checked against exactly
// the same demo user data and the same expected figures as the phone.
import { type Demo, expectedHome, noIncomeDailyMinor, seedLimit, seedNormal, seedOverdue, seedPaise, seedShort } from "../../mobile/e2e/demo-data"
import { PASSWORD, signUpConfirmed, uniqueEmail } from "./helpers"

// Sprint 13a PR 5: Safe to spend on the web Overview, against the throwaway local Supabase with
// a fresh demo user per test. The card must show what the phone shows: the shared loader
// (loadHomeData, read as the same user) gives the expected figures, and the fixed demo
// arithmetic pins them (final rule, goals not subtracted: ₹4,875 a day and ₹3,675 left today;
// ₹4,750 with an overdue bill).

const SHOTS = "e2e-screenshots"
const money = (minor: number) => formatMoneyWhole(minor, { currency: "INR" })

const card = (page: Page, title: string) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: title, exact: true }) })
const safe = (page: Page) => card(page, "Safe to spend today")
/** The hero's shared figures from packages/api (Savings rate, web only, comes after them). */
const heroFigures = (page: Page) =>
  safe(page).locator("dl > div").filter({ hasNot: page.getByText("Savings rate", { exact: true }) }).getByRole("definition")
const comingUp = (page: Page) => card(page, "Coming up")
/** The big figure: the first match in the card (a figure below it may show the same amount, e.g. For goals ₹0). */
const headline = (page: Page, amount: string) => safe(page).getByText(amount, { exact: true }).first()

/** A confirmed demo user, signed in on the web, with the phone's demo data written through the public API (RLS). */
async function demoUser(page: Page, label: string, seed: (demo: Demo) => Promise<void>): Promise<HomeData> {
  const email = uniqueEmail(`safe-${label}`)
  await signUpConfirmed(page, "Demo user", email)
  const client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  expect((await client.auth.signInWithPassword({ email, password: PASSWORD })).error).toBeNull()
  const day = await userToday(client)
  if (!day.ok) throw new Error(`Could not read today: ${day.reason}`)
  const demo = { client, today: day.today }
  await seed(demo)
  await page.goto("/")
  return expectedHome(demo)
}

async function shots(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}-desktop.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${SHOTS}/${name}-phone.png`, fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
}

test("normal month: the same Safe to spend as the phone, ₹4,875 a day and ₹3,675 left today", async ({ page }) => {
  const home = await demoUser(page, "normal", (d) => seedNormal(d))
  const hero = heroText(home)
  expect(home.safe.nextIncomeDate).not.toBeNull()
  expect(home.limit).toBeNull()
  expect(hero.amountMinor).toBe(4_875_00)
  expect(hero.lines).toEqual([AFTER_BILLS_LINE, "₹3,675 left today"])

  await expect(headline(page, "₹4,875")).toBeVisible()
  await expect(safe(page).getByText(hero.suffix, { exact: true })).toBeVisible()
  await expect(safe(page).getByText(AFTER_BILLS_LINE, { exact: true })).toBeVisible()
  await expect(safe(page).getByText("₹3,675 left today", { exact: true })).toBeVisible()
  await expect(safe(page).getByRole("progressbar", { name: "₹1,200 spent today of ₹4,875" })).toBeVisible()
  // The shared breakdown from packages/api, then this month's Savings rate (Money left is the first card below).
  await expect(heroFigures(page)).toHaveText(hero.figures.map((f) => money(f.minor)))
  await expect(heroFigures(page)).toHaveText(["₹42,000", "₹3,000", "₹5,000"])
  await expect(safe(page).getByRole("term")).toHaveText(["At start of today", "Bills due", "For goals", "Savings rate"])
  await expect(safe(page).getByTestId("amount-total-available")).toHaveCount(0)

  // Coming up: both bills, soonest first, with their account; nothing overdue.
  const bills = comingUp(page).getByRole("list", { name: "Bills coming up" }).getByRole("listitem")
  await expect(bills).toHaveCount(2)
  await expect(bills.nth(0)).toContainText("Electricity")
  await expect(bills.nth(0)).toContainText("HDFC Bank")
  await expect(bills.nth(0)).toContainText("₹2,400")
  await expect(bills.nth(1)).toContainText("Phone")
  await expect(comingUp(page).getByText("Overdue", { exact: true })).toHaveCount(0)

  // The rest of the Overview is still there, unchanged.
  await expect(page.getByRole("region", { name: "Summary this month" })).toBeVisible()
  await shots(page, "13a-overview-safe-normal")
})

test("overdue bill: counted as due now and labelled Overdue, ₹4,750 a day as on the phone", async ({ page }) => {
  const home = await demoUser(page, "overdue", seedOverdue)
  const hero = heroText(home)
  expect(hero.amountMinor).toBe(4_750_00)
  expect(hero.lines).toEqual([AFTER_BILLS_LINE, "₹3,550 left today"])

  await expect(headline(page, "₹4,750")).toBeVisible()
  await expect(safe(page).getByText(hero.suffix, { exact: true })).toBeVisible()
  await expect(safe(page).getByText("₹3,550 left today", { exact: true })).toBeVisible()
  await expect(heroFigures(page)).toHaveText(["₹42,000", "₹4,000", "₹5,000"])

  // Overdue first, with its label, then the bills still to come.
  const bills = comingUp(page).getByRole("list", { name: "Bills coming up" }).getByRole("listitem")
  await expect(bills.first()).toContainText("Internet")
  await expect(bills.first().getByText("Overdue", { exact: true })).toBeVisible()
  await expect(bills.first()).toContainText("₹1,000")
  await expect(bills.nth(1)).toContainText("Electricity")
  await expect(bills.nth(1).getByText("Overdue", { exact: true })).toHaveCount(0)
  // The Upcoming card says Overdue for the same unpaid bill, never Missed.
  const upcoming = card(page, "Upcoming")
  await expect(upcoming.locator("li").filter({ hasText: "Internet" }).getByText("Overdue", { exact: true })).toBeVisible()
  await expect(upcoming.getByText("Missed", { exact: true })).toHaveCount(0)
  await shots(page, "13a-overview-safe-overdue")
})

test("paise: the EMI row and Bills due round the same way, so the rows add up", async ({ page }) => {
  const home = await demoUser(page, "paise", seedPaise)
  const hero = heroText(home)
  expect(home.safe.billsMinor).toBe(14_423_40) // exact
  expect(hero.amountMinor).toBe(3_447_00)

  await expect(headline(page, "₹3,447")).toBeVisible()
  await expect(heroFigures(page)).toHaveText(["₹42,000", "₹14,424", "₹5,000"])
  const bills = comingUp(page).getByRole("list", { name: "Bills coming up" }).getByRole("listitem")
  await expect(bills).toHaveCount(3)
  await expect(bills.filter({ hasText: "Education EMI" })).toContainText("₹11,424")
  await expect(bills.filter({ hasText: "Electricity" })).toContainText("₹2,400")
  await expect(bills.filter({ hasText: "Phone" })).toContainText("₹600")
  // The Upcoming card shows the same bill the same way: whole rupees, rounded up.
  const upcomingEmi = card(page, "Upcoming").locator("li").filter({ hasText: "Education EMI" })
  await expect(upcomingEmi).toContainText("₹11,424")
  await expect(upcomingEmi).not.toContainText("11,423")
  await shots(page, "13a-overview-safe-paise")
})

test("short: ₹0 a day, the shortfall before payday and the account named", async ({ page }) => {
  const home = await demoUser(page, "short", seedShort)
  const hero = heroText(home)
  const [warning] = shortWarnings(home)
  expect(hero.amountMinor).toBe(0)
  expect(hero.lines[0]).toMatch(/^₹3,000 short before \d{1,2} [A-Z][a-z]{2} in HDFC Bank$/)
  expect(warning).toMatch(/^Rent on \d{1,2} [A-Z][a-z]{2} leaves you ₹3,000 short in HDFC Bank$/)

  await expect(headline(page, "₹0")).toBeVisible()
  await expect(safe(page).getByText(hero.suffix, { exact: true })).toBeVisible()
  // The shortfall is a warning (screen readers hear "Warning:"), in the warning colour, not lime.
  const shortLine = safe(page).getByText(hero.lines[0]!)
  await expect(shortLine).toBeVisible()
  await expect(shortLine).toHaveText(`Warning: ${hero.lines[0]}`)
  await expect(shortLine).toHaveCSS("color", "rgb(255, 168, 148)")
  await expect(safe(page).getByRole("progressbar")).toHaveCount(0)
  await expect(heroFigures(page)).toHaveText(hero.figures.map((f) => money(f.minor)))
  await expect(heroFigures(page)).toHaveText(["₹9,000", "₹12,000", "₹0"])
  await expect(comingUp(page).getByText(warning!)).toBeVisible()
  await shots(page, "13a-overview-safe-short")
})

test("no income date: a daily figure to the month's end, with no income-date prompt", async ({ page }) => {
  const home = await demoUser(page, "no-income", (d) => seedNormal(d, { income: false }))
  const hero = heroText(home)
  expect(home.safe.nextIncomeDate).toBeNull()
  // (₹42,000 − the bills due by month end) ÷ days left in the month; goals not subtracted.
  expect(hero.amountMinor).toBe(noIncomeDailyMinor(home.today))
  expect(hero.suffix).toMatch(/^a day, until 1 [A-Z][a-z]{2}$/)

  await expect(headline(page, money(hero.amountMinor))).toBeVisible()
  await expect(safe(page).getByText(hero.suffix, { exact: true })).toBeVisible()
  await expect(safe(page).getByText(AFTER_BILLS_LINE, { exact: true })).toBeVisible()
  await expect(card(page, "Money left this month")).toHaveCount(0)
  await shots(page, "13a-overview-safe-no-income-date")
  // Income is added when it arrives, at the user's choice: no prompt to set a date.
  await expect(safe(page).getByText(/income date|your income arrives/i)).toHaveCount(0)
})

test("daily spend limit: '₹800 left of your ₹2,000 daily limit' and the spent bar, no after-bills line", async ({ page }) => {
  const home = await demoUser(page, "limit", seedLimit)
  const hero = heroText(home)
  expect(home.limit?.today.dailyMinor).toBe(2_000_00)
  expect(home.limit?.exceedsMoneyAfterBills).toBe(false)
  expect(hero.amountMinor).toBe(800_00)
  expect(hero.suffix).toBe("left of your ₹2,000 daily limit")
  expect(hero.lines).toEqual([])
  expect(hero.note).toBeNull()

  await expect(headline(page, "₹800")).toBeVisible()
  await expect(safe(page).getByText(hero.suffix, { exact: true })).toBeVisible()
  await expect(safe(page).getByRole("progressbar", { name: "₹1,200 spent today of ₹2,000" })).toBeVisible()
  await expect(safe(page).getByText(AFTER_BILLS_LINE, { exact: true })).toHaveCount(0)
  // The figures row stays as it is.
  await expect(heroFigures(page)).toHaveText(["₹42,000", "₹3,000", "₹5,000"])
  await shots(page, "pre13b-overview-spend-limit")
})
