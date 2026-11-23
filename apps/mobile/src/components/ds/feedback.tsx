import { ArrowRight, CloudOff, type LucideIcon, TriangleAlert } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { dsText, fontFamily, mobile, spacing } from "@/theme";
import { Button } from "./button";
import { WARN_AT, balanceChangeLabel, clampProgress, isWarning, progressA11y } from "./logic";
import { Card } from "./surfaces";

// ---- ProgressBar ---------------------------------------------------------------------

export type ProgressBarProps = {
  /** 0..1 (may exceed 1 when over budget; drawn full). */
  value: number;
  /** What the bar measures, e.g. "Food budget used". */
  label: string;
  /** Even-spend marker, 0..1: where spending would be if spread evenly over the period. */
  marker?: number;
  /** Turn warning colour above this share; null to never warn (e.g. goals). */
  warnAt?: number | null;
  /** Bar colour when not warning. */
  color?: string;
};

/** Budget bar: forest fill, warning colour above 90%, optional even-spend marker. */
export function ProgressBar({ value, label, marker, warnAt = WARN_AT, color = mobile.colors.forest }: ProgressBarProps) {
  const a11y = progressA11y(value, warnAt);
  const warn = isWarning(value, warnAt);
  const markerText = marker === undefined ? "" : `, even-spend mark at ${Math.round(clampProgress(marker) * 100)} percent`;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      aria-valuemin={a11y.min} aria-valuemax={a11y.max} aria-valuenow={a11y.now} aria-valuetext={`${a11y.text}${markerText}`}
      style={styles.track}
    >
      <View
        style={[
          styles.fill,
          { width: `${clampProgress(value) * 100}%`, backgroundColor: warn ? mobile.colors.warning : color },
        ]}
      />
      {marker !== undefined ? <View style={[styles.marker, { left: `${clampProgress(marker) * 100}%` }]} /> : null}
    </View>
  );
}

// ---- ProgressRing --------------------------------------------------------------------

export type ProgressRingProps = {
  value: number;
  label: string;
  size?: number;
  stroke?: number;
  color?: string;
};

/** Goal progress ring with the percentage in the centre. */
export function ProgressRing({ value, label, size = 72, stroke = 8, color = mobile.colors.forest }: ProgressRingProps) {
  const a11y = progressA11y(value, null);
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * clampProgress(value);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      aria-valuemin={a11y.min} aria-valuemax={a11y.max} aria-valuenow={a11y.now} aria-valuetext={a11y.text}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={mobile.categoryTints.grey} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.ringCentre]}>
        <Text style={styles.ringText}>{a11y.now}%</Text>
      </View>
    </View>
  );
}

// ---- Banners -------------------------------------------------------------------------

export type WarningBannerProps = {
  message: string;
  action?: { label: string; onPress: () => void };
};

/** Peach banner with a warning icon, e.g. "Rent on 1 Dec leaves you ₹1,980 short in SBI". */
export function WarningBanner({ message, action }: WarningBannerProps) {
  return (
    <View style={[styles.banner, styles.warningBanner]}>
      <View accessible accessibilityRole="alert" accessibilityLabel={`Warning: ${message}`} style={styles.bannerBody}>
        <TriangleAlert size={20} color={mobile.colors.warning} strokeWidth={2.25} />
        <Text style={[dsText.body, styles.flex]}>{message}</Text>
      </View>
      {action ? <Button label={action.label} variant="secondary" size="small" onPress={action.onPress} /> : null}
    </View>
  );
}

export type OfflineBannerProps = {
  /** e.g. "Showing what was saved at 9:42 PM." */
  detail?: string;
};

/** Shown while the phone is offline: figures may be out of date. */
export function OfflineBanner({ detail }: OfflineBannerProps) {
  const message = "You're offline";
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={detail ? `${message}. ${detail}` : message}
      accessibilityLiveRegion="polite"
      style={[styles.banner, styles.offlineBanner]}
    >
      <CloudOff size={20} color={mobile.colors.onForest} />
      <View style={styles.flex}>
        <Text style={[dsText.bodyStrong, styles.onDark]}>{message}</Text>
        {detail ? <Text style={[dsText.caption, styles.onDarkMuted]}>{detail}</Text> : null}
      </View>
    </View>
  );
}

// ---- BalanceCard ---------------------------------------------------------------------

export type BalanceCardProps = {
  /** e.g. "Paid from". */
  title: string;
  account: string;
  beforeMinor: number;
  afterMinor: number;
  currency?: string;
};

/** "Paid from" row: the account's balance now → after this entry, with any shortfall in words. */
export function BalanceCard({ title, account, beforeMinor, afterMinor, currency = "INR" }: BalanceCardProps) {
  const b = balanceChangeLabel(account, beforeMinor, afterMinor, currency);
  return (
    <Card accessibilityLabel={`${title}: ${b.label}`}>
      <Text style={dsText.label}>{title}</Text>
      <Text style={dsText.bodyStrong}>{account}</Text>
      <View style={styles.balanceLine}>
        <Text style={[dsText.body, styles.muted]}>{b.before.text}</Text>
        <ArrowRight size={18} color={mobile.colors.mutedSubtle} />
        <Text style={[dsText.cardTitle, { color: mobile.colors[b.after.tone] }]}>{b.after.text}</Text>
      </View>
      {b.short ? (
        <View style={styles.shortLine}>
          <TriangleAlert size={16} color={mobile.colors.warning} />
          <Text style={styles.shortText}>{b.short}</Text>
        </View>
      ) : null}
    </Card>
  );
}

// ---- EmptyState ----------------------------------------------------------------------

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
};

export function EmptyState({ icon: Icon, title, body, action }: EmptyStateProps) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Icon size={28} color={mobile.colors.ink} />
      </View>
      <Text accessibilityRole="header" style={[dsText.cardTitle, styles.center]}>
        {title}
      </Text>
      {body ? <Text style={[dsText.body, styles.center, styles.muted]}>{body}</Text> : null}
      {action ? (
        <View style={styles.emptyAction}>
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

const BAR_HEIGHT = 10;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: "center" },
  muted: { color: mobile.colors.muted },
  onDark: { color: mobile.colors.onForest },
  onDarkMuted: { color: mobile.colors.onForestMuted },
  track: {
    height: BAR_HEIGHT,
    borderRadius: mobile.radius.chip,
    backgroundColor: mobile.categoryTints.grey,
    overflow: "visible",
    justifyContent: "center",
  },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: mobile.radius.chip },
  marker: {
    position: "absolute",
    top: -4,
    bottom: -4,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: mobile.colors.ink,
  },
  ringCentre: { alignItems: "center", justifyContent: "center" },
  ringText: { fontFamily: fontFamily.heading, fontSize: mobile.type.caption.size + 1, color: mobile.colors.ink },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: mobile.radius.tile,
    padding: spacing[4],
  },
  bannerBody: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  warningBanner: { backgroundColor: mobile.categoryTints.peach },
  offlineBanner: { backgroundColor: mobile.colors.forest },
  balanceLine: { flexDirection: "row", alignItems: "center", gap: spacing[2], flexWrap: "wrap" },
  shortLine: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  shortText: { ...dsText.caption, fontFamily: fontFamily.bodySemibold, color: mobile.colors.warning },
  empty: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[8], paddingHorizontal: spacing[5] },
  // Button sets alignSelf flex-start; this wrapper is what gets centred.
  emptyAction: { alignSelf: "center", marginTop: spacing[1] },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: mobile.radius.tileLg,
    backgroundColor: mobile.categoryTints.mint,
    alignItems: "center",
    justifyContent: "center",
  },
});
