// In-memory DEMO data for the Phase 1 Transactions prototype. Fictional accounts and
// entries, generated relative to "today" so the month filters have something to show.
// Never shown as a user's real information (the page carries a "Demo data" label).
import type { IsoDate, LedgerEntry } from "@fin-creador/domain"

export type DemoAccount = {
  id: string
  kind: "bank" | "cash" | "other"
  bankType: "savings" | "current" | null
  label: string
  shortLabel: string
  currency: string
  openingBalanceMinor: number
  openingBalanceDate: IsoDate
  archived: boolean
}

export type DemoCategory = {
  id: string
  kind: "expense" | "income"
  name: string
  icon: CategoryIcon
  archived: boolean
}

export type CategoryIcon =
  | "food"
  | "groceries"
  | "transport"
  | "home"
  | "bills"
  | "shopping"
  | "health"
  | "fun"
  | "education"
  | "travel"
  | "care"
  | "fitness"
  | "other"
  | "salary"
  | "freelance"
  | "rent"
  | "business"
  | "interest"

/** Optional label for how a bank payment was made; the account is what moves money. */
export type PaymentMode = "upi" | "debit_card" | "net_banking" | "cheque"

export const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: "upi", label: "UPI" },
  { value: "debit_card", label: "Debit card" },
  { value: "net_banking", label: "Net banking" },
  { value: "cheque", label: "Cheque" },
]

export type DemoEntry = LedgerEntry & {
  note: string | null
  paymentMode: PaymentMode | null
  /** Creation order within a day (newest first in the list). */
  createdAt: string
  voidReason: string | null
}

export type DemoData = {
  today: IsoDate
  currency: string
  accounts: DemoAccount[]
  categories: DemoCategory[]
  entries: DemoEntry[]
}

