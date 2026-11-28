import { formatClockTime } from "@fin-creador/domain";
import { CircleAlert, CloudOff } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { Button, Card } from "@/components/ds";
import type { LoadedState } from "@/lib/use-loaded";
import { dsText, mobile, spacing } from "@/theme";

// Loading, offline and error states for one Plan section (Sprint 13c). Each section loads on its
// own, so one that fails says so in its own card and leaves the others to show.

export function SectionSkeleton({ label }: { label: string }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.skeleton}>
      <View style={[styles.block, styles.short]} />
      <View style={[styles.block, styles.tall]} />
      <View style={styles.block} />
    </View>
  );
}

/** A first load that failed: offline or a server error, with Retry. */
export function SectionUnavailable({ state, what, retry }: { state: { status: "offline" } | { status: "error"; message: string }; what: string; retry: () => void }) {
  const offline = state.status === "offline";
  const Icon = offline ? CloudOff : CircleAlert;
  return (
    <Card>
      <View style={styles.row}>
        <Icon size={18} color={mobile.colors.warning} />
        <Text style={[dsText.body, styles.flex]}>{offline ? `You're offline. ${capital(what)} will load when your phone is back online.` : state.message}</Text>
      </View>
      <View style={styles.start}>
        <Button label={offline ? "Try again" : "Retry"} variant="secondary" size="small" onPress={retry} accessibilityLabel={`${offline ? "Try again" : "Retry"}: ${what}`} />
      </View>
    </Card>
  );
}

/** A refresh that failed over data already shown: one quiet line, the data stays. */
export function SectionProblem<T>({ state, retry, timeZone }: { state: LoadedState<T>; retry: () => void; timeZone?: string }) {
  if (state.status !== "ready" || !state.problem) return null;
  const text =
    state.problem === "offline"
      ? `You're offline. Showing what was loaded${timeZone ? ` at ${formatClockTime(state.loadedAt, timeZone)}` : " earlier"}.`
      : "We couldn't refresh this. Showing what was loaded earlier.";
  return (
    <View style={styles.row}>
      <Text style={[dsText.caption, styles.warning, styles.flex]}>{text}</Text>
      <Button label="Retry" variant="secondary" size="small" onPress={retry} />
    </View>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  skeleton: { backgroundColor: mobile.colors.surface, borderRadius: mobile.radius.card, padding: mobile.card.padding, gap: spacing[3] },
  block: { height: 14, borderRadius: 6, backgroundColor: mobile.colors.canvas },
  short: { width: "40%" },
  tall: { height: 32, width: "60%" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  flex: { flex: 1 },
  warning: { color: mobile.colors.warning },
  start: { alignSelf: "flex-start" },
});
