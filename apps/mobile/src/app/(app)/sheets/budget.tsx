import { type BudgetCategory, type BudgetItem, type GoalsView, monthLabel, setCategoryBudget } from "@fin-creador/api";
import { minorToInputString } from "@fin-creador/domain";
import { budgetFormSchema, firstFieldErrors } from "@fin-creador/schemas";
import { useLocalSearchParams, useRouter } from "expo-router";
import { RotateCw } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { Sheet } from "@/components/income/sheet";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { useBudgets } from "@/lib/plan-data";
import { budgetMonthOptions } from "@/lib/plan-text";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { colors, fontFamily, spacing, text } from "@/theme";

// The budget sheet (Sprint 13c PR 2), opened from Plan and the Budgets screen: set a category's
// monthly budget from a month onward, change it, set it again in the profile currency, or remove
// it from a month on. Same fields and wording as the web's budget form (apps/web/components/goals/
// goals-view.tsx BudgetForm). The shared schema checks the form here and the shared writer
// (setCategoryBudget → set_category_budget) checks it again. A failed save, offline included,
// keeps what was typed.

export const BUDGET_DESCRIPTION = "A budget continues every month until you change it or remove it.";

export default function BudgetSheet() {
  const params = useLocalSearchParams<{ month?: string; categoryId?: string }>();
  const month = typeof params.month === "string" ? params.month : undefined;
  const categoryId = typeof params.categoryId === "string" ? params.categoryId : undefined;
  const { state, refresh } = useBudgets(month);
  // Read again on open: the budget may have changed on another device since the list loaded.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = state.status === "ready" ? state.data : null;
  const item = view && categoryId ? view.budgets.find((b) => b.category.id === categoryId) : undefined;
  return (
    <Sheet eyebrow="Monthly budgets" title={item ? `Budget for ${item.category.name}` : "Set a budget"}>
      <Text style={text.bodySmall}>{BUDGET_DESCRIPTION}</Text>
      {state.status === "loading" ? (
        <View style={styles.center} accessibilityLabel="Loading budgets" accessibilityState={{ busy: true }}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : !view ? (
        <View style={styles.gap}>
          <FormMessage
            tone="error"
            message={state.status === "offline" ? "We couldn't load your budgets. Check your connection and try again." : state.status === "error" ? state.message : ""}
          />
          <Button label="Try again" variant="secondary" icon={RotateCw} onPress={() => void refresh()} />
        </View>
      ) : (
        // A fresher read that differs starts the form again from it.
        <BudgetForm key={item ? `${item.budget.effectiveFrom}:${item.budget.amountMinor}:${item.budget.currency}` : "new"} view={view} item={item} categoryId={categoryId} />
      )}
    </Sheet>
  );
}

function BudgetForm({ view, item, categoryId: wanted }: { view: GoalsView; item?: BudgetItem; categoryId?: string }) {
  const router = useRouter();
  const options: BudgetCategory[] = item ? [item.category] : view.unbudgeted;
  const [categoryId, setCategoryId] = useState(item?.category.id ?? (wanted && options.some((c) => c.id === wanted) ? wanted : ""));
  // From the month being viewed (this month or a later one).
  const [month, setMonth] = useState(view.budgetMonth.start.slice(0, 7));
  const [amount, setAmount] = useState(item?.status ? minorToInputString(item.budget.amountMinor, view.currency) : "");
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const { save, busy, fieldErrors, formError } = useSave();
  const errors = { ...fieldErrors, ...checkErrors };
  const months = budgetMonthOptions(view.today);
  const monthName = months.find((m) => m.value === month)?.label ?? month;

  function submit(values: { categoryId: string; month: string; amount: string }) {
    const checked = budgetFormSchema({ currency: view.currency, today: view.today }).safeParse(values);
    if (!checked.success) {
      setCheckErrors(firstFieldErrors(checked.error));
      return;
    }
    setCheckErrors({});
    void save(() => setCategoryBudget(getSupabase(), values));
  }

  if (!item && options.length === 0) {
    return (
      <View style={styles.gap}>
        <FormMessage tone="info" message="Every category already has a budget this month. Open one to change it." />
        <Button label="Close" variant="secondary" fullWidth onPress={() => router.back()} />
      </View>
    );
  }

  if (confirming && item) {
    return (
      <View style={styles.gap}>
        {formError ? <FormMessage tone="error" message={formError} /> : null}
        <Text style={text.body}>
          Remove the <Text style={styles.strong}>{item.category.name}</Text> budget from {monthName} on? Earlier months keep their amounts.
        </Text>
        <Button label={busy ? "Removing…" : "Remove budget"} fullWidth loading={busy} onPress={() => submit({ categoryId: item.category.id, month, amount: "0" })} />
        <Button label="Keep budget" variant="secondary" fullWidth disabled={busy} onPress={() => setConfirming(false)} />
      </View>
    );
  }

  return (
    <View style={styles.gap}>
      {formError ? <FormMessage tone="error" message={formError} /> : null}
      {item && !item.status ? <FormMessage tone="info" message={`This budget is in ${item.budget.currency}. Enter it again in ${view.currency}.`} /> : null}
      {item ? (
        <View style={styles.field}>
          <Text style={text.label}>Category</Text>
          <Text style={text.body}>{item.category.name}</Text>
        </View>
      ) : (
        <SelectField
          label="Category"
          value={categoryId}
          options={[{ value: "", label: "Choose a category" }, ...options.map((c) => ({ value: c.id, label: c.name }))].filter((o) => o.value || !categoryId)}
          onChange={setCategoryId}
          error={errors.categoryId}
          searchPlaceholder="Search categories"
        />
      )}
      <TextField
        label="Monthly budget"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        autoFocus={Boolean(item)}
        error={errors.amount}
        hint={item ? `In ${view.currency}. 0 or blank removes it from that month on.` : `In ${view.currency}.`}
      />
      <SelectField
        label="From"
        value={month}
        options={months.map((m) => ({ value: m.value, label: m.label }))}
        onChange={setMonth}
        error={errors.month}
        hint={`Applies from ${monthLabel(`${month}-01`)} onwards. Earlier months keep their amounts.`}
        searchPlaceholder="Search months"
      />
      <Button label={busy ? "Saving…" : "Save budget"} fullWidth loading={busy} onPress={() => submit({ categoryId, month, amount })} />
      <Button label="Cancel" variant="secondary" fullWidth disabled={busy} onPress={() => router.back()} />
      {item?.status ? (
        <View style={styles.remove}>
          <Button label="Remove budget" variant="ghost" disabled={busy} onPress={() => setConfirming(true)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing[10], alignItems: "center" },
  gap: { gap: spacing[4] },
  field: { gap: 6 },
  strong: { fontFamily: fontFamily.bodySemibold, color: colors.ink },
  remove: { alignItems: "center" },
});
