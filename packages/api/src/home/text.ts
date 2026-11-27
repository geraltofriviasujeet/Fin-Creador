import { DEFAULT_LOCALE, addDays, addMinor, ceilToWholeMinor, floorToWholeMinor, formatDayMonth, formatMoneyWhole, ratioToBasisPoints } from "@fin-creador/domain"
import type { HomeData } from "./view"

// What Safe to spend says, on the phone's Home and the web Overview alike, from the shared
// safeToSpend result, so both clients show the same words and figures. No arithmetic on
// money here: amounts are rounded with the domain's display helpers (down to spend, a
// shortfall or a bill up) and formatted with formatMoneyWhole. A total made of listed rows is
// the sum of the rows as rounded, so what is on screen adds up; the maths stays in paise.

export type HeroText = {
  title: "Safe to spend today"
  /** The big figure, already rounded down to whole units (never below 0). */
  amountMinor: number
  /** "a day, until 1 Dec", or with a limit "left of your ₹1,000 daily limit". */
  suffix: string
  /** "After you pay your bills, …", "₹3,300 left today", "₹3,000 short before 1 Dec"; may be empty. */
  lines: string[]
  /** The shortfall (lines[0]) is shown as a warning. */
  short: boolean
  /** One quiet line under the spent bar, information only: the limit is more than money left after bills. */
  note: string | null
  /** The hero's figures: At start of today, Bills due, For goals (whole units). */
  figures: { label: string; minor: number }[]
  /** Spent today against the daily figure (0..1, may pass 1), or null when short. */
  spentBar: { value: number; label: string } | null
  /** Everything above in one sentence, for screen readers. */
  label: string
}

/** Under the no-limit figure (owner, decisions log 2026-11-24 "Daily spend limit: final rule"). */
export const AFTER_BILLS_LINE = "After you pay your bills, you can spend this much each day."
/** The safety note with a limit set. */
export const LIMIT_NOTE = "Your limit is more than you have left after bills"

const money = (minor: number, currency: string) => formatMoneyWhole(minor, { currency, locale: DEFAULT_LOCALE })
const down = (minor: number, currency: string) => floorToWholeMinor(Math.max(0, minor), currency)
const up = (minor: number, currency: string) => ceilToWholeMinor(Math.max(0, minor), currency)

/**
 * A bill as Coming up shows it: rounded up to a whole unit, so an amount to pay is never
 * understated. Bills due is the sum of these, so the rows and the total visibly add up.
 */
export function billDisplayMinor(bill: { amountMinor: number; currency: string }): number {
  return up(bill.amountMinor, bill.currency)
}

/** "Rent on 28 Nov leaves you ₹3,000 short in HDFC Savings", one per account that runs short. */
export function shortWarnings(home: Pick<HomeData, "safe" | "currency">): string[] {
  return home.safe.shortAccounts.map(
    (s) => `${s.bill.name} on ${formatDayMonth(s.bill.dueDate)} leaves you ${money(up(s.shortAfterBillMinor, home.currency), home.currency)} short in ${s.accountName}`,
  )
}

/** One sentence for screen readers: the parts joined with ". " (a part's own full stop dropped). */
const sentence = (parts: readonly string[]) => parts.map((p) => p.replace(/\.$/, "")).join(". ")

function bar(spentMinor: number, dailyMinor: number, shownDailyMinor: number, currency: string) {
  const bps = dailyMinor > 0 ? ratioToBasisPoints(spentMinor, dailyMinor) : null
  return {
    value: bps === null ? (spentMinor > 0 ? 1 : 0) : bps / 10_000,
    label: `${money(up(spentMinor, currency), currency)} spent today of ${money(shownDailyMinor, currency)}`,
  }
}

/**
 * The Safe to spend card's words and figures (final rule, owner 2026-11-24).
 * With a limit: only "₹X left of your ₹Y daily limit" and the spent bar (no shortfall there),
 * a "₹Z over today's limit" line once today's spending passes it, and the safety note.
 * Without: (money left − bills) ÷ days left as "₹Y a day, until {date}", the after-bills line
 * and what is left today, or "₹X short before {date}" when the bills need more.
 */
export function heroText(home: Pick<HomeData, "safe" | "currency" | "spentTodayMinor" | "limit">): HeroText {
  const { safe, currency, limit } = home
  const figures = [
    { label: "At start of today", minor: down(safe.moneyLeftMinor, currency) },
    // The counted bills as each row shows them (exact total: safe.billsMinor).
    { label: "Bills due", minor: addMinor(...safe.bills.map(billDisplayMinor)) },
    { label: "For goals", minor: up(safe.goalSavingMinor, currency) },
  ]
  const title = "Safe to spend today" as const

  if (limit) {
    const { dailyMinor, leftTodayMinor, spentTodayMinor } = limit.today
    const dailyShown = down(dailyMinor, currency)
    const amountMinor = down(leftTodayMinor, currency)
    const suffix = `left of your ${money(dailyShown, currency)} daily limit`
    const lines = leftTodayMinor < 0 ? [`${money(up(-leftTodayMinor, currency), currency)} over today's limit`] : []
    const note = limit.exceedsMoneyAfterBills ? LIMIT_NOTE : null
    return {
      title,
      amountMinor,
      suffix,
      lines,
      short: false,
      note,
      figures,
      spentBar: bar(spentTodayMinor, dailyMinor, dailyShown, currency),
      label: sentence([`${title}: ${money(amountMinor, currency)} ${suffix}`, ...lines, ...(note ? [note] : [])]),
    }
  }

  // The day after the window: the next income date, or the 1st of next month.
  const until = formatDayMonth(addDays(safe.lastDay, 1))
  const accounts = [...new Set(safe.shortAccounts.map((s) => s.accountName))]
  const inAccounts = accounts.length > 0 ? ` in ${accounts.join(" and ")}` : ""
  const amountMinor = down(safe.dailyMinor, currency)
  const short = safe.shortMinor > 0
  const lines: string[] = []
  if (short) {
    lines.push(`${money(up(safe.shortMinor, currency), currency)} short before ${until}${inAccounts}`)
  } else {
    lines.push(AFTER_BILLS_LINE)
    if (safe.leftTodayMinor >= 0) lines.push(`${money(down(safe.leftTodayMinor, currency), currency)} left today`)
    else lines.push(`${money(up(-safe.leftTodayMinor, currency), currency)} over today's figure`)
  }
  if (safe.paydayPending) lines.push("Income due today isn't counted until you record it.")
  const suffix = `a day, until ${until}`
  return {
    title,
    amountMinor,
    suffix,
    lines,
    short,
    note: null,
    figures,
    spentBar: short ? null : bar(home.spentTodayMinor, safe.dailyMinor, amountMinor, currency),
    label: sentence([`${title}: ${money(amountMinor, currency)} ${suffix}`, ...lines]),
  }
}
