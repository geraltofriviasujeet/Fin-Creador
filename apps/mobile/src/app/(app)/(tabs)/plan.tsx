import { useFocusEffect } from "expo-router";
import { Landmark } from "lucide-react-native";
import { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { PlanBillsSection } from "@/components/plan/bills";
import { PlanBudgetsSection } from "@/components/plan/budgets";
import { PlanGoalsSection } from "@/components/plan/goals";
import { NetWorthSection } from "@/components/plan/net-worth-card";
import { Screen } from "@/components/screen";
import { BellAndSettings, TabHeader } from "@/components/tab-header";
import { useBudgets, useGoalsView, useNetWorth } from "@/lib/plan-data";
import { useTransactions } from "@/lib/transactions-store";
import { colors } from "@/theme";

// Plan (Sprint 13c, design-spec §5): one scrolling screen of sections, each a summary card that
// opens its own screen. PR 2: Net worth (the web Overview's netWorth) and Budgets. PR 3: Goals and
// Bills that repeat (from the shared transactions store, as Recurring). Loans and investments
// follow in PRs 4–6. The header is Activity's pattern: the title with the bell and Settings; the
// raised + in the tab bar is the only add button (owner). Every section loads on each visit (a
// change saved in a sheet shows on return) and on its own.
export default function PlanScreen() {
  const netWorth = useNetWorth();
  const budgets = useBudgets();
  const goals = useGoalsView();
  const { refresh: refreshTransactions } = useTransactions();
  const [pulling, setPulling] = useState(false);
  const refreshNetWorth = netWorth.refresh;
  const refreshBudgets = budgets.refresh;
  const refreshGoals = goals.refresh;
  const refreshAll = useCallback(() => Promise.all([refreshNetWorth(), refreshBudgets(), refreshGoals()]), [refreshNetWorth, refreshBudgets, refreshGoals]);
  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  return (
    <View testID="plan-screen" style={styles.page}>
      <TabHeader title="Plan">
        <BellAndSettings />
      </TabHeader>
      <Screen
        aboveTabBar
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              void Promise.all([refreshAll(), refreshTransactions()]).finally(() => setPulling(false));
            }}
            tintColor={colors.ink}
          />
        }
      >
        <NetWorthSection state={netWorth.state} retry={() => void refreshNetWorth()} />
        <PlanBudgetsSection state={budgets.state} retry={() => void refreshBudgets()} />
        <PlanGoalsSection state={goals.state} retry={() => void refreshGoals()} />
        <PlanBillsSection />
        <EmptyState
          icon={Landmark}
          chip={colors.lavender}
          title="Loans and investments"
          body="These are coming to the app in a later update."
          action={<Badge label="Soon" tone="info" />}
        />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: colors.canvas } });
