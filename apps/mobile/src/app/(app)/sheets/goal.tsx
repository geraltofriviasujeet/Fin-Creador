import { type GoalItem, type GoalsView, deleteGoal, money, newRequestKey, saveGoal, setGoalArchived, setGoalSaved } from "@fin-creador/api";
import { type GoalDetails, TRIP_COST_LINES, goalFigures, minorToInputString } from "@fin-creador/domain";
import {
  EMI_ROUNDING_NOTE,
  FOREIGN_COUNTRIES,
  GOAL_UPFRONT_LABEL,
  INDIAN_STATES,
  LOAN_PAYMENTS,
  STAY_TYPES,
  TRAVEL_MODES,
  TRIP_COST_LABELS,
  VEHICLE_KIND_OPTIONS,
  goalFormSchema,
} from "@fin-creador/schemas";
import { useLocalSearchParams, useRouter } from "expo-router";
import { RotateCw } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, View } from "react-native";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { DateField } from "@/components/income/date-field";
import { Sheet } from "@/components/income/sheet";
import { MoneyField } from "@/components/money-field";
import { Segmented } from "@/components/segmented";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { param } from "@/lib/income-format";
import { NETWORK_ERROR } from "@/lib/income-store";
import { useGoalsView } from "@/lib/plan-data";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { TOUCH_TARGET, colors, fontFamily, radius, spacing, text } from "@/theme";

// Goal sheets (Sprint 13c PR 3): add a trip, a vehicle or something else; edit; update the saved
// amount; archive; delete an archived goal permanently. Same questions, wording and checks as the
// web Goals page (apps/web/components/goals): the shared goalFormSchema works out the amount to
// save while typing, and the shared writers (saveGoal, setGoalSaved, setGoalArchived, deleteGoal)
// check everything again. House, furniture, electronics and mobile goals are planned and edited
// on the web for now. A failed save, offline included, keeps what was typed.

type Action = "add" | "edit" | "saved" | "archive" | "delete";
type Values = Record<string, string>;

/** The kinds the phone plans (owner, 13c plan); the rest stay on the web for now. */
const PHONE_TYPES = [
  { value: "trip", label: "Trip" },
  { value: "vehicle", label: "Vehicle" },
  { value: "other", label: "Other" },
] as const;
type PhoneType = (typeof PHONE_TYPES)[number]["value"];
const isPhoneType = (t: string): t is PhoneType => PHONE_TYPES.some((p) => p.value === t);

const PREVIEW_KEY = "00000000-0000-4000-8000-000000000000";
const NEW_GOAL: Values = { type: "trip", scope: "domestic", payment: "cash", vehicle: "car", condition: "new" };

const TITLES: Record<Action, (name: string) => string> = {
  add: () => "Plan a goal",
  edit: (name) => `Edit ${name}`,
  saved: (name) => `Saved for ${name}`,
  archive: (name) => `Archive ${name}?`,
  delete: (name) => `Delete ${name} permanently?`,
};

