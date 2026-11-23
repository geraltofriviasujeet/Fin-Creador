// Design-system preview (Sprint 12c). Development builds only: app/dev/design-system.tsx
// requires this module inside `if (__DEV__)`, so production bundles never contain it
// (scripts/check-mobile-preview-excluded.mjs proves that in CI).
// Every figure here is SAMPLE DATA, never a person's real finances.
import {
  Bike,
  Car,
  Film,
  HeartPulse,
  House,
  Inbox,
  type LucideIcon,
  Plane,
  ShoppingBag,
  Utensils,
  Wallet,
  Zap,
} from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CategoryTint } from "@fin-creador/design-tokens";
import {
  AmountInput,
  AmountText,
  BalanceCard,
  BottomSheet,
  Button,
  Card,
  CategoryTile,
  Chip,
  EmptyState,
  type KeypadKey,
  ListRow,
  NumberKeypad,
  OfflineBanner,
  ProgressBar,
  ProgressRing,
  SectionHeader,
  SegmentedControl,
  TabBar,
  type TabKey,
  WarningBanner,
  applyKeypadKey,
} from "@/components/ds";
import { dsText, mobile, spacing } from "@/theme";

/** Unique string the production-bundle check looks for; keep it in this file only. */
export const DESIGN_SYSTEM_PREVIEW_MARKER = "fc-design-system-preview-7c1e";

const noop = () => undefined;

const CATEGORIES: readonly { key: string; label: string; icon: LucideIcon; tint: CategoryTint }[] = [
  { key: "food", label: "Food", icon: Utensils, tint: "peach" },
  { key: "shopping", label: "Shopping", icon: ShoppingBag, tint: "lavender" },
  { key: "transport", label: "Transport", icon: Car, tint: "blue" },
  { key: "home", label: "Home", icon: House, tint: "mint" },
  { key: "bills", label: "Bills", icon: Zap, tint: "grey" },
  { key: "health", label: "Health", icon: HeartPulse, tint: "peach" },
  { key: "fun", label: "Fun", icon: Film, tint: "lavender" },
  { key: "travel", label: "Travel", icon: Plane, tint: "blue" },
];

