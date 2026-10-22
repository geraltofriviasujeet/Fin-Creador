import type { ReactNode } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { colors, radius, spacing, text } from "@/theme";

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={text.cardTitle}>
      {children}
    </Text>
  );
}

export function CardDescription({ children }: { children: ReactNode }) {
  return <Text style={[text.bodySmall, styles.description]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing[5],
  },
  description: { marginTop: spacing[1] },
});
