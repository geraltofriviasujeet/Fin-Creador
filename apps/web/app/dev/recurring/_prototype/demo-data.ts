// In-memory DEMO data for the Sprint 4 Phase 1 recurring-items prototype. Fictional
// accounts and rules, dated relative to "today" so every state appears. Never shown as a
// user's real information (the page carries a "Demo data" label).
import type { EntryType, LedgerAccount, LedgerCategory } from "@fin-creador/api"
import { type Frequency, type IsoDate, addDays, latestOccurrenceOnOrBefore } from "@fin-creador/domain"
import type { PaymentModeValue } from "@fin-creador/schemas"

export type DemoRule = {
  id: string
  type: EntryType
  amountMinor: number
  currency: string
  accountId: string
  counterAccountId: string | null
  categoryId: string | null
  paymentMode: PaymentModeValue | null
  note: string | null
  frequency: Frequency
  startDate: IsoDate
  endDate: IsoDate | null
  archived: boolean
}

/** An entry posted from a rule (rule + occurrence date), or a skipped occurrence. */
export type DemoPost = { ruleId: string; date: IsoDate; amountMinor: number; voided: boolean }
export type DemoSkip = { ruleId: string; date: IsoDate; reason: string | null }

/**
 * Phase 2 adds a stable internal key to two defaults (not editable), so grouping survives
 * a rename: Subscriptions and Memberships group by it.
 */
export type CategoryKey = "subscription" | "membership"
export type DemoCategory = LedgerCategory & { key: CategoryKey | null }

export type DemoData = {
  today: IsoDate
  currency: string
  accounts: LedgerAccount[]
  categories: DemoCategory[]
  rules: DemoRule[]
  posts: DemoPost[]
  skips: DemoSkip[]
}

const account = (id: string, kind: LedgerAccount["kind"], label: string, opening: number, archived = false, currency = "INR"): LedgerAccount => ({
  id,
  kind,
  bankType: kind === "bank" ? "savings" : null,
  label,
  currency,
  openingBalanceMinor: opening,
  openingBalanceDate: "2026-01-01",
  inflowMinor: 0,
  outflowMinor: 0,
  archived,
})

const category = (id: string, kind: LedgerCategory["kind"], name: string, icon: string, archived = false, key: CategoryKey | null = null): DemoCategory => ({
  id,
  kind,
  name,
  icon,
  archived,
  defaultAccountId: null,
  key,
})

const rule = (r: Partial<DemoRule> & Pick<DemoRule, "id" | "type" | "amountMinor" | "accountId" | "frequency" | "startDate">): DemoRule => ({
  currency: "INR",
  counterAccountId: null,
  categoryId: null,
  paymentMode: null,
  note: null,
  endDate: null,
  archived: false,
  ...r,
})

