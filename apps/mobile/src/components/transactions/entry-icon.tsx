import type { LedgerItem, Lookup } from "@fin-creador/api";
import {
  ArrowLeftRight,
  Briefcase,
  Car,
  Clapperboard,
  Ellipsis,
  Fuel,
  Gift,
  GraduationCap,
  HeartPulse,
  IdCard,
  House,
  KeyRound,
  Laptop,
  type LucideIcon,
  Percent,
  Plane,
  Repeat,
  Scissors,
  Send,
  ShoppingBag,
  ShoppingCart,
  Store,
  Utensils,
  Wrench,
  Zap,
} from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { colors, radius } from "@/theme";

// Same icons and chip colours as the web (apps/web/components/transactions/display.tsx).
// Expense icons and income source types; anything else shows "other".
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
  gift: Gift,
  fuel: Fuel,
  services: Wrench,
  money_sent: Send,
  other: Ellipsis,
  salary: Briefcase,
  freelance: Laptop,
  rent: KeyRound,
  business: Store,
  interest: Percent,
};

/** The icon for a category's or income source's icon key ("other" for anything unknown). */
export const categoryIcon = (key: string | null | undefined): LucideIcon => ICONS[key ?? "other"] ?? Ellipsis;

// The chip colour follows the type, so the icon is never the only signal (the amount sign
// and the subtitle say it too).
const CHIP = { expense: colors.peach, income: colors.mint, transfer: colors.blue, refund: colors.mint } as const;

export function EntryIcon({ entry, lookup }: { entry: LedgerItem; lookup: Lookup }) {
  const category = entry.categoryId ? lookup.categories.get(entry.categoryId) : undefined;
  const Icon = entry.type === "transfer" ? ArrowLeftRight : (ICONS[category?.icon ?? "other"] ?? Ellipsis);
  return (
    <View style={[styles.chip, { backgroundColor: CHIP[entry.type] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Icon size={20} color={colors.ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
