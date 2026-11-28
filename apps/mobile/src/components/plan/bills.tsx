import { type Lookup, type RecurringItem, dayHeading, entryTitle, pastDueLabel, planBills, signedAmount } from "@fin-creador/api";
import { formatDayMonth } from "@fin-creador/domain";
import { useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, SectionHeader, Tag } from "@/components/ds";
import { useRecurringView } from "@/lib/recurring";
import { useTransactions } from "@/lib/transactions-store";
import { dsText, fontFamily, mobile, spacing } from "@/theme";
import { SectionSkeleton, SectionUnavailable } from "./section-state";

// Plan → Bills that repeat (Sprint 13c PR 3, design-spec §5): chips for what is due (overdue
// first) and then coming up, each with its next date, from the Recurring page's own view
// (buildRecurringView → planBills). A due chip confirms through Add (/add?ruleId, the amount
// can be changed there) or skips the date; others open the recurring item. "See all" opens
// Recurring. Reads the shared transactions store, as Recurring and Activity do.

/** "Overdue · 25 Nov", "Today", "Tue, 2 Dec". */
export function billWhen(item: RecurringItem, today: string): string {
  if (!item.date) return "";
  const past = pastDueLabel(item, today);
  return past ? `${past} · ${formatDayMonth(item.date)}` : dayHeading(item.date, today);
}

export function PlanBillsSection() {
  const router = useRouter();
  const { state, refresh } = useTransactions();
  const result = useRecurringView();
  const lookup: Lookup | null = useMemo(
    () => (result ? { accounts: new Map(result.data.accounts.map((a) => [a.id, a])), categories: new Map(result.data.categories.map((c) => [c.id, c])) } : null),
    [result],
  );
  const failed = state.status === "error" || (state.status === "ready" && !state.recurring);
  return (
    <View style={styles.section}>
      <SectionHeader
        title="Bills that repeat"
        action={result ? { label: "See all", onPress: () => router.push("/recurring"), accessibilityLabel: "See all bills that repeat" } : undefined}
      />
      {failed ? (
        <SectionUnavailable
          state={state.status === "error" && state.offline ? { status: "offline" } : { status: "error", message: "We couldn't load your recurring items. Please try again." }}
          what="your recurring items"
          retry={() => void refresh()}
        />
      ) : !result || !lookup ? (
        <SectionSkeleton label="Loading bills that repeat" />
      ) : (
        <Bills items={result} lookup={lookup} />
      )}
    </View>
  );
}

function Bills({ items: { view, data }, lookup }: { items: NonNullable<ReturnType<typeof useRecurringView>>; lookup: Lookup }) {
  const router = useRouter();
  const bills = planBills(view);
  const hasAccounts = data.accounts.some((a) => !a.archived);
  if (bills.chips.length === 0) {
    return (
      <Card>
        <Text style={dsText.bodyStrong}>Nothing due in the next 30 days</Text>
        <Text style={dsText.caption}>Rent, EMIs, subscriptions and salary that repeat show here with their next date.</Text>
        {bills.attentionCount ? <Text style={[dsText.caption, styles.warning]}>{`${bills.attentionCount} need attention on Recurring`}</Text> : null}
        {hasAccounts ? (
          <View style={styles.start}>
            <Button label="Add recurring" variant="secondary" icon={Plus} onPress={() => router.push("/sheets/recurring-rule")} />
          </View>
        ) : null}
      </Card>
    );
  }
  const summary = [bills.dueCount ? `${bills.dueCount} to confirm` : "", bills.attentionCount ? `${bills.attentionCount} need attention` : ""].filter(Boolean).join(" · ");
  return (
    <View style={styles.section}>
      {summary ? <Text style={[dsText.caption, styles.summary]}>{summary}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel="Bills that repeat">
        {bills.chips.map((item) => (
          <BillChip key={item.rule.id} item={item} lookup={lookup} today={data.today} />
        ))}
      </ScrollView>
      {bills.more > 0 ? <Text style={dsText.caption}>{`${bills.more} more on Recurring`}</Text> : null}
    </View>
  );
}

function BillChip({ item, lookup, today }: { item: RecurringItem; lookup: Lookup; today: string }) {
  const router = useRouter();
  const title = entryTitle(item.entry, lookup);
  const when = billWhen(item, today);
  const past = pastDueLabel(item, today);
  const due = item.kind === "due";
  const amount = signedAmount(item.entry);
  const body = (
    <>
      <View style={styles.chipHead}>
        <Text style={[dsText.bodyStrong, styles.shrink]} numberOfLines={1}>
          {title}
        </Text>
        {due && !past ? <Tag label="Due" tone="neutral" /> : null}
      </View>
      <Text style={[styles.amount, item.entry.type === "income" && styles.moneyIn]}>{amount}</Text>
      <Text style={[dsText.caption, past === "Overdue" && styles.warning]}>{when}</Text>
    </>
  );
  if (!due) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${amount}, ${when}`}
        accessibilityHint="Opens the recurring item"
        onPress={() => router.push({ pathname: "/sheets/recurring-rule", params: { id: item.rule.id } })}
        style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View style={[styles.chip, styles.dueChip]} accessible={false}>
      {body}
      <View style={styles.chipActions}>
        <Button
          label="Skip"
          variant="secondary"
          size="small"
          accessibilityLabel={`Skip ${title}, ${when}`}
          onPress={() => router.push({ pathname: "/sheets/recurring-skip", params: { id: item.rule.id } })}
        />
        <Button label="Confirm" size="small" accessibilityLabel={`Confirm ${title}`} onPress={() => router.push({ pathname: "/add", params: { ruleId: item.rule.id } })} />
      </View>
    </View>
  );
}

const CHIP_WIDTH = 188;

const styles = StyleSheet.create({
  section: { gap: spacing[2] },
  summary: { fontFamily: fontFamily.bodySemibold, color: mobile.colors.ink },
  chips: { gap: spacing[3], paddingVertical: 2 },
  chip: { width: CHIP_WIDTH, gap: 4, padding: spacing[3], borderRadius: mobile.radius.tileLg, backgroundColor: mobile.colors.surface, borderWidth: 1, borderColor: mobile.colors.line },
  dueChip: { borderColor: mobile.colors.lineStrong },
  chipHead: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  chipActions: { flexDirection: "row", gap: spacing[2], marginTop: spacing[1] },
  shrink: { flexShrink: 1 },
  amount: { fontFamily: fontFamily.heading, fontSize: mobile.type.cardTitle.size, lineHeight: mobile.type.cardTitle.lineHeight, color: mobile.colors.ink, fontVariant: ["tabular-nums"] },
  moneyIn: { color: mobile.colors.moneyIn },
  warning: { color: mobile.colors.warning, fontFamily: fontFamily.bodySemibold },
  pressed: { backgroundColor: mobile.colors.canvas },
  start: { alignSelf: "flex-start" },
});
