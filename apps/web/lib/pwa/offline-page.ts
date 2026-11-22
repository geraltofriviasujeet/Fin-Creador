import { colors, logo, logoRingPath } from "@fin-creador/design-tokens"
import { type SnapshotIdb, SNAPSHOT_IDB, SNAPSHOT_MAX_AGE_MS, isSnapshotFresh } from "./snapshot"
import { idbClear, idbRead } from "./snapshot-idb"

// The offline page (Sprint 12b), served at /offline by app/offline/route.ts and precached by
// the service worker, which shows it for any page that can't load without a connection.
// One self-contained HTML document: inline CSS from the design tokens, fonts from /fonts/
// (stable copies, scripts/generate-pwa-assets.ts), and an inline script that reads the
// snapshot from IndexedDB. It holds no personal data itself: the figures are drawn on the
// device from the snapshot, with textContent only, and only while the device is offline.

/** Font files the offline page uses; the service worker precaches them (public/sw.js). */
export const OFFLINE_FONTS = [
  "/fonts/manrope-latin.woff2",
  "/fonts/manrope-latin-ext.woff2",
  "/fonts/dm-sans-latin.woff2",
  "/fonts/dm-sans-latin-ext.woff2",
] as const

const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
// Carries ₹ (U+20B9).
const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"

const face = (family: string, file: string, weight: string, range: string) =>
  `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:${weight};src:url(${file}) format("woff2-variations");unicode-range:${range}}`

type OfflineConfig = { idb: SnapshotIdb; maxAgeMs: number }
type OfflineDeps = { read: typeof idbRead; clear: typeof idbClear; fresh: typeof isSnapshotFresh }

/**
 * Runs in the browser on the offline page. Self-contained (only its parameters and browser
 * globals): it is inlined with Function.prototype.toString. Shows the snapshot only while
 * offline and only when fresh; a stale one is deleted.
 */
export function offlineMain(cfg: OfflineConfig, deps: OfflineDeps): void {
  const $ = (id: string) => document.getElementById(id) as HTMLElement
  const el = (tag: string, cls: string | null, text: string | null) => {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== null) node.textContent = text
    return node
  }
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === "object") : [])

  const row = (label: string, sub: string | null, value: string) => {
    const li = el("li", "row", null)
    const left = el("div", "row-text", null)
    left.append(el("span", "row-name", label))
    if (sub) left.append(el("span", "row-sub", sub))
    li.append(left, el("span", "row-value", value))
    return li
  }
  const section = (title: string, items: HTMLElement[], empty: string) => {
    const s = el("section", "card", null)
    s.append(el("h2", null, title))
    if (items.length === 0) s.append(el("p", "muted", empty))
    else {
      const ul = el("ul", "rows", null)
      ul.append(...items)
      s.append(ul)
    }
    return s
  }

  function render(snapshot: Record<string, unknown> | null) {
    const content = $("content")
    content.replaceChildren()
    if (navigator.onLine) {
      $("title").textContent = "You’re back online"
      $("lead").textContent = "Tap Retry to open FinCreador."
      return
    }
    $("title").textContent = "You’re offline"
    if (!snapshot) {
      $("lead").textContent = "Nothing saved on this device yet. Your figures appear here once you’ve used FinCreador online on this device."
      return
    }
    $("lead").textContent = `Your money as of ${str(snapshot.takenLabel)}`
    const note = el("p", "note", "Read-only. Saved on this device the last time you were online. Nothing can be added or changed until you’re back online.")
    note.setAttribute("role", "note")

    const total = el("section", "card total", null)
    total.append(el("h2", null, "Total available"), el("p", "big", str(snapshot.totalAvailable)))

    const month = (snapshot.month ?? {}) as Record<string, unknown>
    const monthCard = el("section", "card", null)
    monthCard.append(el("h2", null, `This month · ${str(month.label)}`))
    const grid = el("dl", "pair", null)
    const pair = (k: string, v: string) => {
      const d = el("div", null, null)
      d.append(el("dt", null, k), el("dd", null, v))
      grid.append(d)
    }
    pair("Income", str(month.income))
    pair("Spent", str(month.spent))
    monthCard.append(grid)

    content.append(
      note,
      total,
      section("Accounts", list(snapshot.accounts).map((a) => row(str(a.name), null, str(a.balance))), "No accounts."),
      monthCard,
      section("Next dues", list(snapshot.dues).map((d) => row(str(d.name), str(d.date), str(d.amount) || "—")), "Nothing due soon."),
      section("Latest entries", list(snapshot.entries).map((e) => row(str(e.name), `${str(e.date)} · ${str(e.category)}`, str(e.amount))), "No entries yet."),
    )
  }

  let current: Record<string, unknown> | null = null
  async function load() {
    const value = (await deps.read(cfg.idb)) as Record<string, unknown> | null
    const ok = value && value.v === 1 && typeof value.takenAt === "string"
    if (ok && deps.fresh(value.takenAt as string, Date.now(), cfg.maxAgeMs)) current = value
    else {
      current = null
      if (value) await deps.clear(cfg.idb)
    }
    render(current)
  }

  $("retry").addEventListener("click", () => {
    // A plain page outside the Next.js router: a full load is the point.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (location.pathname === "/offline") location.assign("/")
    else location.reload()
  })
  window.addEventListener("online", () => render(current))
  window.addEventListener("offline", () => void load())
  void load()
}

