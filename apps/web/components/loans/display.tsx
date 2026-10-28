import type { LoanBadge } from "@fin-creador/api"
import { LOAN_BADGE_LABEL } from "@fin-creador/api"
import { formatPercentFromBasisPoints, isIsoDate } from "@fin-creador/domain"
import { fullDate } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"

// Display pieces shared by the Loans & Liabilities page and the Overview "Due soon" card
// (Sprint 8a). Figures come from packages/domain through packages/api/src/loans/view.ts.

export const LOANS_PATH = "/loans-liabilities"

export const LOANS_HEADER = {
  eyebrow: "Owe",
  title: "Loans & Liabilities",
  description: "Your loans, cards, money borrowed and what is due next. What you repay moves to the loan, card or person; interest and fees are expenses.",
}

export const NOT_IN_TOTAL = "Loans are not in Total available"

const BADGE_TONE: Record<LoanBadge, "positive" | "negative" | "info" | "neutral"> = {
  paid: "positive",
  due: "info",
  overdue: "negative",
  not_due_yet: "neutral",
  closed: "neutral",
}

export function LoanBadgeChip({ badge }: { badge: LoanBadge }) {
  return <Badge tone={BADGE_TONE[badge]}>{LOAN_BADGE_LABEL[badge]}</Badge>
}

export const ratePercent = (bps: number) => formatPercentFromBasisPoints(bps, { maximumFractionDigits: 2 })

/** 850 → "8.5" (integer arithmetic only). */
export function bpsToInput(bps: number): string {
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "")
  return fraction ? `${Math.floor(bps / 100)}.${fraction}` : String(Math.floor(bps / 100))
}

/** The date in words beside a date field, so a browser's own format (e.g. MM/DD/YYYY) can't mislead. */
export const inWords = (value: string) => (isIsoDate(value) ? fullDate(value) : undefined)
