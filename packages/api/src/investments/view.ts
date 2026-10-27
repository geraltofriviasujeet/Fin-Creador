import {
  type HoldingFigures,
  type IsoDate,
  type PortfolioTotals,
  type PriceAge,
  groupHoldings,
  holdingFigures,
  identifierChanged,
  portfolioTotals,
  priceAge,
} from "@fin-creador/domain"

// The Investments page and the Overview card (Sprint 7), built from the loaded rows with the
// shared domain rules. Pure, so web and mobile show the same figures. A tracker, not a
// ledger: nothing here touches accounts or Total available.

export type InstrumentKind = "share" | "etf" | "fund"

export type Instrument = {
  id: string
  source: "amfi" | "bse"
  sourceCode: string
  kind: InstrumentKind
  isin: string | null
  symbol: string | null
  name: string
  lastPriceScaled: number
  priceDate: IsoDate
}

export type HoldingRow = {
  id: string
  instrumentId: string
  unitsScaled: number
  buyPriceScaled: number
  buyDate: IsoDate
  isinAtEntry: string | null
  archivedAt: string | null
  createdAt: string
}

export type InvestmentsData = {
  today: IsoDate
  holdings: HoldingRow[]
  /** The instruments the holdings refer to, by id. */
  instruments: ReadonlyMap<string, Instrument>
}

export type HoldingItem = HoldingRow & {
  instrument: Instrument
  figures: HoldingFigures
  /** The instrument's ISIN differs from the one saved with the record. */
  identifierChanged: boolean
}

export type HoldingGroup = {
  instrument: Instrument
  records: HoldingItem[]
  totalUnitsScaled: number
  averageBuyPriceScaled: number
  figures: HoldingFigures
  /** "Old price" after 7 days, "Stale, over 30 days" after 30; always valued at the last price. */
  priceAge: PriceAge
  identifierChanged: boolean
}

/** The tabs and the by-category lines. Fixed deposits come in a later step (no rows yet). */
export const INVESTMENT_CATEGORIES = ["shares", "funds", "etfs", "fds"] as const
export type InvestmentCategory = (typeof INVESTMENT_CATEGORIES)[number]

export const CATEGORY_OF_KIND: Record<InstrumentKind, InvestmentCategory> = { share: "shares", fund: "funds", etf: "etfs" }

export type CategoryTotals = {
  category: InvestmentCategory
  /** Instruments held (groups) in this category. */
  count: number
  totals: PortfolioTotals
}

export type InvestmentsView = {
  today: IsoDate
  groups: HoldingGroup[]
  archived: HoldingItem[]
  totals: PortfolioTotals
  /** Shares, mutual funds, ETFs and fixed deposits, always in that order. */
  categories: CategoryTotals[]
  /** The newest price date among the active holdings; null when there are none. */
  pricesAsOf: IsoDate | null
}

/** Oldest buy first, then the order they were added. */
const byBuyDate = (a: HoldingRow, b: HoldingRow) =>
  a.buyDate === b.buyDate ? a.createdAt.localeCompare(b.createdAt) : a.buyDate < b.buyDate ? -1 : 1

export function buildInvestmentsView(data: InvestmentsData): InvestmentsView {
  const { today, instruments } = data
  // Always the last known price, whatever its age (prices are never 0 or missing).
  const priceOf = (instrumentId: string) => instruments.get(instrumentId)?.lastPriceScaled ?? null
  const item = (row: HoldingRow, instrument: Instrument): HoldingItem => ({
    ...row,
    instrument,
    figures: holdingFigures(row, priceOf(row.instrumentId)),
    identifierChanged: identifierChanged(row.isinAtEntry, instrument.isin),
  })

  // A record whose instrument can't be read is left out (every instrument is readable, so
  // this only guards against a partial load).
  const known = data.holdings.filter((h) => instruments.has(h.instrumentId)).sort(byBuyDate)
  const active = known.filter((h) => !h.archivedAt)
  const archived = known.filter((h) => h.archivedAt).map((h) => item(h, instruments.get(h.instrumentId)!))

  const groups: HoldingGroup[] = groupHoldings(active, priceOf).map((g) => {
    const instrument = instruments.get(g.instrumentId)!
    const records = g.records.map((r) => item(r, instrument))
    return {
      instrument,
      records,
      totalUnitsScaled: g.totalUnitsScaled,
      averageBuyPriceScaled: g.averageBuyPriceScaled,
      figures: g.figures,
      priceAge: priceAge(instrument.priceDate, today),
      identifierChanged: records.some((r) => r.identifierChanged),
    }
  })
  groups.sort((a, b) => a.instrument.name.localeCompare(b.instrument.name))

  const categories = INVESTMENT_CATEGORIES.map((category) => {
    const inCategory = groups.filter((g) => CATEGORY_OF_KIND[g.instrument.kind] === category)
    return { category, count: inCategory.length, totals: portfolioTotals(inCategory.flatMap((g) => g.records), priceOf) }
  })
  const dates = groups.map((g) => g.instrument.priceDate)
  return {
    today,
    groups,
    archived,
    totals: portfolioTotals(active, priceOf),
    categories,
    pricesAsOf: dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null,
  }
}
