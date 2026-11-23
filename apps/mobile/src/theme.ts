import { colors, fontSize, layout, letterSpacing, mobile, radius, spacing } from "@fin-creador/design-tokens";
import { StyleSheet } from "react-native";

// Native styles built only from @fin-creador/design-tokens (design-spec §2–3).
// Android ignores fontWeight for custom fonts, so each weight is its own family.

export const fontFamily = {
  heading: "Manrope_700Bold",
  /** Hero amounts and screen titles (design-spec §5: 800). */
  headingExtraBold: "Manrope_800ExtraBold",
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

/** Mobile design-system type (design-spec §5), built from mobile.type tokens. */
export const dsText = StyleSheet.create({
  hero: {
    fontFamily: fontFamily.headingExtraBold,
    fontSize: mobile.type.hero.size,
    lineHeight: mobile.type.hero.lineHeight,
    letterSpacing: letterSpacing.heading,
    color: mobile.colors.ink,
  },
  screenTitle: {
    fontFamily: fontFamily.headingExtraBold,
    fontSize: mobile.type.screenTitle.size,
    lineHeight: mobile.type.screenTitle.lineHeight,
    letterSpacing: letterSpacing.heading,
    color: mobile.colors.ink,
  },
  cardTitle: {
    fontFamily: fontFamily.heading,
    fontSize: mobile.type.cardTitle.size,
    lineHeight: mobile.type.cardTitle.lineHeight,
    color: mobile.colors.ink,
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: mobile.type.body.size,
    lineHeight: mobile.type.body.lineHeight,
    color: mobile.colors.ink,
  },
  bodyStrong: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: mobile.type.body.size,
    lineHeight: mobile.type.body.lineHeight,
    color: mobile.colors.ink,
  },
  caption: {
    fontFamily: fontFamily.body,
    fontSize: mobile.type.caption.size,
    lineHeight: mobile.type.caption.lineHeight,
    color: mobile.colors.muted,
  },
  label: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: mobile.type.min.size,
    lineHeight: mobile.type.min.lineHeight,
    color: mobile.colors.muted,
  },
});

export { colors, fontSize, mobile, radius, spacing };
