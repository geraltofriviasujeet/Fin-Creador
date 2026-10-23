import { type EntryType, type RecurringItem, type TransactionsContext, newRequestKey, saveRecurringRule, setRecurringRuleArchived } from "@fin-creador/api";
import { FREQUENCIES, type Frequency, anchorDayMayMove, minorToInputString, scheduleText } from "@fin-creador/domain";
import { PAYMENT_MODES } from "@fin-creador/schemas";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Archive } from "lucide-react-native";
import { useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { DateField } from "@/components/income/date-field";
import { Sheet } from "@/components/income/sheet";
import { Segmented } from "@/components/segmented";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { TransactionsGate } from "@/components/transactions/transactions-gate";
import { NETWORK_ERROR } from "@/lib/income-store";
import { param } from "@/lib/income-format";
import { useRecurringItem } from "@/lib/recurring";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { TOUCH_TARGET, colors, spacing, text } from "@/theme";

const TYPES = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
] as const;

/** Add a recurring item, or edit / fix / archive one (with `id`). Same rules as the web form. */
export default function RecurringRuleSheet() {
  const id = param(useLocalSearchParams<{ id?: string }>().id);
  const item = useRecurringItem(id);
  return (
    <Sheet eyebrow="Recurring" title={id ? "Edit recurring" : "Add recurring"}>
      <TransactionsGate>
        {(data) =>
          id && !item ? (
            <FormMessage tone="error" message="We couldn't find this recurring item. Pull to refresh the list and try again." />
          ) : (
            <RuleForm key={item?.rule.id ?? "new"} data={data} item={item} />
          )
        }
      </TransactionsGate>
    </Sheet>
  );
}

