import { type BellReminder, loadBellReminders } from "@fin-creador/api";
import { useFocusEffect, useRouter } from "expo-router";
import { Bell, type LucideIcon, Settings } from "lucide-react-native";
import { type ReactNode, useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BellSheet } from "@/components/home/home-header";
import { getSupabase } from "@/lib/supabase";
import { dsText, fontFamily, mobile, spacing } from "@/theme";

// The header of a tab that draws its own (Activity, Plan; 13c PR 3): the screen title on the
// canvas and round icon buttons on the right. No add button: the raised + in the tab bar is the
// only one (owner).

export function TabHeader({ title, children }: { title: string; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing[2] }]}>
      <Text accessibilityRole="header" style={[dsText.screenTitle, styles.flex]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function HeaderIconButton({ icon: Icon, label, selected, badge, onPress }: {
  icon: LucideIcon;
  label: string;
  /** On (forest), for a toggle such as Search; also told to screen readers as expanded. */
  selected?: boolean;
  /** A count on the button (the bell); 0 or none shows nothing. */
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} due` : label}
      aria-expanded={selected}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, selected && styles.iconButtonOn, pressed && styles.pressed]}
    >
      <Icon size={22} color={selected ? mobile.colors.onForest : mobile.colors.ink} />
      {badge ? (
        <View style={styles.badge} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Bell (the same list as Home's, read on each visit) and Settings, for a tab's header. */
export function BellAndSettings() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reminders, setReminders] = useState<BellReminder[] | null>(null);
  const [failed, setFailed] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      loadBellReminders(getSupabase())
        .then((r) => {
          if (!live) return;
          setReminders(r);
          setFailed(r === null);
        })
        .catch(() => live && setFailed(true));
      return () => {
        live = false;
      };
    }, []),
  );
  return (
    <>
      <HeaderIconButton icon={Bell} label="Notifications" badge={reminders?.length ?? 0} onPress={() => setOpen(true)} />
      <HeaderIconButton icon={Settings} label="Settings" onPress={() => router.push("/settings")} />
      <BellSheet
        visible={open}
        onClose={() => setOpen(false)}
        reminders={reminders}
        pendingText={failed ? "We couldn't load your reminders. Check your connection and try again." : "Loading reminders…"}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing[2], backgroundColor: mobile.colors.canvas, paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  iconButton: {
    width: mobile.tapTarget,
    height: mobile.tapTarget,
    borderRadius: mobile.radius.chip,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: mobile.colors.surface,
    borderWidth: 1,
    borderColor: mobile.colors.line,
  },
  iconButtonOn: { backgroundColor: mobile.colors.forest, borderColor: mobile.colors.forest },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: mobile.colors.warning,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: fontFamily.bodyBold, fontSize: mobile.type.min.size, lineHeight: 16, color: mobile.colors.surface },
});
