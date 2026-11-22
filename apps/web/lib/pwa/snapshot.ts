import { z } from "zod"

// The read-only offline view (Sprint 12b). While online, the app keeps one small snapshot of
// figures the server already worked out (strings, ready to show: nothing is added up on the
// device) in IndexedDB; the offline page (/offline) shows it when there is no connection.
//
// Rules: one snapshot per device, for the signed-in user only (its user id is stored with it);
// wiped on sign-out (including the idle sign-out), when another user's app loads, on the
// sign-in pages, and once older than 7 days; never shown while online; no Roma data; account
// names only as the app already shows them (the last digits, "HDFC Bank ··4821").

/** Where the snapshot lives: one IndexedDB database, one store, one key. */
export const SNAPSHOT_IDB = { db: "fincreador-offline", store: "snapshot", key: "current" } as const
export type SnapshotIdb = typeof SNAPSHOT_IDB

export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export const SNAPSHOT_LIMITS = { accounts: 50, dues: 5, entries: 20 } as const

const text = z.string().max(200)

export const offlineSnapshotSchema = z.object({
  v: z.literal(1),
  userId: z.string().min(1).max(64),
  /** ISO instant the server built it. */
  takenAt: z.iso.datetime({ offset: true }),
  /** "6:42 pm, 22 Nov 2026", in the person's time zone. */
  takenLabel: text,
  totalAvailable: text,
  accounts: z.array(z.object({ name: text, balance: text })).max(SNAPSHOT_LIMITS.accounts),
  month: z.object({ label: text, income: text, spent: text }),
  dues: z.array(z.object({ name: text, date: text, amount: text.nullable() })).max(SNAPSHOT_LIMITS.dues),
  entries: z.array(z.object({ date: text, name: text, category: text, amount: text })).max(SNAPSHOT_LIMITS.entries),
})

export type OfflineSnapshot = z.infer<typeof offlineSnapshotSchema>

/**
 * Whether a snapshot taken at `takenAt` may still be shown at `now` (ms): not older than
 * `maxAgeMs`, and not from the future (a clock moved back more than 5 minutes). Self-contained
 * (no imports, no module scope): the offline page inlines this exact function.
 */
export function isSnapshotFresh(takenAt: string, now: number, maxAgeMs: number): boolean {
  const at = Date.parse(takenAt)
  if (!Number.isFinite(at)) return false
  return now - at <= maxAgeMs && at - now <= 5 * 60 * 1000
}

/** A stored value as a snapshot, or null (wrong shape, or another version). */
export function parseSnapshot(value: unknown): OfflineSnapshot | null {
  const parsed = offlineSnapshotSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
