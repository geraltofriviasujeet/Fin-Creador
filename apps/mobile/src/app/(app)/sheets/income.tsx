import { type IncomePageData, newRequestKey, recordIncome } from "@fin-creador/api";
import { countsTowardBalance } from "@fin-creador/domain";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { DateField } from "@/components/income/date-field";
import { IncomeGate } from "@/components/income/income-gate";
import { Sheet } from "@/components/income/sheet";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { shortDate } from "@/lib/income-format";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { colors, fontFamily, fontSize, radius, spacing } from "@/theme";

/** Add income (design-spec §9): amount, source, date, "Received into", note. */
export default function AddIncomeSheet() {
  return (
    <Sheet eyebrow="New transaction" title="Add income">
      <IncomeGate>{(data) => <IncomeForm data={data} />}</IncomeGate>
    </Sheet>
  );
}

function IncomeForm({ data }: { data: IncomePageData }) {
  const router = useRouter();
  const accounts = data.accounts.filter((a) => !a.archived);
  const sources = data.sources.filter((s) => !s.archived);
  // One key for this opened sheet: kept on retry after a failure, so the income is saved
  // once; a new sheet (after a successful save) gets a new key.
  const [requestKey] = useState(newRequestKey);
  const [amount, setAmount] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0]!.id : "");
  const [accountTouched, setAccountTouched] = useState(false);
  const [occurredOn, setOccurredOn] = useState(data.today);
  const [note, setNote] = useState("");
  const { save, busy, fieldErrors, formError } = useSave();

  if (accounts.length === 0) {
    return (
      <View style={styles.gap}>
        <FormMessage tone="info" message="Add an account first, so we know where the money was received." />
        <Button label="Add an account" onPress={() => router.replace({ pathname: "/sheets/account", params: { kind: "bank" } })} />
      </View>
    );
  }

  const account = accounts.find((a) => a.id === accountId);
  const beforeOpening = account && !countsTowardBalance(occurredOn, account.openingBalanceDate);

  return (
    <View style={styles.gap}>
      <View style={styles.segment} accessibilityRole="tablist">
        <View style={styles.segmentItem} accessibilityState={{ disabled: true }} accessibilityLabel="Expense, coming soon">
          <Text style={styles.segmentMuted}>Expense</Text>
          <Badge label="Soon" tone="info" />
        </View>
        <View style={[styles.segmentItem, styles.segmentActive]} accessibilityState={{ selected: true }}>
          <Text style={styles.segmentActiveText}>Income</Text>
        </View>
      </View>

      {formError ? <FormMessage tone="error" message={formError} /> : null}

      <TextField
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        error={fieldErrors.amount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        hint={account ? `In ${account.currency}` : undefined}
      />
      <SelectField
        label="Category"
        value={sourceId}
        options={[{ value: "", label: "Choose a source" }, ...sources.map((s) => ({ value: s.id, label: s.name }))]}
        onChange={(id) => {
          setSourceId(id);
          const fallback = sources.find((s) => s.id === id)?.defaultAccountId;
          if (!accountTouched && fallback && accounts.some((a) => a.id === fallback)) setAccountId(fallback);
        }}
        error={fieldErrors.sourceId}
        searchPlaceholder="Search sources"
      />
      <DateField label="Date" value={occurredOn} max={data.today} onChange={setOccurredOn} error={fieldErrors.occurredOn} />
      <SelectField
        label="Received into"
        value={accountId}
        options={[{ value: "", label: "Choose an account" }, ...accounts.map((a) => ({ value: a.id, label: a.label }))]}
        onChange={(id) => {
          setAccountId(id);
          setAccountTouched(true);
        }}
        error={fieldErrors.accountId}
        searchPlaceholder="Search accounts"
      />
      {beforeOpening ? (
        <FormMessage
          tone="info"
          message={`This counts as income, but not toward the balance: it's before the opening balance date (${shortDate(account.openingBalanceDate)}).`}
        />
      ) : null}
      <TextField label="Note" value={note} onChangeText={setNote} placeholder="What was this for?" maxLength={280} error={fieldErrors.note} />

      <Button
        label="Save income"
        fullWidth
        loading={busy}
        onPress={() =>
          void save(() => recordIncome(getSupabase(), { amount, sourceId, accountId, occurredOn, note, idempotencyKey: requestKey }))
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing[4] },
  segment: { flexDirection: "row", gap: spacing[1], padding: spacing[1], borderRadius: radius.md, backgroundColor: colors.canvas },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: radius.control, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[2] },
  segmentActive: { backgroundColor: colors.ink },
  segmentMuted: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.sm, color: colors.muted },
  segmentActiveText: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.sm, color: colors.surface },
});
