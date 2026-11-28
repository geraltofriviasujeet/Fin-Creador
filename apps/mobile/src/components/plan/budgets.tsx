import { type BudgetItem, type GoalsView, monthLabel, planBudgets } from "@fin-creador/api";
import type { BudgetStatus } from "@fin-creador/domain";
import { useRouter } from "expo-router";
import { ChevronRight, Plus } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AmountText, Button, Card, ProgressBar, SectionHeader, Tag } from "@/components/ds";
import { budgetBadge, budgetBarLabel, budgetMonthHeading, budgetsSummaryText, leftWord } from "@/lib/plan-text";
import type { LoadedState } from "@/lib/use-loaded";
import { dsText, fontFamily, mobile, spacing } from "@/theme";
import { SectionProblem, SectionSkeleton, SectionUnavailable } from "./section-state";

// Budgets on the phone (Sprint 13c PR 2): the Plan card and the rows of the Budgets screen, from
// the web Goals page's view (buildGoalsView) and planBudgets. Bars turn the warning colour at the
// domain's 80% (budgetStatus), not the design spec's 90%, so web and phone agree; the level is
// also said in words. The even-spend mark shows where spending would be if spread evenly over
// the month (this month only). Exact amounts, as the web shows them.

/** Opens the budget sheet: a category's budget (from that month), or a new one. */
export function budgetSheet(month: string, categoryId?: string) {
  return { pathname: "/sheets/budget" as const, params: categoryId ? { month: month.slice(0, 7), categoryId } : { month: month.slice(0, 7) } };
}

export function BudgetBar({ name, status, marker }: { name: string; status: BudgetStatus; marker?: number }) {
  return (
    <ProgressBar
      value={status.usedBps / 10_000}
      label={budgetBarLabel(name, status)}
      marker={marker}
      warnAt={null}
      color={status.level === "ok" ? mobile.colors.forest : mobile.colors.warning}
    />
  );
}

function Badge({ status }: { status: BudgetStatus | null }) {
  const badge = budgetBadge(status);
  return badge ? <Tag label={badge.label} tone={badge.tone} /> : null;
}

/** All budgets together: what is left (or over), spent of budget, the bar and the level. */
export function BudgetTotal({ total, currency, marker }: { total: BudgetStatus; currency: string; marker?: number }) {
  const word = leftWord(total);
  return (
    <View style={styles.total}>
      <View style={styles.totalHead}>
        <AmountText minor={Math.abs(total.leftMinor)} currency={currency} whole={false} size="title" style={word === "over" ? styles.overText : undefined} />
        <Text style={[dsText.caption, styles.shrink]}>{word}</Text>
        <Badge status={total} />
      </View>
      <BudgetBar name="All budgets" status={total} marker={marker} />
      <Text style={dsText.caption}>
        <AmountText minor={total.spentMinor} currency={currency} whole={false} size="caption" /> spent of{" "}
        <AmountText minor={total.budgetMinor} currency={currency} whole={false} size="caption" />
        {marker !== undefined ? " · the mark is an even pace for the month" : ""}
      </Text>
    </View>
  );
}

