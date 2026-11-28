import {
  type LedgerCategory,
  type TransactionsContext,
  balancesWithout,
  fullDate,
  loadHomeData,
  newRequestKey,
  previewDraft,
  saveTransaction,
} from "@fin-creador/api";
import { type SafeToSpendBill, parseAmount, runsShortAfterDraft } from "@fin-creador/domain";
import { PAYMENT_MODES } from "@fin-creador/schemas";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarDays, Check, LayoutGrid, NotebookPen, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AccountPicker, AccountRow } from "@/components/add/account-picker";
import { AmountInput, BottomSheet, Button, CategoryTile, Chip, IconTile, NumberKeypad, SegmentedControl, WarningBanner, applyKeypadKey } from "@/components/ds";
import { FormMessage } from "@/components/form-message";
import { DateField } from "@/components/income/date-field";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { TransactionsGate } from "@/components/transactions/transactions-gate";
import { categoryIcon } from "@/components/transactions/entry-icon";
import { ADD_TYPES, type AddType, accountRowLabel, categoryTiles, draftMoves, isAddType, runsShortText, saveLabel } from "@/lib/add-entry";
import { param } from "@/lib/income-format";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { dsText, fontFamily, mobile, spacing } from "@/theme";

// Full-screen Add for new entries (Sprint 13b PR 2; design-spec §5 "Add"; decisions log
// 2026-11-24): Expense / Income / Transfer, a large amount typed on the ds keypad, category
// tiles (the person's own order, last-used first, then More), the account row with its balance
// before → after and the runs-short warning (Home's rule on the balance after the draft,
// informational), Today and Add a note, one primary "Save ₹X expense". Saved through the same
// shared writer and request key as the web, so a retry saves once; a failed save (offline
// included) keeps everything typed. Opened from the ＋, Home's quick actions, Income, Cash and
// Activity. Editing and recurring confirm stay on sheets/transaction until PR 3.

