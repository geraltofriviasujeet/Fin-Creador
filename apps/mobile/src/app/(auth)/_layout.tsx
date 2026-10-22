import { Stack } from "expo-router";
import { colors } from "@/theme";

export const unstable_settings = { anchor: "sign-in" };

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />;
}
