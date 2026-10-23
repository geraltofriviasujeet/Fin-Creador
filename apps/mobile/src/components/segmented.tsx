import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, fontSize, radius, spacing } from "@/theme";

type Option<T extends string> = { value: T; label: string };

/** Segmented control (a row of tabs). `disabled` keeps the current choice fixed (e.g. an edit's type). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const selected = o.value === value;
        const inactive = disabled && !selected;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: inactive }}
            disabled={inactive}
            onPress={() => !selected && onChange(o.value)}
            style={[styles.item, selected && styles.active]}
          >
            <Text style={[styles.text, selected ? styles.activeText : inactive && styles.inactiveText]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing[1], padding: spacing[1], borderRadius: radius.md, backgroundColor: colors.canvas },
  item: { flex: 1, minHeight: 44, borderRadius: radius.control, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing[1] },
  active: { backgroundColor: colors.ink },
  text: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.sm, color: colors.muted },
  activeText: { color: colors.surface },
  inactiveText: { color: colors.mutedSubtle },
});
