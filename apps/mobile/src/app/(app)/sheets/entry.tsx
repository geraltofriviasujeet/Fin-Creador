import {
  type LedgerItem,
  type Lookup,
  TYPE_NOUN,
  accountChipText,
  entryKindLabel,
  entryTitle,
  fullDate,
  loadEntry,
  loadEntryHistory,
  newRequestKey,
  paymentModeLabel,
  signedAmount,
  voidTransaction,
} from "@fin-creador/api";
import { useLocalSearchParams, useRouter } from "expo-router";
import { History, Pencil, RotateCw, Undo2 } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { Sheet } from "@/components/income/sheet";
import { TextField } from "@/components/text-field";
import { TransactionsGate } from "@/components/transactions/transactions-gate";
import { NETWORK_ERROR } from "@/lib/income-store";
import { param } from "@/lib/income-format";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { colors, fontFamily, fontSize, radius, spacing, text } from "@/theme";

type Loaded<T> = { status: "loading" } | { status: "error" } | { status: "ready"; value: T };

/** One entry: details, then Edit, Void (one-way, with a reason) and History (if edited). */
export default function EntrySheet() {
  const id = param(useLocalSearchParams<{ id?: string }>().id);
  const [entry, setEntry] = useState<Loaded<LedgerItem>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadEntry(getSupabase(), id)
      .then((e) => active && setEntry(e ? { status: "ready", value: e } : { status: "error" }))
      .catch(() => active && setEntry({ status: "error" }));
    return () => {
      active = false;
    };
  }, [id, attempt]);

  return (
    <Sheet eyebrow="Transaction" title={entry.status === "ready" ? `${capitalise(TYPE_NOUN[entry.value.type])}` : "Transaction"}>
      <TransactionsGate>
        {(data) => {
          const lookup: Lookup = {
            accounts: new Map(data.accounts.map((a) => [a.id, a])),
            categories: new Map(data.categories.map((c) => [c.id, c])),
          };
          if (entry.status === "loading") return <ActivityIndicator color={colors.ink} />;
          if (entry.status === "error") {
            return (
              <View style={styles.gap}>
                <FormMessage tone="error" message={NETWORK_ERROR} />
                <Button label="Try again" variant="secondary" icon={RotateCw} onPress={() => { setEntry({ status: "loading" }); setAttempt((n) => n + 1); }} />
              </View>
            );
          }
          return <EntryDetails entry={entry.value} lookup={lookup} />;
        }}
      </TransactionsGate>
    </Sheet>
  );
}

function EntryDetails({ entry, lookup }: { entry: LedgerItem; lookup: Lookup }) {
  const router = useRouter();
  const [panel, setPanel] = useState<"none" | "void" | "history">("none");
  const edited = Boolean(entry.replacesId);
  return (
    <View style={styles.gap}>
      <Summary entry={entry} lookup={lookup} />
      {!entry.voided && panel !== "void" ? (
        <View style={styles.actions}>
          <Button label="Edit" variant="secondary" icon={Pencil} onPress={() => router.replace({ pathname: "/sheets/transaction", params: { id: entry.id } })} />
          <Button label="Void" variant="secondary" icon={Undo2} onPress={() => setPanel("void")} />
        </View>
      ) : null}
      {panel === "void" ? <VoidForm entry={entry} onCancel={() => setPanel("none")} /> : null}
      {edited && panel !== "history" ? <Button label="History" variant="ghost" icon={History} onPress={() => setPanel("history")} /> : null}
      {panel === "history" ? <HistoryList id={entry.id} lookup={lookup} /> : null}
    </View>
  );
}

function Summary({ entry, lookup }: { entry: LedgerItem; lookup: Lookup }) {
  const rows: [string, string][] = [
    ["Amount", signedAmount(entry)],
    ["Date", fullDate(entry.occurredOn)],
    [entry.type === "transfer" ? "Type" : entry.type === "income" ? "Source" : "Category", entryKindLabel(entry, lookup)],
    [entry.type === "transfer" ? "From → To" : entry.type === "income" ? "Received into" : "Paid from", accountChipText(entry, lookup)],
  ];
  if (entry.type === "expense") rows.push(["Payment mode", paymentModeLabel(entry.paymentMode) ?? "Not specified"]);
  rows.push(["Note", entry.note ?? "No note"]);
  return (
    <View style={styles.summary}>
      <View style={styles.titleRow}>
        <Text style={[text.cardTitle, styles.flex]}>{entryTitle(entry, lookup)}</Text>
        {entry.replacesId ? <Badge label="Edited" tone="info" /> : null}
        {entry.voided ? <Badge label="Voided" tone="negative" /> : null}
      </View>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={text.caption}>{label}</Text>
          <Text style={[styles.value, label === "Amount" && entry.voided && styles.struck]}>{value}</Text>
        </View>
      ))}
      {entry.voided && entry.voidReason ? <Text style={text.caption}>Reason: {entry.voidReason}</Text> : null}
    </View>
  );
}

