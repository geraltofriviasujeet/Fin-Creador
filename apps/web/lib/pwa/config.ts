// Service worker switches (Sprint 12b). docs/deployment.md, "Service worker kill switch".

/**
 * false: pages stop registering the service worker and unregister any they find. Part of the
 * kill switch, together with deploying public/sw-kill-switch.js as public/sw.js.
 */
export const SERVICE_WORKER_ENABLED = true

/** Registered only in production builds (`next build`), never under `npm run dev`. */
export const registersServiceWorker = (nodeEnv: string | undefined) => SERVICE_WORKER_ENABLED && nodeEnv === "production"

/** The script URL for this build: a new build id means a new worker version and new caches. */
export const serviceWorkerUrl = (version: string | undefined) => `/sw.js?v=${encodeURIComponent(version || "dev")}`
