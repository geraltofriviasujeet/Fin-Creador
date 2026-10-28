import { type Page, expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { PASSWORD, addBank, addCash, signOut, signUpConfirmed, uniqueEmail } from "./helpers"

// Net worth on the Overview (Sprint 8e), against the throwaway local Supabase. A worked example
// seeded as the person through the API (the same database functions the app calls): a bank and
// cash added in the UI, a holding on a fictional instrument (e2e/fixtures/instruments.sql), a
// fixed deposit starting today, a home loan that adds its moratorium interest later, a card with
// a card EMI linked to it, money borrowed from a friend with interest to return, and a fine.
// Screenshots in e2e-screenshots/ for the owner's review.
//
// Expected (₹):
//   Total available   50,000 bank + 5,000 borrowed into it + 100 cash          =   55,100
//   Holding           10 units × 1,250.50 (fresh price)                         =   12,505
//   Fixed deposit     1,00,000 starting today (no interest yet; an estimate)    = 1,00,000
//   Loans             10,000 home loan + 300 interest to add + 1,200 card EMI   =   11,500
//   Card              6,000 owed when added (the EMI is a loan, not counted again)=    6,000
//   Borrowed          5,000 (the 500 extra to return is interest, not counted)  =    5,000
//   Statutory         1,000 fine                                                =    1,000
//   Net worth         1,67,605 − 23,500                                         = 1,44,105

const SHOTS = "e2e-screenshots"
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
function daysAhead(days: number) {
  const [y, m, d] = todayInIndia().split("-").map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
const firstOfMonth = () => `${todayInIndia().slice(0, 7)}-01`

const netWorthCard = (page: Page) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Net worth", exact: true }) })
const lineOf = (page: Page, label: string) => netWorthCard(page).getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) })

async function asUser(email: string) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD })
  expect(error).toBeNull()
  return supabase
}

async function seed(email: string) {
  const supabase = await asUser(email)
  const ok = <T>(r: { data: T; error: unknown }) => {
    expect(r.error).toBeNull()
    return r.data
  }
  const bank = ok(await supabase.from("accounts").select("id").eq("kind", "bank").single())

  const instrument = ok(await supabase.from("instruments").select("id").eq("source", "bse").eq("source_code", "990001").single())
  ok(await supabase.from("investments").insert({ instrument_id: instrument!.id, units_scaled: 100_000, buy_price_scaled: 10_000_000, buy_date: "2026-01-02", idempotency_key: crypto.randomUUID() }))
  ok(
    await supabase.from("fixed_deposits").insert({
      bank: "State Bank of India",
      label: "Emergency",
      principal_minor: 1_00_000_00,
      rate_bps: 700,
      compounding: "quarterly",
      start_date: todayInIndia(),
      maturity_date: daysAhead(365),
      idempotency_key: crypto.randomUUID(),
    }),
  )

  // Home loan: ₹10,000 disbursed, EMIs start in 60 days; ₹300 of moratorium interest is added with the first EMI paid.
  ok(
    await supabase.rpc("create_loan", {
      p_idempotency_key: crypto.randomUUID(),
      p_loan_type: "home",
      p_lender: "Avanse Financial Services",
      p_sanctioned_minor: 20_000_00,
      p_disbursed_minor: 10_000_00,
      p_rate_bps: 1200,
      p_rate_kind: "floating",
      p_tenure_months: 24,
      p_start_mode: "starts_later",
      p_outstanding_minor: 10_000_00,
      p_instalment_months: 24,
      p_first_due_date: daysAhead(60),
      p_emi_estimate_minor: 444_24,
      p_emi_minor: 444_24,
      p_nickname: "Study loan",
      p_moratorium_months: 6,
      p_moratorium_interest: "capitalise",
      p_capitalised_minor: 300_00,
    }),
  )
  const card = ok(
    await supabase.rpc("create_card", {
      p_idempotency_key: crypto.randomUUID(),
      p_issuer: "HDFC Bank",
      p_limit_minor: 1_00_000_00,
      p_statement_day: 20,
      p_due_day: 8,
      p_opening_owed_minor: 6_000_00,
      p_product: "HDFC Millennia",
      p_product_other: false,
    }),
  ) as { id: string }
  const emi = ok(
    await supabase.rpc("create_loan", {
      p_idempotency_key: crypto.randomUUID(),
      p_loan_type: "credit_card_emi",
      p_lender: "HDFC Bank",
      p_sanctioned_minor: 1_200_00,
      p_disbursed_minor: 1_200_00,
      p_rate_bps: 0,
      p_rate_kind: "fixed",
      p_tenure_months: 6,
      p_start_mode: "ongoing",
      p_outstanding_minor: 1_200_00,
      p_instalment_months: 6,
      p_first_due_date: firstOfMonth(),
      p_emi_estimate_minor: 200_00,
      p_emi_minor: 200_00,
    }),
  ) as { id: string }
  ok(await supabase.rpc("link_card_emi", { p_loan_id: emi.id, p_card_id: card.id }))
  ok(
    await supabase.rpc("create_borrowing", {
      p_idempotency_key: crypto.randomUUID(),
      p_lender: "Ravi",
      p_amount_minor: 5_000_00,
      p_relationship: "friends",
      p_amount_to_return_minor: 5_500_00,
      p_received_account_id: bank!.id,
      p_received_on: todayInIndia(),
    }),
  )
  ok(await supabase.rpc("create_statutory_due", { p_idempotency_key: crypto.randomUUID(), p_due_type: "fine", p_amount_minor: 1_000_00, p_due_date: daysAhead(5), p_description: "Parking" }))
}

