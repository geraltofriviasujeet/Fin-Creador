import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/card";
import { letterSpacing } from "@fin-creador/design-tokens";
import { colors, fontFamily, fontSize, spacing, text } from "@/theme";

/** One summary card (label, big figure, footer) in the horizontal swipe row. */
export function StatCard({ label, value, footer }: { label: string; value: string; footer?: ReactNode }) {
  return (
    <Card style={styles.card}>
      <Text style={text.bodySmall}>{label}</Text>
      <Text style={styles.value} accessibilityLabel={`${label}: ${value}`}>
        {value}
      </Text>
      {typeof footer === "string" ? <Text style={text.bodySmall}>{footer}</Text> : (footer ?? <View />)}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { width: 245, gap: spacing[2] },
  value: { fontFamily: fontFamily.heading, fontSize: fontSize["3xl"], letterSpacing: letterSpacing.heading, color: colors.ink },
});
