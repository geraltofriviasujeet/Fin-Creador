import { type Locator, type Page, expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { PASSWORD, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Investments page end to end (Sprint 7), against the throwaway local Supabase with the
// fictional instruments of e2e/fixtures/instruments.sql (loaded by CI). Expected figures are
// worked out by hand from the units and prices (and checked with Python's decimal module).
// Screenshots in e2e-screenshots/ for the owner's review.

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

const LOTUS = "Lotus Test Industries Ltd" // BSE close ₹1,250.50, yesterday
const HARBOR = "Harbor Test Bank Ltd" // BSE close ₹480, yesterday
const GILT = "Test Gilt Fund - Regular Plan - Growth" // NAV ₹35.9468, 10 days old
const CLOSED = "Test Closed Ended Fund - Direct Plan - Growth" // NAV 45 days old: not searchable, still valued

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const starts = (text: string) => new RegExp(`^${escape(text)}`)
const holdings = (page: Page) => page.getByRole("region", { name: "Holdings" })
const groupToggle = (page: Page, name: string) => holdings(page).getByRole("button", { name: starts(name) })
// `has` is matched inside each list item, so its locator must not be scoped to the region.
const group = (page: Page, name: string) => holdings(page).getByRole("listitem").filter({ has: page.getByRole("button", { name: starts(name) }) }).first()
const summary = (page: Page) => page.getByRole("region", { name: "Summary" })

/** Opens a group's records (a no-op when they are already open). */
async function expand(page: Page, name: string) {
  const toggle = groupToggle(page, name)
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
}
const overviewCard = (page: Page) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Investments", exact: true }) })

async function newUser(page: Page, label: string) {
  const email = uniqueEmail(label)
  await signUpConfirmed(page, "Meera Shah", email)
  await page.goto("/investments")
  await expect(page.getByRole("heading", { level: 1, name: "Investments" })).toBeVisible()
  return email
}

async function openAdd(page: Page) {
  await page.getByRole("button", { name: "Add holding" }).first().click()
  const d = dialog(page, "Add holding")
  await expect(d).toBeVisible()
  return d
}

async function choose(d: Locator, query: string, name: string) {
  await d.getByLabel("Search a fund or share").fill(query)
  await d.getByRole("list", { name: "Search results" }).getByRole("button", { name: starts(name) }).click()
}

async function addHolding(page: Page, { query, name, units, price, date }: { query: string; name: string; units: string; price: string; date?: string }) {
  const d = await openAdd(page)
  await choose(d, query, name)
  await d.getByLabel("Units").fill(units)
  await d.getByLabel("Buy price per unit (₹)").fill(price)
  if (date) await d.getByLabel("Buy date").fill(date)
  await d.getByRole("button", { name: "Add holding" }).click()
  await expect(toast(page, "Holding added.").first()).toBeVisible()
  await expect(d).toBeHidden()
}

/** A record on an instrument search no longer offers (its price is 45 days old), added as the user through the API, like an older record. */
async function addUnsearchableRecord(email: string) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: PASSWORD })
  expect(signInError).toBeNull()
  const { data: instrument } = await supabase.from("instruments").select("id").eq("source", "amfi").eq("source_code", "990103").single()
  const { error } = await supabase.from("investments").insert({
    instrument_id: instrument!.id,
    units_scaled: 500_000, // 50 units
    buy_price_scaled: 100_000, // ₹10
    buy_date: "2025-06-02",
    idempotency_key: crypto.randomUUID(),
  })
  expect(error).toBeNull()
  return supabase
}

test("navigation, empty state and the Overview link", async ({ page }) => {
  await newUser(page, "inv-empty")
  const nav = page.getByRole("navigation", { name: "Main" }).first()
  await expect(nav.getByRole("link", { name: "Investments" })).toHaveAttribute("href", "/investments")
  await expect(nav.getByText("Soon")).toHaveCount(0)
  await expect(page.getByText("Track your first investment")).toBeVisible()
  await expect(page.getByText("not investment advice")).toBeVisible()
  await shot(page, "investments-empty")

  await page.goto("/")
  await expect(overviewCard(page)).toContainText("Not included in Total available")
  await expect(overviewCard(page).getByRole("link", { name: "Add a holding" })).toHaveAttribute("href", "/investments")
})

