import { type IncomePageData, updateCashOnHand } from "@fin-creador/api";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { IncomeGate } from "@/components/income/income-gate";
import { Sheet } from "@/components/income/sheet";
import { TextField } from "@/components/text-field";
import { TextLink } from "@/components/text-link";
import { money } from "@/lib/income-format";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { spacing, text } from "@/theme";
import { accountBalance, minorToInputString } from "@fin-creador/domain";

/** "Update cash in hand": set the cash held now (a correction, not income). */
export default function CashSheet() {
  return (
    <Sheet title="Update cash in hand">
      <IncomeGate>{(data) => <CashForm data={data} />}</IncomeGate>
    </Sheet>
  );
}

function CashForm({ data }: { data: IncomePageData }) {
  const router = useRouter();
  const cash = data.accounts.find((a) => a.kind === "cash" && !a.archived);
  const [amount, setAmount] = useState(cash ? minorToInputString(accountBalance(cash), cash.currency) : "");
  const { save, busy, fieldErrors, formError } = useSave();

  if (!cash) {
    return (
      <View style={styles.gap}>
        <FormMessage tone="info" message="You don't have Cash in hand yet." />
        <Button label="Add cash" onPress={() => router.replace({ pathname: "/sheets/account", params: { kind: "cash" } })} />
      </View>
    );
  }

  return (
    <View style={styles.gap}>
      <Text style={text.bodySmall}>Now: {money(accountBalance(cash), cash.currency)}</Text>
      {formError ? <FormMessage tone="error" message={formError} /> : null}
      <TextField
        label="Cash you have now"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        hint={`In ${cash.currency}. This corrects the amount; it isn't counted as income.`}
        error={fieldErrors.amount}
      />
      <Button label="Update cash in hand" fullWidth loading={busy} onPress={() => void save(() => updateCashOnHand(getSupabase(), { accountId: cash.id, amount }))} />
      <View style={styles.link}>
        <Text style={text.bodySmall}>Received cash as income?</Text>
        <TextLink label="Add income" onPress={() => router.replace({ pathname: "/sheets/income", params: { accountId: cash.id } })} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing[4] },
  link: { flexDirection: "row", alignItems: "center", gap: spacing[1], flexWrap: "wrap" },
});
