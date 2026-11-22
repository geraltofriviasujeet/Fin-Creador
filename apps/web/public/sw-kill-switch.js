// FinCreador service worker kill switch (Sprint 12b). NOT registered in normal use.
//
// If the service worker misbehaves, deploy this file's contents as public/sw.js (steps in
// docs/deployment.md, "Service worker kill switch"). Every browser that has the worker
// fetches /sw.js when it next checks for updates (each navigation, at least once a day),
// installs this version at once, and it: deletes every cache this site made, unregisters
// itself and reloads each open FinCreador tab, which then loads straight from the network.

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.registration.unregister()
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      await Promise.all(windows.map((client) => ("navigate" in client ? client.navigate(client.url).catch(() => null) : null)))
    })()
  )
})