export default function AddScreen() {
  const params = useLocalSearchParams<{ type?: string; accountId?: string }>();
  const initial = param(params.type);
  const [type, setType] = useState<AddType>(isAddType(initial) ? initial : "expense");
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView style={[styles.screen, { paddingTop: insets.top }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          hitSlop={4}
          style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
        >
          <X size={20} color={mobile.colors.ink} />
        </Pressable>
        <Text accessibilityRole="header" style={[dsText.cardTitle, styles.title]}>
          {`Add ${type}`}
        </Text>
        <View style={styles.close} />
      </View>
      <View style={styles.segment}>
        <SegmentedControl label="Entry type" options={ADD_TYPES} value={type} onChange={setType} />
      </View>
      <View style={[styles.flex, styles.gatePad]}>
        <TransactionsGate>{(data) => <AddForm data={data} type={type} presetAccountId={param(params.accountId)} bottomInset={insets.bottom} />}</TransactionsGate>
      </View>
    </KeyboardAvoidingView>
  );
}

/** The window's bills from Home's loader, for the runs-short warning; without them Add works with no warning. */
function useBills(): SafeToSpendBill[] | null {
  const [bills, setBills] = useState<SafeToSpendBill[] | null>(null);
  useEffect(() => {
    let active = true;
    loadHomeData(getSupabase())
      .then((r) => active && r.ok && setBills(r.data.safe.bills))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return bills;
}

type Picker = null | "from" | "to" | "category";
type Side = "from" | "to";

function AddForm({ data, type, presetAccountId, bottomInset }: { data: TransactionsContext; type: AddType; presetAccountId: string; bottomInset: number }) {
  const router = useRouter();
  const { today } = data;
  // Archived accounts and categories can't be chosen for new entries.
  const accounts = data.accounts.filter((a) => !a.archived);
  const usable = (id: string | null | undefined) => (id && accounts.some((a) => a.id === id) ? id : "");

  // One key per opened Add; kept on retry after a failure, so the entry is saved once.
  const [requestKey] = useState(newRequestKey);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [pickDate, setPickDate] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // Fast entry: a preset account (Cash's "Add income"), else the latest expense's account, else the only one.
  const [accountId, setAccountId] = useState(
    usable(presetAccountId) || (type === "expense" ? usable(data.lastExpenseAccountId) : "") || (accounts.length === 1 ? accounts[0]!.id : "")
  );
  const [accountTouched, setAccountTouched] = useState(Boolean(presetAccountId));
  const [counterAccountId, setCounterAccountId] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [note, setNote] = useState("");
  const [picker, setPicker] = useState<Picker>(null);
  // The account sheet's side, kept while it slides closed so its title and list don't change.
  const [side, setSide] = useState<Side>("from");
  const openAccounts = (s: Side) => {
    setSide(s);
    setPicker(s);
  };
  const [lastType, setLastType] = useState(type);
  const bills = useBills();
  const { save, busy, fieldErrors, formError } = useSave();

  // Categories belong to one type: switching type clears the choice (the amount and account stay).
  if (lastType !== type) {
    setLastType(type);
    setCategoryId("");
  }

  if (accounts.length === 0) {
    return (
      <View style={styles.empty}>
        <FormMessage tone="info" message="Add an account first, so we know where the money moves." />
        <Button label="Add an account" onPress={() => router.replace({ pathname: "/sheets/account", params: { kind: "bank" } })} />
      </View>
    );
  }

  const account = accounts.find((a) => a.id === accountId);
  const counter = accounts.find((a) => a.id === counterAccountId);
  const currency = account?.currency ?? data.currency;
  const parsed = parseAmount(amount, currency);
  const amountMinor = parsed.ok ? parsed.minor : null;
  const preview = previewDraft({ type, amountMinor, occurredOn, account, counter, balances: balancesWithout(data.accounts, null) });
  const moveFor = (id: string | undefined) => preview.moves.find((m) => m.account.id === id);
  const short = bills ? runsShortAfterDraft(draftMoves(preview.moves), bills) : null;
  const kind = type === "income" ? "income" : "expense";
  const { tiles, more } = categoryTiles(data.categories, kind, { lastUsedId: type === "expense" ? data.lastExpenseCategoryId : null, selectedId: categoryId });
  const allCategories = data.categories.filter((c) => c.kind === kind && !c.archived);
  const tint = type === "income" ? "mint" : "peach";
  const categoryWord = type === "income" ? "Source" : "Category";

  function chooseCategory(c: LedgerCategory) {
    setCategoryId(c.id);
    // An income source's usual account, unless the person already picked one.
    if (!accountTouched && c.defaultAccountId && accounts.some((a) => a.id === c.defaultAccountId)) setAccountId(c.defaultAccountId);
  }

  function submit() {
    void save(() =>
      saveTransaction(getSupabase(), {
        transactionId: "",
        type,
        amount,
        categoryId: type === "transfer" ? "" : categoryId,
        accountId,
        counterAccountId: type === "transfer" ? counterAccountId : "",
        paymentMode: type === "expense" ? paymentMode : "",
        occurredOn,
        note,
        idempotencyKey: requestKey,
      })
    );
  }

  const tileRows = [...tiles.map((c) => ({ c })), ...(more ? [{ c: null }] : [])];

  return (
    <View style={styles.flex}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <AmountInput value={amount} currency={currency} error={fieldErrors.amount} />

        {formError ? <FormMessage tone="error" message={formError} /> : null}

        {type === "transfer" ? null : (
          <View style={styles.section}>
            <Text style={dsText.label}>{categoryWord}</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={categoryWord} style={styles.grid}>
              {tileRows.map(({ c }) =>
                c ? (
                  <View key={c.id} style={styles.cell}>
                    <CategoryTile icon={categoryIcon(c.icon)} tint={tint} label={c.name} selected={c.id === categoryId} onPress={() => chooseCategory(c)} />
                  </View>
                ) : (
                  <View key="more" style={styles.cell}>
                    <CategoryTile icon={LayoutGrid} tint="grey" label="More" onPress={() => setPicker("category")} />
                  </View>
                )
              )}
            </View>
            {fieldErrors.categoryId ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {fieldErrors.categoryId}
              </Text>
            ) : null}
          </View>
        )}

        <AccountRow
          label={accountRowLabel(type, "from")}
          account={account}
          move={moveFor(account?.id)}
          error={fieldErrors.accountId}
          onPress={() => openAccounts("from")}
        />
        {type === "transfer" ? (
          <AccountRow
            label={accountRowLabel(type, "to")}
            account={counter}
            move={moveFor(counter?.id)}
            error={fieldErrors.counterAccountId}
            onPress={() => openAccounts("to")}
          />
        ) : null}

        {preview.beforeOpening.map((a) => (
          <FormMessage
            key={a.id}
            tone="info"
            message={`This ${type} is before the opening balance date of ${a.label} (${fullDate(a.openingBalanceDate)}), so it doesn't change that balance.`}
          />
        ))}
        {preview.goesNegative ? (
          <FormMessage
            tone="info"
            message={`This takes ${preview.goesNegative.account.label} below zero. Check the amount, or record the cash you received first. You can still save it.`}
          />
        ) : null}
        {type === "transfer" ? <Text style={dsText.caption}>A transfer moves money between your accounts. It isn&apos;t income or an expense.</Text> : null}

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

        <View style={styles.chips}>
          <Chip icon={CalendarDays} label={occurredOn === today ? "Today" : fullDate(occurredOn)} selected={pickDate} onPress={() => setPickDate((v) => !v)} />
          {noteOpen ? null : <Chip icon={NotebookPen} label={note ? "Edit note" : "Add a note"} onPress={() => setNoteOpen(true)} />}
        </View>
        {pickDate || fieldErrors.occurredOn ? <DateField label="Date" value={occurredOn} max={today} onChange={setOccurredOn} error={fieldErrors.occurredOn} /> : null}
        {noteOpen || fieldErrors.note ? (
          <TextField
            label="Note"
            value={note}
            onChangeText={setNote}
            placeholder={type === "transfer" ? "e.g. ATM withdrawal" : "What was this for?"}
            maxLength={280}
            error={fieldErrors.note}
            autoFocus={noteOpen && !note}
          />
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomInset + spacing[3] }]}>
        {/* Above the keypad, so it shows as the amount is typed (the rows above may scroll). */}
        {short ? <WarningBanner message={runsShortText(short, moveFor(short.accountId)?.account.currency ?? currency)} /> : null}
        <NumberKeypad onKey={(key) => setAmount((a) => applyKeypadKey(a, key, currency))} disabled={busy} />
        <Button label={saveLabel(type, amountMinor, currency)} fullWidth loading={busy} onPress={submit} />
      </View>

      <AccountPicker
        visible={picker === "from" || picker === "to"}
        title={accountRowLabel(type, side)}
        accounts={side === "to" ? accounts.filter((a) => a.id !== accountId) : accounts}
        selectedId={side === "to" ? counterAccountId : accountId}
        onPick={(id) => {
          if (side === "to") setCounterAccountId(id);
          else {
            setAccountId(id);
            setAccountTouched(true);
            if (id === counterAccountId) setCounterAccountId("");
          }
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <BottomSheet visible={picker === "category"} title={type === "income" ? "All sources" : "All categories"} onClose={() => setPicker(null)}>
        <View accessibilityRole="radiogroup" accessibilityLabel={categoryWord} style={styles.list}>
          {allCategories.map((c) => {
            const selected = c.id === categoryId;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="radio"
                accessibilityLabel={c.name}
                aria-checked={selected}
                aria-selected={selected}
                onPress={() => {
                  chooseCategory(c);
                  setPicker(null);
                }}
                style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
              >
                <IconTile icon={categoryIcon(c.icon)} tint={tint} size={36} />
                <Text style={[dsText.body, styles.flex, selected && styles.optionSelected]}>{c.name}</Text>
                {selected ? <Check size={20} color={mobile.colors.forest} strokeWidth={2.5} /> : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: mobile.colors.canvas },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  title: { flex: 1, textAlign: "center" },
  close: { width: mobile.tapTarget, height: mobile.tapTarget, borderRadius: mobile.radius.chip, alignItems: "center", justifyContent: "center" },
  closePressed: { backgroundColor: mobile.categoryTints.grey },
  segment: { paddingHorizontal: spacing[4] },
  gatePad: { paddingTop: spacing[1] },
  body: { paddingHorizontal: spacing[4], paddingBottom: spacing[4], gap: spacing[3] },
  empty: { padding: spacing[4], gap: spacing[3] },
  section: { gap: spacing[2] },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -spacing[1] },
  cell: { width: "25%", padding: spacing[1] },
  error: { ...dsText.caption, color: mobile.colors.warning, fontFamily: fontFamily.bodySemibold },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  footer: { gap: spacing[3], paddingHorizontal: spacing[4], paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: mobile.colors.line, backgroundColor: mobile.colors.canvas },
  list: { gap: spacing[1] },
  option: { flexDirection: "row", alignItems: "center", gap: spacing[3], minHeight: 52, paddingHorizontal: spacing[2], borderRadius: mobile.radius.tile },
  optionPressed: { backgroundColor: mobile.colors.canvas },
  optionSelected: { fontFamily: fontFamily.bodyBold },
});
