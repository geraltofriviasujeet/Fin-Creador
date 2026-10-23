import {
  type EntryType,
  type LedgerItem,
  type TransactionsContext,
  balancesWithout,
  fullDate,
  loadEntry,
  money,
  newRequestKey,
  previewDraft,
  saveTransaction,
} from "@fin-creador/api";
import { minorToInputString, parseAmount } from "@fin-creador/domain";
import { PAYMENT_MODES } from "@fin-creador/schemas";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
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
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { colors, fontFamily, fontSize, radius, spacing, text } from "@/theme";

const TYPES = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
] as const;

const isType = (v: string): v is EntryType => v === "expense" || v === "income" || v === "transfer";

/**
 * Add transaction (bottom sheet, design-spec §6) for expenses, income and transfers, or
 * Edit (with `id`): same fields and rules as the web form, saved through the shared writer.
 */
export default function TransactionSheet() {
  const params = useLocalSearchParams<{ type?: string; id?: string; accountId?: string }>();
  const id = param(params.id);
  const initialType = param(params.type);
  const [type, setType] = useState<EntryType>(isType(initialType) ? initialType : "expense");
  const [editing, setEditing] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; entry: LedgerItem } | null>(
    id ? { status: "loading" } : null
  );

  useEffect(() => {
    if (!id) return;
    let active = true;
    loadEntry(getSupabase(), id)
      .then((entry) => active && setEditing(entry && !entry.voided ? { status: "ready", entry } : { status: "error" }))
      .catch(() => active && setEditing({ status: "error" }));
    return () => {
      active = false;
    };
  }, [id]);

  const noun = editing?.status === "ready" ? editing.entry.type : type;
  return (
    <Sheet eyebrow={id ? "Edit transaction" : "New transaction"} title={`${id ? "Edit" : "Add"} ${noun}`}>
      <TransactionsGate>
        {(data) =>
          editing?.status === "loading" ? (
            <ActivityIndicator color={colors.ink} />
          ) : editing?.status === "error" ? (
            <FormMessage tone="error" message="We couldn't open this entry. It may have been changed or voided. Pull to refresh the list and try again." />
          ) : (
            <TransactionForm
              key={editing?.status === "ready" ? editing.entry.id : "new"}
              data={data}
              type={editing?.status === "ready" ? editing.entry.type : type}
              editing={editing?.status === "ready" ? editing.entry : null}
              presetAccountId={param(params.accountId)}
              onTypeChange={setType}
            />
          )
        }
      </TransactionsGate>
    </Sheet>
  );
}

