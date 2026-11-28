import { type LedgerItem, type Lookup, type TransactionTotals, accountChipText, dayHeading, entryKindLabel, entryTitle } from "@fin-creador/api";
import { type IsoDate, formatMoney } from "@fin-creador/domain";
import { ArrowLeftRight, ScanLine, Search, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AmountText, Card, IconTile, Tag } from "@/components/ds";
import { SWIPE_ACCESSIBILITY_ACTIONS, SwipeRow } from "@/components/activity/swipe-row";
import { categoryIcon } from "@/components/transactions/entry-icon";
import { dayTotalLabel, dayTotalText, summaryText } from "@/lib/activity-text";
import { dsText, fontFamily, mobile, spacing } from "@/theme";

// The pieces of the phone's Activity tab (Sprint 13b PR 4, design-spec §5 "Activity").

// ---- Header ---------------------------------------------------------------------------

type HeaderProps = {
  /** The search applied to the list ("" for none). */
  query: string;
  onSearch: (q: string) => void;
  onImportUpi: () => void;
};

/** "Activity" with Search and Import UPI; Search opens a field under the title (all time while set). */
export function ActivityHeader({ query, onSearch, onImportUpi }: HeaderProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(query !== "");
  const [text, setText] = useState(query);
  // The search ended elsewhere (a month chip, Clear filters): close the field too.
  const [shownQuery, setShownQuery] = useState(query);
  if (shownQuery !== query) {
    setShownQuery(query);
    if (query === "") {
      setText("");
      setOpen(false);
    }
  }
  const close = () => {
    setText("");
    setOpen(false);
    if (query) onSearch("");
  };
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing[2] }]}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={[dsText.screenTitle, styles.flex]}>
          Activity
        </Text>
        <IconButton icon={Search} label="Search entries" selected={open} onPress={() => (open ? close() : setOpen(true))} />
        <IconButton icon={ScanLine} label="Import UPI" onPress={onImportUpi} />
      </View>
      {open ? (
        <View style={styles.searchRow}>
          <Search size={18} color={mobile.colors.mutedSubtle} />
          <TextInput
            accessibilityLabel="Search all time"
            accessibilityHint="Notes, category and account names, or an exact amount. Searches when you press search on the keyboard."
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => onSearch(text.trim())}
            placeholder="Note, category, account or amount"
            placeholderTextColor={mobile.colors.mutedSubtle}
            returnKeyType="search"
            maxLength={100}
            autoFocus={query === ""}
            style={styles.searchInput}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Close search" onPress={close} style={({ pressed }) => [styles.clear, pressed && styles.pressed]}>
            <X size={18} color={mobile.colors.ink} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function IconButton({ icon: Icon, label, selected, onPress }: { icon: typeof Search; label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-expanded={selected}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, selected && styles.iconButtonOn, pressed && styles.pressed]}
    >
      <Icon size={22} color={selected ? mobile.colors.onForest : mobile.colors.ink} />
    </Pressable>
  );
}

// ---- Money in / Money out ---------------------------------------------------------------

type SummaryProps = {
  totals: TransactionTotals;
  previous: { totals: TransactionTotals; month: IsoDate } | null;
  currency: string;
  /** "Nov", "All time" or a custom range. */
  label: string;
};

/** Two tiles (whole rupees) and the net with the savings rate; transfers and other currencies are said, not added. */
export function Summary({ totals, previous, currency, label }: SummaryProps) {
  const s = summaryText(totals, currency, previous);
  const notes = [
    totals.transferCount > 0 ? `${totals.transferCount} ${totals.transferCount === 1 ? "transfer" : "transfers"} between your accounts ${totals.transferCount === 1 ? "isn't" : "aren't"} money in or out.` : "",
    totals.otherCurrencyCount > 0 ? `${totals.otherCurrencyCount} in other currencies ${totals.otherCurrencyCount === 1 ? "is" : "are"} listed, not totalled.` : "",
  ].filter(Boolean);
  return (
    <View style={styles.summary}>
      <View style={styles.tiles}>
        <Tile title={`Money in · ${label}`} value={`+${s.moneyIn}`} spoken={`Money in, ${label}: ${s.moneyIn}`} tone="moneyIn" />
        <Tile title={`Money out · ${label}`} value={`−${s.moneyOut}`} spoken={`Money out, ${label}: ${s.moneyOut}`} tone="ink" />
      </View>
      <View accessible accessibilityLabel={[s.net, s.rate, s.trend].filter(Boolean).join(". ")} style={styles.netRow}>
        <Text style={[dsText.bodyStrong, { color: mobile.colors[s.netTone] }]}>{s.net}</Text>
        <Text style={dsText.caption}>
          {s.rate}
          {s.trend ? ` · ${s.trend}` : ""}
        </Text>
      </View>
      {notes.length > 0 ? <Text style={dsText.caption}>{notes.join(" ")}</Text> : null}
    </View>
  );
}