/** Calendar arithmetic on ISO dates (UTC noon avoids any DST edge). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const firstOfMonth = (date: IsoDate) => `${date.slice(0, 8)}01`

export const DEMO_EXPENSE_CATEGORIES: DemoCategory[] = [
  { id: "c-food", kind: "expense", name: "Food & dining", icon: "food", archived: false },
  { id: "c-groceries", kind: "expense", name: "Groceries", icon: "groceries", archived: false },
  { id: "c-transport", kind: "expense", name: "Transport", icon: "transport", archived: false },
  { id: "c-rent", kind: "expense", name: "Rent & housing", icon: "home", archived: false },
  { id: "c-bills", kind: "expense", name: "Utilities & bills", icon: "bills", archived: false },
  { id: "c-shopping", kind: "expense", name: "Shopping", icon: "shopping", archived: false },
  { id: "c-health", kind: "expense", name: "Health", icon: "health", archived: false },
  { id: "c-fun", kind: "expense", name: "Entertainment", icon: "fun", archived: false },
  { id: "c-education", kind: "expense", name: "Education", icon: "education", archived: false },
  { id: "c-travel", kind: "expense", name: "Travel", icon: "travel", archived: false },
  { id: "c-care", kind: "expense", name: "Personal care", icon: "care", archived: false },
  { id: "c-other", kind: "expense", name: "Other expenses", icon: "other", archived: false },
  // A category the person added and later archived: its history stays visible.
  { id: "c-gym", kind: "expense", name: "Gym membership", icon: "fitness", archived: true },
]

export const DEMO_INCOME_SOURCES: DemoCategory[] = [
  { id: "s-salary", kind: "income", name: "Salary", icon: "salary", archived: false },
  { id: "s-freelance", kind: "income", name: "Freelance", icon: "freelance", archived: false },
  { id: "s-rent", kind: "income", name: "Rental income", icon: "rent", archived: false },
  { id: "s-business", kind: "income", name: "Business", icon: "business", archived: false },
  { id: "s-interest", kind: "income", name: "Interest & dividends", icon: "interest", archived: false },
  { id: "s-other", kind: "income", name: "Other income", icon: "other", archived: false },
]

export function createDemoData(today: IsoDate, { empty = false } = {}): DemoData {
  const thisMonth = firstOfMonth(today)
  const lastMonth = firstOfMonth(addDays(thisMonth, -1))
  const accounts: DemoAccount[] = [
    {
      id: "a-savings",
      kind: "bank",
      bankType: "savings",
      label: "Demo Savings Bank ··1234",
      shortLabel: "Savings ··1234",
      currency: "INR",
      openingBalanceMinor: 18_000_000,
      openingBalanceDate: addDays(lastMonth, -10),
      archived: false,
    },
    {
      id: "a-current",
      kind: "bank",
      bankType: "current",
      label: "Demo Current Bank ··5678",
      shortLabel: "Current ··5678",
      currency: "INR",
      openingBalanceMinor: 4_000_000,
      openingBalanceDate: addDays(lastMonth, -10),
      archived: false,
    },
    {
      id: "a-cash",
      kind: "cash",
      bankType: null,
      label: "Cash in hand",
      shortLabel: "Cash",
      currency: "INR",
      // "Update cash in hand" moved this as-of date recently (Sprint 2 rule).
      openingBalanceMinor: 300_000,
      openingBalanceDate: addDays(today, -6),
      archived: false,
    },
    {
      id: "a-old",
      kind: "bank",
      bankType: "savings",
      label: "Old Demo Bank ··9012 (archived)",
      shortLabel: "Old bank ··9012",
      currency: "INR",
      openingBalanceMinor: 500_000,
      openingBalanceDate: addDays(lastMonth, -10),
      archived: true,
    },
  ]
  const categories = [...DEMO_EXPENSE_CATEGORIES, ...DEMO_INCOME_SOURCES]
  if (empty) return { today, currency: "INR", accounts, categories, entries: [] }

  let seq = 0
  const at = (date: IsoDate) => `${date}T10:${String(seq % 60).padStart(2, "0")}:00Z`
  const e = (
    type: DemoEntry["type"],
    occurredOn: IsoDate,
    amountMinor: number,
    accountId: string,
    rest: Partial<DemoEntry> = {}
  ): DemoEntry => {
    seq += 1
    return {
      id: `t-${seq}`,
      type,
      amountMinor,
      currency: "INR",
      occurredOn,
      accountId,
      counterAccountId: null,
      categoryId: null,
      voided: false,
      replacesId: null,
      note: null,
      paymentMode: null,
      createdAt: at(occurredOn),
      voidReason: null,
      ...rest,
    }
  }
  // Keep every entry on or before today (no future dates).
  const d = (date: IsoDate) => (date > today ? today : date)
  const m = (offset: number) => d(addDays(thisMonth, offset))
  const lm = (offset: number) => addDays(lastMonth, offset)

  const entries: DemoEntry[] = [
    // Last month
    e("income", lm(0), 9_500_000, "a-savings", { categoryId: "s-salary", note: "Monthly salary" }),
    e("expense", lm(1), 2_200_000, "a-savings", { categoryId: "c-rent", note: "Flat rent", paymentMode: "net_banking" }),
    e("expense", lm(4), 184_000, "a-savings", { categoryId: "c-groceries", note: "Weekly groceries", paymentMode: "upi" }),
    e("expense", lm(6), 150_000, "a-old", { categoryId: "c-gym", note: "Gym, last payment", paymentMode: "debit_card" }),
    e("income", lm(9), 2_500_000, "a-current", { categoryId: "s-freelance", note: "Logo design project" }),
    e("expense", lm(11), 64_000, "a-savings", { categoryId: "c-food", note: "Dinner with friends", paymentMode: "upi" }),
    e("expense", lm(14), 239_900, "a-savings", { categoryId: "c-bills", note: "Electricity bill", paymentMode: "upi" }),
    e("transfer", lm(16), 2_000_000, "a-savings", { counterAccountId: "a-current", note: "Move to current account" }),
    e("expense", lm(19), 52_000, "a-savings", { categoryId: "c-transport", note: "Metro card top-up", paymentMode: "upi" }),
    e("expense", lm(23), 349_900, "a-current", { categoryId: "c-shopping", note: "Running shoes", paymentMode: "debit_card" }),
    e("income", lm(25), 120_000, "a-savings", { categoryId: "s-interest", note: "Savings interest" }),
    // This month
    e("income", m(0), 9_500_000, "a-savings", { categoryId: "s-salary", note: "Monthly salary" }),
    e("expense", m(0), 2_200_000, "a-savings", { categoryId: "c-rent", note: "Flat rent", paymentMode: "net_banking" }),
    e("expense", m(2), 212_000, "a-savings", { categoryId: "c-groceries", note: "Weekly groceries", paymentMode: "upi" }),
    e("expense", m(3), 89_900, "a-current", { categoryId: "c-fun", note: "Streaming subscription", paymentMode: "debit_card" }),
    e("income", m(4), 1_500_000, "a-current", { categoryId: "s-rent", note: "Parking space rent" }),
    e("expense", m(5), 45_000, "a-savings", { categoryId: "c-health", note: "Pharmacy", paymentMode: "upi" }),
    e("expense", m(5), 45_000, "a-savings", {
      categoryId: "c-health",
      note: "Pharmacy",
      paymentMode: "upi",
      voided: true,
      voidReason: "Entered twice",
    }),
    e("transfer", m(7), 500_000, "a-savings", { counterAccountId: "a-cash", note: "ATM withdrawal" }),
    e("expense", m(8), 120_000, "a-cash", { categoryId: "c-food", note: "Lunch, office canteen" }),
    e("expense", m(9), 318_000, "a-savings", { categoryId: "c-bills", note: "Phone and internet", paymentMode: "upi" }),
    e("expense", m(11), 76_000, "a-cash", { categoryId: "c-transport", note: "Auto rickshaw" }),
    e("expense", m(12), 159_900, "a-current", { categoryId: "c-education", note: "Online course", paymentMode: "debit_card" }),
    e("income", m(13), 300_000, "a-cash", { categoryId: "s-other", note: "Sold old cycle" }),
    e("expense", m(15), 248_000, "a-savings", { categoryId: "c-groceries", note: "Weekly groceries", paymentMode: "upi" }),
  ]

  // An edited entry: version 1 voided and replaced by version 2 (amount and note changed).
  const v1 = e("expense", d(addDays(today, -1)), 62_000, "a-savings", {
    categoryId: "c-transport",
    note: "Cab to airport",
    paymentMode: "upi",
    voided: true,
  })
  const v2 = e("expense", v1.occurredOn, 68_000, "a-savings", {
    categoryId: "c-transport",
    note: "Cab to airport (with toll)",
    paymentMode: "upi",
    replacesId: v1.id,
  })
  entries.push(
    v1,
    v2,
    e("expense", today, 38_000, "a-cash", { categoryId: "c-food", note: "Tea and snacks" }),
    e("expense", today, 129_900, "a-savings", { categoryId: "c-care", note: "Haircut", paymentMode: "upi" })
  )
  return { today, currency: "INR", accounts, categories, entries }
}
