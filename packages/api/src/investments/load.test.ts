import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { searchInstruments } from "./load"

const row = (code: string, kind: string) => ({
  id: `id-${code}`,
  source: kind === "fund" ? "amfi" : "bse",
  source_code: code,
  kind,
  isin: null,
  symbol: null,
  name: `Test ${code}`,
  last_price_scaled: 10_000,
  price_date: "2026-10-26",
})

function fakeClient(rows: ReturnType<typeof row>[]) {
  const calls: Record<string, unknown>[] = []
  const client = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      calls.push(args)
      return { data: rows, error: null }
    },
  }
  return { client: client as unknown as UserClient, calls }
}

describe("searchInstruments", () => {
  it("returns every kind on the All tab, at most 20", async () => {
    const { client, calls } = fakeClient([row("1", "share"), row("2", "fund"), row("3", "etf")])
    expect((await searchInstruments(client, " test ")).ok).toBe(true)
    expect(calls[0]).toEqual({ p_query: "test", p_limit: 20 })
  })

  it("keeps one kind for a category tab, from the 50 best matches", async () => {
    const rows = [row("1", "share"), row("2", "fund"), row("3", "etf"), ...Array.from({ length: 30 }, (_, i) => row(`s${i}`, "share"))]
    const { client, calls } = fakeClient(rows)
    const result = await searchInstruments(client, "test", "share")
    expect(calls[0]).toEqual({ p_query: "test", p_limit: 50 })
    expect(result.ok && result.results.every((i) => i.kind === "share")).toBe(true)
    expect(result.ok && result.results).toHaveLength(20)
    const etfs = await searchInstruments(client, "test", "etf")
    expect(etfs.ok && etfs.results.map((i) => i.sourceCode)).toEqual(["3"])
  })

  it("does not call the database for a query under 2 characters", async () => {
    const { client, calls } = fakeClient([])
    expect(await searchInstruments(client, " a ")).toEqual({ ok: true, results: [] })
    expect(calls).toHaveLength(0)
  })
})
