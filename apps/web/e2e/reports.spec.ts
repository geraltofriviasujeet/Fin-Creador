import { readFileSync } from "node:fs"
import { type Page, expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { PASSWORD, addBank, addCash, addEntry, signUpConfirmed, uniqueEmail } from "./helpers"

// Reports (Sprint 8c) end to end, against the throwaway local Supabase: cash flow per month equals
// the Overview for the same month, the trend's last point plus investments equals the Overview's
// Net worth card, and the CSV export (guarded text, numeric amounts, voided left out, another
// user's rows absent). Screenshots in e2e-screenshots/ for the owner's review (at most 8).

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
const thisMonth = () => {
  const [y, m] = todayInIndia().split("-").map(Number) as [number, number]
  return `${MONTHS[m - 1]} ${y}`
}
const lastMonth = () => {
  const [y, m] = todayInIndia().split("-").map(Number) as [number, number]
  return m === 1 ? `Dec ${y - 1}` : `${MONTHS[m - 2]} ${y}`
}

/** ₹1,44,105 or −₹1,200.50 → minor units. */
function minor(text: string): number {
  const m = /(-|−)?₹([\d,]+)(?:\.(\d{2}))?/.exec(text)
  if (!m) throw new Error(`No amount in "${text}"`)
  const value = Number(m[2]!.replace(/,/g, "")) * 100 + Number(m[3] ?? 0)
  return m[1] ? -value : value
}

const cashFlow = (page: Page) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Cash flow", exact: true }) })
const trend = (page: Page) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Net worth trend", exact: true }) })
const monthRow = (page: Page, month: string) => cashFlow(page).getByRole("row").filter({ has: page.getByRole("rowheader").filter({ hasText: month }) })
const cell = (page: Page, month: string, column: number) => monthRow(page, month).getByRole("cell").nth(column)
const summary = (page: Page) => page.getByRole("region", { name: /^Summary/ })
const overviewCard = (page: Page, label: string) => summary(page).locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: label, exact: true }) })
const netWorthCard = (page: Page) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Net worth", exact: true }) })
const term = (page: Page, label: string) => trend(page).locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd")

async function asUser(email: string) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD })
  expect(error).toBeNull()
  return supabase
}

test("navigation, empty states, and Reports under More on a phone", async ({ browser, baseURL }) => {
  const page = await (await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })).newPage()
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("reports-nav"))
  const links = page.getByRole("navigation", { name: "Main" }).first().getByRole("link")
  await expect(links.nth(6)).toHaveText("Loans & Liabilities")
  await expect(links.nth(7)).toHaveText("Reports")
  await links.nth(7).click()
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page).toHaveTitle(/Reports/)
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Range" }).getByRole("link", { name: "12 months" })).toHaveAttribute("aria-current", "page")
  await expect(cashFlow(page)).toContainText("No income or expenses recorded in these months.")
  await expect(trend(page)).toContainText("Nothing to show yet.")
  await expect(page.getByRole("heading", { name: "Export CSV" })).toBeVisible()
  await shot(page, "reports-empty")
  await page.close()

  const phone = await (await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })).newPage()
  await signUpConfirmed(phone, "Bala Iyer", uniqueEmail("reports-phone"))
  const tabs = phone.getByRole("navigation", { name: "Main" }).last()
  await expect(tabs.getByRole("link")).toHaveText(["Overview", "Activity", "Goals", "Investments"])
  const more = tabs.getByRole("button", { name: "More" })
  await expect(more).toHaveAttribute("aria-expanded", "false")
  await more.click()
  await expect(more).toHaveAttribute("aria-expanded", "true")
  await expect(tabs.getByRole("link", { name: "Reports" })).toBeVisible()
  await phone.screenshot({ path: `${SHOTS}/reports-phone-more.png` }) // the viewport, with the menu open
  await phone.keyboard.press("Escape")
  await expect(tabs.getByRole("link", { name: "Reports" })).toBeHidden()
  await expect(more).toBeFocused()
  await more.click()
  await tabs.getByRole("link", { name: "Reports" }).click()
  await expect(phone.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible()
  await expect(tabs.getByRole("link", { name: "Reports" })).toBeHidden() // navigating closed it
  await more.click()
  await expect(tabs.getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page")
  const scroll = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(scroll).toBe(0) // no horizontal page scroll at phone width
  await phone.close()
})

