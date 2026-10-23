import { type IncomeAccount, type IncomePageData, setAccountArchived } from "@fin-creador/api";
import {
  incomeBySource,
  incomeTrendBasisPoints,
  monthRange,
  previousMonthRange,
  rentalIncome,
  sumIncome,
  summarizeHoldings,
  yearRange,
} from "@fin-creador/domain";
import { useRouter } from "expo-router";
import { BriefcaseBusiness, House, MoreHorizontal, Plus } from "lucide-react-native";
import { useMemo } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { Card, CardDescription, CardTitle } from "@/components/card";
import { IncomeGate } from "@/components/income/income-gate";
import { StatCard } from "@/components/income/stat-card";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { useToast } from "@/components/toast";
import { money, shortDateInZone, trendText } from "@/lib/income-format";
import { NETWORK_ERROR, useIncome } from "@/lib/income-store";
import { getSupabase } from "@/lib/supabase";
import { TOUCH_TARGET, colors, fontFamily, fontSize, radius, spacing, text } from "@/theme";

/** Income screen (design-spec §9, mobile). Same domain functions and messages as the web. */
export default function IncomeScreen() {
  const { state, refresh } = useIncome();
  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={state.status === "ready" && state.refreshing}
          onRefresh={() => void refresh()}
          tintColor={colors.ink}
        />
      }
    >
      <PageHeader title="Income" description="See where your money comes from and where it is held." />
      <IncomeGate>{(data) => <IncomeContent data={data} />}</IncomeGate>
    </Screen>
  );
}

