import { describe, expect, it } from "vitest"
import { mockSearchProvider } from "./mock"
import { type SearchDb, WEB_NOTICES, WebSession } from "./session"
import { SearchError } from "./types"

// Credits for one question's lookups, on a fake ledger and the mock provider.

const NONE = { names: [], phrases: [] }
const goa = { kind: "trip", destination: "Goa", month: "2027-01", nights: 4, travellers: 2, cost_line: "stay" } as const
const signal = () => new AbortController().signal

function fakeDb(begin: Awaited<ReturnType<SearchDb["begin"]>>) {
  const calls: string[] = []
  const db: SearchDb = {
    async begin() {
      calls.push("begin")
      return begin
    },
    async settle(_id, credits) {
      calls.push(`settle:${credits}`)
      return true
    },
    async release() {
      calls.push("release")
      return true
    },
  }
  return { db, calls }
}

const session = (db: SearchDb, provider = mockSearchProvider()) => new WebSession({ provider, db, requestId: "r1", terms: NONE, countryCode: "IN" })

describe("web lookup credits", () => {
  it("reserves once for parallel lookups and settles the searches sent", async () => {
    const { db, calls } = fakeDb({ outcome: "ok", credits: 3 })
    const web = session(db)
    const outcomes = await Promise.all([web.lookup(goa, signal()), web.lookup({ ...goa, cost_line: "food" }, signal())])
    expect(outcomes.every((o) => o.ok)).toBe(true)
    await web.finish()
    expect(calls).toEqual(["begin", "settle:2"])
    expect(web.trips).toEqual([{ nights: 4, travellers: 2 }, { nights: 4, travellers: 2 }])
  })

  it("runs no more lookups than begin granted", async () => {
    const { db, calls } = fakeDb({ outcome: "ok", credits: 1 })
    const web = session(db)
    expect((await web.lookup(goa, signal())).ok).toBe(true)
    expect(await web.lookup({ ...goa, cost_line: "food" }, signal())).toEqual({ ok: false, reason: "question_limit" })
    await web.finish()
    expect(calls).toEqual(["begin", "settle:1"])
  })

  it("spends nothing on a lookup the query checks refuse", async () => {
    const { db, calls } = fakeDb({ outcome: "ok", credits: 3 })
    const web = session(db)
    expect(await web.lookup({ ...goa, destination: "Atlantis" }, signal())).toEqual({ ok: false, reason: "unlisted_place" })
    await web.finish()
    expect(calls).toEqual([])
  })

  it("says plainly when the month's lookups are used up", async () => {
    const { db, calls } = fakeDb({ outcome: "monthly_cap", credits: 0 })
    const web = session(db)
    expect(await web.lookup(goa, signal())).toEqual({ ok: false, reason: "monthly_cap" })
    await web.finish()
    expect(calls).toEqual(["begin"])
    expect([...web.notices]).toEqual([WEB_NOTICES.monthly_cap])
  })

  it("releases when nothing was sent, and counts a search that may have been", async () => {
    const refused = fakeDb({ outcome: "ok", credits: 3 })
    const failsClean = session(refused.db, { name: "mock", search: async () => Promise.reject(new SearchError("rejected", "no", "x")) })
    await failsClean.lookup(goa, signal())
    await failsClean.finish()
    expect(refused.calls).toEqual(["begin", "release"])

    const cut = fakeDb({ outcome: "ok", credits: 3 })
    const timesOut = session(cut.db, { name: "mock", search: async () => Promise.reject(new SearchError("timeout", "unknown", "x")) })
    expect(await timesOut.lookup(goa, signal())).toEqual({ ok: false, reason: "timeout" })
    await timesOut.finish()
    expect(cut.calls).toEqual(["begin", "settle:1"])
    expect([...timesOut.notices]).toEqual([WEB_NOTICES.timeout])
  })
})
