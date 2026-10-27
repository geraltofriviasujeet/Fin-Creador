import { type Page, expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { PASSWORD, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Fixed deposits end to end (Sprint 7), against the throwaway local Supabase in CI (and the
// fictional instruments of e2e/fixtures/instruments.sql for the All tab). Expected values were
// computed with Python's fractions module, not with the app's code. Dates are fixed in the
// past, so the figures don't depend on the day the test runs, except "worth today" of a
// running deposit, which is only checked to be shown. Screenshots in e2e-screenshots/.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

const deposits = (page: Page) => page.getByRole("region", { name: "Fixed deposits" })
const row = (page: Page, text: string) => deposits(page).getByRole("listitem").filter({ hasText: text })
const summary = (page: Page) => page.getByRole("region", { name: "Summary" })
const overviewCard = (page: Page) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Investments", exact: true }) })

async function newUser(page: Page, label: string, path = "/investments?tab=fds") {
  const email = uniqueEmail(label)
  await signUpConfirmed(page, "Meera Shah", email)
  await page.goto(path)
  await expect(page.getByRole("heading", { level: 1, name: "Investments" })).toBeVisible()
  return email
}

type Deposit = { bank: string; label?: string; principal: string; rate: string; compounding?: string; start: string; maturity: string }

async function fillDeposit(page: Page, title: string, d: Partial<Deposit>) {
  const form = dialog(page, title)
  if (d.bank !== undefined) await form.getByLabel("Bank", { exact: true }).fill(d.bank)
  if (d.label !== undefined) await form.getByLabel("Label (optional)").fill(d.label)
  if (d.principal !== undefined) await form.getByLabel("Principal (₹)").fill(d.principal)
  if (d.rate !== undefined) await form.getByLabel("Interest rate (% a year)").fill(d.rate)
  if (d.compounding !== undefined) await form.getByLabel("Interest added").selectOption({ label: d.compounding })
  if (d.start !== undefined) await form.getByLabel("Start date").fill(d.start)
  if (d.maturity !== undefined) await form.getByLabel("Maturity date").fill(d.maturity)
  return form
}

async function addDeposit(page: Page, d: Deposit) {
  await page.getByRole("button", { name: "Add fixed deposit" }).first().click()
  const form = await fillDeposit(page, "Add fixed deposit", d)
  await form.getByRole("button", { name: "Add fixed deposit" }).click()
  await expect(toast(page, "Fixed deposit added.").first()).toBeVisible()
  await expect(form).toBeHidden()
}

async function addHolding(page: Page, query: string, name: string, units: string, price: string) {
  await page.getByRole("button", { name: "Add holding" }).first().click()
  const d = dialog(page, "Add holding")
  await d.getByLabel("Search a fund or share").fill(query)
  await d.getByRole("list", { name: "Search results" }).getByRole("button", { name: new RegExp(`^${name}`) }).click()
  await d.getByLabel("Units").fill(units)
  await d.getByLabel("Buy price per unit (₹)").fill(price)
  await d.getByRole("button", { name: "Add holding" }).click()
  await expect(d).toBeHidden()
}

test("add (double submit adds once), edit, archive, restore and delete a fixed deposit", async ({ page }) => {
  await newUser(page, "fd-crud")
  await expect(page.getByText("No fixed deposits yet")).toBeVisible()
  await page.getByRole("button", { name: "Add fixed deposit" }).first().click()
  const form = await fillDeposit(page, "Add fixed deposit", {
    bank: "State Bank of India", // offered in the type-ahead; any name can be typed
    label: "Emergency fund",
    principal: "1,00,000",
    rate: "7.25",
    start: "2025-01-15",
    maturity: "2027-01-15",
  })
  await expect(form.getByLabel("Interest added")).toHaveValue("quarterly") // the default
  await expect(form).toContainText("15 Jan 2025") // dates also in words
  await expect(form).toContainText("15 Jan 2027")
  // 8 quarters at 7.25%: ₹1,15,453.95, interest ₹15,453.95; started in the past, so worth today shows.
  await expect(form).toContainText("₹1,15,453.95")
  await expect(form).toContainText("Interest ₹15,453.95")
  await expect(form).toContainText("today")
  await expect(form).toContainText("Interest is added to the deposit (cumulative). Estimate before tax and TDS; your bank's figure can differ slightly.")
  // The form fits a 1440×720 window: its body doesn't scroll and the footer is in view.
  await page.setViewportSize({ width: 1440, height: 720 })
  expect(await form.locator("form > div").first().evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
  await expect(form.getByRole("button", { name: "Add fixed deposit" })).toBeInViewport()
  await page.setViewportSize({ width: 1440, height: 900 })
  await shot(page, "fd-dialog")
  // A future start is refused.
  await form.getByLabel("Start date").fill("2099-01-01")
  await form.getByRole("button", { name: "Add fixed deposit" }).click()
  await expect(form).toContainText("The start date can't be in the future")
  await form.getByLabel("Start date").fill("2025-01-15")
  // Double click: the request key adds the deposit once.
  await form.getByRole("button", { name: "Add fixed deposit" }).dblclick()
  await expect(toast(page, "Fixed deposit added.").first()).toBeVisible()
  await expect(form).toBeHidden()
  await page.reload()
  await expect(deposits(page).getByRole("listitem")).toHaveCount(1)
  const sbi = row(page, "Emergency fund")
  await expect(sbi).toContainText("State Bank of India")
  await expect(sbi).toContainText("₹1,00,000")
  await expect(sbi).toContainText("7.25%")
  await expect(sbi).toContainText("Quarterly")
  await expect(sbi).toContainText("₹1,15,453.95")

  // Edit in place: 7.5% gives ₹1,16,022.17.
  await page.getByRole("button", { name: /^Edit fixed deposit Emergency fund/ }).click()
  const edit = await fillDeposit(page, "Edit Emergency fund", { rate: "7.5" })
  await expect(edit.getByLabel("Principal (₹)")).toHaveValue("100000")
  await edit.getByRole("button", { name: "Save changes" }).click()
  await expect(toast(page, "Fixed deposit saved.")).toBeVisible()
  await expect(row(page, "Emergency fund")).toContainText("₹1,16,022.17")

  // Archive, restore, archive again, then delete permanently (archived deposits only).
  const button = (verb: string) => page.getByRole("button", { name: new RegExp(`^${verb} fixed deposit Emergency fund`) })
  await expect(button("Delete")).toHaveCount(0)
  await button("Archive").click()
  await dialog(page, "Archive this fixed deposit?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Fixed deposit archived.")).toBeVisible()
  await expect(page.getByText("No fixed deposits yet")).toBeVisible()
  await page.getByRole("button", { name: "Show archived (1)" }).click()
  await button("Restore").click()
  await expect(toast(page, "Fixed deposit restored.")).toBeVisible()
  await expect(row(page, "Emergency fund")).toBeVisible()
  await button("Archive").click()
  await dialog(page, "Archive this fixed deposit?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Fixed deposit archived.")).toBeVisible()
  await button("Delete").click()
  const confirm = dialog(page, "Delete this fixed deposit permanently?")
  await expect(confirm).toContainText("This can't be undone.")
  await confirm.getByRole("button", { name: "Delete permanently" }).click()
  await expect(toast(page, "Fixed deposit deleted.")).toBeVisible()
  await expect(page.getByText("Emergency fund")).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Show archived/ })).toHaveCount(0)
})