export default function GoalSheet() {
  const params = useLocalSearchParams<{ action?: string; id?: string }>();
  const raw = param(params.action);
  const action: Action = raw === "edit" || raw === "saved" || raw === "archive" || raw === "delete" ? raw : "add";
  const id = param(params.id);
  const { state, refresh } = useGoalsView();
  // Read again on open: the goal may have changed on another device since the list loaded.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = state.status === "ready" ? state.data : null;
  const item = view && id ? [...view.active, ...view.archived].find((g) => g.goal.id === id) : undefined;
  return (
    <Sheet eyebrow="Goals" title={TITLES[action](item?.goal.name ?? "goal")}>
      {state.status === "loading" ? (
        <View style={styles.center} accessibilityLabel="Loading goals" accessibilityState={{ busy: true }}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : !view ? (
        <View style={styles.gap}>
          <FormMessage
            tone="error"
            message={state.status === "offline" ? "We couldn't load your goals. Check your connection and try again." : state.status === "error" ? state.message : ""}
          />
          <Button label="Try again" variant="secondary" icon={RotateCw} onPress={() => void refresh()} />
        </View>
      ) : action !== "add" && !item ? (
        <FormMessage tone="error" message="We couldn't find that goal. Go back and pull to refresh." />
      ) : action === "saved" ? (
        <SavedForm item={item!} />
      ) : action === "archive" ? (
        <Confirm item={item!} archive />
      ) : action === "delete" ? (
        <Confirm item={item!} />
      ) : action === "edit" && !isPhoneType(item!.goal.type) ? (
        <FormMessage tone="info" message="Goals of this kind are edited on the web for now. You can still update the saved amount or archive it here." />
      ) : (
        <GoalForm view={view} item={action === "edit" ? item : undefined} />
      )}
    </Sheet>
  );
}

// ---- Add or edit ------------------------------------------------------------------------

/** 850 → "8.5" (a stored rate shown for editing, integer arithmetic only). */
function bpsToInput(bps: number | null): string {
  if (bps === null) return "";
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${Math.floor(bps / 100)}.${fraction}` : String(Math.floor(bps / 100));
}

/** The stored answers back into the form's fields (the web form's valuesFrom, for the phone's kinds). */
function valuesFrom(item: GoalItem): Values {
  const { goal, answers } = item;
  const amount = (minor: number | null | undefined) => (minor === null || minor === undefined || minor === 0 ? "" : minorToInputString(minor, goal.currency));
  const v: Values = { ...NEW_GOAL, type: goal.type, name: goal.name, targetDate: goal.targetDate ?? "", saved: amount(goal.savedMinor) };
  if (!answers) return goal.type === "other" ? { ...v, amount: amount(goal.targetMinor) } : v;
  if (answers.type === "trip") {
    const d = answers.details;
    Object.assign(v, { scope: d.scope, place: d.place, people: String(d.people), days: String(d.days), travelMode: d.travelMode, stay: d.stay });
    for (const line of TRIP_COST_LINES) v[`cost_${line}`] = amount(d.costs[line]);
  } else if (answers.type === "vehicle") {
    const d = answers.details;
    Object.assign(v, {
      vehicle: d.vehicle, condition: d.condition, make: d.make ?? "", model: d.model, price: amount(d.priceMinor), extras: amount(d.extrasMinor),
      payment: d.payment, downPayment: amount(d.downPaymentMinor), rate: bpsToInput(d.loanRateBps), months: d.loanMonths ? String(d.loanMonths) : "",
    });
  } else if (answers.type === "other") {
    Object.assign(v, { description: answers.details.description, amount: amount(goal.targetMinor) });
  }
  return v;
}

function GoalForm({ view, item }: { view: GoalsView; item?: GoalItem }) {
  const router = useRouter();
  const editing = Boolean(item);
  const currency = item?.goal.currency ?? view.currency;
  // One key per opened sheet; a retry after a failure reuses it, so the goal is added once.
  const [requestKey] = useState(newRequestKey);
  const [values, setValues] = useState<Values>(() => (item ? valuesFrom(item) : NEW_GOAL));
  const [hasDate, setHasDate] = useState(Boolean(item?.goal.targetDate));
  const { save, busy, fieldErrors: errors, formError } = useSave();
  const type = (isPhoneType(values.type ?? "") ? values.type : "trip") as PhoneType;
  const set = (name: string) => (value: string) => setValues((v) => ({ ...v, [name]: value }));
  const v = (name: string) => values[name] ?? "";
  const targetDate = hasDate ? v("targetDate") || view.today : "";

  // Live figures: the same parse the writer runs (amounts in minor units, exact maths).
  const preview = useMemo(() => {
    const parsed = goalFormSchema({ currency, today: view.today, currentTargetDate: item?.goal.targetDate ?? null }).safeParse({
      ...values,
      targetDate,
      goalId: "",
      idempotencyKey: PREVIEW_KEY,
    });
    if (!parsed.success) return null;
    return { targetMinor: parsed.data.targetMinor, figures: goalFigures({ type: parsed.data.type, details: parsed.data.details } as GoalDetails) };
  }, [values, targetDate, currency, view.today, item?.goal.targetDate]);

  const submit = () =>
    void save(() =>
      saveGoal(getSupabase(), { ...values, targetDate, goalId: item?.goal.id ?? "", idempotencyKey: editing ? "" : requestKey }).catch(() => ({
        status: "error" as const,
        message: NETWORK_ERROR,
      })),
    );

  const field = (name: string, label: string, props: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField label={label} value={v(name)} onChangeText={set(name)} error={errors[name]} {...props} />
  );
  const amountField = (name: string, label: string, hint?: string) => (
    <MoneyField label={label} value={v(name)} onChange={set(name)} currency={currency} error={errors[name]} hint={hint} />
  );
  const select = (name: string, label: string, options: readonly { value: string; label: string }[], placeholder: string) => (
    <SelectField label={label} value={v(name)} options={[{ value: "", label: placeholder }, ...options]} onChange={set(name)} error={errors[name]} searchPlaceholder={`Search ${label.toLowerCase()}`} />
  );

  return (
    <View style={styles.gap}>
      {formError ? <FormMessage tone="error" message={formError} /> : null}
      {errors.type ? <FormMessage tone="error" message={errors.type} /> : null}
      {editing ? null : (
        <Segmented
          label="What are you planning?"
          options={PHONE_TYPES}
          value={type}
          onChange={(t) => setValues((old) => ({ ...NEW_GOAL, type: t, name: old.name ?? "", targetDate: old.targetDate ?? "", saved: old.saved ?? "" }))}
        />
      )}
      {editing ? null : <Text style={text.caption}>A house or an item on EMI can be planned on the web for now.</Text>}
      {field("name", "Name", { placeholder: type === "trip" ? "e.g. Goa with family" : type === "vehicle" ? "e.g. New bike" : "e.g. Emergency fund", maxLength: 80, autoFocus: !editing })}

      <View style={styles.switchRow}>
        <Text style={text.body}>Has a target date</Text>
        <Switch
          value={hasDate}
          onValueChange={setHasDate}
          accessibilityLabel="Has a target date"
          trackColor={{ true: colors.ink, false: colors.lineStrong }}
          thumbColor={colors.surface}
        />
      </View>
      {hasDate ? (
        <DateField label="Target date" value={targetDate} min={view.today} max="2199-12-31" onChange={set("targetDate")} error={errors.targetDate} />
      ) : (
        <Text style={text.caption}>No target date assumes 12 months.</Text>
      )}
      {amountField("saved", "Saved so far (optional)", "It isn't linked to your accounts.")}

      {type === "trip" ? (
        <>
          <Segmented
            label="Trip"
            options={[
              { value: "domestic", label: "Domestic" },
              { value: "international", label: "International" },
            ]}
            value={v("scope") === "international" ? "international" : "domestic"}
            onChange={(scope) => setValues((old) => (old.scope === scope ? old : { ...old, scope, place: "" }))}
          />
          {select(
            "place",
            v("scope") === "international" ? "Country" : "State",
            (v("scope") === "international" ? FOREIGN_COUNTRIES : INDIAN_STATES).map((name) => ({ value: name, label: name })),
            v("scope") === "international" ? "Choose a country" : "Choose a state",
          )}
          <View style={styles.pair}>
            <View style={styles.flex}>{field("people", "People", { keyboardType: "number-pad", maxLength: 3 })}</View>
            <View style={styles.flex}>{field("days", "Days", { keyboardType: "number-pad", maxLength: 3 })}</View>
          </View>
          {select("travelMode", "Travel by", TRAVEL_MODES, "Choose how you'll travel")}
          {select("stay", "Stay type", STAY_TYPES, "Choose where you'll stay")}
          <Text style={text.label}>Your cost lines (totals for the whole trip)</Text>
          {TRIP_COST_LINES.map((line) => (
            <View key={line}>{amountField(`cost_${line}`, TRIP_COST_LABELS[line])}</View>
          ))}
        </>
      ) : null}

      {type === "vehicle" ? (
        <>
          <Segmented
            label="Vehicle"
            options={VEHICLE_KIND_OPTIONS}
            value={(v("vehicle") || "car") as (typeof VEHICLE_KIND_OPTIONS)[number]["value"]}
            onChange={(vehicle) => setValues((old) => (old.vehicle === vehicle ? old : { ...old, vehicle, make: "", model: "" }))}
          />
          <Segmented
            label="Condition"
            options={[
              { value: "new", label: "New" },
              { value: "used", label: "Used" },
            ]}
            value={v("condition") === "used" ? "used" : "new"}
            onChange={set("condition")}
          />
          {field("make", "Make", { placeholder: "e.g. Royal Enfield", maxLength: 80, autoCorrect: false })}
          {field("model", "Model", { placeholder: "e.g. Classic 350", maxLength: 80, autoCorrect: false })}
          {amountField("price", "Price")}
          {amountField("extras", "Extras (optional)", "Registration, insurance, accessories; paid upfront")}
          {select("payment", "Payment", LOAN_PAYMENTS, "Choose how you'll pay")}
          {v("payment") === "loan_down_payment" ? amountField("downPayment", "Down payment") : null}
          {v("payment") === "loan" || v("payment") === "loan_down_payment" ? (
            <>
              {field("rate", "Yearly interest rate (%)", { keyboardType: "decimal-pad", placeholder: "e.g. 8.5" })}
              {field("months", "Loan tenure (months)", { keyboardType: "number-pad", placeholder: "e.g. 60", maxLength: 3 })}
            </>
          ) : null}
        </>
      ) : null}

      {type === "other" ? (
        <>
          {field("description", "What it's for", { maxLength: 280, multiline: true })}
          {amountField("amount", "Amount")}
        </>
      ) : null}

      <View style={styles.preview} accessibilityLiveRegion="polite">
        {preview ? (
          <>
            <Text style={text.label}>{type === "other" ? "Amount to save" : GOAL_UPFRONT_LABEL}</Text>
            <Text style={styles.previewAmount}>{money(preview.targetMinor, currency)}</Text>
            {preview.figures.costTotalMinor !== null ? <Text style={text.caption}>The sum of your cost lines.</Text> : null}
            {preview.figures.loan ? (
              <>
                <Text style={text.caption}>
                  {preview.figures.loan.annualRateBps === 0 ? "No-cost EMI" : "EMI"} {money(preview.figures.loan.emiMinor, currency)} a month for {preview.figures.loan.months} months
                  on {money(preview.figures.loan.principalMinor, currency)} · total interest {money(preview.figures.loan.totalInterestMinor, currency)}
                </Text>
                <Text style={text.caption}>{EMI_ROUNDING_NOTE}</Text>
              </>
            ) : null}
          </>
        ) : (
          <Text style={text.caption}>Fill in the details to see the amount to save.</Text>
        )}
      </View>

      <Button label={busy ? "Saving…" : editing ? "Save changes" : "Add goal"} fullWidth loading={busy} onPress={submit} />
      <Button label="Cancel" variant="secondary" fullWidth disabled={busy} onPress={() => router.back()} />
    </View>
  );
}

// ---- Update saved, archive, delete ------------------------------------------------------

function SavedForm({ item }: { item: GoalItem }) {
  const router = useRouter();
  const [saved, setSaved] = useState(item.goal.savedMinor ? minorToInputString(item.goal.savedMinor, item.goal.currency) : "");
  const { save, busy, fieldErrors, formError } = useSave();
  return (
    <View style={styles.gap}>
      <Text style={text.bodySmall}>Enter the total saved so far. It isn&apos;t linked to your accounts.</Text>
      {formError && !fieldErrors.saved ? <FormMessage tone="error" message={formError} /> : null}
      <MoneyField label="Saved so far" value={saved} onChange={setSaved} currency={item.goal.currency} error={fieldErrors.saved} autoFocus />
      <Text style={text.caption}>Target {money(item.goal.targetMinor, item.goal.currency)}</Text>
      <Button
        label={busy ? "Saving…" : "Save"}
        fullWidth
        loading={busy}
        onPress={() =>
          void save(() => setGoalSaved(getSupabase(), { goalId: item.goal.id, saved }).catch(() => ({ status: "error" as const, message: NETWORK_ERROR })))
        }
      />
      <Button label="Cancel" variant="secondary" fullWidth disabled={busy} onPress={() => router.back()} />
    </View>
  );
}

function Confirm({ item, archive }: { item: GoalItem; archive?: boolean }) {
  const router = useRouter();
  const { save, busy, formError } = useSave();
  const run = () =>
    void save(() =>
      (archive ? setGoalArchived(getSupabase(), { goalId: item.goal.id, archived: true }) : deleteGoal(getSupabase(), { goalId: item.goal.id })).catch(() => ({
        status: "error" as const,
        message: NETWORK_ERROR,
      })),
    );
  return (
    <View style={styles.gap}>
      <Text style={text.body}>
        {archive
          ? "It moves to Archived. You can restore it later; nothing else changes."
          : "The goal and its answers are removed for good. This can't be undone. Your accounts and their history don't change."}
      </Text>
      {formError ? <FormMessage tone="error" message={formError} /> : null}
      {archive ? (
        <Button label={busy ? "Archiving…" : "Archive"} fullWidth loading={busy} onPress={run} />
      ) : (
        <Button label={busy ? "Deleting…" : "Delete permanently"} fullWidth loading={busy} onPress={run} />
      )}
      <Button label="Cancel" variant="secondary" fullWidth disabled={busy} onPress={() => router.back()} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing[10], alignItems: "center" },
  gap: { gap: spacing[4] },
  flex: { flex: 1 },
  pair: { flexDirection: "row", gap: spacing[3] },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: TOUCH_TARGET },
  preview: { gap: 4, padding: spacing[4], borderRadius: radius.control, backgroundColor: colors.canvas },
  previewAmount: { fontFamily: fontFamily.heading, fontSize: 24, color: colors.ink, fontVariant: ["tabular-nums"] },
});
