import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Calendar, CircleAlert } from "lucide-react-native";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { isoToLocalDate, localDateToIso, shortDate } from "@/lib/income-format";
import { colors, fontFamily, fontSize, radius, spacing, text } from "@/theme";

type Props = { label: string; value: string; max: string; onChange: (iso: string) => void; hint?: string; error?: string };

/** Native date picker (calendar dates only). `max` is today from the database, never the phone clock. */
export function DateField({ label, value, max, onChange, hint, error }: Props) {
  const pick = (date?: Date) => {
    if (!date) return;
    const iso = localDateToIso(date);
    onChange(iso > max ? max : iso);
  };

  return (
    <View style={styles.field}>
      <Text style={text.label}>{label}</Text>
      {Platform.OS === "ios" ? (
        <View style={styles.iosRow}>
          <DateTimePicker
            value={isoToLocalDate(value)}
            maximumDate={isoToLocalDate(max)}
            mode="date"
            display="compact"
            accessibilityLabel={label}
            onValueChange={(_, date) => pick(date)}
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${shortDate(value)}`}
          accessibilityHint={[hint, error, "Opens a calendar"].filter(Boolean).join(". ")}
          onPress={() =>
            DateTimePickerAndroid.open({
              value: isoToLocalDate(value),
              maximumDate: isoToLocalDate(max),
              mode: "date",
              // Called only when a date is chosen; dismissing changes nothing.
              onValueChange: (_, date) => pick(date),
            })
          }
          style={({ pressed }) => [
            styles.control,
            { borderColor: error ? colors.danger : colors.lineStrong, borderWidth: error ? 2 : 1 },
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.value}>{shortDate(value)}</Text>
          <Calendar size={18} color={colors.mutedSubtle} />
        </Pressable>
      )}
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
  iosRow: { alignItems: "flex-start" },
  control: {
    minHeight: 48,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  pressed: { backgroundColor: colors.canvas },
  value: { flex: 1, fontFamily: fontFamily.body, fontSize: fontSize.base, color: colors.ink },
  error: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorText: { color: colors.danger, fontFamily: fontFamily.bodyMedium },
});
