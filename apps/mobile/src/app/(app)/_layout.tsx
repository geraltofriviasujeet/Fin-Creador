import { Stack } from "expo-router";
import { IncomeDataProvider } from "@/lib/income-store";
import { colors, fontFamily } from "@/theme";

// Add / edit sheets (design-spec §5–6): native form sheets at full height. Native headers
// don't render inside sheets, so each sheet draws its own title row. If Android's keyboard
// or the searchable lists misbehave in a sheet, switch `presentation` to "fullScreenModal"
// here (one place, no new library).
const SHEET = {
  presentation: "formSheet" as const,
  headerShown: false,
  sheetAllowedDetents: [1],
  sheetGrabberVisible: true,
  sheetCornerRadius: 24,
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
    </Stack>
    </IncomeDataProvider>
  );
}
