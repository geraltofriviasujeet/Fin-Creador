import type { TransactionsContext } from "@fin-creador/api";
import { RotateCw } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { useTransactions } from "@/lib/transactions-store";
import { colors, spacing } from "@/theme";

/** Loading / "no network" error with retry / content, for the Activity tab and its sheets. */
export function TransactionsGate({ children }: { children: (data: TransactionsContext) => ReactNode }) {
  const { state, refresh } = useTransactions();
  if (state.status === "loading") {
    return (
      <View style={styles.center} accessibilityLabel="Loading transactions" accessibilityState={{ busy: true }}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }
  if (state.status === "error") {
    return (
      <View style={styles.error}>
        <FormMessage tone="error" message={state.message} />
        <Button label="Try again" variant="secondary" icon={RotateCw} onPress={() => void refresh()} />
      </View>
    );
  }
  return <>{children(state.data)}</>;
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing[10], alignItems: "center" },
  error: { gap: spacing[3] },
});
