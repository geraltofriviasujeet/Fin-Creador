import { type UserClient, userToday } from "../income/client"
import type { Database } from "../database.types"
import type { FdCompounding } from "@fin-creador/domain"
import type { Instrument, InstrumentKind, InvestmentsData } from "./view"

// Loads what the Investments page and the Overview card need, as the signed-in user (RLS:
// only their own records; instruments are shared and read-only), and searches instruments.

export type InvestmentsDataLoad = { ok: true; data: InvestmentsData } | { ok: false; reason: "unauthenticated" | "unavailable" }

type InstrumentRow = Pick<
  Database["public"]["Tables"]["instruments"]["Row"],
  "id" | "source" | "source_code" | "kind" | "isin" | "symbol" | "name" | "last_price_scaled" | "price_date"
>

const INSTRUMENT_COLUMNS = "id, source, source_code, kind, isin, symbol, name, last_price_scaled, price_date"

export function toInstrument(row: InstrumentRow): Instrument {
  return {
    id: row.id,
    source: row.source === "amfi" ? "amfi" : "bse",
    sourceCode: row.source_code,
    kind: (["share", "etf", "fund"].includes(row.kind) ? row.kind : "share") as InstrumentKind,
    isin: row.isin,
    symbol: row.symbol,
    name: row.name,
    lastPriceScaled: row.last_price_scaled,
    priceDate: row.price_date,
  }
}

export async function loadInvestmentsData(supabase: UserClient): Promise<InvestmentsDataLoad> {
  const day = await userToday(supabase)
  if (!day.ok) return day
  const [{ data, error }, deposits] = await Promise.all([
    supabase
      .from("investments")
      .select(`id, instrument_id, units_scaled, buy_price_scaled, buy_date, isin_at_entry, archived_at, created_at, instruments (${INSTRUMENT_COLUMNS})`),
    supabase
      .from("fixed_deposits")
      .select("id, bank, label, principal_minor, rate_bps, compounding, start_date, maturity_date, archived_at, created_at"),
  ])
  if (error || !data || deposits.error || !deposits.data) return { ok: false, reason: "unavailable" }
  const instruments = new Map<string, Instrument>()
  for (const row of data) if (row.instruments) instruments.set(row.instrument_id, toInstrument(row.instruments))
  return {
    ok: true,
    data: {
      today: day.today,
      instruments,
      deposits: deposits.data.map((d) => ({
        id: d.id,
        bank: d.bank,
        label: d.label,
        principalMinor: d.principal_minor,
        rateBps: d.rate_bps,
        compounding: d.compounding as FdCompounding,
        startDate: d.start_date,
        maturityDate: d.maturity_date,
        archivedAt: d.archived_at,
        createdAt: d.created_at,
      })),
      holdings: data.map((h) => ({
        id: h.id,
        instrumentId: h.instrument_id,
        unitsScaled: h.units_scaled,
        buyPriceScaled: h.buy_price_scaled,
        buyDate: h.buy_date,
        isinAtEntry: h.isin_at_entry,
        archivedAt: h.archived_at,
        createdAt: h.created_at,
      })),
    },
  }
}

export const SEARCH_MIN_LENGTH = 2
export const SEARCH_MAX_LENGTH = 100

export type InstrumentSearch = { ok: true; results: Instrument[] } | { ok: false; message: string }

/**
 * Funds and shares by name words, ticker, code or ISIN (search_instruments: prices at most
 * 30 days old, at most 20 results). A query under 2 characters returns nothing.
 */
export async function searchInstruments(supabase: UserClient, query: string): Promise<InstrumentSearch> {
  const q = query.trim().slice(0, SEARCH_MAX_LENGTH)
  if (q.length < SEARCH_MIN_LENGTH) return { ok: true, results: [] }
  const { data, error } = await supabase.rpc("search_instruments", { p_query: q, p_limit: 20 })
  if (error || !Array.isArray(data)) return { ok: false, message: "We couldn't search right now. Check your connection and try again." }
  return { ok: true, results: data.map(toInstrument) }
}
