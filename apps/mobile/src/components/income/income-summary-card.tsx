import { monthRange, sumIncome, summarizeHoldings } from "@fin-creador/domain";
import { useRouter } from "expo-router";
import { ChevronRight, RotateCw } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { money } from "@/lib/income-format";
import { useIncome } from "@/lib/income-store";
import { colors, fontFamily, fontSize, radius, spacing, text } from "@/theme";

/** Overview card: Total available and Income this month (same domain functions as the Income screen). */
export function IncomeSummaryCard() {
  const router = useRouter();
  const { state, refresh } = useIncome();

  if (state.status === "error") {
    return (
      <Card style={styles.card}>
        <Text style={text.cardTitle}>Income and accounts</Text>
        <Text style={text.bodySmall}>{state.message}</Text>
        <Button label="Try again" variant="secondary" icon={RotateCw} onPress={() => void refresh()} />
      </Card>
    );
  }

  const figures =
    state.status === "ready"
      ? {
          total: money(summarizeHoldings(state.data.accounts, state.data.currency).totalAvailableMinor, state.data.currency),
          month: money(sumIncome(state.data.entries, monthRange(state.data.today), state.data.currency), state.data.currency),
        }
      : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={figures ? `Income and accounts. Total available ${figures.total}. Income this month ${figures.month}.` : "Income and accounts, loading"}
      accessibilityHint="Opens Income"
      onPress={() => router.push("/income")}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={styles.card}>
        <View style={styles.head}>
          <Text style={[text.cardTitle, styles.flex]}>Income and accounts</Text>
          <ChevronRight size={20} color={colors.muted} />
        </View>
        <View style={styles.figures}>
          <Figure label="Total available" value={figures?.total} />
          <Figure label="Income this month" value={figures?.month} />
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
