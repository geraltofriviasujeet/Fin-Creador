import { CircleAlert, CircleCheck, Info } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, text } from "@/theme";

type Tone = "error" | "success" | "info";

const tones = {
  error: { bg: colors.peach, fg: colors.danger, Icon: CircleAlert },
  success: { bg: colors.mint, fg: colors.success, Icon: CircleCheck },
  info: { bg: colors.blue, fg: colors.ink, Icon: Info },
} as const;

/** Form-level status. Announced by screen readers when it appears. */
export function FormMessage({ tone, message }: { tone: Tone; message: string }) {
  const t = tones[tone];
  return (
    <View
      accessible
      accessibilityRole={tone === "error" ? "alert" : "text"}
      accessibilityLiveRegion="polite"
      style={[styles.box, { backgroundColor: t.bg }]}
    >
      <t.Icon size={18} color={t.fg} />
      <Text style={[text.bodySmall, styles.text, { color: t.fg }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    borderRadius: radius.control,
    padding: spacing[3],
  },
  text: { flex: 1 },
});
