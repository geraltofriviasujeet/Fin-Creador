import { money } from "@fin-creador/api";
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/card";
import { useRecurringView } from "@/lib/recurring";
import { colors, fontFamily, fontSize, radius, spacing, text } from "@/theme";

/** Overview card: what is due, what needs attention, and the estimated monthly recurring cost. Opens Recurring. */
export function RecurringSummaryCard() {
  const router = useRouter();
  const result = useRecurringView();
  const profile = result?.view.costs.find((c) => c.currency === result.data.currency);
  const figures = result
    ? {
        due: String(result.view.due.length + result.view.attention.length),
        cost: money(profile?.total.monthlyMinor ?? 0, result.data.currency),
      }
    : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={figures ? `Recurring. ${figures.due} to confirm or fix. Recurring cost ${figures.cost} a month.` : "Recurring, loading"}
      accessibilityHint="Opens Recurring"
      onPress={() => router.push("/recurring")}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={styles.card}>
        <View style={styles.head}>
          <Text style={[text.cardTitle, styles.flex]}>Recurring</Text>
          <ChevronRight size={20} color={colors.muted} />
        </View>
        <View style={styles.figures}>
          <Figure label="To confirm or fix" value={figures?.due} />
          <Figure label="Cost a month (est.)" value={figures?.cost} />
        </View>
      </Card>
    </Pressable>
  );
}

function Figure({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.flex}>
      <Text style={text.caption}>{label}</Text>
      {value ? <Text style={styles.value}>{value}</Text> : <View style={styles.skeleton} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing[3] },
  head: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, gap: spacing[1] },
  figures: { flexDirection: "row", gap: spacing[4] },
  value: { fontFamily: fontFamily.heading, fontSize: fontSize.xl, color: colors.ink },
  skeleton: { height: 24, width: "70%", borderRadius: radius.control, backgroundColor: colors.canvas },
  pressed: { opacity: 0.85 },
});
