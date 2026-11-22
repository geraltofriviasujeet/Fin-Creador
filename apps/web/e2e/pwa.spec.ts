import { type BrowserContext, type Page, expect, test } from "@playwright/test"
import { addBank, addEntry, signIn, signOut, signUpConfirmed, uniqueEmail } from "./helpers"

// Sprint 12b: installable PWA and the read-only offline view, against the production build
// (`next start`), where the service worker registers. Every other spec blocks service workers
// (playwright.config.ts); this one allows them. Synthetic demo users only.

test.use({ serviceWorkers: "allow" })

const SHOTS = "e2e-screenshots"
const OFFLINE_REASON = "You’re offline · Saving is paused"
const IDB = { db: "fincreador-offline", store: "snapshot", key: "current" }

type Stored = { userId: string; takenAt: string; totalAvailable: string; entries: { name: string }[] } | null

/** The stored offline snapshot, read in the page. */
function readSnapshot(page: Page): Promise<Stored> {
  return page.evaluate(
    (idb) =>
      new Promise<Stored>((resolve) => {
        const open = indexedDB.open(idb.db, 1)
        open.onupgradeneeded = () => open.result.createObjectStore(idb.store)
        open.onerror = () => resolve(null)
        open.onsuccess = () => {
          const get = open.result.transaction(idb.store, "readonly").objectStore(idb.store).get(idb.key)
          get.onsuccess = () => {
            open.result.close()
            resolve((get.result as Stored) ?? null)
          }
          get.onerror = () => resolve(null)
        }
      }),
    IDB
  )
}

function writeSnapshot(page: Page, value: unknown): Promise<void> {
  return page.evaluate(
    ({ idb, value }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(idb.db, 1)
        open.onupgradeneeded = () => open.result.createObjectStore(idb.store)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction(idb.store, "readwrite")
          tx.objectStore(idb.store).put(value, idb.key)
          tx.oncomplete = () => {
            open.result.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    { idb: IDB, value }
  )
}

/** Waits until the service worker is active for this page. */
async function swReady(page: Page) {
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state ?? null), { timeout: 20_000 }).toBe("activated")
}

/** Every cache entry: its URL and content type. */
function cacheEntries(page: Page) {
  return page.evaluate(async () => {
    const out: { cache: string; url: string; type: string }[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        const response = await cache.match(request)
        out.push({ cache: name, url: request.url, type: response?.headers.get("content-type") ?? "" })
      }
    }
    return out
  })
}

async function signedUpWithData(page: Page, name: string, label: string) {
  await signUpConfirmed(page, name, uniqueEmail(label), { hideWelcome: true })
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "1,000" })
  await addEntry(page, { amount: "250", category: "Groceries", from: "HDFC Bank ··4821", note: "Milk and bread" })
}

async function goOffline(context: BrowserContext, offline: boolean) {
  await context.setOffline(offline)
}

test("manifest, icons and Apple tags", async ({ page, request }) => {
  const res = await request.get("/manifest.webmanifest")
  expect(res.ok()).toBe(true)
  const m = await res.json()
  expect(m).toMatchObject({ name: "FinCreador", short_name: "FinCreador", start_url: "/", scope: "/", display: "standalone", theme_color: "#f5f7f3", background_color: "#17251f" })
  expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(["/transactions?add=expense", "/roma"])
  for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBe(true)

  await page.goto("/sign-in")
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest")
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png")
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "FinCreador")
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute("content", "default")
})

