import { type Page, expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { type Database, type HomeData, heroText, shortWarnings, userToday } from "@fin-creador/api"
import { formatMoneyWhole } from "@fin-creador/domain"
// The phone's Home E2E seeders (Sprint 13a PR 4), reused so the web is checked against exactly
// the same demo user data and the same expected figures as the phone.
import { type Demo, expectedHome, seedNormal, seedOverdue, seedPaise, seedShort } from "../../mobile/e2e/demo-data"
import { PASSWORD, signUpConfirmed, uniqueEmail } from "./helpers"

// Sprint 13a PR 5: Safe to spend on the web Overview, against the throwaway local Supabase with
// a fresh demo user per test. The card must show what the phone shows: the shared loader
// (loadHomeData, read as the same user) gives the expected figures, and the fixed demo
// arithmetic pins them (₹4,250 a day and ₹3,050 left today; ₹4,125 with an overdue bill).

const SHOTS = "e2e-screenshots"
const money = (minor: number) => formatMoneyWhole(minor, { currency: "INR" })

const card = (page: Page, title: string) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: title, exact: true }) })
const safe = (page: Page) => card(page, "Safe to spend today")
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

test("normal month: the same Safe to spend as the phone, ₹4,250 a day and ₹3,050 left today", async ({ page }) => {
  const home = await demoUser(page, "normal", (d) => seedNormal(d))
  const hero = heroText(home)
  expect(home.safe.kind).toBe("daily")
  expect(hero.amountMinor).toBe(4_250_00)
  expect(hero.lines).toEqual(["₹3,050 left today"])

  await expect(headline(page, "₹4,250")).toBeVisible()
  await expect(safe(page).getByText(hero.suffix!, { exact: true })).toBeVisible()
  await expect(safe(page).getByText("₹3,050 left today", { exact: true })).toBeVisible()
  await expect(safe(page).getByRole("progressbar", { name: "₹1,200 spent today of ₹4,250" })).toBeVisible()
  const figures = safe(page).getByRole("definition")
  await expect(figures).toHaveText(hero.figures.map((f) => money(f.minor)))
  await expect(figures).toHaveText(["₹42,000", "₹3,000", "₹5,000"])
  // The breakdown's first figure is the balance at the start of today; the summary card below
  // keeps "Money left" for the current balance.
  await expect(safe(page).getByRole("term")).toHaveText(["At start of today", "Bills due", "For goals"])

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

test("overdue bill: counted as due now and labelled Overdue, ₹4,125 a day as on the phone", async ({ page }) => {
  const home = await demoUser(page, "overdue", seedOverdue)
  const hero = heroText(home)
  expect(hero.amountMinor).toBe(4_125_00)
  expect(hero.lines).toEqual(["₹2,925 left today"])

  await expect(headline(page, "₹4,125")).toBeVisible()
  await expect(safe(page).getByText(hero.suffix!, { exact: true })).toBeVisible()
  await expect(safe(page).getByText("₹2,925 left today", { exact: true })).toBeVisible()
  await expect(safe(page).getByRole("definition")).toHaveText(["₹42,000", "₹4,000", "₹5,000"])

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
  expect(hero.amountMinor).toBe(2_822_00)

  await expect(headline(page, "₹2,822")).toBeVisible()
  await expect(safe(page).getByRole("definition")).toHaveText(["₹42,000", "₹14,424", "₹5,000"])
  const bills = comingUp(page).getByRole("list", { name: "Bills coming up" }).getByRole("listitem")
  await expect(bills).toHaveCount(3)
  await expect(bills.filter({ hasText: "Education EMI" })).toContainText("₹11,424")
  await expect(bills.filter({ hasText: "Electricity" })).toContainText("₹2,400")
  await expect(bills.filter({ hasText: "Phone" })).toContainText("₹600")
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
  await expect(safe(page).getByText(hero.suffix!, { exact: true })).toBeVisible()
  await expect(safe(page).getByText(hero.lines[0]!, { exact: true })).toBeVisible()
  await expect(safe(page).getByRole("progressbar")).toHaveCount(0)
  await expect(safe(page).getByRole("definition")).toHaveText(hero.figures.map((f) => money(f.minor)))
  await expect(safe(page).getByRole("definition")).toHaveText(["₹9,000", "₹12,000", "₹0"])
  await expect(comingUp(page).getByText(warning!)).toBeVisible()
  await shots(page, "13a-overview-safe-short")
})

test("no income date: money left this month and a link to set the income date", async ({ page }) => {
  const home = await demoUser(page, "no-income", (d) => seedNormal(d, { income: false }))
  const hero = heroText(home)
  expect(hero.title).toBe("Money left this month")
  expect(hero.amountMinor).toBe(34_000_00)

  const left = card(page, "Money left this month")
  await expect(left).toContainText("₹34,000")
  await expect(left.getByText(/a day, until/)).toHaveCount(0)
  await expect(safe(page)).toHaveCount(0)
  await shots(page, "13a-overview-safe-no-income-date")
  await left.getByRole("link", { name: "Set your income date" }).click()
  await expect(page).toHaveURL(/\/recurring$/)
})
