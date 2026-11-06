import { z } from "zod"
import { loadIncomeData, loadNetWorthData } from "@fin-creador/api"
import { NET_WORTH_FLAG_TEXT, NET_WORTH_LINE_LABEL, NET_WORTH_PART_LABEL, formatMoney, netWorth, summarizeHoldings } from "@fin-creador/domain"
import { type FinanceTool, type Figure, ToolError } from "./types"

// account_balances and net_worth (Sprint 10.2): figures as of today, as the Income page and
// the Overview's Net worth card show them (summarizeHoldings, netWorth in packages/domain).
// Accounts go by name only: never the last four digits or record IDs.

const noInput = z.object({}).strict()
type NoInput = z.infer<typeof noInput>

export const accountBalancesTool: FinanceTool<NoInput> = {
  name: "account_balances",
  description:
    "Today's balance of each active bank, cash and other account, and Total available (the sum of those in the person's own currency). Loans and cards are not here.",
  input: noInput,
  async run(ctx) {
    const load = await loadIncomeData(ctx.supabase)
    if (!load.ok) throw new ToolError("The account balances couldn't be loaded.")
    const { currency, today, accounts } = load.data
    const summary = summarizeHoldings(accounts, currency)
    const money = (minor: number, c = currency) => formatMoney(minor, { currency: c })
    return {
      data: {
        as_of: today,
        currency,
        total_available: money(summary.totalAvailableMinor),
        money_in_banks: money(summary.moneyInBanksMinor),
        cash_in_hand: money(summary.cashInHandMinor),
        accounts: summary.rows.map((r) => ({
          name: r.account.name,
          kind: r.account.kind,
          balance: money(r.balanceMinor, r.account.currency),
          in_total: r.inTotal,
        })),
        note:
          summary.rows.length === 0
            ? "The person has no active accounts."
            : "Total available adds the accounts in the person's currency; accounts in other currencies are listed, never converted.",
      },
      figures: [
        { label: "Total available", kind: "money", minor: summary.totalAvailableMinor, currency },
        { label: "Money in banks", hideWhenZero: true, kind: "money", minor: summary.moneyInBanksMinor, currency },
        { label: "Cash in hand", hideWhenZero: true, kind: "money", minor: summary.cashInHandMinor, currency },
        ...summary.rows.map((r): Figure => ({ label: r.account.name, kind: "money", minor: r.balanceMinor, currency: r.account.currency })),
        { label: "Accounts", kind: "count", value: summary.rows.length },
      ],
    }
  },
}

export const netWorthTool: FinanceTool<NoInput> = {
  name: "net_worth",
  description:
    "Net worth today: assets (Total available, shares, funds and ETFs at their last price, fixed deposits) minus liabilities (loans, cards, money borrowed, statutory dues), by line.",
  input: noInput,
  async run(ctx) {
    const load = await loadNetWorthData(ctx.supabase)
    if (!load.ok) throw new ToolError("Net worth couldn't be loaded.")
    const nw = netWorth(load.data)
    const money = (minor: number) => formatMoney(minor, { currency: nw.currency })
    const totals: Figure[] =
      nw.totalMinor === null || nw.assetsMinor === null || nw.liabilitiesMinor === null
        ? []
        : [
            { label: "Net worth", kind: "money", minor: nw.totalMinor, currency: nw.currency },
            { label: "Assets", kind: "money", minor: nw.assetsMinor, currency: nw.currency },
            { label: "Liabilities", kind: "money", minor: nw.liabilitiesMinor, currency: nw.currency },
          ]
    return {
      data: {
        as_of: nw.today,
        currency: nw.currency,
        net_worth: nw.totalMinor === null ? null : money(nw.totalMinor),
        assets: nw.assetsMinor === null ? null : money(nw.assetsMinor),
        liabilities: nw.liabilitiesMinor === null ? null : money(nw.liabilitiesMinor),
        lines: nw.lines.map((l) => ({
          line: NET_WORTH_LINE_LABEL[l.key],
          side: l.side,
          amount: money(l.amountMinor),
          valued_from: l.asOf.from,
          valued_to: l.asOf.to,
          flags: l.flags.map((f) => NET_WORTH_FLAG_TEXT[f.flag]),
        })),
        not_included: nw.notIncluded.map((n) => ({ name: n.name, reason: n.reason, currency: n.currency })),
        could_not_load: nw.failed.map((p) => NET_WORTH_PART_LABEL[p]),
        note: nw.empty
          ? "The person has no accounts, investments or debts recorded."
          : nw.failed.length > 0
            ? "Some parts couldn't be loaded, so there is no total. Say which."
            : "Net worth is assets minus liabilities. Items in other currencies or without a price are not included.",
      },
      figures: [
        ...totals,
        ...nw.lines.map((l): Figure => ({ label: NET_WORTH_LINE_LABEL[l.key], kind: "money", minor: l.amountMinor, currency: nw.currency })),
      ],
      dates: nw.lines.flatMap((l) => [l.asOf.from, l.asOf.to]),
    }
  },
}