export function DesignSystemPreview() {
  const [typed, setTyped] = useState("1250");
  const [kind, setKind] = useState<"expense" | "income" | "transfer">("expense");
  const [category, setCategory] = useState("food");
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState<TabKey>("home");
  const [sheetOpen, setSheetOpen] = useState(false);
  const onKey = (key: KeypadKey) => setTyped((t) => applyKeypadKey(t, key));

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView testID={DESIGN_SYSTEM_PREVIEW_MARKER} contentContainerStyle={styles.content}>
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" style={dsText.screenTitle}>
            Design system
          </Text>
          <Text style={dsText.caption}>Development builds only. Sample figures, not real data.</Text>
        </View>

        <Section id="type" title="Type and amounts">
          <Card tone="forest">
            <Text style={[dsText.caption, { color: mobile.colors.onForestMuted }]}>Safe to spend today</Text>
            <AmountText minor={1_240_00} size="hero" onDark />
            <Text style={[dsText.caption, { color: mobile.colors.onForestMuted }]}>a day, until 1 Dec (sample)</Text>
          </Card>
          <Card>
            <Text style={dsText.screenTitle}>Screen title 28</Text>
            <Text style={dsText.cardTitle}>Card title 18</Text>
            <Text style={dsText.body}>Body 16: plain words like Money left and Bills due.</Text>
            <Text style={dsText.caption}>Caption 13</Text>
            <Text style={dsText.label}>Label 12 (the minimum)</Text>
          </Card>
          <Card>
            <Row label="Money out">
              <AmountText minor={420_00} direction="out" />
            </Row>
            <Row label="Money in">
              <AmountText minor={42_000_00} direction="in" />
            </Row>
            <Row label="Balance, Indian grouping">
              <AmountText minor={12_34_567_00} />
            </Row>
            <Row label="Overdrawn">
              <AmountText minor={-1_980_00} />
            </Row>
            <Row label="Exact paise">
              <AmountText minor={1_250_50} whole={false} direction="out" />
            </Row>
          </Card>
        </Section>

        <Section id="buttons" title="Buttons">
          <Card>
            <Button label="Save ₹1,250 expense" fullWidth onPress={noop} />
            <Button label="Pressed" fullWidth forcePressed onPress={noop} />
            <Button label="Disabled" fullWidth disabled onPress={noop} />
            <Button label="Saving" fullWidth loading onPress={noop} />
            <Button label="Secondary" variant="secondary" onPress={noop} />
            <Button label="Secondary pressed" variant="secondary" forcePressed onPress={noop} />
            <View style={styles.inline}>
              <Button label="Pay" size="small" onPress={noop} />
              <Button label="See all" size="small" variant="secondary" onPress={noop} />
              <Button label="Off" size="small" disabled onPress={noop} />
            </View>
          </Card>
        </Section>

        <Section id="add" title="Amount input and keypad">
          <Card>
            <SegmentedControl
              label="Entry type"
              value={kind}
              onChange={setKind}
              options={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
                { value: "transfer", label: "Transfer" },
              ]}
            />
            <SegmentedControl
              label="Entry type, locked"
              value="expense"
              onChange={noop}
              disabled
              options={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
              ]}
            />
            <AmountInput value={typed} />
            <AmountInput value="" label="Amount (empty)" />
            <AmountInput value="0" label="Amount (error)" error="Amount must be more than zero" />
            <NumberKeypad onKey={onKey} forcePressedKey="5" />
            <Text style={dsText.caption}>Key 5 is drawn pressed.</Text>
          </Card>
        </Section>

        <Section id="categories" title="Category tiles">
          <Card>
            {[CATEGORIES.slice(0, 4), CATEGORIES.slice(4)].map((row, i) => (
              <View key={i} accessibilityRole="radiogroup" accessibilityLabel="Category" style={styles.grid}>
                {row.map((c) => (
                  <CategoryTile
                    key={c.key}
                    icon={c.icon}
                    tint={c.tint}
                    label={c.label}
                    selected={category === c.key}
                    forcePressed={c.key === "transport"}
                    disabled={c.key === "travel"}
                    onPress={() => setCategory(c.key)}
                  />
                ))}
              </View>
            ))}
            <Text style={dsText.caption}>Selected: Food. Pressed: Transport. Disabled: Travel.</Text>
          </Card>
        </Section>

        <Section id="chips" title="Chips">
          <Card>
            <View style={styles.wrap}>
              {["all", "spent", "received", "transfers"].map((f) => (
                <Chip key={f} label={capitalise(f)} selected={filter === f} onPress={() => setFilter(f)} />
              ))}
            </View>
            <View style={styles.wrap}>
              <Chip label="Pressed" forcePressed onPress={noop} />
              <Chip label="Disabled" disabled onPress={noop} />
              <Chip label="Nov 2026" icon={Inbox} onPress={noop} />
            </View>
          </Card>
        </Section>

        <Section id="rows" title="List rows">
          <Card>
            <SectionHeader title="Today" action={{ label: "See all", onPress: noop }} />
            <ListRow icon={Utensils} tint="peach" title="Lunch (sample)" subtitle="Food · Sample bank" amount={{ minor: 420_00, direction: "out" }} onPress={noop} />
            <ListRow
              icon={ShoppingBag}
              tint="lavender"
              title="Groceries (sample)"
              subtitle="Shopping · UPI"
              tag="Imported"
              amount={{ minor: 1_865_00, direction: "out" }}
              onPress={noop}
              forcePressed
            />
            <ListRow icon={Wallet} tint="mint" title="Salary (sample)" subtitle="Income · Sample bank" amount={{ minor: 85_000_00, direction: "in" }} />
            <ListRow icon={Bike} tint="blue" title="Bike EMI (sample)" subtitle="Due 5 Dec" amount={{ minor: 3_250_00, direction: "out" }} />
          </Card>
        </Section>

        <Section id="progress" title="Progress">
          <Card>
            <Text style={dsText.bodyStrong}>Food budget · 45% used, even-spend mark at 70%</Text>
            <ProgressBar value={0.45} marker={0.7} label="Food budget used" />
            <Text style={dsText.bodyStrong}>Shopping budget · 94% used (warning)</Text>
            <ProgressBar value={0.94} marker={0.7} label="Shopping budget used" />
            <Text style={dsText.bodyStrong}>EMIs paid · 8 of 24</Text>
            <ProgressBar value={8 / 24} warnAt={null} label="EMIs paid" />
            <View style={styles.inline}>
              <ProgressRing value={0.62} label="Goa trip goal" />
              <ProgressRing value={0.15} label="Emergency fund goal" color={mobile.colors.moneyIn} />
              <ProgressRing value={1} label="New phone goal" />
            </View>
          </Card>
        </Section>

        <Section id="banners" title="Banners and balance">
          <WarningBanner message="Rent on 1 Dec leaves you ₹1,980 short in Sample bank." action={{ label: "Move money", onPress: noop }} />
          <WarningBanner message="Shopping is at 94% of its budget." />
          <OfflineBanner detail="Showing what was saved at 9:42 PM." />
          <BalanceCard title="Paid from" account="Sample bank" beforeMinor={12_400_00} afterMinor={11_150_00} />
          <BalanceCard title="Paid from" account="Sample wallet" beforeMinor={600_00} afterMinor={-650_00} />
        </Section>

        <Section id="empty" title="Empty state">
          <Card>
            <EmptyState icon={Inbox} title="No entries yet" body="Add your first expense and it shows up here." action={{ label: "Add expense", onPress: noop }} />
          </Card>
        </Section>

        <Section id="sheet" title="Bottom sheet">
          <Button label={sheetOpen ? "Close sheet" : "Open sheet"} variant="secondary" onPress={() => setSheetOpen((o) => !o)} />
          <BottomSheet visible title="Pick an account (inline)" onClose={noop} inline>
            <ListRow icon={Wallet} tint="mint" title="Sample bank" amount={{ minor: 12_400_00 }} onPress={noop} />
            <ListRow icon={Wallet} tint="grey" title="Cash (sample)" amount={{ minor: 2_150_00 }} onPress={noop} />
          </BottomSheet>
          <BottomSheet visible={sheetOpen} title="Pick an account" onClose={() => setSheetOpen(false)}>
            <ListRow icon={Wallet} tint="mint" title="Sample bank" amount={{ minor: 12_400_00 }} onPress={() => setSheetOpen(false)} />
          </BottomSheet>
        </Section>

        <Section id="tabbar" title="Tab bar">
          <View style={styles.tabFrame}>
            <TabBar active={tab} onSelect={setTab} onAdd={noop} noSafeArea />
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <View testID={`ds-${id}`} style={styles.section}>
      <SectionHeader title={title} />
      {children}
    </View>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={dsText.caption}>{label}</Text>
      {children}
    </View>
  );
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: mobile.colors.canvas },
  content: { padding: spacing[5], gap: spacing[8], paddingBottom: spacing[12] },
  titleBlock: { gap: spacing[1] },
  section: { gap: mobile.card.gap },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 32 },
  inline: { flexDirection: "row", gap: spacing[3], alignItems: "center", flexWrap: "wrap" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  grid: { flexDirection: "row", gap: spacing[2] },
  tabFrame: { paddingTop: spacing[8], borderRadius: mobile.radius.card, overflow: "hidden", backgroundColor: mobile.colors.canvas },
});
