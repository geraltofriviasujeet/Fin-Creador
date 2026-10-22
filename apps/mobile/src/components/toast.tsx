import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, layoutBottomOffset, radius, spacing, text } from "@/theme";

type Toast = { id: number; message: string };
type ToastApi = { show: (message: string) => void };

const ToastContext = createContext<ToastApi>({ show: () => {} });

export const useToast = () => useContext(ToastContext);

const VISIBLE_MS = 3500;

/** One short message at a time, dark surface (design-spec §6), announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const reduceMotion = useRef(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => (reduceMotion.current = v));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => (reduceMotion.current = v));
    return () => sub.remove();
  }, []);

  const show = useCallback(
    (message: string) => {
      setToast({ id: Date.now(), message });
      AccessibilityInfo.announceForAccessibility(message);
      if (reduceMotion.current) opacity.setValue(1);
      else Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    },
    [opacity]
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      const done = () => setToast((t) => (t?.id === toast.id ? null : t));
      if (reduceMotion.current) {
        opacity.setValue(0);
        done();
      } else {
        Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(done);
      }
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toast, opacity]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[styles.toast, { opacity, bottom: insets.bottom + layoutBottomOffset }]}
        >
          <Text style={[text.bodySmall, styles.text]}>{toast.message}</Text>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: spacing[4],
    right: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.nav,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  text: { color: colors.navText },
});
