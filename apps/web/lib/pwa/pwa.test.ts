import { readFileSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { BellReminder, LedgerAccount, LedgerItem, RecurringView } from "@fin-creador/api"
import manifest from "../../app/manifest"
import { buildOfflineSnapshot, takenLabel } from "./build-snapshot"
import { registersServiceWorker, serviceWorkerUrl } from "./config"
import { countVisit, dismissInstall, installDismissed, isIosSafari, showInstallCard } from "./install"
import { OFFLINE_FONTS, offlinePageHtml } from "./offline-page"
import { SNAPSHOT_IDB, SNAPSHOT_MAX_AGE_MS, isSnapshotFresh, parseSnapshot } from "./snapshot"

// Sprint 12b: the manifest, the service worker's cache rules, the offline snapshot and the
// install card rules. The browser behaviour (offline navigation, wipes) is in e2e/pwa.spec.ts.

const web = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))
const sw = readFileSync(web("public/sw.js"), "utf8")
const killSwitch = readFileSync(web("public/sw-kill-switch.js"), "utf8")

describe("manifest", () => {
  const m = manifest()
  it("installs as FinCreador, standalone, from / and within /", () => {
    expect(m).toMatchObject({ name: "FinCreador", short_name: "FinCreador", start_url: "/", scope: "/", display: "standalone", theme_color: "#f5f7f3", background_color: "#17251f" })
    expect(m.description).toBeTruthy()
  })
  it("has 192, 512 and a maskable 512 icon, each a committed file", () => {
    expect(m.icons?.map((i) => [i.src, i.sizes, i.purpose])).toEqual([
      ["/icons/icon-192.png", "192x192", "any"],
      ["/icons/icon-512.png", "512x512", "any"],
      ["/icons/icon-maskable-512.png", "512x512", "maskable"],
    ])
    for (const icon of m.icons ?? []) expect(existsSync(web(`public${icon.src}`))).toBe(true)
  })
  it("offers Add expense and Ask Roma by their existing deep links", () => {
    expect(m.shortcuts?.map((s) => [s.name, s.url])).toEqual([
      ["Add expense", "/transactions?add=expense"],
      ["Ask Roma", "/roma"],
    ])
  })
})

