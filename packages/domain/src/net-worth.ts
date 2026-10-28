// Net worth (Sprint 8e, CLAUDE.md §5): what the person owns minus what they owe, in the profile
// currency, from figures the app already computes. No new rounding: every input is already in
// minor units (holdings valued once per instrument at the last known price, deposits on today's
// date), and this only adds them.
//   Assets: Total available (money accounts, same definition as everywhere else), shares /
//     funds / ETFs at the last known price, fixed deposits at today's value (the maturity amount
//     once matured), and a liability account in credit ("Card credit (overpaid)").
//   Liabilities: what each liability account owes (loans, card EMIs included as loans; cards;
//     borrowings, principal only: interest is an expense when repaid), plus moratorium interest a
//     loan has not added yet, plus what is left on statutory dues (they have no account).
//   Due items (EMIs, card bills, borrowing dues) are never counted: the account balance already
//     holds what is owed, so a bill or an unpaid EMI is not subtracted a second time.
//   Archived items are left out. Items in another currency, and holdings without a price, are
//   listed as not included and never converted.
//   If a part could not be loaded there is no total: the parts that loaded are still shown.
import type { IsoDate } from "./dates";
import type { AccountKind, LiabilityKind } from "./holdings";
import { isLiabilityKind, isMoneyAccountKind } from "./holdings";
import type { PriceAge } from "./investments";
import { addMinor } from "./money";

/** What the loader fetches in one go; each is null when it could not be loaded. */
export const NET_WORTH_PARTS = ["accounts", "investments", "statutory"] as const;
export type NetWorthPart = (typeof NET_WORTH_PARTS)[number];

export const NET_WORTH_PART_LABEL: Record<NetWorthPart, string> = {
  accounts: "accounts, loans, cards and borrowing",
  investments: "investments and fixed deposits",
  statutory: "statutory dues",
};

export interface NetWorthAccount {
  id: string;
  kind: AccountKind | LiabilityKind;
  name: string;
  currency: string;
  /** Opening balance + posted inflows − posted outflows (a liability account: minus what is owed). */
  balanceMinor: number;
  archived: boolean;
}

export interface NetWorthAccounts {
  accounts: readonly NetWorthAccount[];
  /** Moratorium interest a loan will add with its first EMI paid, by the loan's account. */
  pendingCapitalised: readonly { accountId: string; minor: number }[];
}

export interface NetWorthHolding {
  name: string;
  currency: string;
  /** Null when the instrument has no price. */
  valueMinor: number | null;
  priceDate: IsoDate | null;
  priceAge: PriceAge | null;
}

export interface NetWorthDeposit {
  name: string;
  currency: string;
  /** Today's value, capped at the maturity amount. */
  valueMinor: number;
  matured: boolean;
}

export interface NetWorthInvestments {
  holdings: readonly NetWorthHolding[];
  deposits: readonly NetWorthDeposit[];
}

export interface NetWorthDue {
  name: string;
  currency: string;
  leftMinor: number;
}

/** Only active (not archived) holdings, deposits and dues; accounts carry their own flag. */
export interface NetWorthInput {
  currency: string;
  today: IsoDate;
  accounts: NetWorthAccounts | null;
  investments: NetWorthInvestments | null;
  statutory: readonly NetWorthDue[] | null;
}

export type NetWorthFlag = "old_price" | "stale_price" | "estimate" | "matured";

export const NET_WORTH_FLAG_TEXT: Record<NetWorthFlag, string> = {
  old_price: "Old price: the last price is over 7 days old",
  stale_price: "Stale: the last price is over 30 days old",
  estimate: "Estimate: deposit interest worked out to today",
  matured: "Matured: valued at the maturity amount",
};

export type NetWorthLineKey = "available" | "holdings" | "deposits" | "credit" | "loans" | "cards" | "borrowings" | "statutory";

export const NET_WORTH_LINE_LABEL: Record<NetWorthLineKey, string> = {
  available: "Total available",
  holdings: "Shares, funds and ETFs",
  deposits: "Fixed deposits",
  credit: "Card credit (overpaid)",
  loans: "Loans (card EMIs included)",
  cards: "Credit cards owed",
  borrowings: "Borrowed (principal)",
  statutory: "Statutory dues left",
};

export interface NetWorthLine {
  key: NetWorthLineKey;
  side: "asset" | "liability";
  part: NetWorthPart;
  /** Never negative on a liability line; Total available can be (an overdrawn account). */
  amountMinor: number;
  count: number;
  /** Valued as of: today, or the oldest and newest price dates used. */
  asOf: { from: IsoDate; to: IsoDate };
  flags: { flag: NetWorthFlag; count: number }[];
}

export type NotIncludedReason = "currency" | "no_price";

export interface NotIncluded {
  name: string;
  reason: NotIncludedReason;
  currency: string;
}

export interface NetWorth {
  currency: string;
  today: IsoDate;
  /** Null when any part failed to load. */
  totalMinor: number | null;
  assetsMinor: number | null;
  liabilitiesMinor: number | null;
  /** Lines with something in them, assets first; only from the parts that loaded. */
  lines: NetWorthLine[];
  notIncluded: NotIncluded[];
  failed: NetWorthPart[];
  /** Nothing at all to show (and nothing failed). */
  empty: boolean;
}

