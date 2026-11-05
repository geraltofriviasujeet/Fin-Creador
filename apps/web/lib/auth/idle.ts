// Sign-out after inactivity (Sprint 10a): pure timing rules, shared by every open tab.
// Activity is the last pointer, key, scroll or touch in any tab of this browser, stored in
// localStorage so all tabs agree. A fresh sign-in counts as activity, so an old stored
// time from an earlier session never signs a new one out.

export const IDLE_LIMIT_MS = 2 * 60 * 60 * 1000
export const IDLE_WARNING_MS = 60 * 1000
/** The shortest limit the server's IDLE_LIMIT_MS may set (the E2E run uses 20 seconds). */
export const MIN_IDLE_LIMIT_MS = 10 * 1000
/** localStorage key holding the last activity time (epoch ms) across tabs. */
export const LAST_ACTIVE_KEY = "fc:last-active"
/** Activity is written at most this often, so scrolling doesn't write on every event. */
export const ACTIVITY_WRITE_EVERY_MS = 10 * 1000

export type IdlePhase = { phase: "active" } | { phase: "warning"; msLeft: number } | { phase: "expired" }

/** The later of the stored activity time and the sign-in time (either may be missing or junk). */
export function lastActiveAt(stored: string | null, signedInAt: string | null): number {
  const fromStore = stored !== null && /^\d{1,16}$/.test(stored) ? Number(stored) : 0
  const fromSignIn = signedInAt ? Date.parse(signedInAt) : Number.NaN
  return Math.max(fromStore, Number.isFinite(fromSignIn) ? fromSignIn : 0)
}

/** The storage every tab of this browser shares (localStorage in the app). */
export type SharedStorage = Pick<Storage, "getItem" | "setItem">

/**
 * Reads and writes the shared last-active time. If storage is missing or throws (private
 * windows, blocked storage), this tab falls back to its own memory.
 */
export function lastActiveStore(storage: () => SharedStorage) {
  let memory: string | null = null
  return {
    read(): string | null {
      try {
        return storage().getItem(LAST_ACTIVE_KEY)
      } catch {
        return memory
      }
    },
    write(at: number) {
      memory = String(at)
      try {
        storage().setItem(LAST_ACTIVE_KEY, memory)
      } catch {
        // This tab still keeps its own time.
      }
    },
  }
}

/**
 * The limit from the server's environment (read at request time, never from the browser).
 * IDLE_LIMIT_MS may only shorten it, within [10 s, 2 h], and never on a Vercel production
 * deployment: there it is always 2 hours. Unset or junk: 2 hours.
 */
export function idleLimitFromEnv(env: Readonly<Record<string, string | undefined>>): number {
  if (env.VERCEL_ENV === "production") return IDLE_LIMIT_MS
  const raw = env.IDLE_LIMIT_MS
  const ms = raw !== undefined && /^\d{1,10}$/.test(raw) ? Number(raw) : Number.NaN
  return ms >= MIN_IDLE_LIMIT_MS && ms <= IDLE_LIMIT_MS ? ms : IDLE_LIMIT_MS
}

/** The warning shows for the last minute, or the last half of a shorter limit. */
export function warningMs(limitMs: number): number {
  return Math.min(IDLE_WARNING_MS, Math.floor(limitMs / 2))
}

/** "2 hours", "30 minutes", "20 seconds": the limit as the warning and sign-in page say it. */
export function idleLimitText(limitMs: number): string {
  const [n, unit] =
    limitMs % 3_600_000 === 0 ? [limitMs / 3_600_000, "hour"] : limitMs % 60_000 === 0 ? [limitMs / 60_000, "minute"] : [Math.round(limitMs / 1000), "second"]
  return `${n} ${unit}${n === 1 ? "" : "s"}`
}

/** Where `now` falls: active, in the warning (with time left) or past the limit. */
export function idlePhase(lastActive: number, now: number, limitMs = IDLE_LIMIT_MS): IdlePhase {
  const left = lastActive + limitMs - now
  if (left <= 0) return { phase: "expired" }
  if (left <= warningMs(limitMs)) return { phase: "warning", msLeft: left }
  return { phase: "active" }
}

/** "0:59": whole seconds left, rounded up so the count never shows 0:00 early. */
export function countdownText(msLeft: number): string {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** The route that ends the session (POST), then shows the reason on the sign-in page. */
export const IDLE_SIGN_OUT_PATH = "/auth/idle-sign-out"
export const IDLE_REASON = "idle"
