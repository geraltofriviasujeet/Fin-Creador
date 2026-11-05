import { describe, expect, it } from "vitest"
import {
  IDLE_LIMIT_MS,
  IDLE_WARNING_MS,
  LAST_ACTIVE_KEY,
  type SharedStorage,
  countdownText,
  idleLimitFromEnv,
  idleLimitText,
  idlePhase,
  lastActiveAt,
  lastActiveStore,
  warningMs,
} from "./idle"

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

describe("idleLimitFromEnv", () => {
  it("is 2 hours by default, warning for the last minute", () => {
    expect(IDLE_LIMIT_MS).toBe(7_200_000)
    expect(idleLimitFromEnv({})).toBe(IDLE_LIMIT_MS)
    expect(warningMs(IDLE_LIMIT_MS)).toBe(60_000)
    expect(idleLimitText(IDLE_LIMIT_MS)).toBe("2 hours")
  })

  it("is always 2 hours on a production deployment, whatever IDLE_LIMIT_MS says", () => {
    expect(idleLimitFromEnv({ VERCEL_ENV: "production", IDLE_LIMIT_MS: "20000" })).toBe(IDLE_LIMIT_MS)
  })

  it("may only shorten it, to 10 seconds at least; junk is ignored", () => {
    expect(idleLimitFromEnv({ IDLE_LIMIT_MS: "20000" })).toBe(20_000)
    expect(idleLimitFromEnv({ IDLE_LIMIT_MS: "9999" })).toBe(IDLE_LIMIT_MS)
    expect(idleLimitFromEnv({ IDLE_LIMIT_MS: String(IDLE_LIMIT_MS + 1) })).toBe(IDLE_LIMIT_MS)
    for (const junk of ["", "20s", "-20000", "2e4", " 20000"]) expect(idleLimitFromEnv({ IDLE_LIMIT_MS: junk })).toBe(IDLE_LIMIT_MS)
  })

  it("a short limit warns for its last half, and is said in seconds", () => {
    expect(warningMs(20_000)).toBe(10_000)
    expect(idlePhase(T, T + 9_999, 20_000)).toEqual({ phase: "active" })
    expect(idlePhase(T, T + 10_000, 20_000)).toEqual({ phase: "warning", msLeft: 10_000 })
    expect(idlePhase(T, T + 20_000, 20_000)).toEqual({ phase: "expired" })
    expect(idleLimitText(20_000)).toBe("20 seconds")
    expect(idleLimitText(30 * 60_000)).toBe("30 minutes")
    expect(idleLimitText(3_600_000)).toBe("1 hour")
  })
})