test("add (double submit adds once), edit, archive, restore and delete a holding", async ({ page }) => {
  await newUser(page, "inv-crud")
  const d = await openAdd(page)
  await d.getByLabel("Search a fund or share").fill("lotus")
  const results = d.getByRole("list", { name: "Search results" })
  await expect(results).toContainText(LOTUS)
  await expect(results).toContainText("Share")
  await expect(results).toContainText("BSE 990001 · LOTUSTEST · INE990T01011")
  await expect(results).toContainText("₹1,250.50")
  // The 45-day-old fund is never offered.
  await d.getByLabel("Search a fund or share").fill("test closed")
  await expect(d).toContainText("Nothing matches")
  await d.getByLabel("Search a fund or share").fill("test")
  await expect(results).toContainText(GILT)
  await shot(page, "investments-search")
  await choose(d, "lotus", LOTUS)
  await d.getByLabel("Units").fill("10")
  await d.getByLabel("Buy price per unit (₹)").fill("1,000")
  await expect(d).toContainText("₹10,000") // invested
  await expect(d).toContainText("+₹2,505") // 10 × (1,250.50 − 1,000)
  await expect(d).toContainText("+25.05%")
  await shot(page, "investments-add-step2")
  // The form fits a 1440×720 window: its body doesn't scroll and the footer is in view.
  await page.setViewportSize({ width: 1440, height: 720 })
  const body = d.locator("form > div").first()
  expect(await body.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
  await expect(d.getByRole("button", { name: "Add holding" })).toBeInViewport()
  await page.setViewportSize({ width: 1440, height: 900 })
  // A future buy date is refused.
  await d.getByLabel("Buy date").fill("2099-01-01")
  await d.getByRole("button", { name: "Add holding" }).click()
  await expect(d).toContainText("The buy date can't be in the future")
  await d.getByLabel("Buy date").fill("2026-01-15")
  // Double click: the request key adds the record once.
  await d.getByRole("button", { name: "Add holding" }).dblclick()
  await expect(toast(page, "Holding added.").first()).toBeVisible()
  await expect(d).toBeHidden()
  await page.reload()
  await expect(group(page, LOTUS)).toContainText("1 record")
  await expect(group(page, LOTUS)).toContainText("₹12,505")

  // Edit in place.
  await expand(page, LOTUS)
  await page.getByRole("button", { name: starts(`Edit ${LOTUS}`) }).click()
  const edit = dialog(page, `Edit ${LOTUS}`)
  await expect(edit.getByLabel("Units")).toHaveValue("10")
  await expect(edit.getByRole("button", { name: "Change", exact: true })).toHaveCount(0) // the instrument stays
  await edit.getByLabel("Units").fill("12")
  await edit.getByRole("button", { name: "Save changes" }).click()
  await expect(toast(page, "Holding saved.")).toBeVisible()
  await expect(group(page, LOTUS)).toContainText("₹15,006") // 12 × 1,250.50
  await expect(group(page, LOTUS)).toContainText("+₹3,006")

  // Archive, restore, archive again, then delete permanently (archived records only).
  const recordButton = (verb: string) => page.getByRole("button", { name: starts(`${verb} ${LOTUS}`) })
  await expand(page, LOTUS)
  await expect(recordButton("Delete")).toHaveCount(0)
  await recordButton("Archive").click()
  await dialog(page, "Archive this holding?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Holding archived.")).toBeVisible()
  await expect(page.getByText("Track your first investment")).toBeVisible()
  await page.getByRole("button", { name: "Show archived (1)" }).click()
  await recordButton("Restore").click()
  await expect(toast(page, "Holding restored.")).toBeVisible()
  await expect(group(page, LOTUS)).toBeVisible()

  await expand(page, LOTUS)
  await recordButton("Archive").click()
  await dialog(page, "Archive this holding?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Holding archived.")).toBeVisible()
  await recordButton("Delete").click()
  const confirm = dialog(page, "Delete this holding permanently?")
  await expect(confirm).toContainText("This can't be undone.")
  await confirm.getByRole("button", { name: "Delete permanently" }).click()
  await expect(toast(page, "Holding deleted.")).toBeVisible()
  await expect(page.getByText(LOTUS)).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Show archived/ })).toHaveCount(0)
})

