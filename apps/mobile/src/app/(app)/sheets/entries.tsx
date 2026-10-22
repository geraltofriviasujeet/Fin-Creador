import { type IncomeEntryItem, type IncomePageData, voidIncome } from "@fin-creador/api";
import { isInRange, yearRange } from "@fin-creador/domain";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { IncomeGate } from "@/components/income/income-gate";
import { Sheet } from "@/components/income/sheet";
import { TextField } from "@/components/text-field";
import { money, param, shortDate } from "@/lib/income-format";
import { useIncome } from "@/lib/income-store";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { colors, fontFamily, fontSize, radius, spacing, text } from "@/theme";

/** This year's entries for one source, with a one-way void. */
export default function EntriesSheet() {
  const sourceId = param(useLocalSearchParams<{ sourceId?: string }>().sourceId);
  const { state } = useIncome();
  const name = state.status === "ready" ? state.data.sources.find((s) => s.id === sourceId)?.name : undefined;
  return (
    <Sheet eyebrow="Income this year" title={name ?? "Source"}>
      <IncomeGate>{(data) => <Entries data={data} sourceId={sourceId} />}</IncomeGate>
    </Sheet>
  );
}

function Entries({ data, sourceId }: { data: IncomePageData; sourceId: string }) {
  const [voiding, setVoiding] = useState<string | null>(null)
  const year = yearRange(data.today);
  const entries = data.entries.filter((e) => e.sourceId === sourceId && isInRange(e.occurredOn, year));
  const label = (id: string) => data.accounts.find((a) => a.id === id)?.label ?? "Account";

  if (entries.length === 0) return <Text style={text.bodySmall}>No income from this source this year.</Text>;

  return (
    <View style={styles.list}>
      {entries.map((e) => (
        <View key={e.id} style={styles.entry}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={text.label}>{shortDate(e.occurredOn)}</Text>
              <Text style={text.caption}>{label(e.accountId)}</Text>
              {e.note ? <Text style={text.caption}>{e.note}</Text> : null}
            </View>
            <View style={styles.right}>
              <Text style={e.voided ? styles.voidedAmount : styles.amount}>+{money(e.amountMinor, e.currency)}</Text>
              {e.voided ? (
                <Badge label={`Voided${e.voidReason ? `: ${e.voidReason}` : ""}`} />
              ) : voiding !== e.id ? (
                <Button label="Void" variant="ghost" onPress={() => setVoiding(e.id)} />
              ) : null}
            </View>
          </View>
          {voiding === e.id ? <VoidForm entry={e} onCancel={() => setVoiding(null)} /> : null}
        </View>
      ))}
    </View>
  );
}

function VoidForm({ entry, onCancel }: { entry: IncomeEntryItem; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const { save, busy, fieldErrors, formError } = useSave();
  return (
    <View style={styles.voidForm}>
      <Text style={text.bodySmall}>Void this income? It stays in history but no longer counts. This can’t be undone.</Text>
      {formError ? <FormMessage tone="error" message={formError} /> : null}
      <TextField label="Reason" hint="Optional" value={reason} onChangeText={setReason} maxLength={200} error={fieldErrors.reason} />
      <View style={styles.buttons}>
        <Button label="Keep it" variant="secondary" onPress={onCancel} />
        <Button
          label="Void income"
          loading={busy}
          onPress={() => void save(() => voidIncome(getSupabase(), { transactionId: entry.id, reason }), { close: false }).then((r) => r.status === "success" && onCancel())}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing[2] },
  entry: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing[3], gap: spacing[3] },
  row: { flexDirection: "row", gap: spacing[3] },
  flex: { flex: 1, gap: 2 },
  right: { alignItems: "flex-end", gap: spacing[1] },
  amount: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.sm, color: colors.success },
  voidedAmount: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.sm, color: colors.muted, textDecorationLine: "line-through" },
  voidForm: { gap: spacing[3], borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing[3] },
  buttons: { flexDirection: "row", justifyContent: "flex-end", gap: spacing[2] },
});
