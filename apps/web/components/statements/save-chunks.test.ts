import { describe, expect, it } from "vitest"
import type { LineSaveResult } from "@fin-creador/api"
import { saveInChunks, savedOutcome } from "./save-chunks"

// saveInChunks against a stand-in server that keeps a ledger by request key, as the database does
// (one row per key; a resent key is reported, never posted again). Synthetic keys only.

type Line = { key: string }
const lines = (n: number): Line[] => Array.from({ length: n }, (_, i) => ({ key: `k${i}` }))

function fakeServer() {
  const ledger = new Map<string, number>()
  let calls = 0
  /** `fail(call)` decides how the call-th request (from 1) fails, if it does. */
  const send =
    (fail: (call: number) => "network" | { ok: false; message: string } | null = () => null) =>
    async (chunk: Line[]) => {
      calls += 1
      const how = fail(calls)
      if (how === "network") throw new Error("offline")
      if (how) return how
      const results: LineSaveResult[] = chunk.map(({ key }) => {
        const seen = ledger.has(key)
        ledger.set(key, (ledger.get(key) ?? 0) + 1)
        return { key, status: seen ? "already_saved" : "saved" }
      })
      return { ok: true as const, results }
    }
  const posted = () => [...ledger.keys()].length
  return { send, ledger, posted, calls: () => calls }
}

describe("saveInChunks", () => {
  it("a save cut off part-way keeps what was saved, says what's left, and Save again finishes without posting twice", async () => {
    const server = fakeServer()
    const all = lines(25)
    const seen: LineSaveResult[][] = []
    const first = await saveInChunks(all, 10, server.send((call) => (call === 2 ? "network" : null)), (r) => seen.push(r))
    expect(first.done.map((r) => r.key)).toEqual(all.slice(0, 10).map((l) => l.key))
    expect(first.stopped).toBe("We couldn't reach the server. Check your connection.")
    expect(seen).toHaveLength(1)
    expect(server.calls()).toBe(2) // stopped at the failed chunk: the third was never sent
    expect(savedOutcome(25, first.done, first.stopped)).toEqual({
      tone: "error",
      text: "Saved 10 lines of 25. 15 lines not saved: check them and press Save again to finish. We couldn't reach the server. Check your connection.",
    })

    // The review unticks saved lines, so Save again sends the 15 left.
    const second = await saveInChunks(all.slice(10), 10, server.send(), () => {})
    expect(second.stopped).toBeNull()
    expect(savedOutcome(15, second.done, second.stopped)).toEqual({ tone: "success", text: "15 lines saved." })
    expect(server.posted()).toBe(25)
    expect([...server.ledger.values()].every((n) => n === 1)).toBe(true)
  })

  it("resending every line after a cut-off (a reload with the same file) posts nothing twice", async () => {
    const server = fakeServer()
    const all = lines(25)
    await saveInChunks(all, 10, server.send((call) => (call === 3 ? "network" : null)), () => {})
    const again = await saveInChunks(all, 10, server.send(), () => {})
    expect(again.done.filter((r) => r.status === "already_saved")).toHaveLength(20)
    expect(savedOutcome(25, again.done, again.stopped)).toEqual({ tone: "success", text: "5 lines saved; 20 lines were already imported." })
    expect(server.posted()).toBe(25)
  })

  it("a signed-out session or an archived account stops the save with the server's message; earlier chunks stay saved", async () => {
    for (const message of ["Sign in again; your file is still here.", "We couldn't find this account. It may be archived."]) {
      const server = fakeServer()
      const result = await saveInChunks(lines(30), 10, server.send((call) => (call === 2 ? { ok: false, message } : null)), () => {})
      expect(result.done).toHaveLength(10)
      expect(result.stopped).toBe(message)
      expect(savedOutcome(30, result.done, result.stopped).text).toBe(`Saved 10 lines of 30. 20 lines not saved: check them and press Save again to finish. ${message}`)
    }
  })

  it("a line that fails on its own doesn't stop the chunks after it", async () => {
    const send = async (chunk: Line[]) => ({
      ok: true as const,
      results: chunk.map(({ key }): LineSaveResult => (key === "k3" ? { key, status: "failed", reason: "Choose a category" } : { key, status: "saved" })),
    })
    const result = await saveInChunks(lines(12), 5, send, () => {})
    expect(result.done).toHaveLength(12)
    expect(savedOutcome(12, result.done, result.stopped)).toEqual({
      tone: "error",
      text: "Saved 11 lines of 12. 1 line not saved: check them and press Save again to finish.",
    })
  })
})
