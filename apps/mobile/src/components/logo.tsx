import { logo, logoRingPath } from "@fin-creador/design-tokens";
import { StyleSheet, Text, View } from "react-native";
import Svg, { G, Path, Rect } from "react-native-svg";
import { colors, fontFamily } from "@/theme";

const RING = logoRingPath();
const CENTER = logo.size / 2;

/**
 * 28pt lime rounded square, rotated −6°, with a dark open ring (design-spec §1). Decorative.
 * The hide-from-screen-readers props sit on a View, and the rotation is an SVG transform
 * string: react-native-svg passes its own props straight to the DOM on web, where these
 * native-only names are invalid attributes (React warnings on Expo web).
 */
export function LogoMark({ size = logo.size }: { size?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox={`0 0 ${logo.size} ${logo.size}`}>
        <G transform={`rotate(${logo.rotationDeg} ${CENTER} ${CENTER})`}>
          <Rect width={logo.size} height={logo.size} rx={logo.cornerRadius} fill={colors.accent} />
          <Path d={RING} fill="none" stroke={colors.ink} strokeWidth={logo.ringStroke} strokeLinecap="round" />
        </G>
      </Svg>
    </View>
  );
}

type Tone = "onDark" | "onLight";

/**
 * "Fin" + "Creador" (FinCreador): white + lime on dark; all ink on light
 * (lime text fails contrast there). The styled text is hidden from screen readers, which
 * hear "FinCreador" from the Logo's label instead.
 */
export function Wordmark({ tone }: { tone: Tone }) {
  const base = tone === "onDark" ? colors.navText : colors.ink;
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.wordmark, { color: base }]}
    >
      Fin
      <Text style={{ color: tone === "onDark" ? colors.accent : colors.ink }}>Creador</Text>
    </Text>
  );
}

export function Logo({ tone }: { tone: Tone }) {
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel="FinCreador">
      <LogoMark />
      <Wordmark tone={tone} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  wordmark: {
    fontFamily: fontFamily.heading,
    fontSize: logo.wordmark.fontSize,
    letterSpacing: logo.wordmark.letterSpacing,
  },
});
