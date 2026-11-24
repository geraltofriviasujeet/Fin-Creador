import { type HomeBill, type HomeData, billDisplayMinor, heroText, shortWarnings } from "@fin-creador/api";
import { formatDayMonth } from "@fin-creador/domain";
import { type Href, useRouter } from "expo-router";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  CreditCard,
  FileText,
  HandCoins,
  Landmark,
  type LucideIcon,
  ScanLine,
  Sparkles,
  Wallet,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatAmount } from "@/components/ds/logic";
import { AmountText, Card, IconTile, ListRow, ProgressBar, SectionHeader, WarningBanner } from "@/components/ds";
import { useToast } from "@/components/toast";
import { categoryIcon } from "@/components/transactions/entry-icon";
import { comingSoonMessage } from "@/navigation";
import { dsText, mobile, spacing } from "@/theme";

// Home's sections (design-spec §5). Every figure comes from HomeData (packages/api buildHome);
// amounts go through AmountText / formatAmount, dates through the domain formatters.

const addSheet = (type: "expense" | "income" | "transfer"): Href => ({ pathname: "/sheets/transaction", params: { type } });

export function HeroCard({ home }: { home: HomeData }) {
  const hero = heroText(home);
  return (
    <Card tone="forest" style={styles.hero}>
      <View accessible accessibilityLabel={hero.label} style={styles.heroTop}>
        <Text style={[dsText.label, styles.onForestMuted]}>{hero.title}</Text>
        <View style={styles.heroLine}>
          <AmountText minor={hero.amountMinor} currency={home.currency} size="hero" onDark />
          {hero.suffix ? <Text style={[dsText.body, styles.onForestMuted]}>{hero.suffix}</Text> : null}
        </View>
        {hero.lines.map((line) =>
          hero.short && line === hero.lines[0] ? (
            // The shortfall reads as a problem: warning colour and icon (never lime, which reads as good).
            <View key={line} style={styles.shortLine}>
              <CircleAlert size={18} color={mobile.colors.warningOnForest} style={styles.shortIcon} />
              <Text style={[dsText.bodyStrong, styles.warningOnForest, styles.shrink]}>{line}</Text>
            </View>
          ) : (
            <Text key={line} style={[dsText.bodyStrong, styles.onForest]}>
              {line}
            </Text>
          ),
        )}
      </View>
      {hero.spentBar ? (
        <View style={styles.bar}>
          <ProgressBar value={hero.spentBar.value} label={hero.spentBar.label} warnAt={null} color={mobile.colors.lime} />
          <Text style={[dsText.caption, styles.onForestMuted]}>{hero.spentBar.label}</Text>
        </View>
      ) : null}
      <View style={styles.figures}>
        {hero.figures.map((f) => (
          <View key={f.label} style={styles.figure} accessible accessibilityLabel={`${f.label}: ${formatAmount(f.minor, { currency: home.currency }).label}`}>
            <Text style={[dsText.label, styles.onForestMuted]}>{f.label}</Text>
            <AmountText minor={f.minor} currency={home.currency} size="body" onDark />
          </View>
        ))}
      </View>
    </Card>
  );
}

