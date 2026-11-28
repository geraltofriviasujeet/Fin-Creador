import { type LedgerAccount, money } from "@fin-creador/api";
import { accountBalance } from "@fin-creador/domain";
import { Banknote, Check, ChevronRight, CreditCard, Landmark, Wallet } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheet, IconTile } from "@/components/ds";
import { cardPosition } from "@/lib/add-entry";
import { dsText, fontFamily, mobile, spacing } from "@/theme";

// The account rows and picker on Add (Sprint 13b PRs 2–3): "Paid from" (or Received into, From,
// To) with the balance before → after, and a bottom sheet listing each account with its
// balance now. Balances are the loaded figures (the server's account_balances); the "after"
// is the shared previewDraft's, informational only. A credit card (expenses and refunds only,
// as on the web) shows what is owed: "owed ₹6,000 → owed ₹7,250".

const accountIcon = (a: LedgerAccount) => (a.kind === "cash" ? Banknote : a.kind === "bank" ? Landmark : a.kind === "card" ? CreditCard : Wallet);

/** A balance as the row shows it: money for an account, "owed ₹X" for a card. */
const shown = (a: LedgerAccount, minor: number) => (a.kind === "card" ? cardPosition(minor, a.currency) : money(minor, a.currency));

export type AccountRowProps = {
  label: string;
  account: LedgerAccount | undefined;
  /** The draft's effect on this account, when there is an amount and the date counts. */
  move?: { before: number; after: number };
  error?: string;
  onPress: () => void;
};

/** One tappable row: the role ("Paid from"), the account, and its balance before → after. */
export function AccountRow({ label, account, move, error, onPress }: AccountRowProps) {
  const now = account ? shown(account, accountBalance(account)) : null;
  const figures = account && move ? `${shown(account, move.before)} → ${shown(account, move.after)}` : now;
  // "Balance ₹37,300 now", or for a card "owed ₹6,000 now".
  const word = account?.kind === "card" ? "" : "Balance ";
  const spoken = account
    ? move
      ? `${label}: ${account.label}. ${word}${shown(account, move.before)} now, ${shown(account, move.after)} after. Change account`
      : `${label}: ${account.label}. ${word}${now}. Change account`
    : `${label}: choose an account`;
  return (
    <View style={styles.rowWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={error ? `${spoken}. Error: ${error}` : spoken}
        onPress={onPress}
        style={({ pressed }) => [styles.row, error ? styles.rowError : null, pressed && styles.rowPressed]}
      >
        {account ? <IconTile icon={accountIcon(account)} tint="blue" size={40} /> : null}
        <View style={styles.rowText}>
          <Text style={dsText.label}>{label}</Text>
          <Text style={dsText.bodyStrong} numberOfLines={1}>
            {account?.label ?? "Choose an account"}
          </Text>
        </View>
        {figures ? (
          <Text style={[styles.figures, move && move.after < 0 && account?.kind !== "card" ? styles.negative : null]} numberOfLines={1} adjustsFontSizeToFit>
            {figures}
          </Text>
        ) : null}
        <ChevronRight size={18} color={mobile.colors.mutedSubtle} />
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export type AccountPickerProps = {
  visible: boolean;
  title: string;
  accounts: readonly LedgerAccount[];
  selectedId: string;
  onPick: (id: string) => void;
  onClose: () => void;
};

/** Bottom sheet listing the accounts with their balance now; the chosen one is ticked. */
export function AccountPicker({ visible, title, accounts, selectedId, onPick, onClose }: AccountPickerProps) {
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      <View accessibilityRole="radiogroup" accessibilityLabel={title} style={styles.list}>
        {accounts.map((a) => {
          const selected = a.id === selectedId;
          const card = a.kind === "card";
          const balance = shown(a, accountBalance(a));
          return (
            <Pressable
              key={a.id}
              accessibilityRole="radio"
              accessibilityLabel={card ? `${a.label}, ${balance}` : `${a.label}, balance ${balance}`}
              aria-checked={selected}
              aria-selected={selected}
              onPress={() => onPick(a.id)}
              style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.rowPressed]}
            >
              <IconTile icon={accountIcon(a)} tint="blue" size={40} />
              <View style={styles.rowText}>
                <Text style={dsText.bodyStrong} numberOfLines={1}>
                  {a.label}
                </Text>
                <Text style={dsText.caption}>
                  {(card ? "Credit card" : "Balance now") + (a.currency === "INR" ? "" : `, in ${a.currency}`)}
                </Text>
              </View>
              <Text style={[styles.figures, !card && accountBalance(a) < 0 ? styles.negative : null]}>{balance}</Text>
              {selected ? <Check size={20} color={mobile.colors.forest} strokeWidth={2.5} /> : <View style={styles.checkSpace} />}
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  rowWrap: { gap: spacing[1] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minHeight: 64,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: mobile.radius.tileLg,
    borderWidth: 1,
    borderColor: mobile.colors.line,
    backgroundColor: mobile.colors.surface,
  },
  rowError: { borderColor: mobile.colors.warning, borderWidth: 2 },
  rowPressed: { backgroundColor: mobile.colors.canvas },
  rowText: { flex: 1, minWidth: 0 },
  figures: { fontFamily: fontFamily.bodySemibold, fontSize: mobile.type.caption.size, color: mobile.colors.ink, fontVariant: ["tabular-nums"], flexShrink: 1, maxWidth: "55%" },
  negative: { color: mobile.colors.warning },
  error: { ...dsText.caption, color: mobile.colors.warning, fontFamily: fontFamily.bodySemibold },
  list: { gap: spacing[2] },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minHeight: 64,
    paddingHorizontal: spacing[3],
    borderRadius: mobile.radius.tileLg,
    borderWidth: 2,
    borderColor: mobile.colors.line,
  },
  optionSelected: { borderColor: mobile.colors.forest },
  checkSpace: { width: 20 },
});