test("offline: the read-only snapshot with its time; caches hold no pages, RSC or API", async ({ page, context }) => {
  await signedUpWithData(page, "Pooja Menon", "pwa-offline")
  await swReady(page)
  // The save refreshed the snapshot (Total available ₹750, the entry).
  await expect.poll(async () => (await readSnapshot(page))?.entries.map((e) => e.name) ?? []).toContain("Milk and bread")
  // A few controlled page loads, so /_next/static files are cached on first use.
  await page.goto("/transactions")
  await page.goto("/")

  await goOffline(context, true)
  await page.goto("/transactions")
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible()
  await expect(page.getByText(/^Your money as of \d{1,2}:\d{2}\s?[ap]m, \d{1,2} [A-Z][a-z]{2} \d{4}$/i)).toBeVisible()
  await expect(page.getByRole("note")).toContainText("Read-only.")
  await expect(page.getByText("₹750").first()).toBeVisible()
  await expect(page.getByText("HDFC Bank ··4821")).toBeVisible()
  await expect(page.getByText("Milk and bread")).toBeVisible()
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible()
  // Fonts come from the precache (no hashed app CSS offline).
  await expect
    .poll(() => page.evaluate(() => [...document.fonts].some((f) => f.family.includes("DM Sans") && f.status === "loaded")))
    .toBe(true)
  await page.screenshot({ path: `${SHOTS}/pwa-offline.png`, fullPage: true })

  const entries = await cacheEntries(page)
  expect(entries.length).toBeGreaterThan(0)
  for (const e of entries) {
    const { pathname, search } = new URL(e.url)
    expect(pathname.startsWith("/api/") || pathname.startsWith("/auth/"), e.url).toBe(false)
    expect(search, e.url).not.toContain("_rsc")
    expect(e.type, e.url).not.toContain("text/x-component")
    if (e.type.includes("text/html")) expect(pathname, e.url).toBe("/offline")
    expect(pathname === "/offline" || pathname === "/favicon.ico" || /^\/(fonts|icons|_next\/static)\//.test(pathname), e.url).toBe(true)
  }
  expect(entries.some((e) => new URL(e.url).pathname.startsWith("/_next/static/"))).toBe(true)

  // Back online: the figures go away at once; Retry loads the page that failed.
  await goOffline(context, false)
  await expect(page.getByRole("heading", { name: "You’re back online" })).toBeVisible()
  await expect(page.getByText("Milk and bread")).toBeHidden()
  await page.getByRole("button", { name: "Retry" }).click()
  await expect(page).toHaveURL(/\/transactions$/)
  await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible()
})

test("offline in the app: the banner, and Save disabled with the reason", async ({ page, context }) => {
  await signedUpWithData(page, "Ravi Kumar", "pwa-banner")
  await page.getByRole("link", { name: "Add expense" }).first().click()
  const d = page.getByRole("dialog", { name: "Add expense" })
  await expect(d).toBeVisible()

  await goOffline(context, true)
  await expect(page.getByRole("status").filter({ hasText: OFFLINE_REASON })).toBeVisible()
  const save = d.getByRole("button", { name: /^Save expense/ })
  await expect(save).toBeDisabled()
  await expect(save).toHaveAttribute("title", OFFLINE_REASON)
  await expect(save).toHaveAccessibleName(`Save expense (${OFFLINE_REASON})`)

  await goOffline(context, false)
  await expect(page.getByText(OFFLINE_REASON)).toBeHidden()
  await expect(d.getByRole("button", { name: "Save expense", exact: true })).toBeEnabled()
})

test("sign-out and another user's snapshot are wiped", async ({ page }) => {
  const email = uniqueEmail("pwa-wipe")
  await signUpConfirmed(page, "Meera Shah", email, { hideWelcome: true })
  await expect.poll(async () => (await readSnapshot(page))?.userId ?? null).not.toBeNull()
  const own = (await readSnapshot(page))!.userId

  await signOut(page)
  expect(await readSnapshot(page)).toBeNull()

  // Another user's snapshot on this device: deleted when this user's app loads, then replaced.
  await signIn(page, email)
  await expect(page).toHaveURL(/\/$/)
  await writeSnapshot(page, { ...(await readSnapshotOrWait(page)), userId: "00000000-0000-4000-8000-00000000beef" })
  await page.reload()
  await expect.poll(async () => (await readSnapshot(page))?.userId ?? null).toBe(own)
})

async function readSnapshotOrWait(page: Page) {
  await expect.poll(async () => (await readSnapshot(page))?.userId ?? null).not.toBeNull()
  return (await readSnapshot(page))!
}

test("offline sign-out: the signed-out page; snapshot, caches and session gone; the server is told once online", async ({ page, context }) => {
  await signedUpWithData(page, "Dev Patel", "pwa-offline-sign-out")
  await swReady(page)
  await expect.poll(async () => (await readSnapshot(page))?.entries.map((e) => e.name) ?? []).toContain("Milk and bread")
  await page.goto("/settings")
  await expect.poll(async () => (await cacheEntries(page)).some((e) => e.cache.startsWith("fincreador-static-"))).toBe(true)
  const authCookies = async () => (await context.cookies()).filter((c) => /^sb-.+-auth-token/.test(c.name))
  expect((await authCookies()).length).toBeGreaterThan(0)

  await goOffline(context, true)
  const signOutButton = page.getByRole("main").getByRole("button", { name: "Sign out" })
  await expect(signOutButton).toBeEnabled()
  await expect(page.getByRole("main").getByRole("button", { name: /^Save/ }).first()).toBeDisabled()
  await signOutButton.click()

  await expect(page).toHaveURL(/\/offline\?signed-out=1$/)
  await expect(page.getByRole("heading", { name: "You’re signed out" })).toBeVisible()
  await expect(page.getByText("Milk and bread")).toHaveCount(0)
  expect(await readSnapshot(page)).toBeNull()
  expect((await cacheEntries(page)).filter((e) => !e.cache.startsWith("fincreador-precache-"))).toEqual([])
  expect(await authCookies()).toEqual([])
  expect(await page.evaluate(() => sessionStorage.getItem("fincreador-pending-sign-out"))).toBeTruthy()
  await page.screenshot({ path: `${SHOTS}/pwa-signed-out-offline.png`, fullPage: true })

  // Reopening the offline page: nothing saved on this device.
  await page.goto("/offline")
  await expect(page.getByText(/^Nothing saved on this device yet\./)).toBeVisible()

  // Back online: the app asks to sign in, and the sign-in page revokes the session with Auth.
  await goOffline(context, false)
  const logout = page.waitForResponse((r) => r.url().includes("/auth/v1/logout") && r.request().method() === "POST")
  await page.goto("/")
  await expect(page).toHaveURL(/\/sign-in/)
  expect((await logout).status()).toBeLessThan(300)
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("fincreador-pending-sign-out"))).toBeNull()
})