function IncomeContent({ data }: { data: IncomePageData }) {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useIncome();
  const { currency, today, accounts, sources, entries } = data;

  const view = useMemo(() => {
    const periods = { month: monthRange(today), previousMonth: previousMonthRange(today), year: yearRange(today) };
    const thisMonth = sumIncome(entries, periods.month, currency);
    const holdings = summarizeHoldings(accounts, currency);
    const cashUpdated = holdings.rows
      .filter((r) => r.account.kind === "cash")
      .map((r) => r.account.lastActivityAt)
      .sort()
      .at(-1);
    return {
      thisMonth,
      thisYear: sumIncome(entries, periods.year, currency),
      trend: incomeTrendBasisPoints(thisMonth, sumIncome(entries, periods.previousMonth, currency)),
      holdings,
      cashUpdated,
      sourceRows: incomeBySource(entries, sources, periods, currency),
      rental: rentalIncome(entries, sources, periods, currency),
    };
  }, [accounts, currency, entries, sources, today]);

  const label = (id: string) => accounts.find((a) => a.id === id)?.label ?? "Account";
  const hasCash = accounts.some((a) => a.kind === "cash" && !a.archived);
  const h = view.holdings;

  function accountActions(account: IncomeAccount) {
    Alert.alert(account.label, undefined, [
      {
        text: account.kind === "cash" ? "Update amount" : "Edit",
        onPress: () =>
          account.kind === "cash"
            ? router.push("/sheets/cash")
            : router.push({ pathname: "/sheets/account", params: { kind: account.kind, id: account.id } }),
      },
      {
        text: "Archive",
        style: "destructive",
        onPress: () =>
          Alert.alert(`Archive ${account.label}?`, "It will leave your totals and the account list. Its income history stays, and you can restore it later.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Archive",
              style: "destructive",
              onPress: async () => {
                try {
                  const r = await setAccountArchived(getSupabase(), { id: account.id, archived: true });
                  toast.show(r.message);
                  if (r.status === "success") void refresh();
                } catch {
                  toast.show(NETWORK_ERROR);
                }
              },
            },
          ]),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <>
      <View style={styles.actions}>
        <Button label="Add income" icon={Plus} onPress={() => router.push({ pathname: "/sheets/transaction", params: { type: "income" } })} />
        <Button label="Add bank account" variant="secondary" icon={Plus} onPress={() => router.push({ pathname: "/sheets/account", params: { kind: "bank" } })} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={245 + spacing[3]} decelerationRate="fast" contentContainerStyle={styles.cards} accessibilityLabel="Summary">
        <StatCard
          label="Income this month"
          value={money(view.thisMonth, currency)}
          footer={view.trend !== null ? <Text style={[text.bodySmall, { color: view.trend >= 0 ? colors.success : colors.danger }]}>{trendText(view.trend)}</Text> : undefined}
        />
        <StatCard label="Income this year" value={money(view.thisYear, currency)} footer={`January – December ${today.slice(0, 4)}`} />
        <StatCard label="Bank accounts" value={String(h.bankCount)} footer={h.bankCount === 0 ? "None added yet" : `${h.savingsCount} savings · ${h.currentCount} current`} />
        <StatCard
          label="Money in banks"
          value={money(h.moneyInBanksMinor, currency)}
          footer={h.bankCount === 0 ? "Add a bank account to see this" : `Across ${h.bankCount} bank account${h.bankCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Cash in hand"
          value={money(h.cashInHandMinor, currency)}
          footer={view.cashUpdated ? `As of ${shortDateInZone(view.cashUpdated, data.timeZone)}` : "No cash added yet"}
        />
        <StatCard
          label="Rental income"
          value={money(view.rental.monthMinor, currency)}
          footer={view.rental.hasRentSource ? `${money(view.rental.yearMinor, currency)} this year` : "Add a rental source"}
        />
      </ScrollView>

      <Card style={styles.panel}>
        <View style={styles.panelHead}>
          <View style={styles.flex}>
            <CardTitle>Income sources</CardTitle>
            <CardDescription>Monthly and yearly earnings by source</CardDescription>
          </View>
          <Button label="Add source" variant="ghost" onPress={() => router.push("/sheets/source")} />
        </View>
        {view.sourceRows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={text.label}>No income recorded yet</Text>
            <Text style={text.bodySmall}>Your sources appear here with this month’s and this year’s income.</Text>
            <Button label="Add income" icon={Plus} onPress={() => router.push({ pathname: "/sheets/transaction", params: { type: "income" } })} />
          </View>
        ) : (
          view.sourceRows.map(({ source, monthMinor, yearMinor, linked, onlyVoided }) => (
            <Pressable
              key={source.id}
              accessibilityRole="button"
              accessibilityHint="Shows this year's entries"
              onPress={() => router.push({ pathname: "/sheets/entries", params: { sourceId: source.id } })}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.iconTile}>
                {source.sourceType === "rent" ? <House size={20} color={colors.ink} /> : <BriefcaseBusiness size={20} color={colors.ink} />}
              </View>
              <View style={styles.flex}>
                <Text style={text.label} numberOfLines={1}>
                  {source.name}
                </Text>
                <Text style={text.caption} numberOfLines={1}>
                  {linked.kind === "multiple" ? "Multiple accounts" : linked.kind === "account" ? label(linked.accountId) : "No account yet"}
                </Text>
                {onlyVoided ? <Text style={text.caption}>Voided entries only</Text> : null}
              </View>
              <View style={styles.amounts}>
                <Text style={styles.monthAmount}>{money(monthMinor, currency)}</Text>
                <Text style={text.caption}>{money(yearMinor, currency)} yearly</Text>
              </View>
            </Pressable>
          ))
        )}
      </Card>

      <Card style={styles.panel}>
        <CardTitle>Where your money is</CardTitle>
        <CardDescription>Available balances</CardDescription>
        {h.rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={text.label}>Add your first account</Text>
            <Text style={text.bodySmall}>Add the banks and cash where you keep money to see your total.</Text>
          </View>
        ) : (
          h.rows.map(({ account, balanceMinor, inTotal }) => (
            <View key={account.id} style={styles.holding}>
              <Text style={[text.bodySmall, styles.flex]} numberOfLines={1}>
                {account.label}
              </Text>
              {!inTotal ? <Badge label="Not in total" /> : null}
              <Text style={styles.balance}>{money(balanceMinor, account.currency)}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Actions for ${account.label}`}
                hitSlop={8}
                onPress={() => accountActions(account)}
                style={styles.more}
              >
                <MoreHorizontal size={18} color={colors.muted} />
              </Pressable>
            </View>
          ))
        )}
        <View style={styles.total} accessible accessibilityLabel={`Total available: ${money(h.totalAvailableMinor, currency)}`}>
          <Text style={styles.totalLabel}>Total available</Text>
          <Text style={styles.totalValue}>{money(h.totalAvailableMinor, currency)}</Text>
        </View>
        <View style={styles.actions}>
          <Button
            label={hasCash ? "Update cash" : "Add cash"}
            variant="secondary"
            icon={Plus}
            onPress={() => (hasCash ? router.push("/sheets/cash") : router.push({ pathname: "/sheets/account", params: { kind: "cash" } }))}
          />
          <Button label="Add other account" variant="secondary" icon={Plus} onPress={() => router.push({ pathname: "/sheets/account", params: { kind: "other" } })} />
          {h.archived.length > 0 ? <Button label={`Show archived (${h.archived.length})`} variant="ghost" onPress={() => router.push("/sheets/archived")} /> : null}
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  cards: { gap: spacing[3], paddingRight: spacing[4] },
  panel: { gap: spacing[3] },
  panelHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2] },
  empty: { gap: spacing[2], padding: spacing[4], borderRadius: radius.md, backgroundColor: colors.canvas, alignItems: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: spacing[3], minHeight: TOUCH_TARGET, borderTopWidth: 1, borderTopColor: colors.line },
  pressed: { backgroundColor: colors.canvas },
  iconTile: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center" },
  amounts: { alignItems: "flex-end" },
  monthAmount: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.base, color: colors.success },
  holding: { flexDirection: "row", alignItems: "center", gap: spacing[2], minHeight: TOUCH_TARGET, borderTopWidth: 1, borderTopColor: colors.line },
  balance: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.base, color: colors.ink },
  more: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" },
  total: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radius.md, backgroundColor: colors.accentDeep, padding: spacing[4] },
  totalLabel: { fontFamily: fontFamily.body, fontSize: fontSize.sm, color: colors.navMuted },
  totalValue: { fontFamily: fontFamily.heading, fontSize: fontSize["2xl"], color: colors.navText },
});
