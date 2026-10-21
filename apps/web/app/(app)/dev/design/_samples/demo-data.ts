// DEMO DATA — for the dev-only /dev/design review page. Not real financial information.
// Amounts are integer paise (INR minor units); trends are basis points (1% = 100).

export const DEMO_CURRENCY = "INR"

export const demoSummary = {
  balance: { amount: 48_265_000, trendBp: 840, sparkline: [3, 4, 3.5, 5, 4.5, 6, 5.5, 7, 6.5, 8, 7.5, 9] },
  income: { amount: 14_250_000, trendBp: 1250, sources: "Salary & 2 other sources" },
  expenses: { amount: 6_824_000, trendBp: 420, count: 47 },
  savings: { rateBp: 5210, trendBp: 380, saved: 7_426_000 },
}

export type DemoTransaction = {
  id: string
  merchant: string
  category: string
  when: string
  /** Signed: income positive, expense negative. */
  amount: number
  kind: "groceries" | "salary" | "transport" | "housing"
}

export const demoTransactions: DemoTransaction[] = [
  { id: "t1", merchant: "Green Basket", category: "Groceries", when: "Today, 6:42 PM", amount: -248_000, kind: "groceries" },
  { id: "t2", merchant: "Monthly salary", category: "Income", when: "Today, 9:10 AM", amount: 12_800_000, kind: "salary" },
  { id: "t3", merchant: "City Cabs", category: "Transport", when: "Yesterday, 8:15 PM", amount: -62_000, kind: "transport" },
  { id: "t4", merchant: "House rent", category: "Housing", when: "1 Aug, 10:00 AM", amount: -2_600_000, kind: "housing" },
]

export const demoBudget = { spent: 6_824_000, total: 11_100_000, dailyGuide: 213_800 }

export type DemoGoal = { id: string; name: string; saved: number; target: number; timeLeft: string; kind: "travel" | "home" }

export const demoGoals: DemoGoal[] = [
  { id: "g1", name: "Europe trip", saved: 14_600_000, target: 24_000_000, timeLeft: "8 months left", kind: "travel" },
  { id: "g2", name: "Home down payment", saved: 62_500_000, target: 150_000_000, timeLeft: "2 years left", kind: "home" },
]
