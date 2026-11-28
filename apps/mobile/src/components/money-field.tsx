import { currencySymbol } from "@fin-creador/domain";
import { CircleAlert } from "lucide-react-native";
import { useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { cleanAmountTyping, groupTypedAmount } from "@/components/ds/logic";
import { colors, fontFamily, fontSize, radius, spacing, text } from "@/theme";

type Props = {
  label: string;
  /** The amount as typed, without grouping ("6000.5"); what the shared schemas parse. */
  value: string;
  onChange: (value: string) => void;
  currency: string;
  hint?: string;
  error?: string;
  autoFocus?: boolean;
  placeholder?: string;
};

/**
 * An amount in a form (13c PR 3, owner): the currency sign before it and Indian grouping as it is
 * typed ("₹6,000"), as Add shows the amount. Only digits and one point are kept; the value given
 * back has no grouping, so the shared schemas read it as before.
 */
export function MoneyField({ label, value, onChange, currency, hint, error, autoFocus, placeholder = "0" }: Props) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.accentDeep : colors.lineStrong;
  const symbol = currencySymbol(currency);
  const shown = groupTypedAmount(value);
  const description = [hint, error].filter(Boolean).join(". ");
  return (
    <View style={styles.field}>
      <Text style={text.label}>{label}</Text>
      <View style={[styles.box, { borderColor, borderWidth: focused || error ? 2 : 1 }]}>
        <Text style={styles.symbol} importantForAccessibility="no" accessibilityElementsHidden>
          {symbol}
        </Text>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={description || undefined}
          aria-invalid={!!error}
          value={shown}
          onChangeText={(t) => onChange(cleanAmountTyping(t, currency))}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          placeholderTextColor={colors.mutedSubtle}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, Platform.OS === "web" && styles.noWebOutline]}
        />
      </View>
      {hint && !error ? <Text style={text.caption}>{hint}</Text> : null}
      {error ? (
        <View style={styles.error} accessibilityLiveRegion="polite">
          <CircleAlert size={14} color={colors.danger} />
          <Text style={[text.caption, styles.errorText]}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  box: { flexDirection: "row", alignItems: "center", minHeight: 48, borderRadius: radius.control, backgroundColor: colors.surface, paddingHorizontal: spacing[3], gap: 4 },
  symbol: { fontFamily: fontFamily.bodySemibold, fontSize: fontSize.base, color: colors.ink },
  input: { flex: 1, minHeight: 44, fontFamily: fontFamily.body, fontSize: fontSize.base, color: colors.ink, fontVariant: ["tabular-nums"] },
  // The box draws the focus (2px border); the browser's own ring inside it would be a second one.
  noWebOutline: { outlineWidth: 0 },
  error: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorText: { color: colors.danger, fontFamily: fontFamily.bodyMedium },
});
