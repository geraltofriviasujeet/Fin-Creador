import { colors, fontSize, layout, letterSpacing, radius, spacing } from "@fin-creador/design-tokens";
import { StyleSheet } from "react-native";

// Native styles built only from @fin-creador/design-tokens (design-spec §2–3).
// Android ignores fontWeight for custom fonts, so each weight is its own family.

export const fontFamily = {
  heading: "Manrope_700Bold",
  headingSemibold: "Manrope_600SemiBold",
  body: "DMSans_400Regular",
  bodyMedium: "DMSans_500Medium",
  bodySemibold: "DMSans_600SemiBold",
  bodyBold: "DMSans_700Bold",
} as const;

/** Minimum touch target in points (Apple HIG 44pt; Android asks 48dp, which our 48px controls meet). */
export const TOUCH_TARGET = 44;

/** Floating elements (toasts) sit this far above the bottom safe area, clear of the tab bar. */
export const layoutBottomOffset = layout.tabBarHeight + spacing[3];

export const text = StyleSheet.create({
  pageTitle: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize["2xl"],
    letterSpacing: letterSpacing.heading,
    color: colors.ink,
  },
  cardTitle: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize.lg,
    color: colors.ink,
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.base,
    lineHeight: 24,
    color: colors.ink,
  },
  bodySmall: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: colors.muted,
  },
  label: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: fontSize.sm,
    color: colors.ink,
  },
  caption: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.xs,
    lineHeight: 16,
    color: colors.muted,
  },
});

export { colors, fontSize, radius, spacing };