function TransactionForm({
  data,
  type,
  editing,
  presetAccountId,
  onTypeChange,
}: {
  data: TransactionsContext;
  type: EntryType;
  editing: LedgerItem | null;
  presetAccountId: string;
  onTypeChange: (type: EntryType) => void;
}) {
  const router = useRouter();
  const { today } = data;
  // Archived accounts and categories can't be chosen for new entries; an edit may keep its own.
  const accounts = data.accounts.filter((a) => !a.archived || a.id === editing?.accountId || a.id === editing?.counterAccountId);
  const categories = data.categories.filter((c) => c.kind === type && (!c.archived || c.id === editing?.categoryId));
  const usable = (id: string | null | undefined) => (id && accounts.some((a) => a.id === id) ? id : "");

  // One key per opened form; kept on retry after a failure, so the entry is saved once.
  const [requestKey] = useState(newRequestKey);
  const [amount, setAmount] = useState(editing ? minorToInputString(editing.amountMinor, editing.currency) : "");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [occurredOn, setOccurredOn] = useState(editing?.occurredOn ?? today);
  // Fast entry: a preset account ("Received cash as income?"), else the latest expense's account, else the only one.
  const [accountId, setAccountId] = useState(
    editing?.accountId ??
      (usable(presetAccountId) ||
        (type === "expense" ? usable(data.lastExpenseAccountId) : "") ||
        (accounts.length === 1 ? accounts[0]!.id : ""))
  );
  const [accountTouched, setAccountTouched] = useState(Boolean(editing || presetAccountId));
  const [counterAccountId, setCounterAccountId] = useState(editing?.counterAccountId ?? "");
  const [paymentMode, setPaymentMode] = useState<string>(editing?.paymentMode ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const { save, busy, fieldErrors, formError } = useSave();

  if (!editing && accounts.filter((a) => !a.archived).length === 0) {
    return (
      <View style={styles.gap}>
        <FormMessage tone="info" message="Add an account first, so we know where the money moves." />
        <Button label="Add an account" onPress={() => router.replace({ pathname: "/sheets/account", params: { kind: "bank" } })} />
      </View>
    );
  }

  const account = accounts.find((a) => a.id === accountId);
  const counter = accounts.find((a) => a.id === counterAccountId);
  const parsed = parseAmount(amount, account?.currency ?? data.currency);
  const preview = previewDraft({
    type,
    amountMinor: parsed.ok ? parsed.minor : null,
    occurredOn,
    account,
    counter,
    balances: balancesWithout(data.accounts, editing),
  });
  const accountOptions = (exclude?: string) => [
    { value: "", label: "Choose an account" },
    ...accounts.filter((a) => a.id !== exclude).map((a) => ({ value: a.id, label: `${a.label}${a.archived ? " (archived)" : ""}` })),
  ];
  const noun = type === "income" ? "income" : type;

  return (
    <View style={styles.gap}>
      <Segmented
        label="Transaction type"
        options={TYPES}
        value={type}
        onChange={(next) => {
          setCategoryId(""); // categories belong to one type
          onTypeChange(next);
        }}
        disabled={Boolean(editing)}
      />
      {editing ? <Text style={text.caption}>The type can&apos;t change. To turn this into another type, void it and add a new entry.</Text> : null}

      {formError ? <FormMessage tone="error" message={formError} /> : null}

      <TextField
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        error={fieldErrors.amount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        hint={account ? `In ${account.currency}` : undefined}
        autoFocus={!editing}
      />
      {type === "transfer" ? (
        <SelectField label="From" value={accountId} options={accountOptions()} onChange={setAccountId} error={fieldErrors.accountId} searchPlaceholder="Search accounts" />
      ) : (
        <SelectField
          label={type === "income" ? "Source" : "Category"}
          value={categoryId}
          options={[
            { value: "", label: type === "income" ? "Choose a source" : "Choose a category" },
            ...categories.map((c) => ({ value: c.id, label: `${c.name}${c.archived ? " (archived)" : ""}` })),
          ]}
          onChange={(id) => {
            setCategoryId(id);
            // An income source's usual account, unless the person already picked one.
            const fallback = data.categories.find((c) => c.id === id)?.defaultAccountId;
            if (!accountTouched && fallback && accounts.some((a) => a.id === fallback && !a.archived)) setAccountId(fallback);
          }}
          error={fieldErrors.categoryId}
          searchPlaceholder={type === "income" ? "Search sources" : "Search categories"}
        />
      )}
      <DateField label="Date" value={occurredOn} max={today} onChange={setOccurredOn} error={fieldErrors.occurredOn} />
      {type === "transfer" ? (
        <SelectField
          label="To"
          value={counterAccountId}
          options={accountOptions(accountId)}
          onChange={setCounterAccountId}
          error={fieldErrors.counterAccountId}
          searchPlaceholder="Search accounts"
        />
      ) : (
        <SelectField
          label={type === "income" ? "Received into" : "Paid from"}
          value={accountId}
          options={accountOptions()}
          onChange={(id) => {
            setAccountId(id);
            setAccountTouched(true);
          }}
          error={fieldErrors.accountId}
          searchPlaceholder="Search accounts"
        />
      )}
      {type === "expense" && account?.kind === "bank" ? (
        <SelectField
          label="Payment mode (optional)"
          value={paymentMode}
          options={[{ value: "", label: "Not specified" }, ...PAYMENT_MODES.map((m) => ({ value: m.value, label: m.label }))]}
          onChange={setPaymentMode}
          hint="A label only. The account above is what changes."
          error={fieldErrors.paymentMode}
          searchPlaceholder="Search payment modes"
        />
      ) : null}

      {preview.beforeOpening.map((a) => (
        <FormMessage
          key={a.id}
          tone="info"
          message={`This ${noun} is before the opening balance date of ${a.label} (${fullDate(a.openingBalanceDate)}), so it doesn't change that balance.`}
        />
      ))}
      {preview.moves.length > 0 ? (
        <View style={styles.preview} accessibilityLiveRegion="polite">
          {preview.moves.map((m) => (
            <Text key={m.account.id} style={text.caption}>
              <Text style={styles.previewAccount}>{m.account.label}</Text>: {money(m.before, m.account.currency)} →{" "}
              <Text style={m.after < 0 ? styles.negative : styles.previewAccount}>{money(m.after, m.account.currency)}</Text>
            </Text>
          ))}
          {type === "transfer" ? <Text style={text.caption}>A transfer moves money between your accounts. It isn&apos;t income or an expense.</Text> : null}
        </View>
      ) : null}
      {preview.goesNegative ? (
        <FormMessage
          tone="info"
          message={`This takes ${preview.goesNegative.account.label} below zero. Check the amount, or record the cash you received first. You can still save it.`}
        />
      ) : null}

      <TextField
        label="Note"
        value={note}
        onChangeText={setNote}
        placeholder={type === "transfer" ? "e.g. ATM withdrawal" : "What was this for?"}
        maxLength={280}
        error={fieldErrors.note}
      />

      <Button
        label={editing ? "Save changes" : `Save ${noun}`}
        fullWidth
        loading={busy}
        onPress={() =>
          void save(() =>
            saveTransaction(getSupabase(), {
              transactionId: editing?.id ?? "",
              type,
              amount,
              categoryId: type === "transfer" ? "" : categoryId,
              accountId,
              counterAccountId: type === "transfer" ? counterAccountId : "",
              paymentMode: type === "expense" ? paymentMode : "",
              occurredOn,
              note,
              idempotencyKey: requestKey,
            }).catch(() => ({ status: "error" as const, message: NETWORK_ERROR }))
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing[4] },
  preview: { gap: spacing[1], borderRadius: radius.md, backgroundColor: colors.canvas, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  previewAccount: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.xs, color: colors.ink },
  negative: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.xs, color: colors.danger },
});
