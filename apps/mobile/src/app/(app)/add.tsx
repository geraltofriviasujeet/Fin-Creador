import {
  type EntryType,
  type LedgerCategory,
  type LedgerItem,
  type RecurringItem,
  type TransactionsContext,
  balancesWithout,
  cardLimitNote,
  confirmRecurringOccurrence,
  fullDate,
  loadEntry,
  loadHomeData,
  newRequestKey,
  previewDraft,
  saveTransaction,
} from "@fin-creador/api";
import { type SafeToSpendBill, minorToInputString, parseAmount, runsShortAfterDraft } from "@fin-creador/domain";
import { PAYMENT_MODES } from "@fin-creador/schemas";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarDays, Check, Info, LayoutGrid, NotebookPen, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AccountPicker, AccountRow } from "@/components/add/account-picker";
import { AmountInput, BottomSheet, Button, CategoryTile, Chip, IconTile, NumberKeypad, SegmentedControl, WarningBanner, applyKeypadKey } from "@/components/ds";
import { FormMessage } from "@/components/form-message";
import { DateField } from "@/components/income/date-field";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { TransactionsGate } from "@/components/transactions/transactions-gate";
import { categoryIcon } from "@/components/transactions/entry-icon";
import {
  ADD_TYPES,
  type AddType,
  accountRowLabel,
  billsWithout,
  categoryTiles,
  draftMoves,
  isAddType,
  noteChipLabel,
  runsShortText,
  saveLabel,
  takesCard,
} from "@/lib/add-entry";
import { param } from "@/lib/income-format";
import { useRecurringItem } from "@/lib/recurring";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { dsText, fontFamily, mobile, spacing } from "@/theme";

// Full-screen Add (Sprint 13b PRs 2–3; design-spec §5 "Add"; decisions log 2026-11-24 and
// 2026-11-28): Expense / Income / Transfer, a large amount typed on the ds keypad, category
// tiles (the person's own order, last-used first, then More), the account row with its balance
// before → after and the runs-short warning (Home's rule on the balance after the draft,
// informational), Today and Add a note right above the keypad, one primary "Save ₹X expense".
// The same screen edits an entry (`id`: its type is locked, "Save changes") and confirms a due
// recurring item (`ruleId`: its type and category are set by the rule). Saved through the same
// shared writers and request key as the web, so a retry saves once; a failed save (offline
// included) keeps everything typed. Credit cards are offered as "Paid from" for expenses (and as
// "Refunded to" on a refund's edit), as on the web: what is owed before → after, the 80% / over
// limit note, never the runs-short warning.

type Editing = { status: "loading" } | { status: "error" } | { status: "ready"; entry: LedgerItem } | null;