const ORDER: NetWorthLineKey[] = ["available", "holdings", "deposits", "credit", "loans", "cards", "borrowings", "statutory"];
const SIDE: Record<NetWorthLineKey, NetWorthLine["side"]> = {
  available: "asset",
  holdings: "asset",
  deposits: "asset",
  credit: "asset",
  loans: "liability",
  cards: "liability",
  borrowings: "liability",
  statutory: "liability",
};
const LIABILITY_LINE: Record<LiabilityKind, NetWorthLineKey> = { loan: "loans", card: "cards", borrowing: "borrowings" };

export function netWorth(input: NetWorthInput): NetWorth {
  const { currency, today } = input;
  const notIncluded: NotIncluded[] = [];
  const failed = NET_WORTH_PARTS.filter((p) => input[p] === null);
  type Acc = { amounts: number[]; count: number; part: NetWorthPart; from: IsoDate; to: IsoDate; flags: Map<NetWorthFlag, number> };
  const acc = new Map<NetWorthLineKey, Acc>();
  const add = (key: NetWorthLineKey, part: NetWorthPart, minor: number, opts: { date?: IsoDate; flag?: NetWorthFlag | null; counted?: boolean } = {}) => {
    const date = opts.date ?? today;
    const a: Acc = acc.get(key) ?? { amounts: [], count: 0, part, from: date, to: date, flags: new Map() };
    a.amounts.push(minor);
    if (opts.counted !== false) a.count += 1;
    if (date < a.from) a.from = date;
    if (date > a.to) a.to = date;
    if (opts.flag) a.flags.set(opts.flag, (a.flags.get(opts.flag) ?? 0) + 1);
    acc.set(key, a);
  };
  const other = (name: string, itemCurrency: string) => {
    if (itemCurrency === currency) return false;
    notIncluded.push({ name, reason: "currency", currency: itemCurrency });
    return true;
  };

  if (input.accounts) {
    const active = input.accounts.accounts.filter((a) => !a.archived);
    // Total available is shown even at 0 once there is any money account.
    if (active.some((a) => isMoneyAccountKind(a.kind) && a.currency === currency)) add("available", "accounts", 0, { counted: false });
    for (const a of active) {
      if (other(a.name, a.currency)) continue;
      if (isMoneyAccountKind(a.kind)) add("available", "accounts", a.balanceMinor);
      else if (isLiabilityKind(a.kind)) {
        if (a.balanceMinor > 0) add("credit", "accounts", a.balanceMinor);
        else if (a.balanceMinor < 0) add(LIABILITY_LINE[a.kind], "accounts", -a.balanceMinor);
      }
    }
    const byId = new Map(active.map((a) => [a.id, a]));
    for (const p of input.accounts.pendingCapitalised) {
      const a = byId.get(p.accountId);
      if (!a || a.kind !== "loan" || a.currency !== currency || p.minor <= 0) continue;
      // Counted with the loan's own line (the loan is counted once even when it owes nothing yet).
      add("loans", "accounts", p.minor, { counted: a.balanceMinor >= 0 });
    }
  }

  if (input.investments) {
    for (const h of input.investments.holdings) {
      if (other(h.name, h.currency)) continue;
      if (h.valueMinor === null || h.priceDate === null) {
        notIncluded.push({ name: h.name, reason: "no_price", currency: h.currency });
        continue;
      }
      add("holdings", "investments", h.valueMinor, {
        date: h.priceDate,
        flag: h.priceAge === "stale" ? "stale_price" : h.priceAge === "old" ? "old_price" : null,
      });
    }
    for (const d of input.investments.deposits) {
      if (other(d.name, d.currency)) continue;
      add("deposits", "investments", d.valueMinor, { flag: d.matured ? "matured" : "estimate" });
    }
  }

  if (input.statutory) {
    for (const d of input.statutory) {
      if (other(d.name, d.currency) || d.leftMinor <= 0) continue;
      add("statutory", "statutory", d.leftMinor);
    }
  }

  const lines: NetWorthLine[] = ORDER.flatMap((key) => {
    const a = acc.get(key);
    if (!a) return [];
    return [
      {
        key,
        side: SIDE[key],
        part: a.part,
        amountMinor: addMinor(...a.amounts),
        count: a.count,
        asOf: { from: a.from, to: a.to },
        flags: [...a.flags].map(([flag, count]) => ({ flag, count })),
      },
    ];
  });
  const sum = (side: NetWorthLine["side"]) => addMinor(...lines.filter((l) => l.side === side).map((l) => l.amountMinor));
  const complete = failed.length === 0;
  const assetsMinor = complete ? sum("asset") : null;
  const liabilitiesMinor = complete ? sum("liability") : null;
  return {
    currency,
    today,
    totalMinor: assetsMinor === null || liabilitiesMinor === null ? null : addMinor(assetsMinor, -liabilitiesMinor),
    assetsMinor,
    liabilitiesMinor,
    lines,
    notIncluded,
    failed,
    empty: complete && lines.length === 0 && notIncluded.length === 0,
  };
}
