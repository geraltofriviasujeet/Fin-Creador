import { saveSource } from "@fin-creador/api";
import { SOURCE_TYPES } from "@fin-creador/schemas";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { IncomeGate } from "@/components/income/income-gate";
import { Sheet } from "@/components/income/sheet";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { spacing } from "@/theme";

/** Add source: name, type and an optional default "Received into" account. */
export default function SourceSheet() {
  return (
    <Sheet eyebrow="New source" title="Add source">
      <IncomeGate>
        {(data) => <SourceForm accounts={data.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.label }))} />}
      </IncomeGate>
    </Sheet>
  );
}

function SourceForm({ accounts }: { accounts: { value: string; label: string }[] }) {
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState("other");
  const [defaultAccountId, setDefaultAccountId] = useState("");
  const { save, busy, fieldErrors, formError } = useSave();
  return (
    <View style={styles.gap}>
      {formError ? <FormMessage tone="error" message={formError} /> : null}
      <TextField label="Name" value={name} onChangeText={setName} maxLength={60} placeholder="e.g. Shop rent" error={fieldErrors.name} />
      <SelectField
        label="Type"
        value={sourceType}
        options={SOURCE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        onChange={setSourceType}
        error={fieldErrors.sourceType}
        searchPlaceholder="Search types"
      />
      <SelectField
        label="Usually received into"
        hint="Optional. Pre-selected when you add income from this source."
        value={defaultAccountId}
        options={[{ value: "", label: "No default" }, ...accounts]}
        onChange={setDefaultAccountId}
        error={fieldErrors.defaultAccountId}
        searchPlaceholder="Search accounts"
      />
      <Button label="Add source" fullWidth loading={busy} onPress={() => void save(() => saveSource(getSupabase(), { name, sourceType, defaultAccountId }))} />
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: spacing[4] } });
