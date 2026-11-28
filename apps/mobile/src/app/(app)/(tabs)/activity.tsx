import {
  ACTIVITY_CHIPS,
  type ActivityFilters,
  type TransactionsContext,
  activeChip,
  activityRange,
  clearActivityFilters,
  dayTotals,
  hasActivityFilters,
  initialActivityFilters,
  isSearching,
  ledgerLookup,
  monthChips,
  monthLabel,
  moreFiltersCount,
  spendLimitLabel,
  withMonth,
} from "@fin-creador/api";
import { formatClockTime } from "@fin-creador/domain";
import { useFocusEffect, useRouter } from "expo-router";
import { CalendarDays, CircleAlert, CloudOff, Gauge, Landmark, Repeat, Search, SlidersHorizontal, Wallet } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { ActivityHeader, ActivitySkeleton, DayGroup, Summary } from "@/components/activity/parts";
import { MonthPicker, MoreFilters } from "@/components/activity/sheets";
import { Button, Chip, EmptyState, OfflineBanner, WarningBanner } from "@/components/ds";
import { Screen } from "@/components/screen";
import { useToast } from "@/components/toast";
import { visibleMonthChips } from "@/lib/activity-text";
import { useTransactions } from "@/lib/transactions-store";
import { useActivityList } from "@/lib/use-activity-list";
import { comingSoonMessage } from "@/navigation";
import { dsText, mobile, spacing } from "@/theme";

/**
 * Activity tab (Sprint 13b PR 4, design-spec §5): month chips and a month picker, Money in /
 * Money out, the All / Spent / Received / Transfers chips and More filters, entries by day
 * with day totals, Search (all time) and Import UPI in the header. Filtering, search and
 * totals run in the database through the loaders shared with the web (packages/api
 * activity.ts); nothing is kept on the phone.
 */
export default function ActivityScreen() {
  const { state, refresh } = useTransactions();
  const toast = useToast();
  const [pulling, setPulling] = useState(false);
  const [f, setF] = useState<ActivityFilters | null>(null);
  const data = state.status === "ready" ? state.data : null;
  const filters = f ?? (data ? initialActivityFilters(data.today) : null);

  const onRefresh = () => {
    setPulling(true);
    void refresh().finally(() => setPulling(false));
  };

  let body;
  if (state.status === "loading") body = <ActivitySkeleton />;
  else if (state.status === "error")
    body = state.offline ? (
      <EmptyState icon={CloudOff} title="You're offline" body="Activity will load when your phone is back online." action={{ label: "Try again", onPress: () => void refresh() }} />
    ) : (
      <EmptyState icon={CircleAlert} title="We couldn't load Activity" body={state.message} action={{ label: "Retry", onPress: () => void refresh() }} />
    );
  else body = <Activity data={state.data} filters={filters!} setFilters={setF} />;

  return (
    <View style={styles.page} testID="activity-screen">
      <ActivityHeader
        query={filters?.q ?? ""}
        onSearch={(q) => filters && setF({ ...filters, q })}
        onImportUpi={() => toast.show(comingSoonMessage("Import UPI"))}
      />
      <Screen aboveTabBar refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={mobile.colors.ink} />}>
        {body}
      </Screen>
    </View>
  );
}

