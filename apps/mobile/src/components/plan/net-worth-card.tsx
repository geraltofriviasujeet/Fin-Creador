import { fullDate } from "@fin-creador/api";
import { type NetWorth, type NetWorthLine, type NotIncluded, NET_WORTH_FLAG_TEXT, NET_WORTH_LINE_LABEL, NET_WORTH_PART_LABEL } from "@fin-creador/domain";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { AmountText, Button, Card, SectionHeader } from "@/components/ds";
import type { NetWorthData } from "@/lib/plan-data";
import type { LoadedState } from "@/lib/use-loaded";
import { dsText, mobile, spacing } from "@/theme";
import { SectionProblem, SectionSkeleton, SectionUnavailable } from "./section-state";

// Plan → Net worth (Sprint 13c PR 2): the web Overview's Net worth card (apps/web/components/
// net-worth/overview-card.tsx) from the same netWorth in packages/domain. Every line says what it
// is valued as of, and every flag says why. Exact amounts, as the web shows them.

function asOfText(line: NetWorthLine, today: string): string {
  if (line.key !== "holdings") return line.asOf.to === today ? "Today" : fullDate(line.asOf.to);
  return line.asOf.from === line.asOf.to ? `Prices of ${fullDate(line.asOf.to)}` : `Prices of ${fullDate(line.asOf.from)} to ${fullDate(line.asOf.to)}`;
}

function notIncludedText(item: NotIncluded): string {
  return item.reason === "no_price" ? `${item.name}: not included (no price)` : `${item.name}: not included (${item.currency}, another currency)`;
}

function Lines({ title, lines, view }: { title: string; lines: NetWorthLine[]; view: NetWorth }) {
  if (lines.length === 0) return null;
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title.toUpperCase()}</Text>
      {lines.map((l, i) => (
        <View key={l.key} style={[styles.line, i > 0 && styles.lineBorder]}>
          <View style={styles.lineHead}>
            <Text style={[dsText.body, styles.shrink]}>{NET_WORTH_LINE_LABEL[l.key]}</Text>
            <AmountText minor={l.amountMinor} currency={view.currency} whole={false} direction={l.side === "liability" ? "out" : undefined} />
          </View>
          <Text style={dsText.caption}>
            {l.count > 0 ? `${l.count} ${l.count === 1 ? "item" : "items"} · ` : ""}
            {asOfText(l, view.today)}
          </Text>
          {l.flags.map((f) => (
            <Text key={f.flag} style={dsText.caption}>
              {f.count} × {NET_WORTH_FLAG_TEXT[f.flag]}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function NetWorthSection({ state, retry }: { state: LoadedState<NetWorthData>; retry: () => void }) {
  return (
    <View style={styles.section}>
      <SectionHeader title="Net worth" />
      <NetWorthBody state={state} retry={retry} />
    </View>
  );
}

function NetWorthBody({ state, retry }: { state: LoadedState<NetWorthData>; retry: () => void }) {
  const router = useRouter();
  if (state.status === "loading") return <SectionSkeleton label="Loading net worth" />;
  if (state.status !== "ready") return <SectionUnavailable state={state} what="your net worth" retry={retry} />;
  const { view, timeZone } = state.data;
  const assets = view.lines.filter((l) => l.side === "asset");
  const liabilities = view.lines.filter((l) => l.side === "liability");
  return (
    <Card>
      <SectionProblem state={state} retry={retry} timeZone={timeZone} />
      <Text style={dsText.caption}>
        What you own minus what you owe, as of {fullDate(view.today)} ({timeZone} time), in {view.currency}.
      </Text>
      {view.empty ? (
        <>
          <Text style={dsText.body}>Add an account, a holding or a loan to see your net worth.</Text>
          <View style={styles.start}>
            <Button label="Add an account" variant="secondary" onPress={() => router.push({ pathname: "/sheets/account", params: { kind: "bank" } })} />
          </View>
        </>
      ) : (
        <>
          {view.totalMinor !== null ? (
            <View style={styles.total}>
              <AmountText minor={view.totalMinor} currency={view.currency} whole={false} size="hero" style={styles.totalText} />
              <Text style={dsText.caption}>
                Assets <AmountText minor={view.assetsMinor ?? 0} currency={view.currency} whole={false} size="caption" /> · Liabilities{" "}
                <AmountText minor={view.liabilitiesMinor ?? 0} currency={view.currency} whole={false} size="caption" />
              </Text>
            </View>
          ) : (
            <Text style={dsText.body}>No total until everything loads.</Text>
          )}
          {view.failed.map((p) => (
            <View key={p} style={styles.failed}>
              <Text style={[dsText.caption, styles.warning]}>Couldn&apos;t load {NET_WORTH_PART_LABEL[p]}.</Text>
              <Button label="Try again" variant="secondary" size="small" onPress={retry} />
            </View>
          ))}
          <Lines title="Assets" lines={assets} view={view} />
          <Lines title="Liabilities" lines={liabilities} view={view} />
          {view.notIncluded.length > 0 ? (
            <View style={styles.group}>
              <Text style={styles.groupTitle}>NOT INCLUDED</Text>
              {view.notIncluded.map((n, i) => (
                <Text key={`${n.name}-${i}`} style={dsText.caption}>
                  {notIncludedText(n)}
                </Text>
              ))}
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing[2] },
  total: { gap: 2 },
  totalText: { fontSize: 36, lineHeight: 42 },
  group: { gap: spacing[1] },
  groupTitle: { ...dsText.caption, fontSize: mobile.type.min.size, letterSpacing: 1.2 },
  line: { gap: 2, paddingVertical: spacing[2] },
  lineBorder: { borderTopWidth: 1, borderTopColor: mobile.colors.line },
  lineHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing[3] },
  shrink: { flexShrink: 1 },
  failed: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing[2] },
  warning: { color: mobile.colors.warning },
  start: { alignSelf: "flex-start" },
});
