import { ArrowUpToLine, ChartNoAxesColumn, Goal, LayoutGrid, type LucideIcon, Wallet } from "lucide-react-native";

// Bottom tabs, same order and labels as the web tab bar (apps/web/components/shell/nav-items.ts).
// Flip `available` when the sprint that builds a section ships.
export type TabItem = { name: string; label: string; icon: LucideIcon; available: boolean };

export const TABS: readonly TabItem[] = [
  { name: "index", label: "Overview", icon: LayoutGrid, available: true },
  { name: "activity", label: "Activity", icon: Wallet, available: true },
  { name: "budgets", label: "Budgets", icon: ChartNoAxesColumn, available: false },
  { name: "investments", label: "Investments", icon: ArrowUpToLine, available: false },
  { name: "goals", label: "Goals", icon: Goal, available: false },
];

export function comingSoonMessage(label: string) {
  return `${label} is coming in a later update.`;
}
