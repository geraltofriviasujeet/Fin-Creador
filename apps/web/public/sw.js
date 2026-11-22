// FinCreador service worker (Sprint 12b). Hand-written, no library.
//
// What it caches, and nothing else:
//   - PRECACHE: the offline page (/offline, a static document with no personal data), its
//     fonts and the app icons, fetched when this version installs.
//   - /_next/static/*: the build's own hashed, immutable files (JS, CSS, fonts), cache-first,
//     stored the first time the page uses them. No hashed name is written here.
// What it never caches: page navigations (HTML), RSC payloads, /api/ and /auth/ responses,
// Supabase and every other origin. Those go to the network as if there were no worker; a
// navigation that fails (offline) shows the offline page instead.
//
// Versions: the page registers /sw.js?v=<build id>; each build gets its own caches and the old
// ones are deleted on activate. A new version waits until the person taps "Reload" (the page
// sends SKIP_WAITING); it never reloads on its own.
//
// Emergency: public/sw-kill-switch.js removes this worker and its caches (docs/deployment.md).

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev"
const PREFIX = "fincreador-"
const PRECACHE = `${PREFIX}precache-${VERSION}`
const STATIC = `${PREFIX}static-${VERSION}`
const OFFLINE_URL = "/offline"
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/fonts/manrope-latin.woff2",
  "/fonts/manrope-latin-ext.woff2",
  "/fonts/dm-sans-latin.woff2",
  "/fonts/dm-sans-latin-ext.woff2",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/favicon.ico",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: "reload", credentials: "omit" }))))
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== PRECACHE && key !== STATIC).map((key) => caches.delete(key)))
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })()
  )
})

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting()
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Pages: always the network. Offline, the offline page (never a cached app page).
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse
          if (preloaded) return preloaded
          return await fetch(request)
        } catch {
          const offline = await caches.match(OFFLINE_URL, { cacheName: PRECACHE })
          return offline || Response.error()
        }
      })()
    )
    return
  }

  // RSC payloads and data are never answered from a cache.
  if (request.headers.get("RSC") || url.searchParams.has("_rsc")) return
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return

  if (PRECACHE_URLS.includes(url.pathname) && url.search === "") {
    event.respondWith(caches.match(url.pathname, { cacheName: PRECACHE }).then((hit) => hit || fetch(request)))
    return
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC)
        const hit = await cache.match(request)
        if (hit) return hit
        const response = await fetch(request)
        if (response.ok && response.type === "basic") await cache.put(request, response.clone())
        return response
      })()
    )
  }
  // Everything else: no respondWith, so the browser fetches it from the network as usual.
})
