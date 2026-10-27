import {
  ArrowDownToLine,
  ArrowUpToLine,
  Goal,
  Landmark,
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

// Order follows design-spec §4 (Goals holds planned expenses and monthly budgets, Sprint 6; Loans & Liabilities after Investments, Sprint 8a). Flip `available` when a page ships.
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "overview", label: "Overview", href: "/", icon: LayoutGrid, available: true, inTabBar: true },
  { key: "income", label: "Income", href: "/income", icon: ArrowDownToLine, available: true, inTabBar: false },
  { key: "recurring", label: "Recurring", href: "/recurring", icon: Repeat, available: true, inTabBar: false },
  {
    key: "transactions",
    label: "Transactions",
    tabLabel: "Activity",
    href: "/transactions",
    icon: Wallet,
    available: true,
    inTabBar: true,
  },
  { key: "goals", label: "Goals", href: "/goals", icon: Goal, available: true, inTabBar: true },
  { key: "investments", label: "Investments", href: "/investments", icon: ArrowUpToLine, available: true, inTabBar: true },
  // Sprint 8a: loans now; 8b adds credit cards and net worth to the same page.
  {
    key: "loans",
    label: "Loans & Liabilities",
    tabLabel: "Liabilities",
    href: "/loans-liabilities",
    icon: Landmark,
    available: true,
    inTabBar: true,
  },
]


export function isActive(item: Pick<NavItem, "href">, pathname: string) {
  return item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)
}

export function comingSoonMessage(label: string) {
  return `${label} is coming in a later update.`
}
