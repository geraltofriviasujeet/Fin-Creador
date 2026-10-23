import { fullDate, newRequestKey, skipRecurringOccurrence } from "@fin-creador/api";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { Sheet } from "@/components/income/sheet";
import { TextField } from "@/components/text-field";
import { TransactionsGate } from "@/components/transactions/transactions-gate";
import { NETWORK_ERROR } from "@/lib/income-store";
import { param } from "@/lib/income-format";
import { useRecurringItem } from "@/lib/recurring";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { spacing, text } from "@/theme";

/** Skip the due date of a recurring item: nothing is saved for it. */
export default function RecurringSkipSheet() {
  const item = useRecurringItem(param(useLocalSearchParams<{ id?: string }>().id));
  // One key per opened sheet; a retry after a failure reuses it, so the date is skipped once.
  const [requestKey] = useState(newRequestKey);
  const [reason, setReason] = useState("");
  const { save, busy, fieldErrors, formError } = useSave();
  const date = item?.kind === "due" ? item.date : null;
  return (
    <Sheet eyebrow="Recurring" title={date ? `Skip ${fullDate(date)}?` : "Skip"}>
      <TransactionsGate>
        {() =>
          !item || !date ? (
            <FormMessage tone="error" message="This date is no longer due. Pull to refresh the list." />
          ) : (
            <View style={styles.gap}>
              <Text style={text.bodySmall}>
                Nothing is saved for this date. Use it when you already added the entry by hand, or it didn&apos;t happen this time. You can undo it while it is the latest date handled.
              </Text>
              {formError ? <FormMessage tone="error" message={formError} /> : null}
              <TextField label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="e.g. Added by hand" maxLength={200} error={fieldErrors.reason} />
              <Button
                label="Skip"
                fullWidth
                loading={busy}
                onPress={() =>
                  void save(() =>
                    skipRecurringOccurrence(getSupabase(), { ruleId: item.rule.id, occurrenceDate: date, reason, idempotencyKey: requestKey }).catch(() => ({
                      status: "error" as const,
                      message: NETWORK_ERROR,
                    }))
                  )
                }
              />
            </View>
          )
        }
      </TransactionsGate>
    </Sheet>
  );
}

const styles = StyleSheet.create({ gap: { gap: spacing[4] } });