function Activity({ data, filters: f, setFilters }: { data: TransactionsContext; filters: ActivityFilters; setFilters: (f: ActivityFilters) => void }) {
  const router = useRouter();
  const { state, version } = useTransactions();
  const { list, reload, loadMore } = useActivityList(f, data.currency, version);
  const [sheet, setSheet] = useState<"month" | "more" | null>(null);
  const { today, currency } = data;
  const lookup = useMemo(() => ledgerLookup(data), [data]);
  const chips = useMemo(() => monthChips(today), [today]);
  const searching = isSearching(f);
  // "Oct" for a month this year (as on its chip), "All time" while searching, or the custom range.
  const label = !searching && f.month !== null ? monthLabel(f.month, today) : activityRange(f).label;
  // Coming back to the tab reloads the list, keeping it on screen (offline: a banner says when it was loaded).
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) reload();
      focused.current = true;
    }, [reload]),
  );
  const more = moreFiltersCount(f);
  // The daily spend limit (pre-13b 2 PR 4): left out if it couldn't be read, so it never offers "Set" over a saved one.
  const spendLimit = state.status === "ready" ? state.spendLimit : null;
  const limitLabel = spendLimit?.limit ? spendLimitLabel(spendLimit.limit) : null;
  const accounts = [...data.accounts, ...data.cardAccounts].map((a) => ({ value: a.id, label: `${a.label}${a.archived ? " (archived)" : ""}` }));
  const hasAccounts = data.accounts.some((a) => !a.archived);
  const add = () => router.push({ pathname: "/add", params: { type: "expense" } });
  // A month chip ends a search: search covers all time.
  const pickMonth = (month: string) => setFilters(withMonth({ ...f, q: "" }, month));

  const tools = (
    <View style={styles.toolRow}>
      {spendLimit ? (
        <Chip icon={Gauge} label={limitLabel ? `Limit ${limitLabel}` : "Set daily spend limit"} onPress={() => router.push("/sheets/spend-limit")} />
      ) : null}
      <Chip icon={Repeat} label="Recurring" onPress={() => router.push("/recurring")} />
    </View>
  );

  if (!data.hasEntries && !hasActivityFilters(f)) {
    return (
      <>
        {tools}
        <EmptyState
          icon={hasAccounts ? Wallet : Landmark}
          title="No entries yet"
          body={
            hasAccounts
              ? "What you spend and receive shows here, by day. Transfers between your own accounts too, without counting as money in or out."
              : "Add the bank account or cash you spend from, then record what you spend and receive."
          }
          action={
            hasAccounts
              ? { label: "Add expense", onPress: add }
              : { label: "Add an account", onPress: () => router.push({ pathname: "/sheets/account", params: { kind: "bank" } }) }
          }
        />
      </>
    );
  }

  const ready = list.status === "ready" ? list : null;
  const groups = ready ? dayTotals(ready.items, { currency, hasMore: ready.nextCursor !== null }) : [];

  return (
    <>
      {ready?.problem === "offline" ? <OfflineBanner detail={`Showing what was loaded at ${formatClockTime(ready.loadedAt, data.timeZone)}.`} /> : null}
      {ready?.problem === "error" ? <WarningBanner message="We couldn't refresh Activity. Showing what was loaded earlier." action={{ label: "Retry", onPress: reload }} /> : null}
      {tools}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} accessibilityLabel="Months">
        {searching ? <Chip label="All time" selected /> : null}
        {visibleMonthChips(chips, f).map((c) => (
          <Chip key={c.month} label={c.label} selected={!searching && f.month === c.month} onPress={() => pickMonth(c.month)} />
        ))}
        <Chip icon={CalendarDays} label="Pick a month" onPress={() => setSheet("month")} />
      </ScrollView>

      {ready ? <Summary totals={ready.totals} previous={ready.previous} currency={currency} label={label} /> : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} accessibilityLabel="Show">
        {ACTIVITY_CHIPS.map((c) => (
          <Chip key={c.value} label={c.label} selected={activeChip(f.type) === c.value} onPress={() => setFilters({ ...f, type: c.value })} />
        ))}
        <Chip icon={SlidersHorizontal} label={more > 0 ? `More filters · ${more}` : "More filters"} selected={more > 0} onPress={() => setSheet("more")} />
      </ScrollView>
      {searching ? <Text style={dsText.caption}>{`Matching “${f.q}” in all time`}</Text> : null}

      {list.status === "loading" ? (
        <ActivitySkeleton />
      ) : list.status === "offline" ? (
        <EmptyState icon={CloudOff} title="You're offline" body="Activity will load when your phone is back online." action={{ label: "Try again", onPress: reload }} />
      ) : list.status === "error" ? (
        <EmptyState icon={CircleAlert} title="We couldn't load these entries" body="Please try again." action={{ label: "Retry", onPress: reload }} />
      ) : list.items.length === 0 ? (
        hasActivityFilters(f) ? (
          <EmptyState
            icon={Search}
            title="No matches"
            body={
              searching
                ? `Nothing matches “${f.q}”. Search looks in notes, category and account names, and exact amounts.`
                : `Nothing in ${label} matches these filters.`
            }
            action={{ label: "Clear filters", onPress: () => setFilters(clearActivityFilters(f, today)) }}
          />
        ) : (
          <EmptyState icon={Wallet} title={`Nothing in ${label}`} body="Entries you record for this month show here." action={{ label: "Add expense", onPress: add }} />
        )
      ) : (
        <>
          {groups.map((g) => (
            <DayGroup
              key={g.date}
              date={g.date}
              today={today}
              rows={g.rows}
              totals={g.totals}
              currency={currency}
              lookup={lookup}
              onOpen={(entry) => router.push({ pathname: "/sheets/entry", params: { id: entry.id } })}
            />
          ))}
          <View style={styles.footer}>
            <Text style={dsText.caption} accessibilityLiveRegion="polite">
              {list.nextCursor ? `Showing ${list.items.length}` : `${list.items.length} ${list.items.length === 1 ? "entry" : "entries"}`}
            </Text>
            {list.nextCursor ? <Button label="Load more" variant="secondary" size="small" loading={list.more === "loading"} onPress={() => void loadMore()} /> : null}
          </View>
          {list.more === "error" ? <WarningBanner message="We couldn't load more entries. Check your connection and try again." /> : null}
        </>
      )}

      <MonthPicker visible={sheet === "month"} today={today} selected={searching ? null : f.month} onPick={(m) => { setSheet(null); pickMonth(m); }} onClose={() => setSheet(null)} />
      <MoreFilters
        visible={sheet === "more"}
        filters={f}
        today={today}
        categories={data.categories}
        accounts={accounts}
        onApply={(next) => {
          setSheet(null);
          setFilters(next);
        }}
        onClose={() => setSheet(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: mobile.colors.canvas },
  toolRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  chipRow: { gap: spacing[2], paddingVertical: 4 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3], minHeight: mobile.tapTarget },
});
