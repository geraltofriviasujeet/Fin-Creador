import { StyleSheet, Text } from "react-native";
import { colors, fontFamily, fontSize, spacing } from "@/theme";

type Tone = "neutral" | "positive" | "negative" | "info";

const tones: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.canvas, fg: colors.muted },
  positive: { bg: colors.mint, fg: colors.success },
  negative: { bg: colors.peach, fg: colors.danger },
  info: { bg: colors.blue, fg: colors.ink },
};

export function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const t = tones[tone];
  return <Text style={[styles.badge, { backgroundColor: t.bg, color: t.fg }]}>{label}</Text>;
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: 6,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    fontFamily: fontFamily.bodySemibold,
    fontSize: fontSize.xs,
  },
});