test("gain, loss, old price and a holding without a current price; summary and Overview card", async ({ page }) => {
  const email = await newUser(page, "inv-list")
  await addHolding(page, { query: "lotus", name: LOTUS, units: "10", price: "1,000", date: "2026-01-15" })
  await addHolding(page, { query: "LOTUSTEST", name: LOTUS, units: "5", price: "1,100", date: "2026-03-02" })
  await addHolding(page, { query: "INE990T01029", name: HARBOR, units: "5", price: "600" }) // by ISIN
  await addHolding(page, { query: "gilt fund", name: GILT, units: "100", price: "30" })
  await addUnsearchableRecord(email)
  await page.reload()

  // Lotus: 15 units, average ₹1,033.3333, value ₹18,757.50, +₹3,257.50 (+21.02%).
  const lotus = group(page, LOTUS)
  await expect(lotus).toContainText("2 records")
  await expect(lotus).toContainText("₹1,033.3333")
  await expect(lotus).toContainText("₹18,757.50")
  await expect(lotus).toContainText("+₹3,257.50")
  await expect(lotus).toContainText("+21.02%")
  await expect(lotus).toContainText("BSE close")
  // Harbor: a loss, shown with a sign and the word (not only red).
  const harbor = group(page, HARBOR)
  await expect(harbor).toContainText("-₹600")
  await expect(harbor).toContainText("-20%")
  await expect(harbor).toContainText("Loss:")
  // Gilt fund: a 10-day-old NAV is counted, with "Old price".
  await expect(group(page, GILT)).toContainText("Old price")
  await expect(group(page, GILT)).toContainText("+₹594.68")
  // Closed fund: a 45-day-old NAV still values it (50 × ₹12.3456 = ₹617.28), marked stale.
  const closed = group(page, CLOSED)
  await expect(closed).toContainText("Stale, over 30 days")
  await expect(closed).toContainText("₹617.28")
  await expect(closed).toContainText("+₹117.28")
  await expect(group(page, GILT)).toContainText("Old price ·")

  // Totals: invested ₹22,000, value ₹25,369.46, +₹3,369.46 (+15.32%); no unpriced banner.
  await expect(summary(page)).toContainText("₹22,000")
  await expect(summary(page)).toContainText("₹25,369.46")
  await expect(summary(page)).toContainText("+₹3,369.46")
  await expect(summary(page)).toContainText("+15.32%")
  await expect(summary(page)).toContainText("Prices as of")
  await expect(summary(page)).toContainText("not investment advice")
  await expect(page.getByText(/without a current price/)).toHaveCount(0)
  // All tab: by category. Shares ₹18,500 → ₹21,157.50; mutual funds ₹3,500 → ₹4,211.96.
  const byCategory = page.getByRole("table", { name: "By category" })
  await expect(byCategory.getByRole("row", { name: /^Shares/ })).toContainText("+₹2,657.50")
  await expect(byCategory.getByRole("row", { name: /^Mutual funds/ })).toContainText("₹4,211.96")
  await expect(byCategory.getByRole("row", { name: /^ETFs/ })).toContainText("none")
  await expect(byCategory.getByRole("row", { name: /^Fixed deposits/ })).toContainText("none")
  await shot(page, "investments-list")

  // Tabs (also in the URL): each has its own summary and columns.
  const tabs = page.getByRole("navigation", { name: "Investment types" })
  await tabs.getByRole("link", { name: "Mutual funds" }).click()
  await expect(page).toHaveURL(/\?tab=funds$/)
  await expect(tabs.getByRole("link", { name: "Mutual funds" })).toHaveAttribute("aria-current", "page")
  await expect(summary(page)).toContainText("₹3,500")
  await expect(summary(page)).toContainText("+₹711.96")
  await expect(holdings(page)).toContainText("Avg. NAV")
  await expect(holdings(page)).toContainText("Latest NAV")
  await expect(holdings(page)).not.toContainText(LOTUS)
  await page.goto("/investments?tab=shares")
  await expect(summary(page)).toContainText("₹18,500")
  await expect(holdings(page)).not.toContainText(GILT)
  await page.goto("/investments?tab=etfs")
  await expect(page.getByText("No ETFs yet")).toBeVisible()
  await page.goto("/investments?tab=fds")
  await expect(page.getByText("Tracking fixed deposits is coming in a later update.")).toBeVisible()
  await page.goto("/investments?tab=nonsense") // anything else is All
  await expect(tabs.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page")

  await expand(page, LOTUS)
  const records = page.getByRole("list", { name: `Records of ${LOTUS}` })
  await expect(records.getByRole("listitem")).toHaveCount(2)
  await expect(records).toContainText("10 units at ₹1,000.00")
  await expect(records).toContainText("5 units at ₹1,100.00")
  await shot(page, "investments-expanded")

  await page.goto("/")
  await expect(overviewCard(page)).toContainText("₹25,369.46")
  await expect(overviewCard(page)).toContainText("+₹3,369.46")
  await expect(overviewCard(page)).toContainText("Not included in Total available")
  await expect(overviewCard(page)).toContainText("Prices as of")
  const lines = overviewCard(page).getByRole("list", { name: "By category" })
  await expect(lines.getByRole("listitem")).toHaveCount(4)
  await expect(lines.getByRole("listitem").filter({ hasText: "Shares" })).toContainText("₹21,157.50")
  await expect(lines.getByRole("listitem").filter({ hasText: "Mutual funds" })).toContainText("+₹711.96")
  await expect(lines.getByRole("listitem").filter({ hasText: "Fixed deposits" })).toContainText("None")
  // The card on its own (a full-page shot of the Overview repeats the fixed sidebar).
  await overviewCard(page).screenshot({ path: `${SHOTS}/overview-investments.png` })

  // Archived view: the loss record moves out of the totals.
  await page.goto("/investments")
  await expand(page, HARBOR)
  await page.getByRole("button", { name: starts(`Archive ${HARBOR}`) }).click()
  await dialog(page, "Archive this holding?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Holding archived.")).toBeVisible()
  await expect(summary(page)).toContainText("₹19,000")
  await page.getByRole("button", { name: "Show archived (1)" }).click()
  await expect(page.getByRole("button", { name: starts(`Restore ${HARBOR}`) })).toBeVisible()
  await expect(page.getByRole("button", { name: new RegExp(`^Delete ${escape(HARBOR)}.* permanently$`) })).toBeVisible()
  await shot(page, "investments-archived")
})

