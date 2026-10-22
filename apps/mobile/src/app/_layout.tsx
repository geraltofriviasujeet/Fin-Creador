// Per-weight imports so only these six font files are bundled.
import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_500Medium } from "@expo-google-fonts/dm-sans/500Medium";
import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import { DMSans_700Bold } from "@expo-google-fonts/dm-sans/700Bold";
import { Manrope_600SemiBold } from "@expo-google-fonts/manrope/600SemiBold";
import { Manrope_700Bold } from "@expo-google-fonts/manrope/700Bold";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ConfigError } from "@/components/config-error";
import { ToastProvider } from "@/components/toast";
import { AuthProvider, useAuth } from "@/lib/auth";
import { readPublicEnv } from "@/lib/env";
import { colors } from "@/theme";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_600SemiBold,
    Manrope_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });
  const env = readPublicEnv();

  // If fonts fail to load the app still works with system fonts.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {env.ok ? (
        <AuthProvider>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </AuthProvider>
      ) : (
        <HideSplash>
          <ConfigError problems={env.problems} />
        </HideSplash>
      )}
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const auth = useAuth();
  const ready = auth.status !== "loading";
  const signedIn = auth.status === "signedIn";

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // Protected groups: signed-out users can only reach (auth), signed-in users only (app).
  // Explicit redirects: "/" lives inside (app), and (auth) has no index route, so the
  // router's default fallback ("/(auth)") would land on "Unmatched route".
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Protected guard={signedIn} redirectTo="/sign-in">
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn} redirectTo="/">
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Screen name="auth/callback" />
    </Stack>
  );
}

function HideSplash({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return children;
}
