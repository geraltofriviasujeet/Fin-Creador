import { Stack } from "expo-router";
import { Platform } from "react-native";
import { IncomeDataProvider } from "@/lib/income-store";
import { colors, fontFamily } from "@/theme";

// Add / edit sheets (design-spec §5–6), set in one place. iOS: the standard modal card
// (slides up, swipe down to dismiss). Android: full-screen modal. Native "formSheet" was
// tried first but rendered empty on both platforms in device tests (its flex: 1 content
// got no height). Native headers are hidden, so each sheet draws its own title row.
const SHEET = {
  presentation: (Platform.OS === "android" ? "fullScreenModal" : "modal") as "fullScreenModal" | "modal",
  headerShown: false,
  contentStyle: { backgroundColor: colors.surface },
};

export const unstable_settings = { anchor: "(tabs)" };

export default function AppLayout() {
  return (
    <IncomeDataProvider>
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.canvas },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: fontFamily.heading, color: colors.ink },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
      <Stack.Screen name="income" options={{ title: "Income" }} />
      <Stack.Screen name="sheets/income" options={SHEET} />
      <Stack.Screen name="sheets/account" options={SHEET} />
      <Stack.Screen name="sheets/source" options={SHEET} />
      <Stack.Screen name="sheets/entries" options={SHEET} />
      <Stack.Screen name="sheets/archived" options={SHEET} />
      <Stack.Screen name="sheets/cash" options={SHEET} />
    </Stack>
    </IncomeDataProvider>
  );
}
