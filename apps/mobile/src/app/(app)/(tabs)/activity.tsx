import {
  type Filters,
  type LedgerItem,
  type Lookup,
  ledgerLookup,
  PERIODS,
  type PageCursor,
  TYPE_TABS,
  type TransactionTotals,
  type TransactionsContext,
  accountChipText,
  dayHeading,
  entryKindLabel,
  entryTitle,
  groupByDay,
  hasActiveFilters,
  loadTransactionPage,
  loadTransactionTotals,
  money,
  periodLabel,
  periodRange,
  previousPeriod,
  rangeText,
  readFilters,
  signedAmount,
  toApiFilters,
} from "@fin-creador/api";
import { formatPercentFromBasisPoints, incomeTrendBasisPoints, savingsRateBasisPoints } from "@fin-creador/domain";
import { useRouter } from "expo-router";
import { Plus, Repeat, RotateCw, Search, Wallet } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { Card, CardDescription, CardTitle } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { FormMessage } from "@/components/form-message";
import { DateField } from "@/components/income/date-field";
import { StatCard } from "@/components/income/stat-card";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { Segmented } from "@/components/segmented";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { TextLink } from "@/components/text-link";
import { EntryIcon } from "@/components/transactions/entry-icon";
import { TransactionsGate } from "@/components/transactions/transactions-gate";
import { NETWORK_ERROR } from "@/lib/income-store";
import { getSupabase } from "@/lib/supabase";
import { useTransactions } from "@/lib/transactions-store";
import { TOUCH_TARGET, colors, fontFamily, fontSize, spacing, text } from "@/theme";

/**
 * Activity tab (Sprint 3): every expense, income and transfer, filtered and searched in the
 * database through the loaders shared with the web /transactions page.
 */
export default function ActivityScreen() {
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
      <PageHeader title="Transactions" description="See every rupee coming in and going out." />
      {state.status === "ready" ? <Activity data={state.data} /> : <TransactionsGate>{() => null}</TransactionsGate>}
    </Screen>
  );
}

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: LedgerItem[]; nextCursor: PageCursor | null; totals: TransactionTotals; prevTotals: TransactionTotals | null };

