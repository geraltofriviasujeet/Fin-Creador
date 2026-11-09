import { describe, expect, it } from "vitest"
import { tavilyProvider } from "./tavily"
import { SearchError } from "./types"

// The Tavily adapter against a fake fetch: no test sends a request or spends a credit.

const fakeFetch = (respond: (body: Record<string, unknown>) => Response | Promise<Response>) => {
  const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    sent.push({ url, headers: init.headers as Record<string, string>, body })
    return respond(body)
  }) as unknown as typeof globalThis.fetch
  return { fetch, sent }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const signal = () => new AbortController().signal

describe("Tavily adapter", () => {
  it("sends a basic search with the key as a bearer token and reads the results", async () => {
    const { fetch, sent } = fakeFetch(() =>
      json({
        results: [
          { title: "Test data", url: "https://example.test/a", content: "Test data. Rooms from ₹4,500.", raw_content: "Page text", published_date: "2026-10-01" },
        ],
      }),
    )
    const results = await tavilyProvider({ apiKey: "test-key-not-real", fetch }).search("hotel price per night in Goa", signal())
    expect(sent[0]?.url).toBe("https://api.tavily.com/search")
    expect(sent[0]?.headers.authorization).toBe("Bearer test-key-not-real")
    expect(sent[0]?.body).toMatchObject({ query: "hotel price per night in Goa", search_depth: "basic", include_answer: false })
    expect(sent[0]?.body).not.toHaveProperty("country")
    expect(results).toEqual([
      { title: "Test data", url: "https://example.test/a", snippet: "Test data. Rooms from ₹4,500.", content: "Page text", publishedAt: "2026-10-01" },
    ])
  })

  it("asks for a country's pages first when told to (a domestic trip's lookups)", async () => {
    const { fetch, sent } = fakeFetch(() => json({ results: [] }))
    await tavilyProvider({ apiKey: "test-key-not-real", fetch }).search("local taxi hire price per day in Chennai in rupees", signal(), { country: "india" })
    expect(sent[0]?.body).toMatchObject({ country: "india" })
  })

  it("drops results that aren't plain web links", async () => {
    const { fetch } = fakeFetch(() =>
      json({ results: [{ url: "javascript:alert(1)", content: "x" }, { url: "not a url", content: "x" }, { url: "https://example.test/b" }] }),
    )
    expect(await tavilyProvider({ apiKey: "k", fetch }).search("q", signal())).toEqual([])
  })

  it("says whether a failed search may have cost a credit", async () => {
    const refused = fakeFetch(() => json({ detail: "bad" }, 429))
    await expect(tavilyProvider({ apiKey: "k", fetch: refused.fetch }).search("q", signal())).rejects.toMatchObject({ kind: "rate_limited", billed: "no" })
    const broken = fakeFetch(() => {
      throw new TypeError("network")
    })
    const error = await tavilyProvider({ apiKey: "k", fetch: broken.fetch }).search("q", signal()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SearchError)
    expect(error).toMatchObject({ kind: "unavailable", billed: "unknown" })
  })
})
