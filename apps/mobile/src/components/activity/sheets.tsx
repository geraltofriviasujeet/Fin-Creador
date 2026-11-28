import { type ActivityFilters, type LedgerCategory, activityRange, initialActivityFilters, withCustomRange } from "@fin-creador/api";
import { type IsoDate, monthRange } from "@fin-creador/domain";
import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { BottomSheet, Button } from "@/components/ds";
import { DateField } from "@/components/income/date-field";
import { PICKER_FIRST_YEAR, pickerMonths } from "@/lib/activity-text";
import { dsText, fontFamily, mobile, spacing } from "@/theme";

// Activity's month picker and More filters (Sprint 13b PR 4). Both are ds bottom sheets; the
// category and account lists open inside the More filters sheet (no sheet on top of a sheet).

// ---- Month picker -----------------------------------------------------------------------

type MonthPickerProps = {
  visible: boolean;
  today: IsoDate;
  selected: IsoDate | null;
  onPick: (month: IsoDate) => void;
  onClose: () => void;
};

export function MonthPicker(props: MonthPickerProps) {
  // Mounted only while open, so it opens on the selected month's year.
  return props.visible ? <MonthPickerSheet {...props} /> : null;
}

function MonthPickerSheet({ today, selected, onPick, onClose }: MonthPickerProps) {
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(selected ? Number(selected.slice(0, 4)) : thisYear);
  return (
    <BottomSheet visible title="Pick a month" onClose={onClose}>
      <View style={styles.yearRow}>
        <YearButton label={`Previous year, ${year - 1}`} icon="prev" disabled={year <= PICKER_FIRST_YEAR} onPress={() => setYear((y) => y - 1)} />
        <Text accessibilityRole="header" style={dsText.cardTitle}>
          {year}
        </Text>
        <YearButton label={`Next year, ${year + 1}`} icon="next" disabled={year >= thisYear} onPress={() => setYear((y) => y + 1)} />
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={`Months in ${year}`} style={styles.grid}>
        {pickerMonths(year, today).map((m) => {
          const on = m.month === selected;
          return (
            <View key={m.month} style={styles.cell}>
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={`${m.label} ${year}`}
                aria-checked={on}
                aria-selected={on}
                aria-disabled={m.disabled}
                disabled={m.disabled}
                onPress={() => onPick(m.month)}
                style={({ pressed }) => [styles.month, on && styles.monthOn, pressed && !on && styles.optionPressed, m.disabled && styles.disabled]}
              >
                <Text style={[styles.monthText, on && styles.monthTextOn]}>{m.label}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </BottomSheet>
  );
}

function YearButton({ label, icon, disabled, onPress }: { label: string; icon: "prev" | "next"; disabled: boolean; onPress: () => void }) {
  const Icon = icon === "prev" ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.yearButton, pressed && styles.optionPressed, disabled && styles.disabled]}
    >
      <Icon size={22} color={mobile.colors.ink} />
    </Pressable>
  );
}

// ---- More filters -----------------------------------------------------------------------

type Option = { value: string; label: string };

type MoreFiltersProps = {
  visible: boolean;
  filters: ActivityFilters;
  today: IsoDate;
  categories: LedgerCategory[];
  accounts: Option[];
  onApply: (f: ActivityFilters) => void;
  onClose: () => void;
};

/** Refunds, category, account, voided entries and a custom range. Nothing changes until "Show results". */
export function MoreFilters(props: MoreFiltersProps) {
  // Mounted only while open, so each opening starts from the filters in use.
  return props.visible ? <MoreFiltersSheet {...props} /> : null;
}

function MoreFiltersSheet({ filters, today, categories, accounts, onApply, onClose }: MoreFiltersProps) {
  const [draft, setDraft] = useState(filters);
  const shown = activityRange(filters).range;
  const [from, setFrom] = useState(filters.month === null ? filters.from : shown.start);
  const [to, setTo] = useState(filters.month === null ? filters.to : shown.end > today ? today : shown.end);
  const [custom, setCustom] = useState(filters.month === null);
  const [view, setView] = useState<"main" | "category" | "account">("main");

  const categoryOptions: Option[] = [
    { value: "", label: "All categories" },
    ...categories.map((c) => ({ value: c.id, label: `${c.name}${c.archived ? " (archived)" : ""}${c.kind === "income" ? " · income" : ""}` })),
  ];
  const accountOptions: Option[] = [{ value: "", label: "All accounts" }, ...accounts];
  const nameOf = (options: Option[], value: string) => options.find((o) => o.value === value)?.label ?? options[0]!.label;

  function apply() {
    let next = draft;
    if (custom) next = withCustomRange(draft, from, to);
    else if (draft.month === null) next = { ...draft, month: monthRange(today).start };
    onApply(next);
  }

  if (view !== "main") {
    const isCategory = view === "category";
    const options = isCategory ? categoryOptions : accountOptions;
    const value = isCategory ? draft.category : draft.account;
    const title = isCategory ? "Category" : "Account";
    return (
      <BottomSheet visible title={title} onClose={() => setView("main")}>
        <View accessibilityRole="radiogroup" accessibilityLabel={title} style={styles.list}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <Pressable
                key={o.value || "all"}
                accessibilityRole="radio"
                accessibilityLabel={o.label}
                aria-checked={on}
                aria-selected={on}
                onPress={() => {
                  setDraft((d) => (isCategory ? { ...d, category: o.value } : { ...d, account: o.value }));
                  setView("main");
                }}
                style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
              >
                <Text style={[dsText.body, styles.flex, on && styles.bold]}>{o.label}</Text>
                {on ? <Check size={20} color={mobile.colors.forest} strokeWidth={2.5} /> : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet visible title="More filters" onClose={onClose}>
      <SwitchRow
        label="Refunds only"
        value={draft.type === "refund"}
        onChange={(on) => setDraft((d) => ({ ...d, type: on ? "refund" : "all" }))}
      />
      <PickRow label="Category" value={nameOf(categoryOptions, draft.category)} onPress={() => setView("category")} />
      <PickRow label="Account" value={nameOf(accountOptions, draft.account)} onPress={() => setView("account")} />
      <SwitchRow label="Show voided entries" value={draft.showVoided} onChange={(showVoided) => setDraft((d) => ({ ...d, showVoided }))} />
      <SwitchRow label="Custom dates" value={custom} onChange={setCustom} />
      {custom ? (
        <View style={styles.dates}>
          <DateField label="From" value={from} max={today} onChange={setFrom} />
          <DateField label="To" value={to} max={today} onChange={setTo} />
        </View>
      ) : null}
      <Button label="Show results" fullWidth onPress={apply} />
      <Button
        label="Reset these filters"
        variant="secondary"
        fullWidth
        onPress={() => {
          const reset = initialActivityFilters(today);
          setDraft((d) => ({ ...d, type: d.type === "refund" ? "all" : d.type, category: "", account: "", showVoided: false, month: d.month ?? reset.month }));
          setCustom(false);
        }}
      />
    </BottomSheet>
  );
}

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <Text style={[dsText.body, styles.flex]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: mobile.colors.forest, false: mobile.colors.lineStrong }}
        thumbColor={mobile.colors.surface}
      />
    </View>
  );
}

function PickRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Change`}
      onPress={onPress}
      style={({ pressed }) => [styles.pickRow, pressed && styles.optionPressed]}
    >
      <View style={styles.flex}>
        <Text style={dsText.label}>{label}</Text>
        <Text style={dsText.bodyStrong} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <ChevronRight size={18} color={mobile.colors.mutedSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontFamily: fontFamily.bodyBold },
  disabled: { opacity: 0.4 },
  yearRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  yearButton: { width: mobile.tapTarget, height: mobile.tapTarget, borderRadius: mobile.radius.chip, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -spacing[1] },
  cell: { width: "33.333%", padding: spacing[1] },
  month: {
    minHeight: mobile.tapTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: mobile.radius.tile,
    borderWidth: 1,
    borderColor: mobile.colors.line,
    backgroundColor: mobile.colors.surface,
  },
  monthOn: { backgroundColor: mobile.colors.forest, borderColor: mobile.colors.forest },
  monthText: { fontFamily: fontFamily.bodySemibold, fontSize: mobile.type.body.size, color: mobile.colors.ink },
  monthTextOn: { color: mobile.colors.onForest },
  list: { gap: spacing[1] },
  option: { flexDirection: "row", alignItems: "center", gap: spacing[3], minHeight: 52, paddingHorizontal: spacing[2], borderRadius: mobile.radius.tile },
  optionPressed: { backgroundColor: mobile.colors.canvas },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minHeight: mobile.tapTarget },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minHeight: 56,
    paddingHorizontal: spacing[3],
    borderRadius: mobile.radius.tile,
    borderWidth: 1,
    borderColor: mobile.colors.line,
  },
  dates: { gap: spacing[3] },
});
