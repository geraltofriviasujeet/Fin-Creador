import { CircleAlert } from "lucide-react-native";
import { type Ref, useState } from "react";
import { StyleSheet, Text, TextInput, type TextInputInstance, type TextInputProps, View } from "react-native";
import { colors, fontFamily, fontSize, radius, spacing, text } from "@/theme";

type Props = Omit<TextInputProps, "style"> & {
  label: string;
  hint?: string;
  error?: string;
  ref?: Ref<TextInputInstance>;
};

/** Labelled input with hint and error (design-spec §6). Darker border so it reads as a control. */
export function TextField({ label, hint, error, ref, onFocus, onBlur, editable = true, ...props }: Props) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.accentDeep : colors.lineStrong;
  const description = [hint, error].filter(Boolean).join(". ");

  return (
    <View style={styles.field}>
      <Text style={text.label} nativeID={`${label}-label`}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={description || undefined}
        aria-invalid={!!error}
        editable={editable}
        placeholderTextColor={colors.mutedSubtle}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          { borderColor, borderWidth: focused || error ? 2 : 1 },
          !editable && styles.readOnly,
        ]}
        {...props}
      />
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
  input: {
    minHeight: 48,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    fontFamily: fontFamily.body,
    fontSize: fontSize.base,
    color: colors.ink,
  },
  readOnly: { backgroundColor: colors.canvas },
  error: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorText: { color: colors.danger, fontFamily: fontFamily.bodyMedium },
});
