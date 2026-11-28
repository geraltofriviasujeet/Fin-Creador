import { type SpendLimit, removeSpendLimit, saveSpendLimit, spendLimitLabel } from "@fin-creador/api";
import { minorToInputString } from "@fin-creador/domain";
import {
  SPEND_LIMIT_MAX_CUSTOM_DAYS,
  SPEND_LIMIT_MIN_CUSTOM_DAYS,
  SPEND_LIMIT_PERIOD_OPTIONS,
  type SpendLimitPeriod,
  firstFieldErrors,
  spendLimitFormSchema,
} from "@fin-creador/schemas";
import { useRouter } from "expo-router";
import { RotateCw } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { Sheet } from "@/components/income/sheet";
import { Segmented } from "@/components/segmented";
import { TextField } from "@/components/text-field";
import { TransactionsGate } from "@/components/transactions/transactions-gate";
import { useTransactions } from "@/lib/transactions-store";
import { useSave } from "@/lib/use-save";
import { getSupabase } from "@/lib/supabase";
import { colors, fontFamily, spacing, text } from "@/theme";

// The daily spend limit on the phone (decisions log 2026-11-24 "Daily spend limit"; pre-13b 2
// PR 4). Opened from the Activity header button and from Home's Safe to spend card. Same fields
// and wording as the web dialog (apps/web/components/spend-limit/spend-limit-dialog.tsx): a
// period (1 day, 1 week, 1 month or a custom 2–365 days) and an amount; Remove with a confirm
// step. The shared schema checks the form here and the shared writer checks it again; the
// database sets the currency and the period's first day. A failed save (offline included)
// keeps everything typed; useSave says "Check your connection" when the phone is offline. Sheet handles safe areas and keeps the fields above the keyboard.

export const SPEND_LIMIT_DESCRIPTION =
  "One cap for everyday spending. Bills, EMIs, card payments and transfers don't count. Safe to spend shows what's left for each day.";

/** "each week", or for a custom period "every 10 days" once the day count is a number. */
function per(period: SpendLimitPeriod, days: string): string {
  if (period !== "custom") return `each ${period}`;
  return /^\d{1,3}$/.test(days.trim()) ? `every ${Number(days)} days` : "in each period";
}

export default function SpendLimitSheet() {
  const { state, refresh } = useTransactions();
  // Read the saved limit again on open (it may have changed on another device since the list loaded).
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const limit = state.status === "ready" && state.spendLimit ? state.spendLimit.limit : null;
  return (
    <Sheet eyebrow="Daily spend limit" title={limit ? "Change your spend limit" : "Set a spend limit"}>
      <TransactionsGate>{(data) => <Gate currency={data.currency} />}</TransactionsGate>
    </Sheet>
  );
}

/** Never offers "Set" over a saved limit: if the limit couldn't be read, says so with Try again. */
function Gate({ currency }: { currency: string }) {
  const { state, refresh } = useTransactions();
  const [retrying, setRetrying] = useState(false);
  if (state.status !== "ready") return null;
  if (!state.spendLimit) {
    return (
      <View style={styles.gap}>
        <FormMessage tone="error" message="We couldn't load your spend limit. Check your connection and try again." />
        <Button
          label="Try again"
          variant="secondary"
          icon={RotateCw}
          loading={retrying}
          onPress={() => {
            setRetrying(true);
            void refresh().finally(() => setRetrying(false));
          }}
        />
      </View>
    );
  }
  const limit = state.spendLimit.limit;
  // A fresher read that differs starts the form again from it.
  const key = limit ? `${limit.period}:${limit.periodDays}:${limit.amountMinor}:${limit.currency}` : "none";
  return <SpendLimitForm key={key} limit={limit} currency={currency} />;
}

function SpendLimitForm({ limit, currency }: { limit: SpendLimit | null; currency: string }) {
  const router = useRouter();
  const [period, setPeriod] = useState<SpendLimitPeriod>(limit?.period ?? "week");
  const [days, setDays] = useState(limit?.period === "custom" && limit.periodDays ? String(limit.periodDays) : "");
  const [amount, setAmount] = useState(limit ? minorToInputString(limit.amountMinor, limit.currency) : "");
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const { save, busy, fieldErrors, formError } = useSave();
  // The browser-side check first, then what the shared writer said.
  const errors = { ...fieldErrors, ...checkErrors };

  function submit() {
    const values = { period, days, amount };
    const checked = spendLimitFormSchema({ currency }).safeParse(values);
    if (!checked.success) {
      setCheckErrors(firstFieldErrors(checked.error));
      return;
    }
    setCheckErrors({});
    void save(() => saveSpendLimit(getSupabase(), values));
  }

  if (confirming && limit) {
    return (
      <View style={styles.gap}>
        {formError ? <FormMessage tone="error" message={formError} /> : null}
        <Text style={text.body}>
          Remove your limit of <Text style={styles.strong}>{spendLimitLabel(limit)}</Text>? Safe to spend goes back to what you can spend each day after
          your bills.
        </Text>
        <Button label={busy ? "Removing…" : "Remove limit"} fullWidth loading={busy} onPress={() => void save(() => removeSpendLimit(getSupabase()))} />
        <Button label="Keep limit" variant="secondary" fullWidth disabled={busy} onPress={() => setConfirming(false)} />
      </View>
    );
  }

  return (
    <View style={styles.gap}>
      <Text style={text.bodySmall}>{SPEND_LIMIT_DESCRIPTION}</Text>
      {formError ? <FormMessage tone="error" message={formError} /> : null}
      {limit && limit.currency !== currency ? (
        <FormMessage tone="info" message={`This limit is in ${limit.currency}, so Safe to spend doesn't use it. Save it again in ${currency}.`} />
      ) : null}
      <View style={styles.field}>
        <Text style={text.label}>Period</Text>
        <Segmented
          label="Period"
          options={SPEND_LIMIT_PERIOD_OPTIONS}
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setCheckErrors((e) => {
              const next = { ...e };
              delete next.days;
              return next;
            });
          }}
        />
        {errors.period ? <Text style={[text.caption, styles.error]}>{errors.period}</Text> : null}
        {limit ? <Text style={text.caption}>Changing the period starts a new one from today. Changing only the amount keeps the current one.</Text> : null}
      </View>
      {period === "custom" ? (
        <TextField
          label="Number of days"
          value={days}
          onChangeText={setDays}
          keyboardType="number-pad"
          maxLength={3}
          autoComplete="off"
          error={errors.days}
          hint={`${SPEND_LIMIT_MIN_CUSTOM_DAYS} to ${SPEND_LIMIT_MAX_CUSTOM_DAYS}`}
        />
      ) : null}
      <TextField
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        autoFocus={!limit}
        error={errors.amount}
        hint={`In ${currency}. You can spend this much ${per(period, days)}.`}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <Button label={busy ? "Saving…" : "Save"} fullWidth loading={busy} onPress={submit} />
      <Button label="Cancel" variant="secondary" fullWidth disabled={busy} onPress={() => router.back()} />
      {limit ? (
        <View style={styles.remove}>
          <Button label="Remove limit" variant="ghost" disabled={busy} onPress={() => setConfirming(true)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing[4] },
  field: { gap: 6 },
  strong: { fontFamily: fontFamily.bodySemibold, color: colors.ink },
  error: { color: colors.danger },
  remove: { alignItems: "center" },
});
