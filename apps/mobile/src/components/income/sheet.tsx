import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/button";
import { colors, fontFamily, fontSize, spacing, text } from "@/theme";

/**
 * Content of a bottom-sheet route (design-spec §6/§9): eyebrow, title, close button, then a
 * keyboard-aware scrolling body. Native headers don't render inside form sheets, so the
 * title row is part of the content.
 */
export function Sheet({ eyebrow, title, children }: { eyebrow?: string; title: string; children: ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.body,
          // Android shows sheets as full-screen modals (see app/(app)/_layout.tsx): clear the
          // status bar. The iOS modal card already sits below it.
          { paddingTop: (Platform.OS === "android" ? insets.top : 0) + spacing[5], paddingBottom: insets.bottom + spacing[8] },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.titles}>
            {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
            <Text accessibilityRole="header" style={text.pageTitle}>
              {title}
            </Text>
          </View>
          <Button label="Close" variant="secondary" icon={X} iconOnly onPress={() => router.back()} />
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  body: { padding: spacing[5], gap: spacing[4] },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing[3] },
  titles: { flex: 1, gap: spacing[1] },
  eyebrow: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.xs, letterSpacing: 1.4, color: colors.muted },
});
