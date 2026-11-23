import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Pressable, type PressableProps, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, mobile, spacing } from "@/theme";
import { hitSlopFor } from "./logic";

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "regular" | "small";

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  fullWidth?: boolean;
  /** Draw the pressed look without a press (design-system preview only). */
  forcePressed?: boolean;
};

const SMALL_HEIGHT = 36;
const REGULAR_HEIGHT = 52;

const palette: Record<ButtonVariant, { bg: string; fg: string; border: string; pressed: string }> = {
  // design-spec §5: Forest fill with a Lime label; one primary action per screen.
  primary: { bg: mobile.colors.forest, fg: mobile.colors.lime, border: mobile.colors.forest, pressed: colors.accentDeep },
  secondary: { bg: mobile.colors.surface, fg: mobile.colors.ink, border: mobile.colors.lineStrong, pressed: mobile.colors.canvas },
};

/** Primary (forest/lime), secondary (outline) and small buttons. Small ones get hitSlop to 44px. */
export function Button({
  label,
  variant = "primary",
  size = "regular",
  icon: Icon,
  loading,
  fullWidth,
  disabled,
  forcePressed,
  ...props
}: ButtonProps) {
  const p = palette[variant];
  const inactive = !!disabled || !!loading;
  const small = size === "small";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={inactive} aria-busy={!!loading}
      disabled={inactive}
      hitSlop={small ? hitSlopFor(SMALL_HEIGHT) : undefined}
      style={({ pressed }) => [
        styles.base,
        small ? styles.small : styles.regular,
        fullWidth && styles.full,
        { backgroundColor: pressed || forcePressed ? p.pressed : p.bg, borderColor: p.border },
        inactive && styles.inactive,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.content}>
          {Icon ? <Icon size={small ? 16 : 20} color={p.fg} strokeWidth={2.25} /> : null}
          <Text style={[small ? styles.labelSmall : styles.label, { color: p.fg }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  regular: { minHeight: REGULAR_HEIGHT, paddingHorizontal: spacing[5], borderRadius: mobile.radius.tile },
  small: { minHeight: SMALL_HEIGHT, paddingHorizontal: spacing[3], borderRadius: mobile.radius.chip },
  full: { alignSelf: "stretch" },
  inactive: { opacity: 0.45 },
  content: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  label: { fontFamily: fontFamily.bodyBold, fontSize: mobile.type.body.size },
  labelSmall: { fontFamily: fontFamily.bodySemibold, fontSize: mobile.type.caption.size },
});
