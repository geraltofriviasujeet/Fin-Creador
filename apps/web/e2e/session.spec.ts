import { type Page, expect, test } from "@playwright/test"
import { IDLE_LIMIT_MS, IDLE_PORT } from "./idle-server"
import { overviewHeading, signUpConfirmed, uniqueEmail } from "./helpers"

// Sign-out after inactivity (Sprint 10a), in real time: this test uses the second server,
// whose IDLE_LIMIT_MS is 20 seconds (playwright.config.ts), so the warning shows for the last
// 10. It checks the warning, that "Stay signed in" restarts the limit, and that the sign-out
// really ends the session (the cookies are gone and the app sends you to sign in). The
// 2-hour default and tabs sharing one clock are unit-tested in lib/auth/idle.test.ts.

const IDLE = `http://localhost:${IDLE_PORT}`
const WARN_MS = IDLE_LIMIT_MS / 2
const warning = (page: Page) => page.getByRole("alertdialog", { name: "Still there?" })
const authCookies = async (page: Page) => (await page.context().cookies()).filter((c) => c.name.startsWith("sb-"))

test("warns before the limit, then signs out for real and says why", async ({ page }) => {
  test.setTimeout(90_000)
  await signUpConfirmed(page, "Idle Person", uniqueEmail("idle"))
  await page.goto(`${IDLE}/`)
  await expect(overviewHeading(page)).toBeVisible()
  expect(await authCookies(page)).not.toHaveLength(0)

  // No activity: the warning, with a countdown, once the last 10 seconds start.
  await expect(warning(page)).toBeVisible({ timeout: IDLE_LIMIT_MS })
  await expect(warning(page)).toContainText(/signed out in 0:\d\d after 20 seconds without activity/)

  // "Stay signed in" restarts the limit: the warning comes back no sooner than 10 s later.
  await warning(page).getByRole("button", { name: "Stay signed in" }).click()
  await expect(warning(page)).toBeHidden()
  const stayedAt = Date.now()
  await expect(warning(page)).toBeVisible({ timeout: IDLE_LIMIT_MS })
  expect(Date.now() - stayedAt).toBeGreaterThanOrEqual(IDLE_LIMIT_MS - WARN_MS - 1_000)

  // Ignored again: signed out, with the reason on the sign-in page.
  await expect(page).toHaveURL(/\/sign-in\?reason=idle/, { timeout: WARN_MS + 5_000 })
  await expect(page.getByText("You were signed out after 20 seconds of inactivity")).toBeVisible()

  // The session is really over: no auth cookies, and the app asks to sign in.
  expect(await authCookies(page)).toHaveLength(0)
  await page.goto(`${IDLE}/income`)
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fincome/)
})

test("the sign-out route refuses posts from another site", async ({ page, request }) => {
  await signUpConfirmed(page, "Cross Site", uniqueEmail("idle-csrf"))
  const res = await request.post("/auth/idle-sign-out", { headers: { origin: "https://evil.example" }, form: { next: "/" }, maxRedirects: 0 })
  expect(res.status()).toBe(403)
})