function Tile({ title, value, spoken, tone }: { title: string; value: string; spoken: string; tone: "moneyIn" | "ink" }) {
  return (
    <View accessible accessibilityLabel={spoken} style={styles.tile}>
      <Text style={dsText.label} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[dsText.cardTitle, styles.tabular, { color: mobile.colors[tone] }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

// ---- Day groups -------------------------------------------------------------------------

const TINT = { expense: "peach", income: "mint", transfer: "blue", refund: "mint" } as const;

type DayProps = {
  date: IsoDate;
  today: IsoDate;
  rows: LedgerItem[];
  totals: { inMinor: number; outMinor: number } | null;
  currency: string;
  lookup: Lookup;
  onOpen: (entry: LedgerItem) => void;
  /** The swipe (and accessibility) actions: Edit opens Add, Void opens the entry at its void step. */
  onEdit: (entry: LedgerItem) => void;
  onVoid: (entry: LedgerItem) => void;
  /** The one row whose swipe actions are showing. */
  swipedId: string | null;
  onSwipe: (id: string | null) => void;
};

/** One day: its heading and total (left out while the day may continue on the next page), then its entries. */
export function DayGroup({ date, today, rows, totals, currency, lookup, onOpen, onEdit, onVoid, swipedId, onSwipe }: DayProps) {
  const heading = dayHeading(date, today);
  const total = dayTotalText(totals, currency);
  return (
    <Card style={styles.day}>
      <View accessible accessibilityRole="header" accessibilityLabel={[heading, dayTotalLabel(totals, currency)].filter(Boolean).join(". ")} style={styles.dayHeader}>
        <Text style={styles.dayTitle}>{heading}</Text>
        {total ? <Text style={styles.dayTotal}>{total}</Text> : null}
      </View>
      {rows.map((entry) => (
        <SwipeRow
          key={entry.id}
          enabled={!entry.voided}
          open={swipedId === entry.id}
          onOpenChange={(open) => onSwipe(open ? entry.id : null)}
          onEdit={() => onEdit(entry)}
          onVoid={() => onVoid(entry)}
        >
          {(guard) => <EntryRow entry={entry} lookup={lookup} onPress={guard(() => onOpen(entry))} onEdit={() => onEdit(entry)} onVoid={() => onVoid(entry)} />}
        </SwipeRow>
      ))}
    </Card>
  );
}

type RowProps = { entry: LedgerItem; lookup: Lookup; onPress: () => void; onEdit: () => void; onVoid: () => void };

function EntryRow({ entry, lookup, onPress, onEdit, onVoid }: RowProps) {
  const title = entryTitle(entry, lookup);
  const subtitle = `${entryKindLabel(entry, lookup)} · ${accountChipText(entry, lookup)}`;
  const category = entry.categoryId ? lookup.categories.get(entry.categoryId) : undefined;
  const icon = entry.type === "transfer" ? ArrowLeftRight : categoryIcon(category?.icon);
  const direction = entry.type === "expense" ? "out" : entry.type === "transfer" ? "neutral" : "in";
  const amount = { minor: entry.amountMinor, direction, currency: entry.currency, whole: false } as const;
  const tags = [entry.replacesId ? "Edited" : null, entry.voided ? "Voided" : null].filter((t): t is string => t !== null);
  const spoken = [
    title,
    subtitle,
    ...tags,
    entry.voided ? "not counted" : null,
    entry.voided && entry.voidReason ? `Reason: ${entry.voidReason}` : null,
    `${direction === "in" ? "Money in" : direction === "out" ? "Money out" : "Moved"}, ${formatMoney(entry.amountMinor, { currency: entry.currency })}`,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={entry.voided ? "Opens details and history" : "Opens details, edit, void and history. Swipe left, or use actions, for Edit and Void."}
      accessibilityActions={entry.voided ? undefined : [...SWIPE_ACCESSIBILITY_ACTIONS]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === "edit" ? onEdit() : e.nativeEvent.actionName === "void" ? onVoid() : undefined)}
      onPress={onPress}
    >
      {({ pressed }) => (
        <View style={[styles.row, pressed && styles.rowPressed]}>
          <IconTile icon={icon} tint={TINT[entry.type]} />
          <View style={styles.rowText}>
            <Text style={[dsText.bodyStrong, entry.voided && styles.muted]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={dsText.caption} numberOfLines={1}>
              {subtitle}
            </Text>
            {tags.length > 0 ? (
              <View style={styles.tags}>
                {tags.map((t) => (
                  <Tag key={t} label={t} tone={t === "Voided" ? "warning" : "neutral"} />
                ))}
              </View>
            ) : null}
          </View>
          <AmountText {...amount} style={entry.voided ? styles.struck : undefined} />
        </View>
      )}
    </Pressable>
  );
}

// ---- Skeleton ---------------------------------------------------------------------------

/** Grey blocks in the shape of the tiles and a day of entries while the first page loads. */
export function ActivitySkeleton() {
  return (
    <View accessible accessibilityLabel="Loading activity" accessibilityState={{ busy: true }} style={styles.skeleton}>
      <View style={styles.tiles}>
        <View style={[styles.block, styles.tileBlock]} />
        <View style={[styles.block, styles.tileBlock]} />
      </View>
      <View style={[styles.block, styles.listBlock]} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  header: { backgroundColor: mobile.colors.canvas, paddingHorizontal: spacing[4], paddingBottom: spacing[2], gap: spacing[2] },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
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
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minHeight: mobile.tapTarget,
    paddingLeft: spacing[3],
    borderRadius: mobile.radius.tile,
    borderWidth: 1,
    borderColor: mobile.colors.lineStrong,
    backgroundColor: mobile.colors.surface,
  },
  searchInput: { flex: 1, minHeight: mobile.tapTarget, fontFamily: fontFamily.body, fontSize: mobile.type.body.size, color: mobile.colors.ink },
  clear: { width: mobile.tapTarget, height: mobile.tapTarget, alignItems: "center", justifyContent: "center" },
  summary: { gap: spacing[2] },
  tiles: { flexDirection: "row", gap: spacing[3] },
  tile: { flex: 1, gap: spacing[1], backgroundColor: mobile.colors.surface, borderRadius: mobile.radius.card, padding: spacing[4] },
  tabular: { fontVariant: ["tabular-nums"] },
  netRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: spacing[2], rowGap: 2 },
  day: { paddingVertical: spacing[2], gap: 0 },
  dayHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2], minHeight: 32 },
  dayTitle: { ...dsText.caption, fontFamily: fontFamily.bodySemibold, color: mobile.colors.muted },
  dayTotal: { ...dsText.caption, fontFamily: fontFamily.bodySemibold, color: mobile.colors.ink, fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3], minHeight: 64, paddingVertical: spacing[2] },
  rowPressed: { backgroundColor: mobile.colors.canvas },
  rowText: { flex: 1, gap: 2 },
  tags: { flexDirection: "row", gap: spacing[1], marginTop: 2 },
  muted: { color: mobile.colors.muted },
  struck: { textDecorationLine: "line-through", color: mobile.colors.muted },
  skeleton: { gap: spacing[4] },
  block: { backgroundColor: mobile.categoryTints.grey, borderRadius: mobile.radius.card },
  tileBlock: { flex: 1, height: 84 },
  listBlock: { height: 240 },
});
