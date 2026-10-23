import {
  ArrowLeftRight,
  Briefcase,
  Car,
  Clapperboard,
  Dumbbell,
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
import { type IsoDate, formatMoney } from "@fin-creador/domain"
import { cn } from "cn"
import type { CategoryIcon, DemoAccount, DemoEntry, PaymentMode } from "./demo-data"
import { PAYMENT_MODES, addDays } from "./demo-data"
import type { Lookup } from "./filters"

const ICONS: Record<CategoryIcon, LucideIcon> = {
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
  fitness: Dumbbell,
  other: Ellipsis,
  salary: Briefcase,
  freelance: Laptop,
  rent: KeyRound,
  business: Store,
  interest: Percent,
}

// Chip colour follows the type, so the icon is never the only signal (the amount sign and
// the subtitle say it too).
const CHIP: Record<DemoEntry["type"], string> = {
  expense: "bg-chip-peach",
  income: "bg-chip-mint",
  transfer: "bg-chip-blue",
}

export function EntryIcon({ entry, lookup }: { entry: DemoEntry; lookup: Lookup }) {
  const category = entry.categoryId ? lookup.categories.get(entry.categoryId) : undefined
  const Icon = entry.type === "transfer" ? ArrowLeftRight : ICONS[category?.icon ?? "other"]
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl text-ink", CHIP[entry.type])}>
      <Icon aria-hidden="true" className="size-5" />
    </span>
  )
}

export const TYPE_NOUN: Record<DemoEntry["type"], string> = { expense: "expense", income: "income", transfer: "transfer" }

export function entryTitle(entry: DemoEntry, lookup: Lookup): string {
  if (entry.note) return entry.note
  if (entry.type === "transfer") return "Transfer"
  return (entry.categoryId && lookup.categories.get(entry.categoryId)?.name) || "Entry"
}

export function accountName(id: string | null, lookup: Lookup, short = true): string {
  const a = id ? lookup.accounts.get(id) : undefined
  if (!a) return "Unknown account"
  return short ? a.shortLabel : a.label
}

export const paymentModeLabel = (mode: PaymentMode | null) => PAYMENT_MODES.find((m) => m.value === mode)?.label ?? null

/** "UPI · Savings ··1234", "Cash", or "Savings ··1234 → Cash". */
export function accountChipText(entry: DemoEntry, lookup: Lookup): string {
  if (entry.type === "transfer") return `${accountName(entry.accountId, lookup)} → ${accountName(entry.counterAccountId, lookup)}`
  const mode = paymentModeLabel(entry.paymentMode)
  return [mode, accountName(entry.accountId, lookup)].filter(Boolean).join(" · ")
}

/** Category (or "Transfer") for the subtitle. */
export function entryKindLabel(entry: DemoEntry, lookup: Lookup): string {
  if (entry.type === "transfer") return "Transfer"
  const category = entry.categoryId ? lookup.categories.get(entry.categoryId) : undefined
  return category ? `${category.name}${category.archived ? " (archived)" : ""}` : "Uncategorised"
}

/** −₹2,480 for expenses, +₹95,000 for income, ₹5,000 for transfers (they move, not earn or spend). */
export function signedAmount(entry: Pick<DemoEntry, "type" | "amountMinor" | "currency">): string {
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

export const isAccountUsable = (a: DemoAccount) => !a.archived