test("a month equals the Overview's; the trend's last point plus investments equals the Net worth card", async ({ page }) => {
  const email = uniqueEmail("reports-flow")
  await signUpConfirmed(page, "Chitra Nair", email)
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addCash(page, "500")
  await addEntry(page, { amount: "250", category: "Groceries", from: "HDFC Bank ··4821" })
  await addEntry(page, { amount: "400", category: "Transport", from: "HDFC Bank ··4821" })
  await addEntry(page, { type: "Income", amount: "5,000", category: "Salary", from: "HDFC Bank ··4821" })
  await addEntry(page, { type: "Transfer", amount: "1,000", from: "HDFC Bank ··4821", to: "Cash in hand" })
  // A holding (fictional instrument, e2e/fixtures/instruments.sql): 10 units at ₹1,250.50 = ₹12,505.
  const supabase = await asUser(email)
  const instrument = await supabase.from("instruments").select("id").eq("source", "bse").eq("source_code", "990001").single()
  expect(instrument.error).toBeNull()
  const holding = await supabase.from("investments").insert({ instrument_id: instrument.data!.id, units_scaled: 100_000, buy_price_scaled: 10_000_000, buy_date: "2026-01-02", idempotency_key: crypto.randomUUID() })
  expect(holding.error).toBeNull()

  await page.goto("/")
  const overviewIncome = minor(await overviewCard(page, "Income").textContent() ?? "")
  const overviewExpenses = minor(await overviewCard(page, "Expenses").textContent() ?? "")
  await expect(netWorthCard(page).getByText(/^Net worth ₹/)).toBeVisible()
  const overviewNetWorth = minor(await netWorthCard(page).getByText(/^Net worth ₹/).textContent() ?? "")
  expect([overviewIncome, overviewExpenses]).toEqual([5_000_00, 650_00])
  // 10,000 + 500 − 650 + 5,000 available, + 12,505 in shares.
  expect(overviewNetWorth).toBe(27_355_00)

  await page.goto("/reports")
  const month = thisMonth()
  await expect(monthRow(page, month)).toContainText("so far")
  expect(minor(await cell(page, month, 0).textContent() ?? "")).toBe(overviewIncome)
  expect(minor(await cell(page, month, 1).textContent() ?? "")).toBe(overviewExpenses)
  await expect(cell(page, month, 2)).toHaveText("+₹4,350")
  await expect(cell(page, month, 3)).toHaveText("87%")
  await expect(cell(page, month, 4)).toContainText("Transport")
  await expect(cell(page, month, 3)).not.toHaveText("—")
  await expect(cell(page, lastMonth(), 3)).toHaveText("—") // no income: no savings rate
  await expect(cashFlow(page).getByRole("list", { name: "Top categories for the range" }).getByRole("listitem")).toHaveCount(2)
  await expect(cashFlow(page).getByText("Show as a table")).toBeVisible()

  // The trend leaves shares out; today with them equals the Overview card.
  await expect(trend(page).getByText("Excluding shares, funds & ETFs (only today’s price is kept)").first()).toBeVisible()
  const lastPoint = minor(await term(page, "Today, excluding shares, funds & ETFs").textContent() ?? "")
  const investments = minor(await term(page, "Shares, funds & ETFs today").textContent() ?? "")
  const today = minor(await term(page, "Net worth today, with investments").textContent() ?? "")
  expect([lastPoint, investments]).toEqual([14_850_00, 12_505_00])
  expect(lastPoint + investments).toBe(today)
  expect(today).toBe(overviewNetWorth)
  await expect(trend(page)).toContainText("As corrected")
  await expect(trend(page)).toContainText("Statutory dues use today's amount")
  await shot(page, "reports-flow")

  // Ranges: presets and custom months live in the URL.
  await page.getByRole("navigation", { name: "Range" }).getByRole("link", { name: "3 months" }).click()
  await expect(page).toHaveURL(/months=3/)
  await expect(cashFlow(page).getByRole("row")).toHaveCount(4) // the header and three months
  await page.getByRole("navigation", { name: "Range" }).getByRole("link", { name: "Custom" }).click()
  await expect(page.getByLabel("From month")).toBeVisible()

  // Each month opens its entries on Transactions.
  await monthRow(page, month).getByRole("link", { name: month }).click()
  await expect(page).toHaveURL(/\/transactions\?period=custom&from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}/)
  await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible()
})

