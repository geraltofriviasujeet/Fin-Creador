import {
  ArrowLeftRight,
  Briefcase,
  Car,
  Clapperboard,
  Ellipsis,
  GraduationCap,
  HeartPulse,
  IdCard,
  House,
  KeyRound,
  Laptop,
  Percent,
  Plane,
  Repeat,
  Scissors,
  ShoppingBag,
  ShoppingCart,
  Store,
  Utensils,
  Zap,
  type LucideIcon,
} from "lucide-react"
import type { EntryType, LedgerItem, Lookup } from "@fin-creador/api"
import { cn } from "cn"

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
  membership: IdCard,
  subscription: Repeat,
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

// Entry text is shared with the mobile app (packages/api).
export {
  TYPE_NOUN,
  accountChipText,
  accountName,
  dayHeading,
  entryKindLabel,
  entryTitle,
  fullDate,
  money,
  paymentModeLabel,
  rangeText,
  signedAmount,
} from "@fin-creador/api"
