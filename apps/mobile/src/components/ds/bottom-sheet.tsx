import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dsText, mobile, spacing } from "@/theme";
import { useReducedMotion } from "./motion";

export type BottomSheetProps = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Render in place instead of in a Modal (design-system preview only). */
  inline?: boolean;
};

/**
 * Sheet that slides up from the bottom (no slide when the OS asks to reduce motion). The
 * backdrop and the close button both dismiss it; Android back closes it too.
 */
export function BottomSheet({ visible, title, onClose, children, inline }: BottomSheetProps) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const panel = (
    <View
      accessibilityViewIsModal
      style={[styles.panel, !inline && styles.panelCapped, { paddingBottom: insets.bottom + spacing[5] }]}
    >
      <View style={styles.handle} importantForAccessibility="no" accessibilityElementsHidden />
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[dsText.cardTitle, styles.title]}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          onPress={onClose}
          style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
        >
          <X size={20} color={mobile.colors.ink} />
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );

  if (inline) return visible ? <View style={styles.inline}>{panel}</View> : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? "none" : "slide"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdropWrap}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close sheet" style={styles.backdrop} onPress={onClose} />
        {panel}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: mobile.colors.scrim },
  inline: { borderRadius: mobile.radius.card, overflow: "hidden", borderWidth: 1, borderColor: mobile.colors.line },
  panel: {
    backgroundColor: mobile.colors.surface,
    borderTopLeftRadius: mobile.radius.card,
    borderTopRightRadius: mobile.radius.card,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[2],
  },
  // 90% of the screen in the Modal. Not inline: a percentage of a content-sized parent is
  // circular and clipped the last row.
  panelCapped: { maxHeight: "90%" },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: mobile.colors.line,
    marginBottom: spacing[2],
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  title: { flex: 1 },
  close: {
    width: mobile.tapTarget,
    height: mobile.tapTarget,
    borderRadius: mobile.radius.chip,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: mobile.categoryTints.grey,
  },
  closePressed: { backgroundColor: mobile.colors.line },
  // Grow to fit every row; shrink (and scroll) only when the panel hits its max height.
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { paddingTop: spacing[3], gap: spacing[3] },
});