function Activity({ data }: { data: TransactionsContext }) {
  const router = useRouter();
  const { version } = useTransactions();
  const { today, currency } = data;
  const defaults = useMemo(() => readFilters(new URLSearchParams(), today), [today]);
  const [f, setF] = useState<Filters>(defaults);
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState<"idle" | "loading" | "error">("idle");
  const range = periodRange(f, today);
  const key = JSON.stringify(f);

  const lookup: Lookup = useMemo(
    () => ledgerLookup(data),
    [data]
  );

  useEffect(() => {
    let active = true;
    const supabase = getSupabase();
    const filters = JSON.parse(key) as Filters;
    const r = periodRange(filters, today);
    const prev = previousPeriod(filters, today);
    Promise.all([
      loadTransactionPage(supabase, toApiFilters(filters, r), { currency }),
      loadTransactionTotals(supabase, toApiFilters(filters, r), currency),
      prev ? loadTransactionTotals(supabase, toApiFilters(filters, prev), currency) : null,
    ])
      .then(([page, totals, prevTotals]) => {
        if (!active) return;
        if (!page.ok || !totals.ok || (prevTotals && !prevTotals.ok)) return setList({ status: "error" });
        setList({ status: "ready", items: page.items, nextCursor: page.nextCursor, totals: totals.totals, prevTotals: prevTotals?.ok ? prevTotals.totals : null });
      })
      .catch(() => active && setList({ status: "error" }));
    return () => {
      active = false;
    };
  }, [key, today, currency, version, attempt]);

  const go = (next: Partial<Filters>) => {
    setList({ status: "loading" });
    setMore("idle");
    setF((cur) => ({ ...cur, ...next }));
  };

  async function loadMore() {
    if (list.status !== "ready" || !list.nextCursor || more === "loading") return;
    setMore("loading");
    try {
      const page = await loadTransactionPage(getSupabase(), toApiFilters(f, range), { currency, cursor: list.nextCursor });
      if (!page.ok) return setMore("error");
      setList((l) => (l.status === "ready" ? { ...l, items: [...l.items, ...page.items], nextCursor: page.nextCursor } : l));
      setMore("idle");
    } catch {
      setMore("error");
    }
  }

  const addTransaction = (type: "expense" | "income" = "expense") => router.push({ pathname: "/sheets/transaction", params: { type } });
  const label = periodLabel(f);
  const hasAccounts = data.accounts.some((a) => !a.archived);

  return (
    <View style={styles.gap}>
      <Button label="Add transaction" icon={Plus} onPress={() => addTransaction()} />
      <Button label="Recurring" variant="secondary" icon={Repeat} onPress={() => router.push("/recurring")} accessibilityHint="Opens recurring items: what is due and what it costs" />
      <Segmented label="Transaction type" options={TYPE_TABS} value={f.type} onChange={(type) => go({ type })} />

      <Card style={styles.filters}>
        <TextField
          label="Search"
          value={query}
          onChangeText={setQuery}
          placeholder="Note, category, account or amount"
          returnKeyType="search"
          maxLength={100}
          onSubmitEditing={() => go({ q: query.trim() })}
          accessibilityHint="Searches when you press search on the keyboard"
        />
        <View style={styles.actions}>
          <Button label="Search" variant="secondary" icon={Search} onPress={() => go({ q: query.trim() })} />
          {f.q ? (
            <TextLink
              label="Clear search"
              onPress={() => {
                setQuery("");
                go({ q: "" });
              }}
            />
          ) : null}
        </View>
        <SelectField
          label="Date"
          value={f.period}
          options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          onChange={(period) => go({ period: period as Filters["period"] })}
          searchPlaceholder="Search periods"
        />
        {f.period === "custom" ? (
          <View style={styles.gap}>
            <DateField label="From" value={f.from} max={today} onChange={(from) => go({ from })} />
            <DateField label="To" value={f.to} max={today} onChange={(to) => go({ to })} />
          </View>
        ) : null}
        <SelectField
          label="Category"
          value={f.category}
          options={[
            { value: "", label: "All categories" },
            ...data.categories.map((c) => ({
              value: c.id,
              label: `${c.name}${c.archived ? " (archived)" : ""}${c.kind === "income" ? " · income" : ""}`,
            })),
          ]}
          onChange={(category) => go({ category })}
          searchPlaceholder="Search categories"
        />
        <SelectField
          label="Account"
          value={f.account}
          options={[{ value: "", label: "All accounts" }, ...data.accounts.map((a) => ({ value: a.id, label: `${a.label}${a.archived ? " (archived)" : ""}` }))]}
          onChange={(account) => go({ account })}
          searchPlaceholder="Search accounts"
        />
        <View style={styles.switchRow}>
          <Text style={text.body}>Show voided entries</Text>
          <Switch
            value={f.showVoided}
            onValueChange={(showVoided) => go({ showVoided })}
            accessibilityLabel="Show voided entries"
            trackColor={{ true: colors.ink, false: colors.lineStrong }}
            thumbColor={colors.surface}
          />
        </View>
        {hasActiveFilters(f) ? (
          <TextLink
            label="Clear filters"
            onPress={() => {
              setQuery("");
              go(defaults);
            }}
          />
        ) : null}
      </Card>

      {list.status === "loading" ? (
        <View style={styles.center} accessibilityLabel="Loading transactions" accessibilityState={{ busy: true }}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : list.status === "error" ? (
        <View style={styles.gap}>
          <FormMessage tone="error" message={NETWORK_ERROR} />
          <Button
            label="Try again"
            variant="secondary"
            icon={RotateCw}
            onPress={() => {
              setList({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          />
        </View>
      ) : (
        <>
          <Totals totals={list.totals} prevTotals={list.prevTotals} label={label} currency={currency} />
          <Text style={text.caption}>
            {rangeText(range)}. Transfers between your accounts ({list.totals.transferCount}) aren&apos;t income or expenses. Voided entries never count.
            {list.totals.otherCurrencyCount > 0 ? ` ${list.totals.otherCurrencyCount} entries in other currencies are listed but not totalled.` : ""}
          </Text>

          {list.items.length === 0 ? (
            !data.hasEntries ? (
              <EmptyState
                icon={Wallet}
                title="No transactions yet"
                body={
                  hasAccounts
                    ? "Add what you spend and receive. Transfers between your own accounts go here too, without counting as income or expenses."
                    : "Add an account on the Income screen first, then record what you spend and receive here."
                }
                action={
                  hasAccounts ? (
                    <Button label="Add expense" icon={Plus} onPress={() => addTransaction("expense")} />
                  ) : (
                    <Button label="Go to Income" onPress={() => router.push("/income")} />
                  )
                }
              />
            ) : (
              <EmptyState
                icon={Search}
                title="Nothing matches these filters"
                body={`${f.q ? "Search looks in notes, category and account names, and exact amounts. " : ""}Try another period or clear the filters.`}
                chip={colors.blue}
              />
            )
          ) : (
            <Card style={styles.listCard}>
              <View style={styles.listHeader}>
                <CardTitle>{f.type === "all" ? "All transactions" : (TYPE_TABS.find((t) => t.value === f.type)?.label ?? "All")}</CardTitle>
                <CardDescription>
                  {label}
                  {f.q ? ` · matching “${f.q}”` : ""}
                </CardDescription>
              </View>
              {groupByDay(list.items).map((g) => (
                <View key={g.date}>
                  <Text style={styles.day} accessibilityRole="header">
                    {dayHeading(g.date, today).toUpperCase()}
                  </Text>
                  {g.rows.map((entry) => (
                    <Row key={entry.id} entry={entry} lookup={lookup} onPress={() => router.push({ pathname: "/sheets/entry", params: { id: entry.id } })} />
                  ))}
                </View>
              ))}
              <View style={styles.footer}>
                <Text style={text.caption} accessibilityLiveRegion="polite">
                  Showing {list.items.length}
                </Text>
                {list.nextCursor ? <Button label="Show more" variant="secondary" loading={more === "loading"} onPress={() => void loadMore()} /> : null}
              </View>
              {more === "error" ? (
                <View style={styles.footerError}>
                  <FormMessage tone="error" message="We couldn't load more entries. Check your connection and try again." />
                </View>
              ) : null}
            </Card>
          )}
        </>
      )}
    </View>
  );
}

function Totals({ totals, prevTotals, label, currency }: { totals: TransactionTotals; prevTotals: TransactionTotals | null; label: string; currency: string }) {
  const trend = prevTotals ? incomeTrendBasisPoints(totals.incomeMinor, prevTotals.incomeMinor) : null;
  const rate = savingsRateBasisPoints(totals);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stats} accessibilityLabel="Totals for these filters">
      <StatCard
        label={`Income · ${label}`}
        value={money(totals.incomeMinor, currency)}
        footer={
          trend === null ? (
            <Text style={text.caption}>{`${totals.incomeCount} ${totals.incomeCount === 1 ? "entry" : "entries"}`}</Text>
          ) : (
            <Text style={[text.caption, { color: trend >= 0 ? colors.success : colors.danger }]}>
              {formatPercentFromBasisPoints(trend, { signed: true })} from the month before
            </Text>
          )
        }
      />
      <StatCard
        label={`Expenses · ${label}`}
        value={money(totals.expenseMinor, currency)}
        footer={<Text style={text.caption}>{`${totals.expenseCount} ${totals.expenseCount === 1 ? "expense" : "expenses"}`}</Text>}
      />
      <StatCard
        label="Net savings"
        value={money(totals.netMinor, currency)}
        footer={
          rate === null ? (
            <Text style={text.caption}>No income in this period</Text>
          ) : totals.netMinor < 0 ? (
            <Text style={[text.caption, { color: colors.danger }]}>Spent {money(-totals.netMinor, currency)} more than came in</Text>
          ) : (
            <Text style={[text.caption, { color: colors.success }]}>{formatPercentFromBasisPoints(rate)} savings rate</Text>
          )
        }
      />
    </ScrollView>
  );
}

function Row({ entry, lookup, onPress }: { entry: LedgerItem; lookup: Lookup; onPress: () => void }) {
  const title = entryTitle(entry, lookup);
  const amount = signedAmount(entry);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${amount}${entry.voided ? ", voided, not counted" : ""}`}
      accessibilityHint="Opens details, edit, void and history"
      style={({ pressed }) => [styles.row, entry.voided && styles.voidedRow, pressed && styles.pressed]}
    >
      <EntryIcon entry={entry} lookup={lookup} />
      <View style={styles.rowText}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, entry.voided && styles.muted]} numberOfLines={1}>
            {title}
          </Text>
          {entry.replacesId ? <Badge label="Edited" tone="info" /> : null}
          {entry.voided ? <Badge label="Voided" tone="negative" /> : null}
        </View>
        <Text style={text.caption} numberOfLines={1}>
          {entryKindLabel(entry, lookup)} · {accountChipText(entry, lookup)}
          {entry.voided && entry.voidReason ? ` · Reason: ${entry.voidReason}` : ""}
        </Text>
      </View>
      <Text style={[styles.amount, entry.type === "income" && styles.income, entry.voided && styles.struck]}>{amount}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing[4] },
  filters: { gap: spacing[4] },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: TOUCH_TARGET },
  center: { paddingVertical: spacing[10], alignItems: "center" },
  stats: { gap: spacing[3] },
  listCard: { paddingHorizontal: 0, paddingBottom: spacing[3] },
  listHeader: { paddingHorizontal: spacing[4], paddingBottom: spacing[3], gap: spacing[1] },
  day: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: fontSize.xs,
    letterSpacing: 1.2,
    color: colors.muted,
    backgroundColor: colors.canvas,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingHorizontal: spacing[4], paddingVertical: spacing[3], minHeight: 64 },
  voidedRow: { backgroundColor: colors.canvas },
  pressed: { opacity: 0.7 },
  rowText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  title: { flexShrink: 1, fontFamily: fontFamily.bodySemibold, fontSize: fontSize.sm, color: colors.ink },
  muted: { color: colors.muted },
  amount: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.sm, color: colors.ink, fontVariant: ["tabular-nums"] },
  income: { color: colors.success },
  struck: { textDecorationLine: "line-through", color: colors.muted },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing[4], paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colors.line, gap: spacing[3] },
  footerError: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },
});
