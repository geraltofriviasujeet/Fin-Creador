import { describe, expect, it } from "vitest"
import { IDLE_LIMIT_MS, countdownText, idlePhase, lastActiveAt } from "./idle"

const T = Date.parse("2026-11-05T10:00:00Z")

describe("lastActiveAt", () => {
  it("takes the later of the stored activity and the sign-in time", () => {
    expect(lastActiveAt(String(T), "2026-11-05T09:00:00Z")).toBe(T)
    expect(lastActiveAt(String(T - IDLE_LIMIT_MS * 3), "2026-11-05T10:00:00Z")).toBe(T)
  })

  it("a stale time from an earlier session never signs out a fresh sign-in", () => {
    const now = T + 5_000
    expect(idlePhase(lastActiveAt(String(T - IDLE_LIMIT_MS * 10), new Date(T).toISOString()), now)).toEqual({ phase: "active" })
  })

  it("ignores missing or junk values", () => {
    expect(lastActiveAt(null, null)).toBe(0)
    expect(lastActiveAt("soon", "not a date")).toBe(0)
    expect(lastActiveAt("-5", null)).toBe(0)
  })
})

describe("idlePhase", () => {
  it("is active until the last minute of two hours", () => {
    expect(idlePhase(T, T)).toEqual({ phase: "active" })
    expect(idlePhase(T, T + IDLE_LIMIT_MS - 60_001)).toEqual({ phase: "active" })
  })

  it("warns one minute before, with the time left", () => {
    expect(idlePhase(T, T + IDLE_LIMIT_MS - 60_000)).toEqual({ phase: "warning", msLeft: 60_000 })
    expect(idlePhase(T, T + IDLE_LIMIT_MS - 1)).toEqual({ phase: "warning", msLeft: 1 })
  })

  it("expires at two hours, and a laptop opened hours later expires at once", () => {
    expect(idlePhase(T, T + IDLE_LIMIT_MS)).toEqual({ phase: "expired" })
    expect(idlePhase(T, T + IDLE_LIMIT_MS * 1.5)).toEqual({ phase: "expired" })
  })
})

describe("countdownText", () => {
  it("rounds up to whole seconds", () => {
    expect(countdownText(60_000)).toBe("1:00")
    expect(countdownText(59_001)).toBe("1:00")
    expect(countdownText(59_000)).toBe("0:59")
    expect(countdownText(1)).toBe("0:01")
    expect(countdownText(-5)).toBe("0:00")
  })
})