/** One category's budget. Pressing it opens the budget sheet (change, remove or set again). */
export function BudgetRow({ item, currency, marker, later, first, onPress }: {
  item: BudgetItem;
  currency: string;
  marker?: number;
  later: boolean;
  /** First row of its own card: no divider above it. */
  first?: boolean;
  onPress: () => void;
}) {
  const { category, status, since, budget } = item;
  const action = status ? "Change budget" : "Set your budget again";
  return (
    <Pressable accessibilityRole="button" accessibilityHint={action} onPress={onPress} style={({ pressed }) => [styles.row, first && styles.firstRow, pressed && styles.pressed]}>
      <View style={styles.rowHead}>
        <View style={styles.rowTitle}>
          <Text style={dsText.bodyStrong} numberOfLines={1}>
            {category.name}
          </Text>
          <Badge status={status} />
        </View>
        {status ? (
          <Text style={dsText.caption}>
            <AmountText minor={status.spentMinor} currency={currency} whole={false} size="caption" /> /{" "}
            <AmountText minor={status.budgetMinor} currency={currency} whole={false} size="caption" />
          </Text>
        ) : (
          <AmountText minor={budget.amountMinor} currency={budget.currency} whole={false} size="caption" />
        )}
        <ChevronRight size={18} color={mobile.colors.mutedSubtle} />
      </View>
      {status ? <BudgetBar name={category.name} status={status} marker={marker} /> : <Text style={dsText.caption}>{budget.currency} budget. Enter it again in {currency}.</Text>}
      {since ? (
        <Text style={dsText.caption}>
          {later ? "Carried forward · " : ""}Since {monthLabel(since)}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Plan → Budgets: this month's total and the three budgets that need a look first. */
export function PlanBudgetsSection({ state, retry }: { state: LoadedState<GoalsView>; retry: () => void }) {
  const router = useRouter();
  const ready = state.status === "ready" ? state.data : null;
  return (
    <View style={styles.section}>
      <SectionHeader
        title="Budgets"
        action={ready ? { label: "See all", onPress: () => router.push("/budgets"), accessibilityLabel: "See all budgets" } : undefined}
      />
      {state.status === "loading" ? (
        <SectionSkeleton label="Loading budgets" />
      ) : state.status !== "ready" ? (
        <SectionUnavailable state={state} what="your budgets" retry={retry} />
      ) : (
        <PlanBudgetsCard view={state.data} problem={<SectionProblem state={state} retry={retry} />} />
      )}
    </View>
  );
}

function PlanBudgetsCard({ view, problem }: { view: GoalsView; problem: ReactNode }) {
  const router = useRouter();
  const plan = planBudgets(view);
  if (plan.count === 0) {
    return (
      <Card>
        {problem}
        <Text style={dsText.bodyStrong}>No budgets this month</Text>
        <Text style={dsText.caption}>Set a monthly amount for a category. You&apos;ll see a warning at 80% and when it&apos;s used up.</Text>
        {view.unbudgeted.length > 0 ? (
          <View style={styles.start}>
            <Button label="Set a budget" variant="secondary" icon={Plus} onPress={() => router.push(budgetSheet(plan.month))} />
          </View>
        ) : null}
      </Card>
    );
  }
  return (
    <Card>
      {problem}
      <Text style={dsText.caption}>{budgetMonthHeading(plan.month, view.today)}</Text>
      {plan.total ? (
        <BudgetTotal total={plan.total} currency={plan.currency} marker={plan.evenSpend} />
      ) : (
        <Text style={dsText.body}>Your budgets are in another currency. Set your budget again in {plan.currency}.</Text>
      )}
      <Text style={[dsText.caption, styles.summary]}>{budgetsSummaryText(plan)}</Text>
      {plan.top.map((item) => (
        <BudgetRow
          key={item.category.id}
          item={item}
          currency={plan.currency}
          marker={plan.evenSpend}
          later={false}
          onPress={() => router.push(budgetSheet(plan.month, item.category.id))}
        />
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing[2] },
  total: { gap: spacing[2] },
  totalHead: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: spacing[2], rowGap: 4 },
  overText: { color: mobile.colors.warning },
  shrink: { flexShrink: 1 },
  summary: { fontFamily: fontFamily.bodySemibold, color: mobile.colors.ink },
  row: { gap: 6, paddingVertical: spacing[2], borderTopWidth: 1, borderTopColor: mobile.colors.line, minHeight: mobile.tapTarget },
  rowHead: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  rowTitle: { flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: spacing[2], rowGap: 2 },
  firstRow: { borderTopWidth: 0 },
  pressed: { backgroundColor: mobile.colors.canvas },
  start: { alignSelf: "flex-start" },
});
