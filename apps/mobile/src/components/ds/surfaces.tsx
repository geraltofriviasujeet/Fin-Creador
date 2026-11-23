import type { CategoryTint } from "@fin-creador/design-tokens";
import { ChevronRight, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { dsText, fontFamily, mobile, spacing } from "@/theme";
import { AmountText } from "./amount";
import { type Direction, formatAmount, hitSlopFor, listRowLabel } from "./logic";

// ---- Card ----------------------------------------------------------------------------

export type CardProps = {
  children: ReactNode;
  /** forest = the hero card (white and lime text only). */
  tone?: "surface" | "forest";
  accessibilityLabel?: string;
  style?: ViewStyle;
};

/** White card, radius 22, padding 18, no shadow (design-spec §5). */
export function Card({ children, tone = "surface", accessibilityLabel, style }: CardProps) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessible={accessibilityLabel ? true : undefined}
      style={[styles.card, tone === "forest" && styles.forest, style]}
    >
      {children}
    </View>
  );
}

// ---- SectionHeader -------------------------------------------------------------------

export type SectionHeaderProps = {
  title: string;
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
};

/** Section title with an optional text action ("See all"). The action has a 44px tap area. */
export function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={dsText.cardTitle}>
        {title}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? `${action.label}, ${title}`}
          onPress={action.onPress}
          style={({ pressed }) => [styles.sectionAction, pressed && styles.pressedText]}
        >
          <Text style={styles.sectionActionText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---- IconTile ------------------------------------------------------------------------

export function IconTile({ icon: Icon, tint, size = 44 }: { icon: LucideIcon; tint: CategoryTint; size?: number }) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.iconTile, { width: size, height: size, backgroundColor: mobile.categoryTints[tint] }]}
    >
      <Icon size={Math.round(size * 0.48)} color={mobile.colors.ink} strokeWidth={2} />
    </View>
  );
}

// ---- ListRow -------------------------------------------------------------------------

export type ListRowProps = {
  icon: LucideIcon;
  tint: CategoryTint;
  title: string;
  subtitle?: string;
  /** Amount in minor units, with its direction. */
  amount?: { minor: number; direction?: Direction; whole?: boolean };
  /** Small tag such as "Imported". */
  tag?: string;
  onPress?: () => void;
  forcePressed?: boolean;
};

