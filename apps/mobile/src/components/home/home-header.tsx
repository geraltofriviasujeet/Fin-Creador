import { type BellReminder, reminderText } from "@fin-creador/api";
import { formatDayMonth, formatLongDate, greetingFor } from "@fin-creador/domain";
import { type Href, useRouter } from "expo-router";
import {
  BarChart3,
  Bell,
  CalendarClock,
  LineChart,
  LogOut,
  Repeat,
  Settings,
  UserRound,
  Wallet,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, ListRow } from "@/components/ds";
import { useToast } from "@/components/toast";
import { signOut } from "@/lib/auth-actions";
import { comingSoonMessage } from "@/navigation";
import { dsText, fontFamily, mobile, spacing } from "@/theme";
import { initials } from "./home-text";

type Props = {
  /** Null until Home has loaded (the greeting then shows without a name, the date as a placeholder). */
  profile: { name: string | null; timeZone: string } | null;
  reminders: BellReminder[] | null;
  now: Date;
};

/** Home's header (design-spec §5): avatar menu top-left, greeting and date, the bell top-right. */
export function HomeHeader({ profile, reminders, now }: Props) {
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const count = reminders?.length ?? 0;
  const mark = initials(profile?.name ?? null);

  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing[2] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile menu"
        accessibilityHint="Accounts, Recurring, Settings and Sign out"
        onPress={() => setMenuOpen(true)}
        style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
      >
        {mark ? <Text style={styles.avatarText}>{mark}</Text> : <UserRound size={22} color={mobile.colors.lime} />}
      </Pressable>

      <View style={styles.titles}>
        {profile ? (
          <>
            <Text accessibilityRole="header" style={dsText.cardTitle} numberOfLines={1}>
              {greetingFor(profile.name, now, profile.timeZone)}
            </Text>
            <Text style={dsText.caption}>{formatLongDate(now, profile.timeZone)}</Text>
          </>
        ) : (
          <View accessible accessibilityLabel="Loading your name and date" style={styles.placeholderWrap}>
            <View style={[styles.placeholder, styles.placeholderWide]} />
            <View style={styles.placeholder} />
          </View>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={count > 0 ? `Notifications, ${count} due` : "Notifications"}
        onPress={() => setBellOpen(true)}
        style={({ pressed }) => [styles.bell, pressed && styles.pressed]}
      >
        <Bell size={22} color={mobile.colors.ink} />
        {count > 0 ? (
          <View style={styles.badge} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Text style={styles.badgeText}>{count > 9 ? "9+" : count}</Text>
          </View>
        ) : null}
      </Pressable>

      <AvatarMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
      <BellSheet visible={bellOpen} onClose={() => setBellOpen(false)} reminders={reminders} />
    </View>
  );
}

function AvatarMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const go = (href: Href) => {
    onClose();
    router.push(href);
  };
  const soon = (label: string) => {
    onClose();
    toast.show(comingSoonMessage(label));
  };
  return (
    <BottomSheet visible={visible} title="Menu" onClose={onClose}>
      <ListRow icon={Wallet} tint="mint" title="Accounts and income" subtitle="Balances, income and sources" onPress={() => go("/income")} />
      <ListRow icon={Repeat} tint="blue" title="Recurring" subtitle="Bills, EMIs and salary that repeat" onPress={() => go("/recurring")} />
      <ListRow icon={LineChart} tint="lavender" title="Investments" tag="Coming soon" onPress={() => soon("Investments")} />
      <ListRow icon={BarChart3} tint="lavender" title="Reports" tag="Coming soon" onPress={() => soon("Reports")} />
      <ListRow icon={Settings} tint="grey" title="Settings" subtitle="Profile, currency and time zone" onPress={() => go("/settings")} />
      <ListRow
        icon={LogOut}
        tint="peach"
        title="Sign out"
        onPress={() => {
          onClose();
          void signOut(); // the router returns to sign-in when the session ends
        }}
      />
    </BottomSheet>
  );
}

/** The same list as the web bell: EMIs, card bills, repayments and dues overdue, today or tomorrow. */
function BellSheet({ visible, onClose, reminders }: { visible: boolean; onClose: () => void; reminders: BellReminder[] | null }) {
  return (
    <BottomSheet visible={visible} title="Due soon" onClose={onClose}>
      {reminders === null ? (
        <Text style={dsText.body}>Reminders will show once Home has loaded.</Text>
      ) : reminders.length === 0 ? (
        <Text style={dsText.body}>Nothing due today or tomorrow.</Text>
      ) : (
        reminders.map((r) => (
          <ListRow
            key={r.id}
            icon={CalendarClock}
            tint={r.reason === "overdue" ? "peach" : "grey"}
            title={r.name}
            subtitle={[r.label, reminderText(r), r.dueDate ? formatDayMonth(r.dueDate) : null].filter(Boolean).join(" · ")}
            amount={r.amountMinor === null ? undefined : { minor: r.amountMinor, currency: r.currency }}
          />
        ))
      )}
    </BottomSheet>
  );
}

const AVATAR = 44;

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    backgroundColor: mobile.colors.canvas,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: mobile.colors.forest,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: fontFamily.heading, fontSize: mobile.type.body.size, color: mobile.colors.lime },
  titles: { flex: 1, minWidth: 0 },
  placeholderWrap: { gap: spacing[2] },
  placeholder: { height: 12, width: "40%", borderRadius: 6, backgroundColor: mobile.colors.line },
  placeholderWide: { height: 18, width: "70%" },
  bell: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: mobile.colors.surface,
    borderWidth: 1,
    borderColor: mobile.colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
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
  pressed: { opacity: 0.7 },
});