test("net worth: empty state, then the worked example to the rupee; another user's data never counts", async ({ page }) => {
  const email = uniqueEmail("net-worth")
  await signUpConfirmed(page, "Asha Rao", email)
  await expect(netWorthCard(page)).toContainText("Add an account, a holding or a loan to see your net worth.")
  await expect(netWorthCard(page)).toContainText("(Asia/Kolkata time)")

  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "", opening: "50,000" })
  await addCash(page, "100")
  await seed(email)

  await page.goto("/")
  const nw = netWorthCard(page)
  await expect(nw.getByText("₹1,44,105", { exact: true })).toBeVisible()
  await expect(nw).toContainText("Assets ₹1,67,605 · Liabilities ₹23,500")
  await expect(lineOf(page, "Total available")).toContainText("₹55,100")
  await expect(lineOf(page, "Shares, funds and ETFs")).toContainText("₹12,505")
  await expect(lineOf(page, "Shares, funds and ETFs")).toContainText("Prices of")
  await expect(lineOf(page, "Fixed deposits")).toContainText("₹1,00,000")
  await expect(lineOf(page, "Fixed deposits")).toContainText("Estimate: deposit interest worked out to today")
  await expect(lineOf(page, "Loans (card EMIs included)")).toContainText("₹11,500")
  await expect(lineOf(page, "Loans (card EMIs included)")).toContainText("2 items")
  await expect(lineOf(page, "Credit cards owed")).toContainText("₹6,000")
  await expect(lineOf(page, "Borrowed (principal)")).toContainText("₹5,000")
  await expect(lineOf(page, "Statutory dues left")).toContainText("₹1,000")
  await expect(nw.getByText("Card credit (overpaid)")).toHaveCount(0)
  // Total available keeps its definition: the summary card shows the same figure.
  await expect(page.getByRole("region", { name: /^Summary/ })).toContainText("₹55,100")
  await nw.scrollIntoViewIfNeeded()
  await shot(page, "net-worth-example")

  // Another person sees none of it.
  await signOut(page)
  await signUpConfirmed(page, "Bala Iyer", uniqueEmail("net-worth-other"))
  await expect(netWorthCard(page)).toContainText("Add an account, a holding or a loan to see your net worth.")
  await shot(page, "net-worth-empty")
})
