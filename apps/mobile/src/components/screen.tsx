import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { type Edge, SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";

type Props = {
  children: ReactNode;
  /** Safe-area edges this screen pads itself; headers and tab bars handle the rest. */
  edges?: Edge[];
  /** Centre the content vertically (auth screens). */
  centered?: boolean;
};

/** Scrollable page on the canvas background, keyboard-aware so focused inputs stay visible. */
export function Screen({ children, edges = [], centered }: Props) {
  return (
    <SafeAreaView edges={edges} style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, centered && styles.centered]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View style={styles.inner}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: spacing[4], paddingBottom: spacing[8] },
  centered: { justifyContent: "center" },
  // Comfortable reading width on tablets.
  inner: { width: "100%", maxWidth: 560, alignSelf: "center", gap: spacing[4] },
});