const RING = logoRingPath()

/** The whole offline page. */
export function offlinePageHtml(): string {
  const c = colors
  const config: OfflineConfig = { idb: SNAPSHOT_IDB, maxAgeMs: SNAPSHOT_MAX_AGE_MS }
  // Each function as an expression, so a minifier renaming its declared name changes nothing.
  const script = `(function(){var deps={read:(${idbRead.toString()}),clear:(${idbClear.toString()}),fresh:(${isSnapshotFresh.toString()})};
(${offlineMain.toString()})(${JSON.stringify(config)},deps);})();`

  const css = [
    face("Manrope Variable", OFFLINE_FONTS[0], "200 800", LATIN),
    face("Manrope Variable", OFFLINE_FONTS[1], "200 800", LATIN_EXT),
    face("DM Sans Variable", OFFLINE_FONTS[2], "100 1000", LATIN),
    face("DM Sans Variable", OFFLINE_FONTS[3], "100 1000", LATIN_EXT),
    `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}`,
    `body{margin:0;background:${c.canvas};color:${c.ink};font:14px/1.5 "DM Sans Variable",ui-sans-serif,system-ui,sans-serif}`,
    `main{max-width:560px;margin:0 auto;padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(32px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}`,
    `h1,h2{font-family:"Manrope Variable","DM Sans Variable",ui-sans-serif,system-ui,sans-serif;margin:0}`,
    `h1{font-size:22px;font-weight:700;margin-top:16px}h2{font-size:14px;font-weight:600;color:${c.muted}}`,
    `.lead{font-size:16px;margin:6px 0 16px}.muted{color:${c.muted};margin:8px 0 0}`,
    `.note{background:${c.surface};border:1px solid ${c.line};border-left:4px solid ${c.accentDeep};border-radius:12px;padding:10px 12px;margin:0 0 12px;color:${c.ink}}`,
    `.card{background:${c.surface};border:1px solid ${c.line};border-radius:16px;padding:16px;margin:0 0 12px}`,
    `.big{font-family:"Manrope Variable",ui-sans-serif,system-ui,sans-serif;font-size:28px;font-weight:700;margin:4px 0 0;font-variant-numeric:tabular-nums}`,
    `.rows{list-style:none;margin:8px 0 0;padding:0}.row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid ${c.line}}.row:first-child{border-top:0}`,
    `.row-text{display:grid;min-width:0}.row-name{font-weight:600;overflow-wrap:anywhere}.row-sub{font-size:12px;color:${c.muted}}.row-value{font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}`,
    `.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:8px 0 0}.pair dt{font-size:12px;color:${c.muted}}.pair dd{margin:0;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}`,
    `button{font:inherit;font-weight:600;min-height:44px;padding:0 18px;border-radius:8px;border:0;background:${c.ink};color:${c.navText};cursor:pointer}`,
    `button:focus-visible{outline:2px solid ${c.accentDeep};outline-offset:2px}`,
  ].join("\n")

  const mark = `<svg aria-hidden="true" width="32" height="32" viewBox="0 0 ${logo.size} ${logo.size}" overflow="visible"><g transform="rotate(${logo.rotationDeg} ${logo.size / 2} ${logo.size / 2})"><rect width="${logo.size}" height="${logo.size}" rx="${logo.cornerRadius}" fill="${c.accent}"/><path d="${RING}" fill="none" stroke="${c.ink}" stroke-width="${logo.ringStroke}" stroke-linecap="round"/></g></svg>`

  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${c.canvas}">
<meta name="robots" content="noindex">
<title>Offline · FinCreador</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<style>${css}</style>
</head>
<body>
<main>
${mark}
<h1 id="title">You’re offline</h1>
<p class="lead" id="lead" aria-live="polite">Checking this device…</p>
<div id="content"></div>
<button type="button" id="retry">Retry</button>
</main>
<script>${script}</script>
</body>
</html>
`
}
