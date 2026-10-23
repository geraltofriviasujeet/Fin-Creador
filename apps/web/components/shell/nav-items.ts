import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChartNoAxesColumn,
  Goal,
  LayoutGrid,
  Repeat,
  Wallet,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  key: string
  label: string
  /** Shorter label for the mobile tab bar. */
  tabLabel?: string
  href: string
  icon: LucideIcon
  /** False until the sprint that builds the page; rendered as "coming soon". */
  available: boolean
  /** Show in the mobile bottom tab bar (design-spec §5). */
  inTabBar: boolean
}

// Order follows design-spec §4. Flip `available` when a page ships.
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "overview", label: "Overview", href: "/", icon: LayoutGrid, available: true, inTabBar: true },
  { key: "income", label: "Income", href: "/income", icon: ArrowDownToLine, available: true, inTabBar: false },
  // Sprint 4: live once /recurring ships (Phase 2.3); the dev prototype previews it.
  { key: "recurring", label: "Recurring", href: "/recurring", icon: Repeat, available: false, inTabBar: false },
  {
    key: "transactions",
    label: "Transactions",
    tabLabel: "Activity",
    href: "/transactions",
    icon: Wallet,
    available: true,
    inTabBar: true,
  },
  { key: "budgets", label: "Budgets", href: "/budgets", icon: ChartNoAxesColumn, available: false, inTabBar: true },
  { key: "investments", label: "Investments", href: "/investments", icon: ArrowUpToLine, available: false, inTabBar: true },
  { key: "goals", label: "Goals", href: "/goals", icon: Goal, available: false, inTabBar: true },
]


/** Dev prototypes only: treat these items as available, linking to the given path. */
export type NavPreview = Readonly<Record<string, string>>

export function navItems(preview?: NavPreview): readonly NavItem[] {
  if (!preview) return NAV_ITEMS
  return NAV_ITEMS.map((item) => (preview[item.key] ? { ...item, href: preview[item.key]!, available: true } : item))
}

export function isActive(item: Pick<NavItem, "href">, pathname: string) {
  return item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)
}

export function comingSoonMessage(label: string) {
  return `${label} is coming in a later update.`
}
