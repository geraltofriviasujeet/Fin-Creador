import { describe, expect, it } from "vitest"
import { type HoldingRow, type Instrument, buildInvestmentsView } from "./view"

// Expected figures are worked out by hand from the scaled values (4 decimals) and checked
// against the domain's own tests (packages/domain/src/investments.test.ts).

const TODAY = "2026-10-27"

const instrument = (id: string, over: Partial<Instrument> = {}): Instrument => ({
  id,
  source: "bse",
  sourceCode: id,
  kind: "share",
  isin: `INE${id}`,
  symbol: null,
  name: id,
  lastPriceScaled: 10_000_000, // ₹1,000
  priceDate: "2026-10-26",
  ...over,
})

let n = 0
const row = (instrumentId: string, unitsScaled: number, buyPriceScaled: number, over: Partial<HoldingRow> = {}): HoldingRow => ({
  id: `h${++n}`,
  instrumentId,
  unitsScaled,
  buyPriceScaled,
  buyDate: "2026-01-15",
  isinAtEntry: `INE${instrumentId}`,
  archivedAt: null,
  createdAt: `2026-10-01T00:00:0${n % 10}Z`,
  ...over,
})

const view = (holdings: HoldingRow[], list: Instrument[]) =>
  buildInvestmentsView({ today: TODAY, holdings, instruments: new Map(list.map((i) => [i.id, i])) })

describe("buildInvestmentsView", () => {
  it("groups records per instrument with total units, average buy price and profit", () => {
    const v = view(
      [row("Alpha", 100_000, 8_000_000), row("Alpha", 300_000, 9_000_000, { buyDate: "2026-02-01" })],
      [instrument("Alpha")],
    )
    expect(v.groups).toHaveLength(1)
    const g = v.groups[0]!
    expect(g.totalUnitsScaled).toBe(400_000) // 40 units
    expect(g.averageBuyPriceScaled).toBe(8_750_000) // (10 × 800 + 30 × 900) / 40 = ₹875
    expect(g.figures).toEqual({ investedMinor: 3_500_000, valueMinor: 4_000_000, profitMinor: 500_000, profitBps: 1_429 })
    expect(g.records.map((r) => r.figures.profitMinor)).toEqual([200_000, 300_000])
    expect(v.totals).toMatchObject({ investedMinor: 3_500_000, valueMinor: 4_000_000, profitMinor: 500_000, pricedCount: 2, unpricedCount: 0 })
    expect(v.pricesAsOf).toBe("2026-10-26")
  })

  it("shows a loss with a negative profit", () => {
    const v = view([row("Beta", 50_000, 12_000_000)], [instrument("Beta")])
    expect(v.groups[0]!.figures).toEqual({ investedMinor: 600_000, valueMinor: 500_000, profitMinor: -100_000, profitBps: -1_667 })
  })

  it("marks a price older than 7 days and stops counting one older than 30 days", () => {
    const v = view(
      [row("Fresh", 10_000, 10_000_000), row("Old", 10_000, 10_000_000), row("Gone", 20_000, 5_000_000)],
      [instrument("Fresh"), instrument("Old", { priceDate: "2026-10-19" }), instrument("Gone", { priceDate: "2026-09-26" })],
    )
    const by = Object.fromEntries(v.groups.map((g) => [g.instrument.id, g]))
    expect(by.Fresh).toMatchObject({ oldPrice: false, priced: true })
    expect(by.Old).toMatchObject({ oldPrice: true, priced: true })
    expect(by.Gone).toMatchObject({ oldPrice: true, priced: false })
    expect(by.Gone!.figures).toEqual({ investedMinor: 100_000, valueMinor: null, profitMinor: null, profitBps: null })
    // Invested ₹3,000 (₹2,000 of it priced); 1 holding without a current price.
    expect(v.totals).toMatchObject({ investedMinor: 300_000, pricedInvestedMinor: 200_000, valueMinor: 200_000, profitMinor: 0, pricedCount: 2, unpricedCount: 1 })
    expect(v.pricesAsOf).toBe("2026-10-26")
  })

  it("flags a changed identifier, but not when the record has none", () => {
    const v = view(
      [row("Gamma", 10_000, 1, { isinAtEntry: "INE000OLD011" }), row("Delta", 10_000, 1, { isinAtEntry: null })],
      [instrument("Gamma"), instrument("Delta")],
    )
    const by = Object.fromEntries(v.groups.map((g) => [g.instrument.id, g]))
    expect(by.Gamma!.identifierChanged).toBe(true)
    expect(by.Gamma!.records[0]!.identifierChanged).toBe(true)
    expect(by.Delta!.identifierChanged).toBe(false)
  })

  it("keeps archived records out of the groups and totals", () => {
    const v = view([row("Alpha", 10_000, 1), row("Alpha", 10_000, 1, { archivedAt: "2026-10-20T00:00:00Z" })], [instrument("Alpha")])
    expect(v.groups[0]!.records).toHaveLength(1)
    expect(v.archived).toHaveLength(1)
    expect(v.totals.pricedCount + v.totals.unpricedCount).toBe(1)
  })

  it("is empty without records", () => {
    const v = view([], [])
    expect(v).toMatchObject({ groups: [], archived: [], pricesAsOf: null })
    expect(v.totals).toMatchObject({ investedMinor: 0, valueMinor: 0, profitMinor: 0, profitBps: null })
  })
})
