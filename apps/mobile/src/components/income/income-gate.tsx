import type { IncomePageData } from "@fin-creador/api";
import { RotateCw } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { useIncome } from "@/lib/income-store";
import { colors, spacing } from "@/theme";

/** Loading / "no network" error with retry / content, for every screen and sheet that needs Income data. */
export function IncomeGate({ children }: { children: (data: IncomePageData) => ReactNode }) {
  const { state, refresh } = useIncome();
  if (state.status === "loading") {
    return (
      <View style={styles.center} accessibilityLabel="Loading income" accessibilityState={{ busy: true }}>
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
  error: { gap: spacing[3], paddingVertical: spacing[4] },
});
