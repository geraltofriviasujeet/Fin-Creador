import { type GoalItem, type GoalsView, goalPaceOf, money, planGoals } from "@fin-creador/api";
import type { GoalType } from "@fin-creador/domain";
import { GOAL_TYPE_OPTIONS } from "@fin-creador/schemas";
import { type Href, useRouter } from "expo-router";
import { Armchair, Bike, Car, ChevronRight, House, Laptop, type LucideIcon, Plane, Plus, Smartphone, Sparkles, Truck } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Card, IconTile, ProgressRing, SectionHeader, Tag } from "@/components/ds";
import { goalBehindText, goalPaceTag, goalSavingText, goalsSummaryText, savedPercent } from "@/lib/plan-text";
import type { LoadedState } from "@/lib/use-loaded";
import { dsText, fontFamily, mobile, spacing } from "@/theme";
import { SectionProblem, SectionSkeleton, SectionUnavailable } from "./section-state";

// Goals on the phone (Sprint 13c PR 3, design-spec §5 "Plan"): progress rings, saved of target,
// "Save ₹X a month", and On track / Behind in words (domain goalPace: an even pace from the month
// the goal was added). Figures from the web Goals page's view (buildGoalsView); exact amounts.

/** "Ask Roma" per goal (what if I save more?): hidden until Roma comes to the phone in 13d. */
export const SHOW_ASK_ROMA = false;

const ICON: Record<GoalType, LucideIcon> = {
  trip: Plane,
  vehicle: Car,
  house: House,
  furniture: Armchair,
  electronics: Laptop,
  mobile: Smartphone,
  other: Sparkles,
};

// The web's labels, except "Vehicle" (the web says "Wheeler"), as the phone's add sheet names it.
const TYPE_LABEL = { ...Object.fromEntries(GOAL_TYPE_OPTIONS.map((t) => [t.value, t.label])), vehicle: "Vehicle" } as Record<GoalType, string>;

/** The goal's icon; a vehicle shows its kind (bike, car or HMV), as on the web. */
export function goalIcon(item: GoalItem): LucideIcon {
  if (item.answers?.type === "vehicle") {
    if (item.answers.details.vehicle === "bike") return Bike;
    if (item.answers.details.vehicle === "hmv") return Truck;
  }
  return ICON[item.goal.type as GoalType] ?? Sparkles;
}

export const goalTypeLabel = (item: GoalItem) => TYPE_LABEL[item.goal.type as GoalType] ?? "Goal";

/** A goal sheet: add, edit, update saved, archive or delete. */
export function goalSheet(action: "add" | "edit" | "saved" | "archive" | "delete", goalId?: string): Href {
  return { pathname: "/sheets/goal", params: goalId ? { action, id: goalId } : { action } };
}

function Ring({ item, size }: { item: GoalItem; size: number }) {
  const bps = item.plan.progressBps ?? 0;
  return (
    <View style={{ width: size, height: size }}>
      <ProgressRing value={Math.floor(bps / 100) / 100} size={size} stroke={size > 60 ? 8 : 6} label={`${item.goal.name}: ${savedPercent(bps)} saved`} />
    </View>
  );
}

/** One goal: ring, name, saved of target, the pace in words and what to save a month. */
export function GoalCard({ item, view, actions }: { item: GoalItem; view: Pick<GoalsView, "today" | "timeZone">; actions?: ReactNode }) {
  const { goal } = item;
  const pace = goalPaceOf(item, view);
  const tag = goalPaceTag(pace);
  const behind = goalBehindText(pace, goal.currency);
  return (
    <Card>
      <View style={styles.head}>
        <Ring item={item} size={72} />
        <View style={styles.headText}>
          <View style={styles.titleRow}>
            <Text accessibilityRole="header" style={[dsText.cardTitle, styles.shrink]} numberOfLines={2}>
              {goal.name}
            </Text>
            {tag ? <Tag label={tag.label} tone={tag.tone} /> : null}
          </View>
          <Text style={dsText.caption}>{goalTypeLabel(item)}</Text>
          <Text style={styles.amounts}>
            {money(goal.savedMinor, goal.currency)} of {money(goal.targetMinor, goal.currency)}
          </Text>
        </View>
      </View>
      {!item.answers ? <Text style={dsText.caption}>We couldn&apos;t read this goal&apos;s details. Edit it to enter them again.</Text> : null}
      <View style={styles.plan}>
        <Text style={dsText.bodyStrong}>{goalSavingText(item)}</Text>
        {behind ? <Text style={[dsText.caption, styles.caution]}>{behind}</Text> : null}
      </View>
      {actions}
    </Card>
  );
}

/** Update saved, Edit and Archive (and the hidden Ask Roma link) under a goal on the Goals screen. */
export function GoalActions({ item }: { item: GoalItem }) {
  const router = useRouter();
  const name = item.goal.name;
  return (
    <View style={styles.actions}>
      <Button label="Update saved" variant="secondary" size="small" accessibilityLabel={`Update saved amount for ${name}`} onPress={() => router.push(goalSheet("saved", item.goal.id))} />
      <Button label="Edit" variant="secondary" size="small" accessibilityLabel={`Edit ${name}`} onPress={() => router.push(goalSheet("edit", item.goal.id))} />
      <Button label="Archive" variant="secondary" size="small" accessibilityLabel={`Archive ${name}`} onPress={() => router.push(goalSheet("archive", item.goal.id))} />
      {SHOW_ASK_ROMA ? (
        <Button label="Ask Roma" variant="secondary" size="small" icon={Sparkles} accessibilityLabel={`Ask Roma about ${name}`} onPress={() => router.push("/roma")} />
      ) : null}
    </View>
  );
}

