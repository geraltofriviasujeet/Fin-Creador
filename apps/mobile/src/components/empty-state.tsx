import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/card";
import { colors, radius, spacing, text } from "@/theme";

type Props = { icon: LucideIcon; title: string; body: string; chip?: string; action?: ReactNode };

export function EmptyState({ icon: Icon, title, body, chip = colors.mint, action }: Props) {
  return (
    <Card style={styles.card}>
      <View style={[styles.icon, { backgroundColor: chip }]}>
        <Icon size={24} color={colors.ink} />
      </View>
      <Text accessibilityRole="header" style={[text.cardTitle, styles.center]}>
        {title}
      </Text>
      <Text style={[text.bodySmall, styles.center]}>{body}</Text>
      {action}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[10] },
  icon: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center", maxWidth: 420 },
});
