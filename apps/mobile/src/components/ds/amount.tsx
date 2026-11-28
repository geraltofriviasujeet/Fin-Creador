import { Delete } from "lucide-react-native";
import { Pressable, StyleSheet, Text, type TextStyle, View } from "react-native";
import { dsText, fontFamily, mobile, spacing } from "@/theme";
import { KEYPAD_ROWS, type Direction, type KeypadKey, amountInputState, formatAmount, keypadKeyLabel } from "./logic";

type AmountSize = "hero" | "title" | "body" | "caption";

const sizeStyle: Record<AmountSize, TextStyle> = {
  hero: dsText.hero,
  title: dsText.cardTitle,
  body: { ...dsText.bodyStrong },
  caption: { ...dsText.caption, fontFamily: fontFamily.bodySemibold },
};

export type AmountTextProps = {
  /** Minor units (paise). */
  minor: number;
  direction?: Direction;
  currency?: string;
  /** Whole rupees (default, for summaries) or exact paise. */
  whole?: boolean;
  size?: AmountSize;
  /** On the forest hero card: white text (money-in green does not meet AA on forest). */
  onDark?: boolean;
  style?: TextStyle;
};

/**
 * A money figure: Indian grouping via packages/domain, a minus for money out and a plus
 * (and green) for money in. The sign and the spoken label carry the meaning, never colour alone.
 */
export function AmountText({ minor, direction, currency, whole, size = "body", onDark, style }: AmountTextProps) {
  const a = formatAmount(minor, { direction, currency, whole });
  const color = onDark ? mobile.colors.onForest : mobile.colors[a.tone];
  return (
    <Text accessibilityRole="text" accessibilityLabel={a.label} style={[sizeStyle[size], styles.tabular, { color }, style]}>
      {a.text}
    </Text>
  );
}

export type AmountInputProps = {
  /** What has been typed on the keypad, e.g. "1250.5". */
  value: string;
  currency?: string;
  label?: string;
  error?: string;
};

/** The large amount above the keypad. It is read-only: the NumberKeypad edits `value`. */
export function AmountInput({ value, currency = "INR", label = "Amount", error }: AmountInputProps) {
  const s = amountInputState(value, currency);
  const empty = value === "";
  return (
    <View style={styles.inputWrap}>
      <Text style={dsText.label}>{label}</Text>
      <Text
        accessibilityRole="text"
        accessibilityLabel={error ? `${s.label}. Error: ${error}` : s.label}
        accessibilityLiveRegion="polite"
        style={[dsText.hero, styles.tabular, empty && styles.placeholder]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {s.display}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export type NumberKeypadProps = {
  onKey: (key: KeypadKey) => void;
  disabled?: boolean;
  /** Draw this key pressed (design-system preview only). */
  forcePressedKey?: KeypadKey;
  /** 48px keys instead of 56px (still above the 44px tap target), so Add's date and note row fits above it on a 390×844 phone. */
  compact?: boolean;
};

const KEY_HEIGHT = 56;
const KEY_HEIGHT_COMPACT = 48;

/** 4×3 number keypad: digits, decimal point and delete. Every key is 56px tall (48px compact). */
export function NumberKeypad({ onKey, disabled, forcePressedKey, compact }: NumberKeypadProps) {
  return (
    <View accessibilityLabel="Number keypad" style={styles.pad}>
      {KEYPAD_ROWS.map((row) => (
        <View key={row.join("")} style={styles.padRow}>
          {row.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={keypadKeyLabel(key)}
              aria-disabled={!!disabled}
              disabled={disabled}
              onPress={() => onKey(key)}
              style={({ pressed }) => [
                styles.key,
                compact && styles.keyCompact,
                (pressed || forcePressedKey === key) && styles.keyPressed,
                disabled && styles.keyDisabled,
              ]}
            >
              {key === "back" ? (
                <Delete size={24} color={mobile.colors.ink} strokeWidth={2} />
              ) : (
                <Text style={styles.keyText}>{key}</Text>
              )}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ["tabular-nums"] },
  inputWrap: { alignItems: "center", gap: spacing[1], paddingVertical: spacing[3] },
  placeholder: { color: mobile.colors.mutedSubtle },
  error: { ...dsText.caption, color: mobile.colors.warning, fontFamily: fontFamily.bodySemibold },
  pad: { gap: spacing[2] },
  padRow: { flexDirection: "row", gap: spacing[2] },
  key: {
    flex: 1,
    height: KEY_HEIGHT,
    minWidth: mobile.tapTarget,
    borderRadius: mobile.radius.tile,
    backgroundColor: mobile.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  keyCompact: { height: KEY_HEIGHT_COMPACT },
  keyPressed: { backgroundColor: mobile.categoryTints.grey },
  keyDisabled: { opacity: 0.45 },
  keyText: { fontFamily: fontFamily.headingSemibold, fontSize: mobile.type.screenTitle.size - 4, color: mobile.colors.ink },
});
