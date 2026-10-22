import { StyleSheet, Text, View } from "react-native";
import { Card, CardTitle } from "@/components/card";
import { Logo } from "@/components/logo";
import { Screen } from "@/components/screen";
import { spacing, text } from "@/theme";

/** Shown instead of the app when public configuration is missing or unsafe. Names variables, never values. */
export function ConfigError({ problems }: { problems: string[] }) {
  return (
    <Screen edges={["top", "bottom"]} centered>
      <View style={styles.logo}>
        <Logo tone="onLight" />
      </View>
      <Card style={styles.card}>
        <CardTitle>App configuration needed</CardTitle>
        {problems.map((p) => (
          <Text key={p} style={text.bodySmall}>
            • {p}
          </Text>
        ))}
        <Text style={text.bodySmall}>Fill in apps/mobile/.env.local (see .env.example) and restart Expo.</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { alignItems: "center" },
  card: { gap: spacing[2] },
});
