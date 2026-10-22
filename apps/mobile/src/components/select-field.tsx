import { Check, ChevronDown, CircleAlert, Search, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/button";
import { colors, fontFamily, fontSize, radius, spacing, text } from "@/theme";

export type Option = { value: string; label: string };

type Props = {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  searchPlaceholder: string;
};

const ROW_HEIGHT = 52;

/**
 * Field that opens a full-screen searchable list. Countries, currencies and ~420 time
 * zones are too many for a wheel picker.
 */
export function SelectField({ label, value, options, onChange, hint, error, searchPlaceholder }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <View style={styles.field}>
      <Text style={text.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? value}`}
        accessibilityHint={[hint, error, "Opens a searchable list"].filter(Boolean).join(". ")}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.control,
          { borderColor: error ? colors.danger : colors.lineStrong, borderWidth: error ? 2 : 1 },
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.value} numberOfLines={1}>
          {selected?.label ?? value}
        </Text>
        <ChevronDown size={18} color={colors.mutedSubtle} />
      </Pressable>
      {hint && !error ? <Text style={text.caption}>{hint}</Text> : null}
      {error ? (
        <View style={styles.error} accessibilityLiveRegion="polite">
          <CircleAlert size={14} color={colors.danger} />
          <Text style={[text.caption, styles.errorText]}>{error}</Text>
        </View>
      ) : null}

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
        <SafeAreaView style={styles.sheet} edges={["top", "bottom"]}>
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={[text.cardTitle, styles.flex]}>
              {label}
            </Text>
            <Button label="Close" variant="ghost" icon={X} iconOnly onPress={close} />
          </View>
          <View style={styles.search}>
            <Search size={18} color={colors.mutedSubtle} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.mutedSubtle}
              accessibilityLabel={`Search ${label.toLowerCase()}`}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              style={styles.searchInput}
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
            ListEmptyComponent={<Text style={[text.bodySmall, styles.empty]}>No matches for “{query.trim()}”.</Text>}
            renderItem={({ item }) => {
              const isSelected = item.value === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    onChange(item.value);
                    close();
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <Text style={[styles.rowText, isSelected && styles.rowSelected]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {isSelected ? <Check size={18} color={colors.ink} /> : null}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  flex: { flex: 1 },
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
  sheet: { flex: 1, backgroundColor: colors.surface },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: spacing[4],
    paddingRight: spacing[2],
    paddingVertical: spacing[2],
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
    paddingHorizontal: spacing[3],
    minHeight: 48,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  searchInput: { flex: 1, fontFamily: fontFamily.body, fontSize: fontSize.base, color: colors.ink, minHeight: 46 },
  row: {
    height: ROW_HEIGHT,
    paddingHorizontal: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowText: { flex: 1, fontFamily: fontFamily.body, fontSize: fontSize.base, color: colors.ink },
  rowSelected: { fontFamily: fontFamily.bodySemibold },
  empty: { padding: spacing[4], textAlign: "center" },
});
