import {
  type Lookup,
  type RecurringItem,
  UPCOMING_DAYS,
  accountChipText,
  dayHeading,
  entryKindLabel,
  entryTitle,
  fullDate,
  money,
  setRecurringRuleArchived,
  showCostTile,
  signedAmount,
  undoRecurringSkip,
} from "@fin-creador/api";
import type { CostTotal } from "@fin-creador/domain";
import { useRouter } from "expo-router";
import { CircleAlert, Plus } from "lucide-react-native";
import { type ReactNode, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { Card, CardDescription, CardTitle } from "@/components/card";
import { FormMessage } from "@/components/form-message";
import { StatCard } from "@/components/income/stat-card";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { useToast } from "@/components/toast";
import { EntryIcon } from "@/components/transactions/entry-icon";
import { TransactionsGate } from "@/components/transactions/transactions-gate";
import { NETWORK_ERROR } from "@/lib/income-store";
import { useRecurringView } from "@/lib/recurring";
import { getSupabase } from "@/lib/supabase";
import { useTransactions } from "@/lib/transactions-store";
import { colors, fontFamily, fontSize, spacing, text } from "@/theme";

/**
 * Recurring screen (Sprint 4, mobile): the same cost tiles, panels and groups as the web
 * /recurring page, from the shared view builder. Reached from the Overview card and Activity.
 */
export default function RecurringScreen() {
  const { state, refresh } = useTransactions();
  const [pulling, setPulling] = useState(false);
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
      <PageHeader title="Recurring" description="Salary, rent, subscriptions and other repeating items. Nothing is saved until you confirm it." />
      {state.status === "ready" && !state.recurring ? (
        <View style={styles.gap}>
          <FormMessage tone="error" message={NETWORK_ERROR} />
          <Button label="Try again" variant="secondary" onPress={() => void refresh()} />
        </View>
      ) : (
        <TransactionsGate>{() => <RecurringContent />}</TransactionsGate>
      )}
    </Screen>
  );
}