/** Icon tile, title and subtitle, optional tag, amount on the right. At least 64px tall. */
export function ListRow({ icon, tint, title, subtitle, amount, tag, onPress, forcePressed }: ListRowProps) {
  const amountLabel = amount ? formatAmount(amount.minor, amount).label : undefined;
  const label = listRowLabel({ title, subtitle, tag, amountLabel });
  const body = (pressed: boolean) => (
    <View style={[styles.row, (pressed || forcePressed) && styles.rowPressed]}>
      <IconTile icon={icon} tint={tint} />
      <View style={styles.rowText}>
        <Text style={dsText.bodyStrong} numberOfLines={1}>
          {title}
        </Text>
        {subtitle || tag ? (
          <View style={styles.rowSubtitleLine}>
            {subtitle ? (
              <Text style={[dsText.caption, styles.shrink]} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
            {tag ? <Tag label={tag} /> : null}
          </View>
        ) : null}
      </View>
      {amount ? <AmountText minor={amount.minor} direction={amount.direction} whole={amount.whole} /> : null}
      {onPress ? <ChevronRight size={18} color={mobile.colors.mutedSubtle} /> : null}
    </View>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label}>
        {body(false)}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

export function Tag({ label }: { label: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{label}</Text>
    </View>
  );
}

// ---- CategoryTile --------------------------------------------------------------------

export type CategoryTileProps = {
  icon: LucideIcon;
  tint: CategoryTint;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  forcePressed?: boolean;
};

/** Category choice in the Add screen's 4×2 grid. Selection shows a forest ring and a heavier label. */
export function CategoryTile({ icon, tint, label, selected, disabled, onPress, forcePressed }: CategoryTileProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={!!selected} aria-selected={!!selected} aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.categoryTile,
        selected && styles.categorySelected,
        (pressed || forcePressed) && styles.categoryPressed,
        disabled && styles.disabled,
      ]}
    >
      <IconTile icon={icon} tint={tint} size={40} />
      <Text style={[styles.categoryLabel, selected && styles.categoryLabelSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---- Chip ----------------------------------------------------------------------------

export type ChipProps = {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  onPress?: () => void;
  forcePressed?: boolean;
};

const CHIP_HEIGHT = 36;

/** Filter or suggestion chip, pill-shaped. Selected = forest fill with white text. */
export function Chip({ label, selected, disabled, icon: Icon, onPress, forcePressed }: ChipProps) {
  const fg = selected ? mobile.colors.onForest : mobile.colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-selected={!!selected} aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      hitSlop={hitSlopFor(CHIP_HEIGHT, 64)}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        (pressed || forcePressed) && !selected && styles.chipPressed,
        disabled && styles.disabled,
      ]}
    >
      {Icon ? <Icon size={16} color={fg} /> : null}
      <Text style={[styles.chipText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

// ---- SegmentedControl ----------------------------------------------------------------

export type SegmentedOption<T extends string> = { value: T; label: string };

export type SegmentedControlProps<T extends string> = {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
};

/** Expense / Income / Transfer style switch: a tab list, the selected segment white on grey. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, disabled }: SegmentedControlProps<T>) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={styles.segmented}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            aria-selected={selected} aria-disabled={!!disabled}
            disabled={disabled}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && styles.segmentSelected, disabled && !selected && styles.disabled]}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobile.colors.surface,
    borderRadius: mobile.radius.card,
    padding: mobile.card.padding,
    gap: spacing[3],
  },
  forest: { backgroundColor: mobile.colors.forest },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: mobile.tapTarget },
  sectionAction: { minHeight: mobile.tapTarget, minWidth: mobile.tapTarget, justifyContent: "center", alignItems: "flex-end" },
  sectionActionText: { fontFamily: fontFamily.bodySemibold, fontSize: mobile.type.caption.size + 1, color: mobile.colors.ink, textDecorationLine: "underline" },
  pressedText: { opacity: 0.6 },
  iconTile: { borderRadius: mobile.radius.tileSm, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3], minHeight: 64, paddingVertical: spacing[2] },
  rowPressed: { backgroundColor: mobile.colors.canvas },
  rowText: { flex: 1, gap: 2 },
  // It wraps under the subtitle when both do not fit, so neither is cut short.
  rowSubtitleLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing[2], rowGap: 4 },
  shrink: { flexShrink: 1 },
  tag: {
    borderRadius: mobile.radius.chip,
    backgroundColor: mobile.categoryTints.lavender,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  tagText: { fontFamily: fontFamily.bodySemibold, fontSize: mobile.type.min.size, color: mobile.colors.ink },
  categoryTile: {
    flex: 1,
    minHeight: 84,
    minWidth: mobile.tapTarget,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    borderRadius: mobile.radius.tileLg,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: mobile.colors.surface,
    paddingVertical: spacing[2],
  },
  categorySelected: { borderColor: mobile.colors.forest },
  categoryPressed: { backgroundColor: mobile.colors.canvas },
  categoryLabel: { fontFamily: fontFamily.bodyMedium, fontSize: mobile.type.min.size, color: mobile.colors.ink },
  categoryLabelSelected: { fontFamily: fontFamily.bodyBold },
  disabled: { opacity: 0.45 },
  chip: {
    minHeight: CHIP_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingHorizontal: spacing[4],
    borderRadius: mobile.radius.chip,
    borderWidth: 1,
    borderColor: mobile.colors.line,
    backgroundColor: mobile.colors.surface,
    alignSelf: "flex-start",
  },
  chipSelected: { backgroundColor: mobile.colors.forest, borderColor: mobile.colors.forest },
  chipPressed: { backgroundColor: mobile.colors.canvas },
  chipText: { fontFamily: fontFamily.bodySemibold, fontSize: mobile.type.caption.size + 1 },
  segmented: {
    flexDirection: "row",
    backgroundColor: mobile.categoryTints.grey,
    borderRadius: mobile.radius.tile,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: mobile.tapTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: mobile.radius.tileSm - 2,
  },
  segmentSelected: { backgroundColor: mobile.colors.surface },
  segmentText: { fontFamily: fontFamily.bodyMedium, fontSize: mobile.type.caption.size + 1, color: mobile.colors.muted },
  segmentTextSelected: { fontFamily: fontFamily.bodyBold, color: mobile.colors.ink },
});