function VoidForm({ entry, onCancel }: { entry: LedgerItem; onCancel: () => void }) {
  // One key per opened form; a retry after a failure reuses it, so the entry is voided once.
  const [requestKey] = useState(newRequestKey);
  const [reason, setReason] = useState("");
  const { save, busy, fieldErrors, formError } = useSave();
  const noun = TYPE_NOUN[entry.type];
  return (
    <View style={styles.voidForm}>
      <Text style={text.bodySmall}>
        {entry.type === "transfer"
          ? "Void this transfer? Both accounts go back to their balances without it."
          : `Void this ${noun}? It stops counting toward totals and the account balance.`}{" "}
        It stays in your history, marked “Voided”. This can’t be undone.
      </Text>
      {formError ? <FormMessage tone="error" message={formError} /> : null}
      <TextField label="Reason (optional)" value={reason} onChangeText={setReason} maxLength={200} placeholder="e.g. Entered twice" error={fieldErrors.reason} />
      <View style={styles.actions}>
        <Button label="Keep it" variant="secondary" onPress={onCancel} />
        <Button
          label={`Void ${noun}`}
          loading={busy}
          onPress={() =>
            void save(() =>
              voidTransaction(getSupabase(), { transactionId: entry.id, reason, idempotencyKey: requestKey }).catch(() => ({
                status: "error" as const,
                message: NETWORK_ERROR,
              }))
            )
          }
        />
      </View>
    </View>
  );
}

function HistoryList({ id, lookup }: { id: string; lookup: Lookup }) {
  const [state, setState] = useState<Loaded<LedgerItem[]>>({ status: "loading" });
  useEffect(() => {
    let active = true;
    loadEntryHistory(getSupabase(), id)
      .then((r) => active && setState(r.ok ? { status: "ready", value: r.versions } : { status: "error" }))
      .catch(() => active && setState({ status: "error" }));
    return () => {
      active = false;
    };
  }, [id]);
  const fields = useMemo(
    () =>
      [
        ["Amount", signedAmount],
        ["Date", (e: LedgerItem) => fullDate(e.occurredOn)],
        ["Category", (e: LedgerItem) => entryKindLabel(e, lookup)],
        ["Account", (e: LedgerItem) => accountChipText(e, lookup)],
        ["Payment mode", (e: LedgerItem) => paymentModeLabel(e.paymentMode) ?? "Not specified"],
        ["Note", (e: LedgerItem) => e.note ?? "No note"],
      ] as const,
    [lookup]
  );

  if (state.status === "loading") return <ActivityIndicator color={colors.ink} accessibilityLabel="Loading history" />;
  if (state.status === "error") return <FormMessage tone="error" message="We couldn't load the history. Close and try again." />;
  const versions = state.value;
  return (
    <View style={styles.gap} accessibilityLabel="History">
      <Text style={text.cardTitle}>History</Text>
      <Text style={text.caption}>Every saved version, newest first. Earlier versions never count toward totals.</Text>
      {versions
        .map((v, i) => ({ v, i }))
        .reverse()
        .map(({ v, i }) => {
          const latest = i === versions.length - 1;
          const prev = i > 0 ? versions[i - 1] : undefined;
          const changes = prev ? fields.filter(([, f]) => f(prev) !== f(v)) : [];
          return (
            <View key={v.id} style={[styles.version, latest && styles.latest]}>
              <View style={styles.titleRow}>
                <Text style={styles.value}>Version {i + 1}</Text>
                {latest && !v.voided ? <Badge label="Current" tone="positive" /> : null}
                {latest && v.voided ? <Badge label="Voided" tone="negative" /> : null}
                {!latest ? <Badge label="Replaced by an edit" /> : null}
              </View>
              {prev ? (
                changes.map(([label, f]) => (
                  <Text key={label} style={text.bodySmall}>
                    {label}: <Text style={styles.struck}>{f(prev)}</Text> → <Text style={styles.value}>{f(v)}</Text>
                  </Text>
                ))
              ) : (
                <Text style={text.bodySmall}>
                  {signedAmount(v)} · {entryKindLabel(v, lookup)} · {accountChipText(v, lookup)} · {fullDate(v.occurredOn)}
                  {v.note ? ` · ${v.note}` : ""}
                </Text>
              )}
            </View>
          );
        })}
    </View>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  gap: { gap: spacing[3] },
  flex: { flex: 1 },
  actions: { flexDirection: "row", gap: spacing[2], flexWrap: "wrap" },
  summary: { gap: spacing[2], borderRadius: radius.md, backgroundColor: colors.canvas, padding: spacing[4] },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], flexWrap: "wrap" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing[3] },
  value: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.sm, color: colors.ink, flexShrink: 1, textAlign: "right" },
  struck: { textDecorationLine: "line-through", color: colors.muted },
  voidForm: { gap: spacing[3], borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing[3] },
  version: { gap: spacing[1], borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing[3] },
  latest: { borderColor: colors.lineStrong },
});
