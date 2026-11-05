import { type Page, expect, test } from "@playwright/test"
import { LAST_ACTIVE_KEY } from "../lib/auth/idle"
import { overviewHeading, signUpConfirmed, uniqueEmail } from "./helpers"

// Sign-out after 2 hours of inactivity (Sprint 10a), with a fake clock: a warning one
// minute before, "Stay signed in" in any tab keeps every tab signed in, and the sign-out
// really ends the session (the cookies are gone and the app sends you to sign in).

const warning = (page: Page) => page.getByRole("alertdialog", { name: "Still there?" })
const authCookies = async (page: Page) => (await page.context().cookies()).filter((c) => c.name.startsWith("sb-"))

test("warns a minute before, then signs out for real and says why", async ({ page }) => {
  await signUpConfirmed(page, "Idle Person", uniqueEmail("idle"))
  await page.clock.install()
  await page.goto("/")
  await expect(overviewHeading(page)).toBeVisible()
  expect(await authCookies(page)).not.toHaveLength(0)

  // 1 h 59 min with no activity: the warning, with a countdown.
  await page.clock.fastForward("01:59:01")
  await expect(warning(page)).toBeVisible()
  await expect(warning(page)).toContainText(/signed out in 0:\d\d/)

  // "Stay signed in" resets the two hours.
  await warning(page).getByRole("button", { name: "Stay signed in" }).click()
  await expect(warning(page)).toBeHidden()
  await page.clock.fastForward("01:00:00")
  await expect(warning(page)).toBeHidden()

  // Ignored again until two hours pass: signed out, with the reason on the sign-in page.
  await page.clock.fastForward("01:00:05")
  await expect(page).toHaveURL(/\/sign-in\?reason=idle/)
  await expect(page.getByText("You were signed out after 2 hours of inactivity")).toBeVisible()

  // The session is really over: no auth cookies, and the app asks to sign in.
  expect(await authCookies(page)).toHaveLength(0)
  await page.goto("/income")
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fincome/)
  // (A fresh sign-in starting a new two hours is unit-tested in lib/auth/idle.test.ts: the
  // fake clock here runs hours ahead of the server's sign-in time.)
})

test("activity in another tab keeps this tab signed in; the sign-out ends the session for every tab", async ({ context, page }) => {
  await signUpConfirmed(page, "Two Tabs", uniqueEmail("idle-tabs"))
  await page.clock.install()
  await page.goto("/")
  // The other tab: same site, same localStorage, no guard of its own (Playwright's fake
  // clock is not reliable across two pages, so only this page runs the timer). It records
  // activity the way a real tab does: by writing the shared last-active time.
  const other = await context.newPage()
  await other.goto("/favicon.ico")

  await page.clock.fastForward("01:59:01")
  await expect(warning(page)).toBeVisible()

  // Activity in the other tab (at this page's time) closes the warning here.
  const now = await page.evaluate(() => Date.now())
  await other.evaluate(([key, at]) => localStorage.setItem(key, at), [LAST_ACTIVE_KEY, String(now)] as const)
  await expect(warning(page)).toBeHidden()

  // Two more idle hours: signed out here with the reason; the other tab's session is gone too.
  await page.clock.fastForward("02:00:05")
  await expect(page).toHaveURL(/\/sign-in\?reason=idle/)
  await other.goto("/income")
  await expect(other).toHaveURL(/\/sign-in\?next=%2Fincome/)
  expect(await authCookies(page)).toHaveLength(0)
})

test("the sign-out route refuses posts from another site", async ({ page, request }) => {
  await signUpConfirmed(page, "Cross Site", uniqueEmail("idle-csrf"))
  const res = await request.post("/auth/idle-sign-out", { headers: { origin: "https://evil.example" }, form: { next: "/" }, maxRedirects: 0 })
  expect(res.status()).toBe(403)
})
