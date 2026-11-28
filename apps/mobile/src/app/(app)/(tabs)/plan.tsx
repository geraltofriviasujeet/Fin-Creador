import { useFocusEffect } from "expo-router";
import { Target } from "lucide-react-native";
import { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PlanBudgetsSection } from "@/components/plan/budgets";
import { NetWorthSection } from "@/components/plan/net-worth-card";
import { RecurringSummaryCard } from "@/components/recurring/recurring-summary-card";
import { Screen } from "@/components/screen";
import { useBudgets, useNetWorth } from "@/lib/plan-data";
import { colors } from "@/theme";

// Plan (Sprint 13c, design-spec §5): one scrolling screen of sections, each a summary card that
// opens its own screen. PR 2: Net worth (the web Overview's netWorth) and Budgets. Recurring stays
// linked until PR 3 brings Bills that repeat; goals, loans and investments follow in PRs 3–6.
// Every section loads on each visit (a budget saved in its sheet shows on return) and on its own.
export default function PlanScreen() {
  const netWorth = useNetWorth();
  const budgets = useBudgets();
  const [pulling, setPulling] = useState(false);
  const refreshNetWorth = netWorth.refresh;
  const refreshBudgets = budgets.refresh;
  const refreshAll = useCallback(() => Promise.all([refreshNetWorth(), refreshBudgets()]), [refreshNetWorth, refreshBudgets]);
  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  return (
    <View testID="plan-screen" style={styles.page}>
      <Screen
        aboveTabBar
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              void refreshAll().finally(() => setPulling(false));
            }}
            tintColor={colors.ink}
          />
        }
      >
        <PageHeader title="Plan" description="Net worth, budgets, goals, loans and bills that repeat." />
        <NetWorthSection state={netWorth.state} retry={() => void refreshNetWorth()} />
        <PlanBudgetsSection state={budgets.state} retry={() => void refreshBudgets()} />
        <RecurringSummaryCard />
        <EmptyState
          icon={Target}
          chip={colors.lavender}
          title="Goals, loans and investments"
          body="These are coming to the app in a later update."
          action={<Badge label="Soon" tone="info" />}
        />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ page: { flex: 1 } });
