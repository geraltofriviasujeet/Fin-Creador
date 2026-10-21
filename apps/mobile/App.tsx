import { colors, fontSize, spacing } from "@fin-creador/design-tokens";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

// Bare shell. Navigation, Manrope/DM Sans via expo-font, and screens arrive in Step 4.
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fin Creador</Text>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[4],
    backgroundColor: colors.canvas,
  },
  title: {
    color: colors.ink,
    fontSize: fontSize["2xl"],
    fontWeight: "700",
  },
});