function QuickAction({ icon, tint, label, onPress }: { icon: LucideIcon; tint: "peach" | "mint" | "lavender" | "blue"; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <IconTile icon={icon} tint={tint} />
      <Text style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function QuickActions() {
  const router = useRouter();
  const toast = useToast();
  return (
    <View style={styles.actions} accessibilityRole="toolbar" accessibilityLabel="Quick actions">
      <QuickAction icon={ArrowUpRight} tint="peach" label="Expense" onPress={() => router.push(addSheet("expense"))} />
      <QuickAction icon={ArrowDownLeft} tint="mint" label="Income" onPress={() => router.push(addSheet("income"))} />
      <QuickAction icon={ScanLine} tint="lavender" label="Import UPI" onPress={() => toast.show(comingSoonMessage("Import UPI"))} />
      <QuickAction icon={ArrowLeftRight} tint="blue" label="Transfer" onPress={() => router.push(addSheet("transfer"))} />
    </View>
  );
}

const BILL_ICONS: Record<HomeBill["kind"], LucideIcon> = { bill: CalendarClock, emi: Landmark, card: CreditCard, borrowing: HandCoins, statutory: FileText };

export function ComingUp({ home }: { home: HomeData }) {
  const router = useRouter();
  const warnings = shortWarnings(home);
  return (
    <View style={styles.section}>
      <SectionHeader title="Coming up" action={{ label: "See all", onPress: () => router.push("/recurring"), accessibilityLabel: "See all bills that repeat" }} />
      {warnings.map((w) => (
        <WarningBanner key={w} message={w} />
      ))}
      <Card>
        {home.comingUp.length === 0 ? (
          <Text style={[dsText.body, styles.muted]}>No bills, EMIs or card dues in the next 30 days.</Text>
        ) : (
          home.comingUp.map((b) => (
            <ListRow
              key={b.id}
              icon={b.kind === "bill" ? categoryIcon(b.icon) : BILL_ICONS[b.kind]}
              tint="peach"
              title={b.name}
              subtitle={`${formatDayMonth(b.dueDate)} · ${b.accountName ?? "No account set"}`}
              tag={b.overdue ? "Overdue" : undefined}
              tagTone="warning"
              amount={{ minor: billDisplayMinor(b), direction: "out", currency: b.currency }}
            />
          ))
        )}
        {home.comingUpMore > 0 ? <Text style={[dsText.caption, styles.more]}>{`${home.comingUpMore} more in the next 30 days`}</Text> : null}
      </Card>
    </View>
  );
}

export function WhereItWent({ home }: { home: HomeData }) {
  const { where, currency } = home;
  return (
    <View style={styles.section}>
      <SectionHeader title="Where it went" />
      <Card>
        {where.categories.length === 0 ? (
          <Text style={[dsText.body, styles.muted]}>No spending recorded this month yet.</Text>
        ) : (
          <>
            <View style={styles.totalLine}>
              <Text style={dsText.caption}>Spent this month</Text>
              <AmountText minor={where.spentMinor} currency={currency} size="title" />
            </View>
            {where.categories.map((c) => (
              <View key={c.id} style={styles.category}>
                <ListRow icon={categoryIcon(c.icon)} tint="grey" title={c.name} amount={{ minor: c.spentMinor, currency }} />
                {c.budget ? (
                  <ProgressBar
                    value={c.budget.usedBps / 10_000}
                    label={`${c.name}: ${c.budget.usedBps >= 10_000 ? "over" : "within"} budget`}
                  />
                ) : null}
                {c.budget ? (
                  <View style={styles.budgetLine}>
                    <Text style={dsText.caption}>Budget left</Text>
                    <AmountText minor={c.budget.leftMinor} currency={currency} size="caption" />
                  </View>
                ) : null}
              </View>
            ))}
          </>
        )}
      </Card>
    </View>
  );
}

const ACCOUNT_ICONS = { bank: Landmark, cash: Banknote, other: Wallet } as const;

export function YourMoney({ home }: { home: HomeData }) {
  const router = useRouter();
  const { money, currency } = home;
  return (
    <View style={styles.section}>
      <SectionHeader title="Your money" action={{ label: "See all", onPress: () => router.push("/income"), accessibilityLabel: "See all accounts and income" }} />
      <Card>
        {money.accounts.map((a) => (
          <ListRow
            key={a.id}
            icon={ACCOUNT_ICONS[a.kind]}
            tint="mint"
            title={a.label}
            subtitle={a.inTotal ? undefined : `${a.currency}, not in the total`}
            amount={{ minor: a.balanceMinor, currency: a.currency }}
          />
        ))}
        <View style={styles.totalLine}>
          <Text style={dsText.bodyStrong}>Total available</Text>
          <AmountText minor={money.totalMinor} currency={currency} size="title" />
        </View>
      </Card>
    </View>
  );
}

export function AskRomaCard() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ask Roma"
      accessibilityHint="Opens Roma, your finance agent"
      onPress={() => router.navigate("/roma")}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={styles.roma}>
        <IconTile icon={Sparkles} tint="lavender" />
        <View style={styles.flex}>
          <Text style={dsText.cardTitle}>Ask Roma</Text>
          <Text style={dsText.caption}>Questions about your spending, bills and goals.</Text>
        </View>
        <ChevronRight size={20} color={mobile.colors.mutedSubtle} />
      </Card>
    </Pressable>
  );
}

/** Grey blocks in Home's layout while it loads. */
export function HomeSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading Home" style={styles.skeleton}>
      <View style={[styles.block, styles.heroBlock]} />
      <View style={styles.actions}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.block, styles.actionBlock]} />
        ))}
      </View>
      <View style={[styles.block, styles.listBlock]} />
      <View style={[styles.block, styles.listBlock]} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { gap: spacing[4] },
  heroTop: { gap: spacing[1] },
  heroLine: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: spacing[2] },
  onForest: { color: mobile.colors.onForest },
  onForestMuted: { color: mobile.colors.onForestMuted },
  warningOnForest: { color: mobile.colors.warningOnForest },
  shortLine: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2] },
  shortIcon: { marginTop: 2 },
  shrink: { flexShrink: 1 },
  bar: { gap: spacing[1] },
  figures: { flexDirection: "row", gap: spacing[3] },
  figure: { flex: 1, gap: 2 },
  actions: { flexDirection: "row", gap: spacing[2] },
  action: {
    flex: 1,
    alignItems: "center",
    gap: spacing[1],
    paddingVertical: spacing[3],
    borderRadius: mobile.radius.tile,
    backgroundColor: mobile.colors.surface,
    minHeight: mobile.tapTarget,
  },
  actionLabel: { ...dsText.label, color: mobile.colors.ink },
  pressed: { opacity: 0.75 },
  section: { gap: spacing[2] },
  muted: { color: mobile.colors.muted },
  more: { paddingTop: spacing[2] },
  totalLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing[2] },
  budgetLine: { flexDirection: "row", justifyContent: "space-between" },
  category: { gap: spacing[1], paddingBottom: spacing[2] },
  roma: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  skeleton: { gap: spacing[4] },
  block: { backgroundColor: mobile.colors.line, borderRadius: mobile.radius.card },
  heroBlock: { height: 220, backgroundColor: mobile.colors.forest, opacity: 0.25 },
  actionBlock: { flex: 1, height: 84, borderRadius: mobile.radius.tile },
  listBlock: { height: 160 },
});