test("a matured deposit, the four categories on the All tab and the Overview card", async ({ page }) => {
  await newUser(page, "fd-matured")
  // ₹50,000 at 7% yearly for one year, matured on 15 Jan 2025: ₹53,500.
  await addDeposit(page, { bank: "HDFC Bank", principal: "50,000", rate: "7", compounding: "Yearly", start: "2024-01-15", maturity: "2025-01-15" })
  await addDeposit(page, { bank: "My Co-op Bank", label: "Car fund", principal: "1,00,000", rate: "7.1", start: "2025-06-01", maturity: "2030-06-01" })
  await page.reload()
  const matured = row(page, "HDFC Bank")
  await expect(matured).toContainText("Matured")
  await expect(matured).toContainText("₹53,500")
  await expect(row(page, "Car fund")).toContainText("My Co-op Bank")
  await expect(row(page, "Car fund")).toContainText("days")
  await expect(summary(page)).toContainText("₹1,50,000") // invested: both principals
  await expect(summary(page)).toContainText("Not included in Total available")
  await shot(page, "fd-tab")

  await page.goto("/investments")
  await addHolding(page, "lotus", "Lotus Test Industries Ltd", "10", "1,000")
  await addHolding(page, "gilt fund", "Test Gilt Fund", "100", "30")
  await addHolding(page, "bees", "Test Nifty Bees ETF", "40", "250")
  await page.reload()
  const byCategory = page.getByRole("table", { name: "By category" })
  for (const name of ["Shares", "Mutual funds", "ETFs", "Fixed deposits"]) {
    await expect(byCategory.getByRole("row", { name: new RegExp(`^${name}`) })).not.toContainText("none")
  }
  await expect(byCategory.getByRole("row", { name: /^Fixed deposits/ })).toContainText("₹1,50,000")
  await shot(page, "fd-all-tab")

  await page.goto("/")
  await expect(overviewCard(page)).toContainText("Not included in Total available")
  const fdLine = overviewCard(page).getByRole("list", { name: "By category" }).getByRole("listitem").filter({ hasText: "Fixed deposits" })
  await expect(fdLine).not.toContainText("None")
  await overviewCard(page).screenshot({ path: `${SHOTS}/fd-overview-card.png` })
})

test("another user sees none of my fixed deposits and can't change them", async ({ browser, baseURL }) => {
  const newPage = async () => (await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })).newPage()
  const first = await newPage()
  await newUser(first, "fd-owner")
  await addDeposit(first, { bank: "Axis Bank", label: "Private deposit", principal: "75,000", rate: "6.9", start: "2025-03-01", maturity: "2026-03-01" })
  await first.close()

  const second = await newPage()
  const email = await newUser(second, "fd-stranger")
  await expect(second.getByText("Private deposit")).toHaveCount(0)
  await expect(second.getByText("No fixed deposits yet")).toBeVisible()
  // Through the API as well: no rows of another user, and an update or delete matches nothing.
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  expect((await supabase.auth.signInWithPassword({ email, password: PASSWORD })).error).toBeNull()
  const { data: visible } = await supabase.from("fixed_deposits").select("id")
  expect(visible).toEqual([])
  const { data: changed } = await supabase.from("fixed_deposits").update({ rate_bps: 1 }).gte("rate_bps", 0).select("id")
  expect(changed).toEqual([])
  const { data: removed } = await supabase.from("fixed_deposits").delete().gte("rate_bps", 0).select("id")
  expect(removed).toEqual([])
  await second.close()
})
