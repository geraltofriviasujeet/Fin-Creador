import { type GoalsView, fullDate, monthLabel } from "@fin-creador/api";
import { evenSpendShare } from "@fin-creador/domain";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, Chip } from "@/components/ds";
import { PageHeader } from "@/components/page-header";
import { BudgetRow, BudgetTotal, budgetSheet } from "@/components/plan/budgets";
import { SectionProblem, SectionSkeleton, SectionUnavailable } from "@/components/plan/section-state";
import { Screen } from "@/components/screen";
import { useBudgets } from "@/lib/plan-data";
import { budgetMonthOptions } from "@/lib/plan-text";
import { colors, dsText, spacing } from "@/theme";

// Budgets (Sprint 13c PR 2), opened from Plan: month chips (this month and up to 23 ahead, as the
// web's month navigation), all budgets together with the even-spend mark, and each category's
// bar; pressing one opens the budget sheet. Same view as the web Goals page (buildGoalsView).
// Reloads on each visit, so a budget saved in the sheet shows on return.
export default function BudgetsScreen() {
  const params = useLocalSearchParams<{ month?: string }>();
  const [month, setMonth] = useState<string | undefined>(typeof params.month === "string" ? params.month : undefined);
  const { state, refresh } = useBudgets(month);
  const [pulling, setPulling] = useState(false);
  // The profile's today, kept while another month loads so the chips stay put.
  const [today, setToday] = useState<string | null>(null);
  if (state.status === "ready" && state.data.today !== today) setToday(state.data.today);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={() => {
            setPulling(true);
            void refresh().finally(() => setPulling(false));
          }}
          tintColor={colors.ink}
        />
      }
    >
      <View testID="budgets-screen" style={styles.page}>
        {today ? <MonthChips today={today} month={month ?? today.slice(0, 7)} onChange={setMonth} /> : null}
        {state.status === "loading" ? (
          <SectionSkeleton label="Loading budgets" />
        ) : state.status !== "ready" ? (
          <SectionUnavailable state={state} what="your budgets" retry={() => void refresh()} />
        ) : (
          <>
            <SectionProblem state={state} retry={() => void refresh()} />
            <Budgets view={state.data} />
          </>
        )}
      </View>
    </Screen>
  );
}

function MonthChips({ today, month, onChange }: { today: string; month: string; onChange: (month: string) => void }) {
  const options = budgetMonthOptions(today);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Budget month" contentContainerStyle={styles.chips}>
      {options.map((o, i) => (
        <Chip key={o.value} label={i === 0 ? `This month · ${o.label}` : o.label} selected={o.value === month} onPress={() => onChange(o.value)} />
      ))}
    </ScrollView>
  );
}

function Budgets({ view }: { view: GoalsView }) {
  const router = useRouter();
  const later = view.budgetMonth.start > view.month.start;
  const shown = monthLabel(view.budgetMonth.start);
  // The even-spend mark is for the month in progress; a later month has nothing spent yet.
  const marker = later ? undefined : evenSpendShare(view.budgetMonth.start, view.today);
  return (
    <>
      <PageHeader
        description={`${
          later
            ? `The budgets that will apply in ${shown}. Nothing is spent yet.`
            : `Spending this month (${fullDate(view.month.start)} to ${fullDate(view.month.end)}) against each category's budget.`
        } A budget continues every month until you change it or remove it.`}
      />
      {view.budgets.length === 0 ? (
        <Card>
          <Text style={dsText.bodyStrong}>{later ? `No budgets in ${shown}` : "No budgets this month"}</Text>
          <Text style={dsText.caption}>Set a monthly amount for a category. You&apos;ll see a warning at 80% and when it&apos;s used up.</Text>
        </Card>
      ) : (
        <>
          <Card>
            {view.total ? (
              <BudgetTotal total={view.total} currency={view.currency} marker={marker} />
            ) : (
              <Text style={dsText.body}>Your budgets are in another currency. Set your budget again in {view.currency}.</Text>
            )}
          </Card>
          <Card style={styles.list}>
            {view.budgets.map((item) => (
              <BudgetRow
                key={item.category.id}
                item={item}
                currency={view.currency}
                marker={marker}
                later={later}
                onPress={() => router.push(budgetSheet(view.budgetMonth.start, item.category.id))}
              />
            ))}
          </Card>
        </>
      )}
      {view.unbudgeted.length > 0 ? (
        <Button label="Set a budget" icon={Plus} fullWidth onPress={() => router.push(budgetSheet(view.budgetMonth.start))} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  page: { gap: spacing[4] },
  chips: { gap: spacing[2], paddingVertical: 4 },
  // The rows draw their own top border; the first one sits flush under the card's padding.
  list: { gap: 0, paddingVertical: spacing[2] },
});
