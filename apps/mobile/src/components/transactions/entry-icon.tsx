import type { LedgerItem, Lookup } from "@fin-creador/api";
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
  type LucideIcon,
  Percent,
  Plane,
  Scissors,
  ShoppingBag,
  ShoppingCart,
  Store,
  Utensils,
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
  other: Ellipsis,
  salary: Briefcase,
  freelance: Laptop,
  rent: KeyRound,
  business: Store,
  interest: Percent,
};

// The chip colour follows the type, so the icon is never the only signal (the amount sign
// and the subtitle say it too).
const CHIP = { expense: colors.peach, income: colors.mint, transfer: colors.blue } as const;

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
