import { type GoalsView, setGoalArchived } from "@fin-creador/api";
import { useFocusEffect, useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { Button, Card } from "@/components/ds";
import { PageHeader } from "@/components/page-header";
import { ArchivedGoalRow, GoalActions, GoalCard, goalSheet } from "@/components/plan/goals";
import { SectionProblem, SectionSkeleton, SectionUnavailable } from "@/components/plan/section-state";
import { Screen } from "@/components/screen";
import { useToast } from "@/components/toast";
import { useGoalsView } from "@/lib/plan-data";
import { getSupabase } from "@/lib/supabase";
import { NETWORK_ERROR } from "@/lib/income-store";
import { explainFailure } from "@/lib/use-save";
import { colors, dsText, spacing } from "@/theme";

// Goals (Sprint 13c PR 3), opened from Plan: every active goal with its ring, saved of target,
// On track or Behind and what to save a month, with Update saved, Edit and Archive; then the
// archived ones (Restore, Delete permanently). Same view as the web Goals page (buildGoalsView),
// read on each visit, so a change made in a sheet shows on return.
export default function GoalsScreen() {
  const { state, refresh } = useGoalsView();
  const [pulling, setPulling] = useState(false);
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
      <View testID="goals-screen" style={styles.page}>
        <PageHeader description="Planned expenses. Every figure comes from the amounts you enter; the saved amount isn't linked to your accounts." />
        {state.status === "loading" ? (
          <SectionSkeleton label="Loading goals" />
        ) : state.status !== "ready" ? (
          <SectionUnavailable state={state} what="your goals" retry={() => void refresh()} />
        ) : (
          <>
            <SectionProblem state={state} retry={() => void refresh()} />
            <Goals view={state.data} refresh={refresh} />
          </>
        )}
      </View>
    </Screen>
  );
}

function Goals({ view, refresh }: { view: GoalsView; refresh: () => Promise<void> }) {
  const router = useRouter();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);

  async function restore(goalId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await explainFailure(await setGoalArchived(getSupabase(), { goalId, archived: false }));
      if (r.status === "success") await refresh();
      toast.show(r.message);
    } catch {
      toast.show(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button label="Plan a goal" icon={Plus} fullWidth onPress={() => router.push(goalSheet("add"))} />
      {view.active.length === 0 ? (
        <Card>
          <Text style={dsText.bodyStrong}>Plan your first goal</Text>
          <Text style={dsText.caption}>A trip, a vehicle or something else: enter your own figures and see how much to save each month.</Text>
        </Card>
      ) : (
        view.active.map((item) => <GoalCard key={item.goal.id} item={item} view={view} actions={<GoalActions item={item} />} />)
      )}
      <Text style={dsText.caption}>
        On track means what you&apos;ve saved keeps an even pace from the month you added the goal to its target month. A goal without a target date has no pace.
      </Text>
      {view.archived.length > 0 ? (
        <View style={styles.archived}>
          <Button
            label={showArchived ? "Hide archived" : `Show archived (${view.archived.length})`}
            variant="secondary"
            onPress={() => setShowArchived((s) => !s)}
          />
          {showArchived ? (
            <Card style={styles.list}>
              {view.archived.map((item, i) => (
                <ArchivedGoalRow key={item.goal.id} item={item} first={i === 0} busy={busy} onRestore={() => void restore(item.goal.id)} />
              ))}
            </Card>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  page: { gap: spacing[4] },
  archived: { gap: spacing[3] },
  list: { gap: 0, paddingVertical: spacing[2] },
});