test("a snapshot older than 7 days is never shown, nor one while online", async ({ page, context }) => {
  await signUpConfirmed(page, "Imran Ali", uniqueEmail("pwa-stale"), { hideWelcome: true })
  await swReady(page)
  const current = await readSnapshotOrWait(page)

  await goOffline(context, true)
  await writeSnapshot(page, { ...current, takenAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() })
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible()
  await expect(page.getByText(/^Nothing saved on this device yet\./)).toBeVisible()
  await expect(page.getByText(/^Your money as of/)).toBeHidden()
  expect(await readSnapshot(page)).toBeNull()

  // Online, /offline never shows figures.
  await goOffline(context, false)
  await writeSnapshot(page, current)
  await page.goto("/offline")
  await expect(page.getByRole("heading", { name: "You’re back online" })).toBeVisible()
  await expect(page.getByText(/^Your money as of/)).toBeHidden()
})

test("kill switch: the self-unregistering worker clears caches and unregisters", async ({ page }) => {
  await signUpConfirmed(page, "Kavya Nair", uniqueEmail("pwa-kill"), { hideWelcome: true })
  await swReady(page)
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0)

  // The sign-in page doesn't register the worker, so nothing re-registers after the reload.
  await page.goto("/sign-in")
  const reloaded = page.waitForEvent("load")
  // The kill switch reloads this tab, which may end the evaluate itself.
  await page.evaluate(() => navigator.serviceWorker.register("/sw-kill-switch.js", { scope: "/" })).catch(() => {})
  await reloaded
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBe(0)
})

test("install: Settings entry and the browser's install dialog", async ({ page }) => {
  await signUpConfirmed(page, "Neha Gupta", uniqueEmail("pwa-install"), { hideWelcome: true })
  await page.goto("/settings")
  const card = page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Install the app", exact: true }) })
  await expect(card).toBeVisible()

  // Chrome's beforeinstallprompt, simulated (headless Chrome may not fire it); the newest wins.
  await page.evaluate(() => {
    const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => {},
      userChoice: Promise.resolve({ outcome: "accepted" }),
    })
    window.dispatchEvent(e)
  })
  await card.getByRole("button", { name: "Install FinCreador" }).click()
  await expect(card).toContainText("FinCreador is installed on this device.")
})

test.describe("phone install card", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("never on the first visit; from the second until dismissed", async ({ page, context }) => {
    await signUpConfirmed(page, "Arjun Rao", uniqueEmail("pwa-card"), { hideWelcome: true })
    const prompt = (p: Page) =>
      p.evaluate(() =>
        window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "dismissed" }) }))
      )
    const card = (p: Page) => p.getByRole("region", { name: "Install FinCreador" })
    await prompt(page)
    await expect(card(page)).toHaveCount(0)

    // A new tab is a new browser session: the second visit.
    const second = await context.newPage()
    await second.goto("/")
    await prompt(second)
    await expect(card(second)).toBeVisible()
    await second.screenshot({ path: `${SHOTS}/pwa-install-card.png` })
    await card(second).getByRole("button", { name: "Dismiss install suggestion" }).click()
    await expect(card(second)).toHaveCount(0)

    const third = await context.newPage()
    await third.goto("/")
    await prompt(third)
    await expect(third.getByRole("heading", { level: 1 })).toBeVisible()
    await expect(card(third)).toHaveCount(0)
  })
})

test("legal links on sign-up, in Settings and by the Roma switch", async ({ page }) => {
  await page.goto("/sign-up")
  const consent = page.getByText(/^By creating an account you agree to the/)
  await expect(consent).toBeVisible()
  const terms = consent.getByRole("link", { name: /^Terms/ })
  const privacy = consent.getByRole("link", { name: /^Privacy Policy/ })
  await expect(terms).toHaveAttribute("href", "https://www.fincreador.com/#terms")
  await expect(privacy).toHaveAttribute("href", "https://www.fincreador.com/#privacy-policy")
  for (const link of [terms, privacy]) {
    await expect(link).toHaveAttribute("target", "_blank")
    await expect(link).toHaveAttribute("rel", /noopener/)
  }

  await signUpConfirmed(page, "Sana Khan", uniqueEmail("pwa-legal"), { hideWelcome: true })
  await page.goto("/settings")
  const legal = page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Terms and privacy", exact: true }) })
  await expect(legal.getByRole("link", { name: /^Terms/ })).toHaveAttribute("href", "https://www.fincreador.com/#terms")
  const roma = page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Roma", exact: true }) })
  await expect(roma.getByRole("link", { name: /^Privacy Policy/ })).toHaveAttribute("href", "https://www.fincreador.com/#privacy-policy")
})