export default function AddScreen() {
  const params = useLocalSearchParams<{ type?: string; accountId?: string; id?: string; ruleId?: string }>();
  const id = param(params.id);
  // Confirming a recurring item's due date (from the Recurring screen).
  const ruleId = param(params.ruleId);
  const recurring = useRecurringItem(ruleId);
  const initial = param(params.type);
  const [newType, setNewType] = useState<AddType>(isAddType(initial) ? initial : "expense");
  const [editing, setEditing] = useState<Editing>(id ? { status: "loading" } : null);
  const router = useRouter();
  const insets = useSafeAreaInsets();

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

  const entry = editing?.status === "ready" ? editing.entry : null;
  const type: EntryType = entry?.type ?? (ruleId ? (recurring?.rule.type ?? newType) : newType);
  // An edit or a recurring confirm can't change type (the web's rule).
  const locked = Boolean(id || ruleId);
  const title = id ? `Edit ${type}` : `Add ${type}`;
  const eyebrow = ruleId && recurring?.date ? `Recurring · ${fullDate(recurring.date)}` : null;

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
        <View style={styles.titleWrap}>
          {eyebrow ? <Text style={[dsText.caption, styles.center]}>{eyebrow}</Text> : null}
          <Text accessibilityRole="header" style={[dsText.cardTitle, styles.center]}>
            {title}
          </Text>
        </View>
        <View style={styles.close} />
      </View>
      <View style={styles.segment}>
        {/* An edit or a recurring confirm can't change type: one line instead of the type switch,
            so the account row stays on screen above the keypad. */}
        {locked ? (
          <Text style={[dsText.caption, styles.lockNote]}>
            {id ? "The type can't change. To change it, void this and add a new entry." : "The type is set by the recurring item."}
          </Text>
        ) : (
          <SegmentedControl label="Entry type" options={ADD_TYPES} value={newType} onChange={setNewType} />
        )}
      </View>
      <View style={[styles.flex, styles.gatePad]}>
        <TransactionsGate>
          {(data) =>
            ruleId && (!recurring || recurring.kind !== "due") ? (
              <View style={styles.empty}>
                <FormMessage tone="error" message="This recurring item is no longer due. Pull to refresh the list." />
              </View>
            ) : editing?.status === "loading" ? (
              <ActivityIndicator style={styles.loading} color={mobile.colors.ink} accessibilityLabel="Loading the entry" />
            ) : editing?.status === "error" ? (
              <View style={styles.empty}>
                <FormMessage tone="error" message="We couldn't open this entry. It may have been changed or voided. Pull to refresh the list and try again." />
              </View>
            ) : (
              <AddForm
                key={entry?.id ?? recurring?.rule.id ?? "new"}
                data={data}
                type={type}
                editing={entry}
                recurring={ruleId ? recurring : null}
                presetAccountId={param(params.accountId)}
                bottomInset={insets.bottom}
              />
            )
          }
        </TransactionsGate>
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

type Picker = null | "from" | "to" | "category" | "date" | "note";
type Side = "from" | "to";

function AddForm({
  data,
  type,
  editing,
  recurring,
  presetAccountId,
  bottomInset,
}: {
  data: TransactionsContext;
  type: EntryType;
  editing: LedgerItem | null;
  /** A due recurring item: pre-fills the form; its type and category are fixed. */
  recurring: RecurringItem | null;
  presetAccountId: string;
  bottomInset: number;
}) {
  const router = useRouter();
  const { today } = data;
  // Archived accounts and categories can't be chosen for new entries; an edit may keep its own.
  const own = (id: string) => id === editing?.accountId || id === editing?.counterAccountId;
  const accounts = data.accounts.filter((a) => !a.archived || own(a.id));
  const cards = data.cardAccounts.filter((a) => !a.archived || own(a.id));
  const everyAccount = [...data.accounts, ...data.cardAccounts];
  // A card is offered only as the account an expense is paid from (or a refund comes back to).
  const fromAccounts = takesCard(type) ? [...accounts, ...cards] : accounts;
  const usable = (id: string | null | undefined) => (id && fromAccounts.some((a) => a.id === id) ? id : "");

  // One key per opened Add; kept on retry after a failure, so the entry is saved once.
  const [requestKey] = useState(newRequestKey);
  const start = editing ?? recurring?.entry ?? null;
  const [amount, setAmount] = useState(start ? minorToInputString(start.amountMinor, start.currency) : "");
  const [categoryId, setCategoryId] = useState(start?.categoryId ?? "");
  const [occurredOn, setOccurredOn] = useState(start && start.occurredOn <= today ? start.occurredOn : today);
  // Fast entry: a preset account (Cash's "Add income"), else the latest expense's account (a card
  // included), else the only one.
  const [accountId, setAccountId] = useState(
    start?.accountId ??
      (usable(presetAccountId) || (type === "expense" ? usable(data.lastExpenseAccountId) : "") || (accounts.length === 1 ? accounts[0]!.id : ""))
  );
  const [accountTouched, setAccountTouched] = useState(Boolean(editing || presetAccountId));
  const [counterAccountId, setCounterAccountId] = useState(start?.counterAccountId ?? "");
  const [paymentMode, setPaymentMode] = useState<string>(start?.paymentMode ?? "");
  const [note, setNote] = useState(start?.note ?? "");
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

  // Categories belong to one type: switching type clears the choice (the amount and account
  // stay, unless the account is a card and the new type can't take one).
  if (lastType !== type) {
    setLastType(type);
    setCategoryId("");
    if (!takesCard(type) && data.cardAccounts.some((c) => c.id === accountId)) setAccountId("");
  }

  if (!editing && accounts.length === 0 && cards.length === 0) {
    return (
      <View style={styles.empty}>
        <FormMessage tone="info" message="Add an account first, so we know where the money moves." />
        <Button label="Add an account" onPress={() => router.replace({ pathname: "/sheets/account", params: { kind: "bank" } })} />
      </View>
    );
  }

  const account = everyAccount.find((a) => a.id === accountId);
  const counter = everyAccount.find((a) => a.id === counterAccountId);
  const currency = account?.currency ?? data.currency;
  const parsed = parseAmount(amount, currency);
  const amountMinor = parsed.ok ? parsed.minor : null;
  const preview = previewDraft({ type, amountMinor, occurredOn, account, counter, balances: balancesWithout(everyAccount, editing) });
  const moveFor = (id: string | undefined) => preview.moves.find((m) => m.account.id === id);
  const windowBills = bills ? billsWithout(bills, recurring?.rule.id ?? null, recurring?.date ?? null) : null;
  const short = windowBills ? runsShortAfterDraft(draftMoves(preview.moves), windowBills) : null;
  const limitNote = cardLimitNote(preview.moves.find((m) => m.account.kind === "card"));
  // A refund takes an expense category (it lowers that category's spending).
  const kind = type === "income" ? "income" : "expense";
  const { tiles, more } = categoryTiles(data.categories, kind, {
    lastUsedId: type === "expense" && !editing ? data.lastExpenseCategoryId : null,
    selectedId: categoryId,
    keepId: editing?.categoryId,
  });
  const allCategories = data.categories.filter((c) => c.kind === kind && (!c.archived || c.id === editing?.categoryId));
  const fixedCategory = recurring ? data.categories.find((c) => c.id === categoryId) : undefined;
  const tint = type === "income" ? "mint" : "peach";
  const categoryWord = type === "income" ? "Source" : "Category";
  const noun = type;

  function chooseCategory(c: LedgerCategory) {
    setCategoryId(c.id);
    // An income source's usual account, unless the person already picked one.
    if (!accountTouched && c.defaultAccountId && accounts.some((a) => a.id === c.defaultAccountId && !a.archived)) setAccountId(c.defaultAccountId);
  }

  function submit() {
    const counterId = type === "transfer" ? counterAccountId : "";
    const mode = type === "expense" ? paymentMode : "";
    void save(() =>
      recurring
        ? confirmRecurringOccurrence(getSupabase(), {
            ruleId: recurring.rule.id,
            occurrenceDate: recurring.date ?? "",
            type,
            amount,
            occurredOn,
            accountId,
            counterAccountId: counterId,
            paymentMode: mode,
            note,
            idempotencyKey: requestKey,
          })
        : saveTransaction(getSupabase(), {
            transactionId: editing?.id ?? "",
            type,
            amount,
            categoryId: type === "transfer" ? "" : categoryId,
            accountId,
            counterAccountId: counterId,
            paymentMode: mode,
            occurredOn,
            note,
            idempotencyKey: requestKey,
          })
    );
  }

  const tileRows = [...tiles.map((c) => ({ c })), ...(more ? [{ c: null }] : [])];
  const dateNoteError = fieldErrors.occurredOn ?? fieldErrors.note;

  return (
    <View style={styles.flex}>
      {/* The amount sticks to the top while the rows below scroll, so it is always on screen (owner, #105). */}
      <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" stickyHeaderIndices={[0]}>
        <View style={styles.amount}>
          <AmountInput value={amount} currency={currency} error={fieldErrors.amount} />
        </View>

        {formError ? <FormMessage tone="error" message={formError} /> : null}

        {type === "transfer" ? null : fixedCategory ? (
          <View style={styles.section}>
            <Text style={dsText.label}>{categoryWord}</Text>
            <View style={styles.fixed} accessible accessibilityLabel={`${categoryWord}: ${fixedCategory.name}. Set by the recurring item.`}>
              <IconTile icon={categoryIcon(fixedCategory.icon)} tint={tint} size={36} />
              <View style={styles.flex}>
                <Text style={dsText.bodyStrong}>{fixedCategory.name}</Text>
                <Text style={dsText.caption}>Set by the recurring item.</Text>
              </View>
            </View>
          </View>
        ) : (
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
            message={`This ${noun} is before the opening balance date of ${a.label} (${fullDate(a.openingBalanceDate)}), so it doesn't change that balance.`}
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
      </ScrollView>

      <View testID="add-footer" style={[styles.footer, { paddingBottom: bottomInset + spacing[3] }]}>
        {/* Above the keypad, so they show as the amount is typed (the rows above may scroll). */}
        {short ? <WarningBanner message={runsShortText(short, moveFor(short.accountId)?.account.currency ?? currency)} /> : null}
        {/* One short line, so the amount at the top stays on screen at 390×844 (owner, #105). */}
        {limitNote ? (
          <View accessible accessibilityLabel={`${limitNote}. You can still save it.`} style={styles.limitNote}>
            <Info size={16} color={mobile.colors.muted} />
            <Text style={[dsText.caption, styles.flex]} numberOfLines={1}>
              {limitNote}
            </Text>
          </View>
        ) : null}
        {/* Date and note sit right above the keypad: on screen without scrolling on a 390×844 phone. */}
        <View style={styles.chips}>
          <Chip icon={CalendarDays} label={occurredOn === today ? "Today" : fullDate(occurredOn)} onPress={() => setPicker("date")} />
          <Chip icon={NotebookPen} label={noteChipLabel(note)} onPress={() => setPicker("note")} />
        </View>
        {dateNoteError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {dateNoteError}
          </Text>
        ) : null}
        <NumberKeypad compact onKey={(key) => setAmount((a) => applyKeypadKey(a, key, currency))} disabled={busy} />
        <Button label={saveLabel(type, amountMinor, currency, Boolean(editing))} fullWidth loading={busy} onPress={submit} />
      </View>

      <AccountPicker
        visible={picker === "from" || picker === "to"}
        title={accountRowLabel(type, side)}
        accounts={side === "to" ? accounts.filter((a) => a.id !== accountId) : fromAccounts}
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
      <BottomSheet visible={picker === "date"} title="Date" onClose={() => setPicker(null)}>
        <DateField label="Date" value={occurredOn} max={today} onChange={setOccurredOn} error={fieldErrors.occurredOn} />
        <Button label="Done" fullWidth onPress={() => setPicker(null)} />
      </BottomSheet>
      <BottomSheet visible={picker === "note"} title="Note" onClose={() => setPicker(null)}>
        <TextField
          label="Note"
          value={note}
          onChangeText={setNote}
          placeholder={type === "transfer" ? "e.g. ATM withdrawal" : "What was this for?"}
          maxLength={280}
          error={fieldErrors.note}
          autoFocus
        />
        <Button label="Done" fullWidth onPress={() => setPicker(null)} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: mobile.colors.canvas },
  flex: { flex: 1 },
  center: { textAlign: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  titleWrap: { flex: 1 },
  close: { width: mobile.tapTarget, height: mobile.tapTarget, borderRadius: mobile.radius.chip, alignItems: "center", justifyContent: "center" },
  closePressed: { backgroundColor: mobile.categoryTints.grey },
  segment: { paddingHorizontal: spacing[4], gap: spacing[1] },
  lockNote: { textAlign: "center" },
  gatePad: { paddingTop: spacing[1] },
  loading: { marginTop: spacing[6] },
  // Tighter gaps (13b PR 5) keep the "Paid from" row whole above the footer at 390×844.
  body: { paddingHorizontal: spacing[4], paddingBottom: spacing[4], gap: spacing[2] },
  empty: { padding: spacing[4], gap: spacing[3] },
  section: { gap: spacing[2] },
  // 6pt between tiles: room for "Bank charges" on one line of a 390pt-wide tile.
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -3 },
  cell: { width: "25%", padding: 3 },
  fixed: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: mobile.radius.tileLg,
    backgroundColor: mobile.colors.surface,
  },
  error: { ...dsText.caption, color: mobile.colors.warning, fontFamily: fontFamily.bodySemibold },
  chips: { flexDirection: "row", gap: spacing[2] },
  amount: { backgroundColor: mobile.colors.canvas },
  limitNote: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  footer: { gap: spacing[2], paddingHorizontal: spacing[4], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: mobile.colors.line, backgroundColor: mobile.colors.canvas },
  list: { gap: spacing[1] },
  option: { flexDirection: "row", alignItems: "center", gap: spacing[3], minHeight: 52, paddingHorizontal: spacing[2], borderRadius: mobile.radius.tile },
  optionPressed: { backgroundColor: mobile.colors.canvas },
  optionSelected: { fontFamily: fontFamily.bodyBold },
});