function RecurringContent() {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useTransactions();
  const result = useRecurringView();
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const lookup: Lookup | null = useMemo(
    () =>
      result
        ? { accounts: new Map(result.data.accounts.map((a) => [a.id, a])), categories: new Map(result.data.categories.map((c) => [c.id, c])) }
        : null,
    [result]
  );
  if (!result || !lookup) return null;
  const { view, data } = result;
  const { today, currency } = data;
  const hasAccounts = data.accounts.some((a) => !a.archived);

  async function quick(run: () => Promise<{ status: "success" | "error"; message: string }>) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await run();
      toast.show(r.message);
      if (r.status === "success") void refresh();
    } catch {
      toast.show(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const openRule = (i: RecurringItem) => router.push({ pathname: "/sheets/recurring-rule", params: { id: i.rule.id } });
  const tile = (label: string, t: CostTotal, cur: string, what: string) => (
    <StatCard
      key={label}
      label={label}
      value={`${money(t.monthlyMinor, cur)} / month`}
      footer={<Text style={text.caption}>{`${money(t.yearlyMinor, cur)} a year · ${t.count} ${t.count === 1 ? what : `${what}s`} · estimated from default amounts`}</Text>}
    />
  );
  const row = (i: RecurringItem, actions?: ReactNode, onPress?: () => void) => (
    <Row key={i.rule.id} item={i} lookup={lookup} today={today} onPress={onPress}>
      {actions}
    </Row>
  );

  return (
    <View style={styles.gap}>
      {hasAccounts ? (
        <Button label="Add recurring" icon={Plus} onPress={() => router.push("/sheets/recurring-rule")} />
      ) : (
        <FormMessage tone="info" message="Add an account first on the Income screen. Recurring items post into an account." />
      )}

      {view.costs.map((c) => {
        const suffix = c.currency === currency ? "" : ` · ${c.currency}`;
        return (
          <ScrollView key={c.currency} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles} accessibilityLabel={`Recurring cost in ${c.currency}`}>
            {showCostTile(c, "subscriptions", currency) && tile(`Subscriptions${suffix}`, c.subscriptions, c.currency, "subscription")}
            {showCostTile(c, "memberships", currency) && tile(`Memberships${suffix}`, c.memberships, c.currency, "membership")}
            {showCostTile(c, "total", currency) && tile(`Total recurring cost${suffix}`, c.total, c.currency, "expense")}
          </ScrollView>
        );
      })}
      <Text style={text.caption}>Active recurring expenses only (not income, transfers, ended or archived items). Each currency is totalled on its own; amounts are never converted.</Text>

      <Panel title="Due" count={view.due.length} description="Confirm to save the entry, or skip this date." empty="Nothing is due.">
        {view.due.map((i) =>
          row(
            i,
            <View style={styles.actions}>
              <Button label="Skip" variant="ghost" onPress={() => router.push({ pathname: "/sheets/recurring-skip", params: { id: i.rule.id } })} />
              <Button label="Confirm" onPress={() => router.push({ pathname: "/sheets/transaction", params: { ruleId: i.rule.id } })} />
            </View>
          )
        )}
      </Panel>
      <Panel title="Needs attention" count={view.attention.length} description="These can't save until fixed." empty="All recurring items can save.">
        {view.attention.map((i) => row(i, <Button label="Fix" variant="secondary" onPress={() => openRule(i)} />))}
      </Panel>
      <Panel title={`Coming in ${UPCOMING_DAYS} days`} count={view.soon.length} empty={`Nothing in the next ${UPCOMING_DAYS} days.`}>
        {view.soon.map((i) => row(i))}
      </Panel>
      <Panel title="Ended" count={view.ended.length} description="Past their end date. Their entries stay." empty="No recurring items have ended.">
        {view.ended.map((i) => row(i, undefined, () => openRule(i)))}
      </Panel>

      {(
        [
          ["subscription", "Subscriptions", "No subscriptions. Use the Subscription category for streaming, apps and similar."],
          ["membership", "Memberships", "No memberships. Use the Membership category for clubs, gyms and similar."],
          ["other", "Other recurring", "No other recurring items."],
        ] as const
      ).map(([key, title, empty]) => (
        <Panel key={key} title={title} count={view.groups[key].length} empty={empty}>
          {view.groups[key].map((i) =>
            row(
              { ...i, attention: null },
              i.undoableSkip ? (
                <Button
                  label="Undo skip"
                  variant="ghost"
                  loading={busy}
                  onPress={() => void quick(() => undoRecurringSkip(getSupabase(), { ruleId: i.rule.id, occurrenceDate: i.undoableSkip! }))}
                />
              ) : undefined,
              () => openRule(i)
            )
          )}
        </Panel>
      ))}

      {view.archived.length > 0 ? (
        <View style={styles.gap}>
          <Button
            label={showArchived ? "Hide archived" : `Show archived (${view.archived.length})`}
            variant="ghost"
            onPress={() => setShowArchived((v) => !v)}
          />
          {showArchived ? (
            <Panel title="Archived" count={view.archived.length} empty="">
              {view.archived.map((i) =>
                row(
                  i,
                  <Button
                    label="Restore"
                    variant="secondary"
                    loading={busy}
                    onPress={() => void quick(() => setRecurringRuleArchived(getSupabase(), { ruleId: i.rule.id, archived: false }))}
                  />
                )
              )}
            </Panel>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Panel({ title, description, count, empty, children }: { title: string; description?: string; count: number; empty: string; children: ReactNode }) {
  return (
    <Card style={styles.panel}>
      <View style={styles.panelHead}>
        <CardTitle>{`${title} (${count})`}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </View>
      {count === 0 ? <Text style={[text.bodySmall, styles.empty]}>{empty}</Text> : <View>{children}</View>}
    </Card>
  );
}

function Row({ item, lookup, today, onPress, children }: { item: RecurringItem; lookup: Lookup; today: string; onPress?: () => void; children?: ReactNode }) {
  const title = entryTitle(item.entry, lookup);
  const when =
    item.kind === "ended" ? (item.date ? `Ended ${fullDate(item.date)}` : "Ended") : item.kind === "archived" ? "Archived" : item.date ? dayHeading(item.date, today) : "";
  const body = (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <EntryIcon entry={item.entry} lookup={lookup} />
        <View style={styles.rowText}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {item.kind === "needs_attention" ? <Badge label="Needs attention" tone="negative" /> : null}
            {item.kind === "due" && item.date && item.date < today ? <Badge label="Missed" tone="info" /> : null}
          </View>
          <Text style={text.caption} numberOfLines={2}>
            {item.schedule} · {entryKindLabel(item.entry, lookup)} · {accountChipText(item.entry, lookup)}
          </Text>
          {item.attention ? (
            <View style={styles.attention}>
              <CircleAlert size={14} color={colors.danger} />
              <Text style={styles.attentionText}>{item.attention}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.right}>
          <Text style={styles.amount}>{signedAmount(item.entry)}</Text>
          <Text style={text.caption}>{when}</Text>
        </View>
      </View>
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}, ${signedAmount(item.entry)}, ${item.schedule}`} accessibilityHint="Opens edit, archive and undo" style={({ pressed }) => [pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing[4] },
  tiles: { gap: spacing[3] },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing[2] },
  panel: { paddingHorizontal: 0, gap: spacing[3] },
  panelHead: { paddingHorizontal: spacing[4], gap: spacing[1] },
  empty: { paddingHorizontal: spacing[4] },
  row: { gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[3], borderTopWidth: 1, borderTopColor: colors.line },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  rowText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], flexWrap: "wrap" },
  title: { flexShrink: 1, fontFamily: fontFamily.bodySemibold, fontSize: fontSize.sm, color: colors.ink },
  right: { alignItems: "flex-end", gap: 2 },
  amount: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.sm, color: colors.ink, fontVariant: ["tabular-nums"] },
  attention: { flexDirection: "row", gap: spacing[1], alignItems: "flex-start" },
  attentionText: { flex: 1, fontFamily: fontFamily.bodyMedium, fontSize: fontSize.xs, color: colors.danger },
  pressed: { opacity: 0.7 },
});