/** Plan → Goals: how many are behind or on track and the three nearest goals. */
export function PlanGoalsSection({ state, retry }: { state: LoadedState<GoalsView>; retry: () => void }) {
  const router = useRouter();
  const ready = state.status === "ready" ? state.data : null;
  return (
    <View style={styles.section}>
      <SectionHeader title="Goals" action={ready ? { label: "See all", onPress: () => router.push("/goals"), accessibilityLabel: "See all goals" } : undefined} />
      {state.status === "loading" ? (
        <SectionSkeleton label="Loading goals" />
      ) : state.status !== "ready" ? (
        <SectionUnavailable state={state} what="your goals" retry={retry} />
      ) : (
        <PlanGoalsCard view={state.data} problem={<SectionProblem state={state} retry={retry} />} />
      )}
    </View>
  );
}

function PlanGoalsCard({ view, problem }: { view: GoalsView; problem: ReactNode }) {
  const router = useRouter();
  const plan = planGoals(view);
  if (plan.count === 0) {
    return (
      <Card>
        {problem}
        <Text style={dsText.bodyStrong}>Plan your first goal</Text>
        <Text style={dsText.caption}>A trip, a vehicle or something else: enter your own figures and see how much to save each month.</Text>
        <View style={styles.start}>
          <Button label="Plan a goal" variant="secondary" icon={Plus} onPress={() => router.push(goalSheet("add"))} />
        </View>
      </Card>
    );
  }
  const summary = goalsSummaryText(view.active.map((g) => goalPaceOf(g, view)));
  return (
    <Card>
      {problem}
      {summary ? <Text style={[dsText.caption, styles.summary]}>{summary}</Text> : null}
      {plan.top.map((item, i) => (
        <GoalRow key={item.goal.id} item={item} view={view} first={i === 0} onPress={() => router.push("/goals")} />
      ))}
      {plan.count > plan.top.length ? <Text style={dsText.caption}>{`${plan.count - plan.top.length} more on the Goals screen`}</Text> : null}
    </Card>
  );
}

function GoalRow({ item, view, first, onPress }: { item: GoalItem; view: GoalsView; first: boolean; onPress: () => void }) {
  const { goal } = item;
  const tag = goalPaceTag(goalPaceOf(item, view));
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Opens Goals" onPress={onPress} style={({ pressed }) => [styles.row, first && styles.firstRow, pressed && styles.pressed]}>
      <Ring item={item} size={48} />
      <View style={styles.rowText}>
        <View style={styles.titleRow}>
          <Text style={[dsText.bodyStrong, styles.shrink]} numberOfLines={1}>
            {goal.name}
          </Text>
          {tag ? <Tag label={tag.label} tone={tag.tone} /> : null}
        </View>
        <Text style={dsText.caption} numberOfLines={2}>
          {money(goal.savedMinor, goal.currency)} of {money(goal.targetMinor, goal.currency)} · {goalSavingText(item)}
        </Text>
      </View>
      <ChevronRight size={18} color={mobile.colors.mutedSubtle} />
    </Pressable>
  );
}

/** An archived goal: Restore, or Delete permanently (confirm sheet). */
export function ArchivedGoalRow({ item, first, busy, onRestore }: { item: GoalItem; first: boolean; busy: boolean; onRestore: () => void }) {
  const router = useRouter();
  const { goal } = item;
  return (
    <View style={[styles.archived, first && styles.firstRow]}>
      <View style={styles.archivedHead}>
        <IconTile icon={goalIcon(item)} tint="grey" size={40} />
        <View style={styles.rowText}>
          <Text style={dsText.bodyStrong} numberOfLines={1}>
            {goal.name}
          </Text>
          <Text style={dsText.caption}>
            {money(goal.savedMinor, goal.currency)} of {money(goal.targetMinor, goal.currency)}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button label="Restore" variant="secondary" size="small" disabled={busy} accessibilityLabel={`Restore ${goal.name}`} onPress={onRestore} />
        <Button label="Delete permanently" variant="secondary" size="small" accessibilityLabel={`Delete ${goal.name} permanently`} onPress={() => router.push(goalSheet("delete", goal.id))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing[2] },
  head: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  headText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: spacing[2], rowGap: 4 },
  shrink: { flexShrink: 1 },
  amounts: { fontFamily: fontFamily.bodySemibold, fontSize: mobile.type.caption.size, lineHeight: mobile.type.caption.lineHeight, color: mobile.colors.ink, fontVariant: ["tabular-nums"] },
  plan: { gap: 4, backgroundColor: mobile.colors.canvas, borderRadius: mobile.radius.tileSm, padding: spacing[3] },
  caution: { color: mobile.colors.caution, fontFamily: fontFamily.bodySemibold },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  summary: { fontFamily: fontFamily.bodySemibold, color: mobile.colors.ink },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: spacing[2], borderTopWidth: 1, borderTopColor: mobile.colors.line, minHeight: mobile.tapTarget },
  firstRow: { borderTopWidth: 0 },
  rowText: { flex: 1, gap: 2 },
  pressed: { backgroundColor: mobile.colors.canvas },
  start: { alignSelf: "flex-start" },
  archived: { gap: spacing[2], paddingVertical: spacing[3], borderTopWidth: 1, borderTopColor: mobile.colors.line },
  archivedHead: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
});