test("another user sees none of my holdings and can't change them; phone layout", async ({ browser, baseURL }) => {
  const newPage = async (width = 1440, height = 900) => (await browser.newContext({ baseURL, viewport: { width, height } })).newPage()
  const first = await newPage(390, 844)
  await newUser(first, "inv-owner")
  await addHolding(first, { query: "lotus", name: LOTUS, units: "10", price: "1,000" })
  await addHolding(first, { query: "bees", name: "Test Nifty Bees ETF", units: "40", price: "250" })
  await first.reload() // no toasts over the list
  await expect(group(first, LOTUS)).toBeVisible()
  await first.screenshot({ path: `${SHOTS}/investments-phone.png` }) // the viewport, with the tab bar at the bottom
  await first.close()

  const second = await newPage()
  const email = await newUser(second, "inv-stranger")
  await expect(second.getByText(LOTUS)).toHaveCount(0)
  await expect(second.getByText("Track your first investment")).toBeVisible()
  // Through the API as well: no rows of another user, and an update by guessing matches nothing.
  const supabase = await addUnsearchableRecord(email)
  const { data: mine } = await supabase.from("investments").select("id, instrument_id")
  expect(mine).toHaveLength(1)
  const { data: changed } = await supabase.from("investments").update({ units_scaled: 1 }).neq("id", mine![0]!.id).select("id")
  expect(changed).toEqual([])
  await second.close()
})
