import {
  ArrowLeftRight,
  Briefcase,
  Car,
  Clapperboard,
  Ellipsis,
  GraduationCap,
  HeartPulse,
  House,
  KeyRound,
  Laptop,
  Percent,
  Plane,
  Scissors,
  ShoppingBag,
  ShoppingCart,
  Store,
  Utensils,
  Zap,
  type LucideIcon,
} from "lucide-react"
import type { EntryType, LedgerItem } from "@fin-creador/api"
import { type IsoDate, addDays, formatMoney } from "@fin-creador/domain"
import { PAYMENT_MODES, type PaymentModeValue } from "@fin-creador/schemas"
import { cn } from "cn"
import type { Lookup } from "./filters"

// Expense icons (EXPENSE_ICONS) and income source types; anything else shows "other".
const ICONS: Record<string, LucideIcon> = {
  food: Utensils,
  groceries: ShoppingCart,
  transport: Car,
  home: House,
  bills: Zap,
  shopping: ShoppingBag,
  health: HeartPulse,
  fun: Clapperboard,
  education: GraduationCap,
  travel: Plane,
  care: Scissors,
  other: Ellipsis,
  salary: Briefcase,
  freelance: Laptop,
  rent: KeyRound,
  business: Store,
  interest: Percent,
}

// Chip colour follows the type, so the icon is never the only signal (the amount sign and
// the subtitle say it too).
const CHIP: Record<EntryType, string> = {
  expense: "bg-chip-peach",
  income: "bg-chip-mint",
  transfer: "bg-chip-blue",
}

/** An expense category's icon in its chip (Settings → Categories). */
export function CategoryIcon({ icon }: { icon: string }) {
  const Icon = ICONS[icon] ?? Ellipsis
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-chip-peach text-ink">
      <Icon aria-hidden="true" className="size-5" />
    </span>
  )
}

export function EntryIcon({ entry, lookup }: { entry: LedgerItem; lookup: Lookup }) {
  const category = entry.categoryId ? lookup.categories.get(entry.categoryId) : undefined
  const Icon = entry.type === "transfer" ? ArrowLeftRight : (ICONS[category?.icon ?? "other"] ?? Ellipsis)
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl text-ink", CHIP[entry.type])}>
      <Icon aria-hidden="true" className="size-5" />
    </span>
  )
}

export const TYPE_NOUN: Record<EntryType, string> = { expense: "expense", income: "income", transfer: "transfer" }

export function entryTitle(entry: LedgerItem, lookup: Lookup): string {
  if (entry.note) return entry.note
  if (entry.type === "transfer") return "Transfer"
  return (entry.categoryId && lookup.categories.get(entry.categoryId)?.name) || "Entry"
}

export function accountName(id: string | null, lookup: Lookup): string {
  const a = id ? lookup.accounts.get(id) : undefined
  return a ? `${a.label}${a.archived ? " (archived)" : ""}` : "Unknown account"
}

export const paymentModeLabel = (mode: PaymentModeValue | null) => PAYMENT_MODES.find((m) => m.value === mode)?.label ?? null

/** "UPI · Savings ··1234", "Cash", or "Savings ··1234 → Cash". */
export function accountChipText(entry: LedgerItem, lookup: Lookup): string {
  if (entry.type === "transfer") return `${accountName(entry.accountId, lookup)} → ${accountName(entry.counterAccountId, lookup)}`
  const mode = paymentModeLabel(entry.paymentMode)
  return [mode, accountName(entry.accountId, lookup)].filter(Boolean).join(" · ")
}

/** Category (or "Transfer") for the subtitle. */
export function entryKindLabel(entry: LedgerItem, lookup: Lookup): string {
  if (entry.type === "transfer") return "Transfer"
  const category = entry.categoryId ? lookup.categories.get(entry.categoryId) : undefined
  return category ? `${category.name}${category.archived ? " (archived)" : ""}` : "Uncategorised"
}

/** −₹2,480 for expenses, +₹95,000 for income, ₹5,000 for transfers (they move, not earn or spend). */
export function signedAmount(entry: Pick<LedgerItem, "type" | "amountMinor" | "currency">): string {
  if (entry.type === "transfer") return formatMoney(entry.amountMinor, { currency: entry.currency })
  return formatMoney(entry.type === "expense" ? -entry.amountMinor : entry.amountMinor, { currency: entry.currency, signed: true })
}

export const money = (minor: number, currency: string) => formatMoney(minor, { currency })

const dayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
const fullFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

/** "Today", "Yesterday" or "Thu, 16 Oct" (calendar dates, no time-zone shift). */
export function dayHeading(date: IsoDate, today: IsoDate): string {
  if (date === today) return "Today"
  if (date === addDays(today, -1)) return "Yesterday"
  const label = dayFormat.format(new Date(`${date}T00:00:00Z`))
  return date.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${date.slice(0, 4)}`
}

export const fullDate = (date: IsoDate) => fullFormat.format(new Date(`${date}T00:00:00Z`))

export function rangeText(range: { start: IsoDate; end: IsoDate }): string {
  return `${fullDate(range.start)} – ${fullDate(range.end)}`
}