describe("service worker", () => {
  const precache = JSON.parse(`[${/const PRECACHE_URLS = \[([\s\S]*?)\]/.exec(sw)![1]!.replace(/OFFLINE_URL/, '"/offline"').replace(/,\s*$/, "")}]`) as string[]

  it("precaches only the offline page, its fonts and the icons, all real files", () => {
    expect(precache).toEqual(["/offline", ...OFFLINE_FONTS, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png", "/favicon.ico"])
    for (const url of precache.slice(1)) expect(existsSync(web(url === "/favicon.ico" ? "app/favicon.ico" : `public${url}`)), url).toBe(true)
  })
  it("hard-codes no hashed build file and caches /_next/static only on first use", () => {
    expect(sw).not.toMatch(/_next\/static\/[\w-]+\//)
    expect(sw).toContain('url.pathname.startsWith("/_next/static/")')
  })
  it("never answers RSC payloads, /api/ or /auth/ from a cache, and leaves other origins alone", () => {
    expect(sw).toContain('request.headers.get("RSC") || url.searchParams.has("_rsc")')
    expect(sw).toContain('url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")')
    expect(sw).toContain("if (url.origin !== self.location.origin) return")
    // Navigations: the network, then the offline page; never cache.put for a page.
    expect(sw.match(/cache\.put\(/g)).toHaveLength(1)
  })
  it("waits for the person before activating, and versions its caches", () => {
    expect(sw).toMatch(/event\.data\.type === "SKIP_WAITING"\) self\.skipWaiting\(\)/)
    expect(sw.match(/skipWaiting\(\)/g)).toHaveLength(1)
    expect(serviceWorkerUrl("abc 1")).toBe("/sw.js?v=abc%201")
  })
  it("registers in production builds only", () => {
    expect(registersServiceWorker("production")).toBe(true)
    expect(registersServiceWorker("development")).toBe(false)
    expect(registersServiceWorker("test")).toBe(false)
  })
  it("has a kill switch that clears every cache, unregisters and reloads", () => {
    expect(killSwitch).toContain("self.skipWaiting()")
    expect(killSwitch).toContain("caches.delete(key)")
    expect(killSwitch).toContain("self.registration.unregister()")
    expect(killSwitch).toContain("client.navigate(client.url)")
  })
  it("offline fonts are the same files the app bundles", () => {
    const require = createRequire(import.meta.url)
    const pairs = {
      "manrope-latin.woff2": "@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
      "dm-sans-latin-ext.woff2": "@fontsource-variable/dm-sans/files/dm-sans-latin-ext-wght-normal.woff2",
    }
    for (const [name, from] of Object.entries(pairs)) expect(readFileSync(web(`public/fonts/${name}`)).equals(readFileSync(require.resolve(from)))).toBe(true)
  })
})

describe("offline page", () => {
  const html = offlinePageHtml()
  it("is one self-contained document with a valid inline script", () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!
    expect(() => new Function(script)).not.toThrow()
    expect(html).not.toMatch(/<script src=|<link rel="stylesheet"/)
    for (const font of OFFLINE_FONTS) expect(html).toContain(font)
  })
  it("draws figures with textContent only and says it is read-only", () => {
    expect(html).not.toContain("innerHTML")
    expect(html).toContain("Read-only.")
    expect(html).toContain("Nothing saved on this device yet.")
    expect(html).toContain('id="retry"')
    expect(html).toContain(JSON.stringify(SNAPSHOT_IDB))
  })
})

describe("snapshot freshness", () => {
  const now = Date.parse("2026-11-22T12:00:00Z")
  it("shows a snapshot up to 7 days old, not older, not from the future", () => {
    expect(isSnapshotFresh("2026-11-22T11:00:00Z", now, SNAPSHOT_MAX_AGE_MS)).toBe(true)
    expect(isSnapshotFresh("2026-11-15T12:00:00Z", now, SNAPSHOT_MAX_AGE_MS)).toBe(true)
    expect(isSnapshotFresh("2026-11-15T11:59:59Z", now, SNAPSHOT_MAX_AGE_MS)).toBe(false)
    expect(isSnapshotFresh("2026-11-22T12:10:00Z", now, SNAPSHOT_MAX_AGE_MS)).toBe(false)
    expect(isSnapshotFresh("not a date", now, SNAPSHOT_MAX_AGE_MS)).toBe(false)
  })
})

const account = (id: string, label: string, kind: LedgerAccount["kind"], opening: number, currency = "INR", archived = false): LedgerAccount => ({
  id, kind, bankType: kind === "bank" ? "savings" : null, label, currency, openingBalanceMinor: opening, openingBalanceDate: "2026-01-01", inflowMinor: 0, outflowMinor: 0, archived,
})
const item = (n: number, over: Partial<LedgerItem> = {}): LedgerItem => ({
  id: `e${n}`, type: "expense", amountMinor: 10000 + n, currency: "INR", occurredOn: "2026-11-20", accountId: "bank", counterAccountId: null,
  categoryId: "food", voided: false, replacesId: null, note: null, paymentMode: "upi", createdAt: "2026-11-20T10:00:00+00:00", voidReason: null, ...over,
})

describe("buildOfflineSnapshot", () => {
  const context = {
    today: "2026-11-22",
    currency: "INR",
    timeZone: "Asia/Kolkata",
    accounts: [account("bank", "HDFC Bank ··4821", "bank", 5_000_000), account("cash", "Cash in hand", "cash", 250_000), account("old", "Old account", "bank", 999, "INR", true)],
    loanAccounts: [],
    categories: [{ id: "food", kind: "expense" as const, name: "Food & dining", icon: "food", archived: false, defaultAccountId: null, key: null }],
  }
  const recurring = {
    due: [{ date: "2026-11-25", entry: item(90, { note: "Netflix", amountMinor: 64900 }) }],
    soon: [{ date: "2026-12-01", entry: item(91, { note: "Rent", amountMinor: 2_500_000 }) }, { date: null, entry: item(92) }],
  } as unknown as RecurringView
  const reminders: BellReminder[] = [
    { id: "r1", name: "Car loan", label: "EMI", dueDate: "2026-11-23", amountMinor: 1_200_000, currency: "INR", reason: "due_soon" as BellReminder["reason"], daysOverdue: 0 },
    { id: "r2", name: "Card", label: "Statement", dueDate: null, amountMinor: null, currency: "INR", reason: "statement", daysOverdue: 0 },
  ]
  const recent = Array.from({ length: 25 }, (_, i) => item(i, i === 0 ? { voided: true } : {}))
  const snapshot = buildOfflineSnapshot({ userId: "00000000-0000-4000-8000-000000000001", now: new Date("2026-11-22T13:12:00Z"), context, month: { incomeMinor: 9_500_050, expenseMinor: 1_234_560 } as never, recent, recurring, reminders })

  it("is valid and for the given user, with the time in their zone", () => {
    expect(parseSnapshot(snapshot)).toEqual(snapshot)
    expect(snapshot.userId).toBe("00000000-0000-4000-8000-000000000001")
    expect(snapshot.takenAt).toBe("2026-11-22T13:12:00.000Z")
    expect(snapshot.takenLabel).toBe(takenLabel(new Date("2026-11-22T13:12:00Z"), "Asia/Kolkata"))
    expect(snapshot.takenLabel).toMatch(/^6:42\s?pm, 22 Nov 2026$/i)
  })
  it("totals active accounts (Total available) and lists them as the app labels them", () => {
    expect(snapshot.totalAvailable).toBe("₹52,500")
    expect(snapshot.accounts).toEqual([
      { name: "HDFC Bank ··4821", balance: "₹50,000" },
      { name: "Cash in hand", balance: "₹2,500" },
    ])
  })
  it("has this month's income and spending in whole rupees", () => {
    expect(snapshot.month).toEqual({ label: "November 2026", income: "₹95,001", spent: "₹12,346" })
  })
  it("lists the next 5 dues by date: recurring and loan or card dues", () => {
    expect(snapshot.dues.map((d) => [d.name, d.date])).toEqual([
      ["Car loan · EMI", "23 Nov 2026"],
      ["Netflix", "25 Nov 2026"],
      ["Rent", "1 Dec 2026"],
    ])
  })
  it("keeps the last 20 entries (not voided) with date, name, category and amount, and nothing else", () => {
    expect(snapshot.entries).toHaveLength(20)
    expect(snapshot.entries[0]).toEqual({ date: "20 Nov 2026", name: "Food & dining", category: "Food & dining", amount: expect.stringMatching(/^[−-]₹100\.01$/) })
    expect(Object.keys(snapshot).sort()).toEqual(["accounts", "dues", "entries", "month", "takenAt", "takenLabel", "totalAvailable", "userId", "v"])
  })
  it("rejects anything else as a snapshot", () => {
    expect(parseSnapshot({ ...snapshot, v: 2 })).toBeNull()
    expect(parseSnapshot({ ...snapshot, entries: Array(21).fill(snapshot.entries[0]) })).toBeNull()
    expect(parseSnapshot(null)).toBeNull()
  })
})

describe("install card", () => {
  const store = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
  it("counts one visit per browser session", () => {
    const local = store()
    const s1 = store()
    expect(countVisit(local, s1)).toBe(1)
    expect(countVisit(local, s1)).toBe(1)
    expect(countVisit(local, store())).toBe(2)
  })
  it("shows from the second visit on phones, until dismissed or installed", () => {
    const base = { visits: 2, dismissed: false, phone: true, installed: false, canPrompt: true, iosSafari: false }
    expect(showInstallCard(base)).toBe(true)
    expect(showInstallCard({ ...base, visits: 1 })).toBe(false)
    expect(showInstallCard({ ...base, phone: false })).toBe(false)
    expect(showInstallCard({ ...base, installed: true })).toBe(false)
    expect(showInstallCard({ ...base, canPrompt: false })).toBe(false)
    expect(showInstallCard({ ...base, canPrompt: false, iosSafari: true })).toBe(true)
    const local = store()
    expect(installDismissed(local)).toBe(false)
    dismissInstall(local)
    expect(installDismissed(local)).toBe(true)
  })
  it("offers the Share steps only in Safari on iPhone or iPad", () => {
    const iphoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    expect(isIosSafari(iphoneSafari, 5)).toBe(true)
    expect(isIosSafari(iphoneSafari.replace("Version/18.0", "CriOS/130.0"), 5)).toBe(false)
    expect(isIosSafari("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", 5)).toBe(true)
    expect(isIosSafari("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", 0)).toBe(false)
    expect(isIosSafari("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36", 5)).toBe(false)
  })
})
