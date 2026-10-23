import { useRouter } from "expo-router";
import { Bell, Plus, Settings } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/button";
import { Logo } from "@/components/logo";
import { useToast } from "@/components/toast";
import { comingSoonMessage } from "@/navigation";
import { colors, spacing } from "@/theme";

/** Top bar for the tab screens (design-spec §5): logo, notifications (coming soon), settings, add transaction. */
export function AppHeader() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing[2] }]}>
      <Logo tone="onLight" />
      <View style={styles.actions}>
        <Button
          label="Notifications"
          variant="secondary"
          icon={Bell}
          iconOnly
          onPress={() => toast.show(comingSoonMessage("Notifications"))}
        />
        <Button label="Settings" variant="secondary" icon={Settings} iconOnly onPress={() => router.push("/settings")} />
        <Button label="Add transaction" icon={Plus} iconOnly onPress={() => router.push({ pathname: "/sheets/transaction", params: { type: "expense" } })} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  actions: { flexDirection: "row", gap: spacing[2] },
});
