import { Pressable, StyleSheet, Text } from "react-native";
import { TOUCH_TARGET, colors, fontFamily, fontSize } from "@/theme";

/** Inline text action: ink, underlined (never colour alone), 44pt tall touch area. */
export function TextLink({ label, onPress, accessibilityHint }: { label: string; onPress: () => void; accessibilityHint?: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: TOUCH_TARGET, justifyContent: "center" },
  pressed: { opacity: 0.6 },
  text: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: fontSize.sm,
    color: colors.ink,
    textDecorationLine: "underline",
  },
});
