import { House, type LucideIcon, Plus, ReceiptText, Sparkles, Target } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontFamily, mobile, spacing } from "@/theme";
import { RAISED_ADD_LIFT, TAB_BAR_BORDER_TOP, TAB_BAR_PADDING_TOP } from "./logic";

export type TabKey = "home" | "activity" | "plan" | "roma";

export const TAB_ITEMS: readonly { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "home", label: "Home", icon: House },
  { key: "activity", label: "Activity", icon: ReceiptText },
  { key: "plan", label: "Plan", icon: Target },
  { key: "roma", label: "Roma", icon: Sparkles },
];

export type TabBarProps = {
  active: TabKey;
  onSelect: (key: TabKey) => void;
  onAdd: () => void;
  /** Ignore the bottom safe area (design-system preview, drawn inside a card). */
  noSafeArea?: boolean;
};

const ADD_SIZE = mobile.tabBar.raisedButton;

/**
 * Home · Activity · ＋ · Plan · Roma (design-spec §5). The centre ＋ is a raised forest
 * square with a lime plus that opens Add. Icons carry labels; the active tab is bold too.
 */
export function TabBar({ active, onSelect, onAdd, noSafeArea }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const [left, right] = [TAB_ITEMS.slice(0, 2), TAB_ITEMS.slice(2)];
  const tab = ({ key, label, icon: Icon }: (typeof TAB_ITEMS)[number]) => {
    const selected = key === active;
    const color = selected ? mobile.colors.ink : mobile.colors.muted;
    return (
      <Pressable
        key={key}
        accessibilityRole="tab"
        accessibilityLabel={label}
        aria-selected={selected}
        onPress={() => onSelect(key)}
        style={styles.tab}
      >
        <Icon size={24} color={color} strokeWidth={selected ? 2.4 : 1.8} />
        <Text style={[styles.label, { color }, selected && styles.labelSelected]}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Main"
      style={[styles.bar, { paddingBottom: noSafeArea ? spacing[2] : Math.max(insets.bottom, spacing[2]) }]}
    >
      {left.map(tab)}
      <View style={styles.addSlot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add an entry"
          onPress={onAdd}
          style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
        >
          <Plus size={28} color={mobile.colors.lime} strokeWidth={2.75} />
        </Pressable>
      </View>
      {right.map(tab)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    minHeight: mobile.tabBar.height,
    paddingTop: TAB_BAR_PADDING_TOP,
    backgroundColor: mobile.colors.surface,
    borderTopWidth: TAB_BAR_BORDER_TOP,
    borderTopColor: mobile.colors.line,
  },
  tab: { flex: 1, minHeight: mobile.tapTarget + 8, alignItems: "center", justifyContent: "center", gap: 2 },
  label: { fontFamily: fontFamily.bodyMedium, fontSize: mobile.type.min.size },
  labelSelected: { fontFamily: fontFamily.bodyBold },
  // The slot keeps the column; the button floats so it rises above the bar's top edge.
  addSlot: { flex: 1, alignSelf: "stretch", alignItems: "center" },
  add: {
    position: "absolute",
    top: -RAISED_ADD_LIFT,
    width: ADD_SIZE,
    height: ADD_SIZE,
    borderRadius: mobile.radius.tileLg,
    backgroundColor: mobile.colors.forest,
    alignItems: "center",
    justifyContent: "center",
  },
  addPressed: { transform: [{ scale: 0.96 }] },
});
