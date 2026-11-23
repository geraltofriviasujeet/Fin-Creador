import type { HomeData } from "@fin-creador/api";
import { addDays, ceilToWholeMinor, floorToWholeMinor, formatDayMonth, ratioToBasisPoints } from "@fin-creador/domain";
import { formatAmount } from "../ds/logic";

// What Home's hero card and warnings say, from the shared safeToSpend result. No arithmetic on
// money here: amounts are rounded with the domain's display helpers (down to spend, a
// shortfall up) and formatted with formatMoney (via the ds formatAmount).

export type HeroText = {
  title: "Safe to spend today" | "Money left this month";
  /** The big figure, already rounded down to whole units (never below 0). */
  amountMinor: number;
  /** "a day, until 1 Dec"; null for money left this month. */
  suffix: string | null;
  /** "₹3,300 left today", "₹3,000 short before 1 Dec"; may be empty. */
  lines: string[];
  /** The shortfall is shown as a warning. */
  short: boolean;
  /** The hero's figures: Money left, Bills due, For goals (whole units). */
  figures: { label: string; minor: number }[];
  /** Spent today against the daily figure (0..1), or null when there is no daily figure. */
  spentBar: { value: number; label: string } | null;
  /** No income date: the "Set your income date" prompt. */
  needsIncomeDate: boolean;
  /** Everything above in one sentence, for screen readers. */
  label: string;
};

const money = (minor: number, currency: string) => formatAmount(minor, { currency }).text;
const down = (minor: number, currency: string) => floorToWholeMinor(Math.max(0, minor), currency);
const up = (minor: number, currency: string) => ceilToWholeMinor(Math.max(0, minor), currency);

/** "Rent on 28 Nov leaves you ₹3,000 short in HDFC Savings", one per account that runs short. */
export function shortWarnings(home: Pick<HomeData, "safe" | "currency">): string[] {
  return home.safe.shortAccounts.map(
    (s) => `${s.bill.name} on ${formatDayMonth(s.bill.dueDate)} leaves you ${money(up(s.shortAfterBillMinor, home.currency), home.currency)} short in ${s.accountName}`,
  );
}

export function heroText(home: Pick<HomeData, "safe" | "currency" | "spentTodayMinor">): HeroText {
  const { safe, currency } = home;
  const figures = [
    { label: "Money left", minor: down(safe.moneyLeftMinor, currency) },
    { label: "Bills due", minor: up(safe.billsMinor, currency) },
    { label: "For goals", minor: up(safe.goalSavingMinor, currency) },
  ];
  const accounts = [...new Set(safe.shortAccounts.map((s) => s.accountName))];
  const inAccounts = accounts.length > 0 ? ` in ${accounts.join(" and ")}` : "";
  const lines: string[] = [];
  const shortBy = (date: string) => `${money(up(safe.shortMinor, currency), currency)} short before ${formatDayMonth(date)}${inAccounts}`;

  if (safe.kind === "daily") {
    const until = formatDayMonth(safe.nextIncomeDate);
    const amountMinor = down(safe.dailyMinor, currency);
    const short = safe.shortMinor > 0;
    if (short) {
      lines.push(shortBy(safe.nextIncomeDate));
    } else if (safe.leftTodayMinor >= 0) {
      lines.push(`${money(down(safe.leftTodayMinor, currency), currency)} left today`);
    } else {
      lines.push(`${money(up(-safe.leftTodayMinor, currency), currency)} over today's figure`);
    }
    if (safe.paydayPending) lines.push("Income due today isn't counted until you record it.");
    const bps = safe.dailyMinor > 0 ? ratioToBasisPoints(home.spentTodayMinor, safe.dailyMinor) : null;
    const spentBar = short
      ? null
      : {
          value: bps === null ? (home.spentTodayMinor > 0 ? 1 : 0) : bps / 10_000,
          label: `${money(up(home.spentTodayMinor, currency), currency)} spent today of ${money(amountMinor, currency)}`,
        };
    const headline = `${money(amountMinor, currency)} a day, until ${until}`;
    return {
      title: "Safe to spend today",
      amountMinor,
      suffix: `a day, until ${until}`,
      lines,
      short,
      figures,
      spentBar,
      needsIncomeDate: false,
      label: [`Safe to spend today: ${headline}`, ...lines].join(". "),
    };
  }

  const amountMinor = down(safe.availableMinor, currency);
  const short = safe.shortMinor > 0;
  if (short) lines.push(shortBy(addDays(safe.lastDay, 1)));
  return {
    title: "Money left this month",
    amountMinor,
    suffix: null,
    lines,
    short,
    figures,
    spentBar: null,
    needsIncomeDate: true,
    label: [`Money left this month: ${money(amountMinor, currency)}`, ...lines].join(". "),
  };
}

/** "AR" from "Asha Rao", "A" from "Asha"; null without a name. */
export function initials(name: string | null): string | null {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
