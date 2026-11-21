import { type Page, expect, test } from "@playwright/test"
import { overviewHeading, signUpConfirmed, skipWelcome, uniqueEmail, welcomeDialog } from "./helpers"

// Already signed in on /sign-in or /sign-up: a "Continue as" card instead of the form (owner,
// 2026-11-22). Continue goes to Overview without counting as a sign-in (no welcome); "Not you?"
// signs out with a full page load and shows the form. Screenshots (synthetic demo user on
// example.com) in e2e-screenshots/ for docs/design/sign-in-continue/.

const SHOTS = "e2e-screenshots"
const card = (page: Page) => page.getByTestId("continue-card")

/** The server sends the card, never the form, for a signed-in visitor: no flash of the form. */
async function expectNoFormInHtml(page: Page, path: string) {
  const html = await (await page.request.get(path)).text()
  expect(html).toContain("You’re already signed in")
  expect(html).not.toContain('name="password"')
}

async function expectNoSideScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(scroll).toBeLessThanOrEqual(client)
}

test.describe("at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("Continue goes to Overview without the welcome; Not you? signs out and shows the form", async ({ page }) => {
    const email = uniqueEmail("continue")
    // Skipped, not hidden: the welcome would show again after a real sign-in.
    await signUpConfirmed(page, "Demo User", email)

    await page.goto("/sign-in")
    await expect(card(page)).toBeVisible()
    await expect(card(page).getByRole("heading", { name: "You’re already signed in" })).toBeVisible()
    await expect(card(page).getByText("Demo User", { exact: true })).toBeVisible()
    await expect(card(page).getByText("e•••@example.com", { exact: true })).toBeVisible()
    await expect(card(page).getByText(email)).toHaveCount(0)
    await expect(card(page).getByText("DU", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Email")).toHaveCount(0)
    await expectNoFormInHtml(page, "/sign-in")
    await page.screenshot({ path: `${SHOTS}/1280-continue-card.png`, fullPage: true })

    // Continue: Overview, explicitly, and no welcome (not a new sign-in).
    await card(page).getByRole("link", { name: "Continue to FinCreador" }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(overviewHeading(page)).toBeVisible()
    await page.waitForLoadState("networkidle")
    await expect(welcomeDialog(page)).toHaveCount(0)

    // Sign-up shows the card too; Not you? signs out and comes back to the sign-up form.
    await page.goto("/sign-up")
    await expectNoFormInHtml(page, "/sign-up")
    await card(page).getByRole("button", { name: "Not you? Sign out" }).click()
    await expect(page).toHaveURL(/\/sign-up\?notice=signed-out$/)
    await expect(card(page)).toHaveCount(0)
    await expect(page.getByLabel("Your name")).toBeVisible()
    await page.goto("/")
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test("Not you? on sign-in shows the sign-in form, and a real sign-in still shows the welcome", async ({ page }) => {
    const email = uniqueEmail("not-you")
    await signUpConfirmed(page, "Demo User", email)
    await page.goto("/sign-in")
    await card(page).getByRole("button", { name: "Not you? Sign out" }).click()
    await expect(page).toHaveURL(/\/sign-in\?notice=signed-out$/)
    await expect(page.getByText("You’ve signed out.")).toBeVisible()
    await expect(page.getByLabel("Email")).toBeVisible()

    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill("correct-horse-42")
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    await skipWelcome(page)
  })

  test("the website link sits next to the bell and opens fincreador.com in the same tab", async ({ page }) => {
    await signUpConfirmed(page, "Demo User", uniqueEmail("website"), { hideWelcome: true })
    const link = page.getByRole("banner").getByRole("link", { name: "FinCreador website" })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute("href", "https://www.fincreador.com")
    await expect(link).not.toHaveAttribute("target", /.+/)
    await link.hover()
    await expect(page.getByText("FinCreador website", { exact: true }).last()).toBeVisible()
  })
})

test.describe("at 360px", () => {
  test.use({ viewport: { width: 360, height: 780 } })

  test("the Continue card fits a phone", async ({ page }) => {
    await signUpConfirmed(page, "Demo User", uniqueEmail("continue-phone"), { hideWelcome: true })
    await page.goto("/sign-in")
    await expect(card(page)).toBeVisible()
    await expect(card(page).getByRole("link", { name: "Continue to FinCreador" })).toBeVisible()
    await expectNoSideScroll(page)
    await page.screenshot({ path: `${SHOTS}/360-continue-card.png`, fullPage: true })
  })

  test("the website link moves from the top bar into More", async ({ page }) => {
    await signUpConfirmed(page, "Demo User", uniqueEmail("website-phone"), { hideWelcome: true })
    await expect(page.getByRole("banner").getByRole("link", { name: "FinCreador website" })).toBeHidden()
    const nav = page.getByRole("navigation", { name: "Main" })
    await nav.getByRole("button", { name: "More" }).click()
    const item = nav.getByRole("link", { name: "FinCreador website" })
    await expect(item).toBeVisible()
    await expect(item).toHaveAttribute("href", "https://www.fincreador.com")
  })
})

test("Google sign-in always asks for the account chooser", async ({ page }) => {
  // Google isn't configured on the CI Supabase, so the authorize request is answered here.
  let authorizeUrl: URL | undefined
  await page.route(/\/auth\/v1\/authorize\?/, async (route) => {
    authorizeUrl = new URL(route.request().url())
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Google stub</p>" })
  })
  await page.goto("/sign-in")
  await page.getByRole("button", { name: "Continue with Google" }).click()
  await expect(page.getByText("Google stub")).toBeVisible()
  expect(authorizeUrl?.searchParams.get("provider")).toBe("google")
  expect(authorizeUrl?.searchParams.get("prompt")).toBe("select_account")
})
