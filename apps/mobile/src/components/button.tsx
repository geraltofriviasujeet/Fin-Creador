import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Pressable, type PressableProps, StyleSheet, Text, View } from "react-native";
import { TOUCH_TARGET, colors, fontFamily, fontSize, radius, spacing } from "@/theme";

type Variant = "primary" | "secondary" | "ghost" | "brand";

type Props = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: Variant;
  icon?: LucideIcon;
  loading?: boolean;
  /** Icon-only button: `label` becomes the accessibility label. */
  iconOnly?: boolean;
  fullWidth?: boolean;
};

const palette: Record<Variant, { bg: string; fg: string; border: string; pressed: string }> = {
  primary: { bg: colors.ink, fg: colors.surface, border: colors.ink, pressed: colors.accentDeep },
  secondary: { bg: colors.surface, fg: colors.ink, border: colors.line, pressed: colors.canvas },
  ghost: { bg: "transparent", fg: colors.ink, border: "transparent", pressed: colors.canvas },
  brand: { bg: colors.accent, fg: colors.ink, border: colors.accent, pressed: colors.accent },
};

export function Button({ label, variant = "primary", icon: Icon, loading, iconOnly, fullWidth, disabled, ...props }: Props) {
  const p = palette[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      hitSlop={iconOnly ? 4 : undefined}
      style={({ pressed }) => [
        styles.base,
        iconOnly ? styles.icon : styles.text,
        fullWidth && styles.full,
        { backgroundColor: pressed ? p.pressed : p.bg, borderColor: p.border },
        pressed && variant === "brand" && styles.pressedBrand,
        inactive && styles.inactive,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.content}>
          {Icon ? <Icon size={iconOnly ? 20 : 18} color={p.fg} strokeWidth={2} /> : null}
          {iconOnly ? null : <Text style={[styles.label, { color: p.fg }]}>{label}</Text>}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { paddingHorizontal: spacing[5] },
  icon: { width: TOUCH_TARGET, minHeight: TOUCH_TARGET },
  full: { alignSelf: "stretch" },
  inactive: { opacity: 0.6 },
  pressedBrand: { opacity: 0.85 },
  content: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  label: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.base },
});
