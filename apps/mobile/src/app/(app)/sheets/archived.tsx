import { type IncomeAccount, setAccountArchived } from "@fin-creador/api";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { IncomeGate } from "@/components/income/income-gate";
import { Sheet } from "@/components/income/sheet";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { colors, radius, spacing, text } from "@/theme";

/** Archived accounts: not in totals, history kept; Restore brings one back. */
export default function ArchivedSheet() {
  return (
    <Sheet eyebrow="Accounts" title="Archived accounts">
      <Text style={text.bodySmall}>Archived accounts are not in your totals. Their income history stays.</Text>
      <IncomeGate>
        {(data) => {
          const archived = data.accounts.filter((a) => a.archived);
          if (archived.length === 0) return <Text style={text.bodySmall}>No archived accounts.</Text>;
          return (
            <View style={styles.list}>
              {archived.map((a) => (
                <RestoreRow key={a.id} account={a} />
              ))}
            </View>
          );
        }}
      </IncomeGate>
    </Sheet>
  );
}

function RestoreRow({ account }: { account: IncomeAccount }) {
  // The toast comes from useSave, so it shows even though this row disappears after restoring.
  const { save, busy, formError } = useSave();
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <Text style={text.label}>{account.label}</Text>
        {formError ? <FormMessage tone="error" message={formError} /> : null}
      </View>
      <Button
        label="Restore"
        variant="secondary"
        loading={busy}
        onPress={() => void save(() => setAccountArchived(getSupabase(), { id: account.id, archived: false }), { close: false })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing[2] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3], borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing[3] },
  flex: { flex: 1, gap: spacing[2] },
});