export function createDemoData(today: IsoDate, { empty = false } = {}): DemoData {
  const accounts = [
    account("a-savings", "bank", "Demo Savings Bank ··1234", 18_000_000),
    account("a-cash", "cash", "Cash in hand", 500_000),
    account("a-old", "bank", "Old Demo Bank ··9876", 0, true),
    account("a-usd", "other", "Demo travel wallet (USD)", 10_000, false, "USD"),
  ]
  // The 14 default expense categories (12 from Sprint 3, plus Membership and Subscription),
  // one the person renamed (the key keeps it grouped), and one they archived.
  const categories = [
    category("c-food", "expense", "Food & dining", "food"),
    category("c-groceries", "expense", "Groceries", "groceries"),
    category("c-transport", "expense", "Transport", "transport"),
    category("c-rent", "expense", "Rent & housing", "home"),
    category("c-bills", "expense", "Utilities & bills", "bills"),
    category("c-shopping", "expense", "Shopping", "shopping"),
    category("c-health", "expense", "Health", "health"),
    category("c-fun", "expense", "Entertainment", "fun"),
    category("c-education", "expense", "Education", "education"),
    category("c-travel", "expense", "Travel", "travel"),
    category("c-care", "expense", "Personal care", "care"),
    category("c-membership", "expense", "Clubs & gym", "membership", false, "membership"),
    category("c-subscription", "expense", "Subscription", "subscription", false, "subscription"),
    category("c-other", "expense", "Other expenses", "other"),
    category("c-gym", "expense", "Old gym", "health", true),
    category("s-salary", "income", "Salary", "salary"),
    category("s-rent", "income", "Rental income", "rent"),
    category("s-freelance", "income", "Freelance", "freelance"),
  ]
  if (empty) return { today, currency: "INR", accounts, categories, rules: [], posts: [], skips: [] }

  const rules: DemoRule[] = [
    // Due: its latest occurrence (about two weeks ago) hasn't been confirmed.
    rule({ id: "r-salary", type: "income", amountMinor: 9_500_000, accountId: "a-savings", categoryId: "s-salary", note: "Salary", frequency: "monthly", startDate: addDays(today, -75) }),
    // Posted this time: next one coming up.
    rule({ id: "r-rent", type: "expense", amountMinor: 2_500_000, accountId: "a-savings", categoryId: "c-rent", paymentMode: "net_banking", note: "Flat rent", frequency: "monthly", startDate: addDays(today, -65) }),
    // Due today: weekly cash for the week.
    rule({ id: "r-cash", type: "transfer", amountMinor: 300_000, accountId: "a-savings", counterAccountId: "a-cash", note: "Weekly cash", frequency: "weekly", startDate: addDays(today, -21) }),
    // Starts soon.
    rule({ id: "r-stream", type: "expense", amountMinor: 64_900, accountId: "a-savings", categoryId: "c-subscription", paymentMode: "upi", note: "Streaming service", frequency: "monthly", startDate: addDays(today, 4) }),
    rule({ id: "r-music", type: "expense", amountMinor: 1_19_900, accountId: "a-savings", categoryId: "c-subscription", paymentMode: "debit_card", note: "Music, yearly plan", frequency: "yearly", startDate: addDays(today, -200) }),
    rule({ id: "r-cloud", type: "expense", amountMinor: 299, currency: "USD", accountId: "a-usd", categoryId: "c-subscription", note: "Cloud storage", frequency: "monthly", startDate: addDays(today, -20) }),
    rule({ id: "r-club", type: "expense", amountMinor: 2_00_000, accountId: "a-savings", categoryId: "c-membership", paymentMode: "upi", note: "Sports club", frequency: "monthly", startDate: addDays(today, -58) }),
    // Skipped this time (paid by hand), so the next one is coming up.
    rule({ id: "r-power", type: "expense", amountMinor: 420_000, accountId: "a-savings", categoryId: "c-bills", note: "Electricity bill", frequency: "quarterly", startDate: addDays(today, -100) }),
    // Needs attention: its category is archived.
    rule({ id: "r-gym", type: "expense", amountMinor: 150_000, accountId: "a-savings", categoryId: "c-gym", frequency: "monthly", startDate: addDays(today, -50) }),
    // Needs attention: its account is archived.
    rule({ id: "r-tenant", type: "income", amountMinor: 1_800_000, accountId: "a-old", categoryId: "s-rent", note: "Shop rent from tenant", frequency: "monthly", startDate: addDays(today, -40) }),
    // Ended: its end date has passed.
    rule({ id: "r-course", type: "expense", amountMinor: 250_000, accountId: "a-savings", categoryId: "c-other", note: "Online course instalment", frequency: "monthly", startDate: addDays(today, -150), endDate: addDays(today, -30) }),
    // Archived by the person.
    rule({ id: "r-old-sip", type: "transfer", amountMinor: 500_000, accountId: "a-savings", counterAccountId: "a-cash", note: "Old savings plan", frequency: "monthly", startDate: addDays(today, -300), archived: true }),
  ]

  // Posts and skips on real occurrence dates, from the same date logic the app uses.
  const byId = new Map(rules.map((r) => [r.id, r]))
  const latest = (id: string, before = today) => latestOccurrenceOnOrBefore(byId.get(id)!, before)!
  const previous = (id: string) => latest(id, addDays(latest(id), -1))
  const post = (ruleId: string, date: IsoDate): DemoPost => ({ ruleId, date, amountMinor: byId.get(ruleId)!.amountMinor, voided: false })

  return {
    today,
    currency: "INR",
    accounts,
    categories,
    rules,
    posts: [
      post("r-salary", previous("r-salary")),
      post("r-rent", previous("r-rent")),
      post("r-rent", latest("r-rent")),
      post("r-cash", previous("r-cash")),
      post("r-course", latest("r-course")),
      post("r-music", latest("r-music")),
      post("r-cloud", latest("r-cloud")),
      post("r-club", previous("r-club")),
    ],
    skips: [{ ruleId: "r-power", date: latest("r-power"), reason: "Paid at the counter, added by hand" }],
  }
}
