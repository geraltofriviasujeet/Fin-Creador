import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import type { HoldingGroup, InstrumentKind, InvestmentCategory } from "@fin-creador/api"
import { formatMoney, formatPercentFromBasisPoints } from "@fin-creador/domain"
import { cn } from "cn"
import { fullDate } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"

// Display pieces shared by the Investments page and the Overview card (Sprint 7). Figures
// come from packages/domain through the shared view (packages/api/src/investments/view.ts).

export const INVESTMENTS_HEADER = {
  eyebrow: "Track",
  title: "Investments",
  description: "Shares, ETFs and mutual funds you hold, valued at the last closing price.",
}

export const PRICES_NOTE = "Prices are the previous close from BSE and AMFI, for tracking only, not investment advice."
export const NOT_IN_TOTAL = "Not included in Total available"

export const KIND_LABEL: Record<InstrumentKind, string> = { share: "Share", etf: "ETF", fund: "Fund" }

export function KindChip({ kind }: { kind: InstrumentKind }) {
  return <Badge tone={kind === "fund" ? "savings" : "info"}>{KIND_LABEL[kind]}</Badge>
}

/** Where the price comes from: "BSE close" or "NAV". */
export const priceLabel = (source: "amfi" | "bse") => (source === "amfi" ? "NAV" : "BSE close")

/**
 * Profit or loss with a sign, an arrow and the word in the accessible name, so the meaning
 * never depends on colour: "▲ +₹5,000 (+14.3%)".
 */
export function ProfitText({ minor, bps, className, size = "sm" }: { minor: number; bps: number | null; className?: string; size?: "sm" | "lg" }) {
  const Arrow = minor > 0 ? ArrowUpRight : minor < 0 ? ArrowDownRight : null
  const word = minor > 0 ? "Profit" : minor < 0 ? "Loss" : "No profit or loss"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-semibold whitespace-nowrap tabular-nums",
        minor > 0 && "text-success",
        minor < 0 && "text-danger",
        size === "lg" && "font-heading text-lg font-bold md:text-xl",
        className
      )}
    >
      {Arrow && <Arrow aria-hidden="true" className={size === "lg" ? "size-5" : "size-4"} />}
      <span className="sr-only">{word}: </span>
      {formatMoney(minor, { currency: "INR", signed: true })}
      {bps !== null && <span className={cn("font-medium", size === "lg" && "text-sm")}>&nbsp;({formatPercentFromBasisPoints(bps, { signed: true, maximumFractionDigits: 2 })})</span>}
    </span>
  )
}

export const CATEGORY_LABEL: Record<InvestmentCategory, string> = {
  shares: "Shares",
  funds: "Mutual funds",
  etfs: "ETFs",
  fds: "Fixed deposits",
}

export type InvestmentTab = "all" | InvestmentCategory
export const INVESTMENT_TABS: readonly { value: InvestmentTab; label: string }[] = [
  { value: "all", label: "All" },
  ...(["shares", "funds", "etfs", "fds"] as const).map((value) => ({ value, label: CATEGORY_LABEL[value] })),
]

/** `?tab=` from the URL; anything else is the All tab. */
export function readInvestmentTab(value: unknown): InvestmentTab {
  return INVESTMENT_TABS.some((t) => t.value === value) ? (value as InvestmentTab) : "all"
}

/** The badges a group can carry (text, never colour alone). Every holding is valued at its last price. */
export function GroupBadges({ group }: { group: Pick<HoldingGroup, "priceAge" | "identifierChanged" | "instrument"> }) {
  const date = fullDate(group.instrument.priceDate)
  return (
    <>
      {group.priceAge === "old" && <Badge tone="info">Old price · {date}</Badge>}
      {group.priceAge === "stale" && <Badge tone="negative">Stale, over 30 days · {date}</Badge>}
      {group.identifierChanged && <Badge tone="negative">Identifier changed, check your units</Badge>}
    </>
  )
}

export const pricesAsOfText = (date: string | null) => (date ? `Prices as of ${fullDate(date)}` : "No prices yet")
