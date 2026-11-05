import { describe, expect, it } from "vitest"
import { IDLE_LIMIT_MS, IDLE_WARNING_MS, LAST_ACTIVE_KEY, type SharedStorage, countdownText, idlePhase, lastActiveAt, lastActiveStore } from "./idle"

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

describe("lastActiveStore: every tab shares one clock", () => {
  // One browser's localStorage, seen by two tabs.
  const browser = (): SharedStorage => {
    const items = new Map<string, string>()
    return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v) }
  }
  const signedIn = new Date(T).toISOString()

  it("a time written in one tab is read in the other", () => {
    const shared = browser()
    const a = lastActiveStore(() => shared)
    const b = lastActiveStore(() => shared)
    expect(b.read()).toBeNull()
    a.write(T + 5_000)
    expect(shared.getItem(LAST_ACTIVE_KEY)).toBe(String(T + 5_000))
    expect(b.read()).toBe(String(T + 5_000))
  })

  it("activity in one tab ends the warning in the other; both warn and sign out together", () => {
    const shared = browser()
    const a = lastActiveStore(() => shared)
    const b = lastActiveStore(() => shared)
    a.write(T)
    const phase = (tab: typeof a, now: number) => idlePhase(lastActiveAt(tab.read(), signedIn), now)

    // 1 h 59 min idle: both tabs warn, with the same time left.
    const warnAt = T + IDLE_LIMIT_MS - IDLE_WARNING_MS
    expect(phase(a, warnAt)).toEqual({ phase: "warning", msLeft: IDLE_WARNING_MS })
    expect(phase(b, warnAt)).toEqual({ phase: "warning", msLeft: IDLE_WARNING_MS })

    // "Stay signed in" in tab B: tab A is active again, for another two hours.
    b.write(warnAt)
    expect(phase(a, warnAt)).toEqual({ phase: "active" })
    expect(phase(a, warnAt + IDLE_LIMIT_MS - IDLE_WARNING_MS - 1)).toEqual({ phase: "active" })
    expect(phase(a, warnAt + IDLE_LIMIT_MS - IDLE_WARNING_MS)).toEqual({ phase: "warning", msLeft: IDLE_WARNING_MS })

    // Two hours after that activity: both expire at the same moment.
    expect(phase(a, warnAt + IDLE_LIMIT_MS - 1)).toEqual({ phase: "warning", msLeft: 1 })
    expect(phase(a, warnAt + IDLE_LIMIT_MS)).toEqual({ phase: "expired" })
    expect(phase(b, warnAt + IDLE_LIMIT_MS)).toEqual({ phase: "expired" })
  })

  it("blocked storage: the tab keeps its own time instead of failing", () => {
    const blocked = lastActiveStore(() => {
      throw new DOMException("blocked", "SecurityError")
    })
    expect(blocked.read()).toBeNull()
    blocked.write(T)
    expect(blocked.read()).toBe(String(T))
    expect(idlePhase(lastActiveAt(blocked.read(), null), T + IDLE_LIMIT_MS)).toEqual({ phase: "expired" })
  })
})