test("CSV export: injection neutralised, Amount numeric, voided left out by default, another user's rows absent", async ({ browser, baseURL }) => {
  // Another user, with a note that must never appear in the first user's file.
  const other = await (await browser.newContext({ baseURL })).newPage()
  const otherEmail = uniqueEmail("reports-other")
  await signUpConfirmed(other, "Other Person", otherEmail)
  await other.goto("/income")
  await addBank(other, { bank: "Axis Bank", last4: "9999", opening: "1,000" })
  await addEntry(other, { amount: "99", category: "Groceries", from: "Axis Bank ··9999", note: "other-user-secret" })
  const otherAccount = await (await asUser(otherEmail)).from("accounts").select("id").eq("kind", "bank").single()
  expect(otherAccount.error).toBeNull()
  await other.close()

  const page = await (await browser.newContext({ baseURL })).newPage()
  const email = uniqueEmail("reports-csv")
  await signUpConfirmed(page, "Dev Patel", email)
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addEntry(page, { amount: "1,250.50", category: "Groceries", from: "HDFC Bank ··4821", mode: "UPI", note: '=HYPERLINK("http://example.test","x")' })
  await addEntry(page, { amount: "75", category: "Transport", from: "HDFC Bank ··4821", note: "Entered twice" })
  const supabase = await asUser(email)
  const twice = await supabase.from("transactions").select("id").eq("note", "Entered twice").single()
  expect(twice.error).toBeNull()
  const voided = await supabase.rpc("void_transaction", { p_transaction_id: twice.data!.id, p_idempotency_key: crypto.randomUUID(), p_reason: "Duplicate" })
  expect(voided.error).toBeNull()

  await page.goto("/reports")
  const exportCard = page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Export CSV" }) })
  await expect(exportCard).toContainText("Made safe for spreadsheets")
  await expect(exportCard.getByLabel(/Include voided entries/)).not.toBeChecked()
  const [download] = await Promise.all([page.waitForEvent("download"), exportCard.getByRole("button", { name: "Download CSV" }).click()])
  expect(download.suggestedFilename()).toMatch(/^fincreador-transactions-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = readFileSync((await download.path())!, "utf8")
  await expect(exportCard.getByText("Downloaded 1 entry.")).toBeVisible()
  const lines = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean)
  expect(lines[0]).toBe("Date,Type,Amount,Currency,Account,To account,Category,Payment mode,Note,Voided")
  expect(lines).toHaveLength(2)
  expect(lines[1]).toMatch(new RegExp(`^${todayInIndia()},Expense,1250\\.50,INR,HDFC Bank[^,]*,,Groceries,UPI,"'=HYPERLINK\\(""http://example\\.test"",""x""\\)",$`))
  expect(lines[1]!.split(",")[2]).toMatch(/^\d+\.\d{2}$/) // Amount stays a plain number
  expect(csv).not.toContain("other-user-secret")
  expect(csv).not.toContain("Entered twice")
  await shot(page, "reports-export")

  // With voided entries: marked Yes.
  await exportCard.getByLabel(/Include voided entries/).check()
  const [withVoided] = await Promise.all([page.waitForEvent("download"), exportCard.getByRole("button", { name: "Download CSV" }).click()])
  const all = readFileSync((await withVoided.path())!, "utf8")
  expect(all).toMatch(/,Expense,75\.00,INR,.*,'?Entered twice,Yes\r\n/)
  expect(all).not.toContain("other-user-secret")

  // Another user's account id: RLS leaves nothing, so the form says so and nothing downloads.
  const foreign = await page.request.get(`/reports/export?from=2026-01-01&to=${todayInIndia()}&account=${otherAccount.data!.id}`)
  expect(foreign.status()).toBe(200)
  expect(foreign.headers()["x-row-count"]).toBe("0")
  expect(await foreign.text()).not.toContain("other-user-secret")
  // Bad parameters and an over-long range are refused before any read.
  for (const q of ["from=2026-02-30&to=2026-03-01", "from=2026-03-01&to=2026-02-01", "from=2000-01-01&to=2026-01-01", "from=2026-01-01&to=2026-02-01&account=not-a-uuid"]) {
    const bad = await page.request.get(`/reports/export?${q}`)
    expect(bad.status(), q).toBe(400)
  }
  // Empty range: the form's "nothing to download" state.
  await exportCard.getByLabel("From", { exact: true }).fill("2020-01-01")
  await exportCard.getByLabel("To", { exact: true }).fill("2020-01-31")
  await exportCard.getByRole("button", { name: "Download CSV" }).click()
  await expect(exportCard.getByText("No entries match this range and filter")).toBeVisible()
  // Signed out: sent to sign in (the route itself answers 401 too), never a file.
  const anon = await (await browser.newContext({ baseURL })).request.get(`/reports/export?from=2026-01-01&to=${todayInIndia()}`, { maxRedirects: 0 })
  expect(anon.status()).toBe(307)
  expect(anon.headers()["location"]).toContain("/sign-in")
  await page.close()
})