function RuleForm({ data, item }: { data: TransactionsContext; item: RecurringItem | null }) {
  const router = useRouter();
  const rule = item?.rule;
  const editing = Boolean(rule);
  // One key per opened sheet; kept on retry after a failure, so the rule is added once.
  const [requestKey] = useState(newRequestKey);
  const [type, setType] = useState<EntryType>(rule?.type ?? "expense");
  const [amount, setAmount] = useState(rule ? minorToInputString(rule.amountMinor, rule.currency) : "");
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? "");
  const [accountId, setAccountId] = useState(rule?.accountId ?? "");
  const [counterAccountId, setCounterAccountId] = useState(rule?.counterAccountId ?? "");
  const [paymentMode, setPaymentMode] = useState<string>(rule?.paymentMode ?? "");
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? "monthly");
  const [startDate, setStartDate] = useState(rule?.startDate ?? data.today);
  const [hasEnd, setHasEnd] = useState(Boolean(rule?.endDate));
  const [endDate, setEndDate] = useState(rule?.endDate ?? data.today);
  const [note, setNote] = useState(rule?.note ?? "");
  const { save, busy, fieldErrors, formError } = useSave();

  // New choices can't be archived; an edit may keep the archived one it has (it then still needs attention).
  const accounts = data.accounts.filter((a) => !a.archived || a.id === rule?.accountId || a.id === rule?.counterAccountId);
  const categories = data.categories.filter((c) => c.kind === type && (!c.archived || c.id === rule?.categoryId));
  const account = data.accounts.find((a) => a.id === accountId);
  const accountOptions = (exclude?: string) => [
    { value: "", label: "Choose an account" },
    ...accounts.filter((a) => a.id !== exclude).map((a) => ({ value: a.id, label: `${a.label}${a.archived ? " (archived)" : ""}` })),
  ];

  const archive = () =>
    Alert.alert("Archive this recurring item?", "It stops showing under Upcoming and leaves the cost totals. Entries it already saved stay. You can restore it later.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        style: "destructive",
        onPress: () =>
          void save(() => setRecurringRuleArchived(getSupabase(), { ruleId: rule!.id, archived: true }).catch(() => ({ status: "error" as const, message: NETWORK_ERROR }))),
      },
    ]);

  return (
    <View style={styles.gap}>
      {item?.attention ? <FormMessage tone="error" message={item.attention} /> : null}
      {formError ? <FormMessage tone="error" message={formError} /> : null}
      <Segmented
        label="Type"
        options={TYPES}
        value={type}
        disabled={editing}
        onChange={(t) => {
          setType(t);
          setCategoryId("");
        }}
      />
      <TextField label="Amount" value={amount} onChangeText={setAmount} error={fieldErrors.amount} keyboardType="decimal-pad" placeholder="0.00" hint="You can change it each time you confirm." autoFocus={!editing} />
      {type === "transfer" ? (
        <>
          <SelectField label="From" value={accountId} options={accountOptions()} onChange={setAccountId} error={fieldErrors.accountId} searchPlaceholder="Search accounts" />
          <SelectField label="To" value={counterAccountId} options={accountOptions(accountId)} onChange={setCounterAccountId} error={fieldErrors.counterAccountId} searchPlaceholder="Search accounts" />
        </>
      ) : (
        <>
          <SelectField
            label={type === "income" ? "Source" : "Category"}
            value={categoryId}
            options={[
              { value: "", label: type === "income" ? "Choose a source" : "Choose a category" },
              ...categories.map((c) => ({ value: c.id, label: `${c.name}${c.archived ? " (archived)" : ""}` })),
            ]}
            onChange={setCategoryId}
            error={fieldErrors.categoryId}
            searchPlaceholder={type === "income" ? "Search sources" : "Search categories"}
          />
          <SelectField label={type === "income" ? "Received into" : "Paid from"} value={accountId} options={accountOptions()} onChange={setAccountId} error={fieldErrors.accountId} searchPlaceholder="Search accounts" />
        </>
      )}
      {type === "expense" && account?.kind === "bank" ? (
        <SelectField
          label="Payment mode (optional)"
          value={paymentMode}
          options={[{ value: "", label: "Not specified" }, ...PAYMENT_MODES.map((m) => ({ value: m.value, label: m.label }))]}
          onChange={setPaymentMode}
          error={fieldErrors.paymentMode}
          searchPlaceholder="Search payment modes"
        />
      ) : null}
      {editing ? (
        <Text style={text.caption}>
          {scheduleText(rule!)}, from {rule!.startDate}. To change how often or when it starts, end this one and add a new one.
        </Text>
      ) : (
        <>
          <SelectField
            label="Repeats"
            value={frequency}
            options={FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))}
            onChange={(v) => setFrequency(v as Frequency)}
            error={fieldErrors.frequency}
            searchPlaceholder="Search"
          />
          <DateField label="Starts on" value={startDate} max="2099-12-31" onChange={setStartDate} error={fieldErrors.startDate} />
        </>
      )}
      <View style={styles.switchRow}>
        <Text style={text.body}>Has an end date</Text>
        <Switch value={hasEnd} onValueChange={setHasEnd} accessibilityLabel="Has an end date" trackColor={{ true: colors.ink, false: colors.lineStrong }} thumbColor={colors.surface} />
      </View>
      {hasEnd ? <DateField label="Ends on" value={endDate} max="2099-12-31" onChange={setEndDate} error={fieldErrors.endDate} /> : null}
      {!editing ? (
        <Text style={text.caption}>
          {scheduleText({ frequency, startDate })}
          {anchorDayMayMove({ frequency, startDate }) ? ", or the month's last day when it is shorter" : ""}. Nothing is saved by itself: each one shows under Upcoming for you to confirm.
        </Text>
      ) : null}
      <TextField label="Note" value={note} onChangeText={setNote} placeholder="e.g. Flat rent" maxLength={280} error={fieldErrors.note} />

      <Button
        label={editing ? "Save changes" : "Add recurring"}
        fullWidth
        loading={busy}
        onPress={() =>
          void save(() =>
            saveRecurringRule(getSupabase(), {
              ruleId: rule?.id ?? "",
              type,
              amount,
              categoryId: type === "transfer" ? "" : categoryId,
              accountId,
              counterAccountId: type === "transfer" ? counterAccountId : "",
              paymentMode: type === "expense" ? paymentMode : "",
              frequency: rule?.frequency ?? frequency,
              startDate: rule?.startDate ?? startDate,
              endDate: hasEnd ? endDate : "",
              note,
              idempotencyKey: editing ? "" : requestKey,
            }).catch(() => ({ status: "error" as const, message: NETWORK_ERROR }))
          )
        }
      />
      {editing && !rule!.archived ? <Button label="Archive" variant="secondary" icon={Archive} onPress={archive} /> : null}
      {editing ? <Button label="Cancel" variant="ghost" onPress={() => router.back()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing[4] },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: TOUCH_TARGET },
});
