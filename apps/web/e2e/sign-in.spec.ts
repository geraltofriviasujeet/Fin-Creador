import { type Page, expect, test } from "@playwright/test"
import { addBank, overviewHeading, signIn, signOut, signUpConfirmed, uniqueEmail } from "./helpers"

test("signed-out visitors are sent to sign-in and returned to the page they wanted", async ({ page }) => {
  const email = uniqueEmail("next")
  await signUpConfirmed(page, "Return Trip", email, { hideWelcome: true })
  await signOut(page)
  await expect(page.getByText("You’ve signed out.")).toBeVisible()

  await page.goto("/settings")
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings/)

  await signIn(page, email, "wrong-password-1")
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible()
  await expect(page.getByLabel("Email")).toHaveValue(email)

  await signIn(page, email)
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
})

test("the next parameter cannot send users to another site", async ({ page, baseURL }) => {
  const email = uniqueEmail("redirect")
  await signUpConfirmed(page, "Safe Redirect", email, { hideWelcome: true })
  await signOut(page)

  await page.goto("/sign-in?next=//evil.example/steal")
  await signIn(page, email)
  await expect(page).toHaveURL(`${baseURL}/`)
})

test("an unknown email gets the same message as a wrong password", async ({ page }) => {
  await page.goto("/sign-in")
  await signIn(page, uniqueEmail("nobody"), "whatever-123")
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible()
})

test("sign-out ends the session", async ({ page }) => {
  await signUpConfirmed(page, "Leaving Now", uniqueEmail("signout"))
  await signOut(page)
  await page.goto("/")
  await expect(page).toHaveURL(/\/sign-in/)
})

// Session isolation (owner, 2026-11-20): sign-in and sign-out end in a full page load, so the
// browser never reuses a page cached from the previous session. Another person signing in on the
// same tab must never see the first person's name or figures.
const markDocument = (page: Page) => page.evaluate(() => ((window as unknown as { __fcMark?: number }).__fcMark = 1))
const documentIsNew = (page: Page) => page.evaluate(() => (window as unknown as { __fcMark?: number }).__fcMark === undefined)

test("a second person signing in on the same tab never sees the first person's name or figures", async ({ page, browser }) => {
  // B exists first (in another browser).
  const emailB = uniqueEmail("tab-b")
  const other = await browser.newContext()
  await signUpConfirmed(await other.newPage(), "Mira Bose", emailB, { hideWelcome: true })
  await other.close()

  // A: a bank account with an A-only balance, seen on Income and Overview.
  await signUpConfirmed(page, "Zubin Qadri", uniqueEmail("tab-a"), { hideWelcome: true })
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "7319", opening: "12,345" })
  await expect(page.getByText("12,345").first()).toBeVisible()
  await page.goto("/")
  await expect(overviewHeading(page)).toContainText("Zubin")
  await expect(page.getByText("12,345").first()).toBeVisible()

  const seen: string[] = []
  const record = async () => seen.push(await page.locator("body").innerText())

  // Sign-out: a full page load (a new document), and nothing of A on the sign-in page.
  await markDocument(page)
  await signOut(page)
  expect(await documentIsNew(page)).toBe(true)
  await record()

  // B signs in on the same tab: a full page load to B's Overview.
  await markDocument(page)
  await signIn(page, emailB)
  await expect(overviewHeading(page)).toContainText("Mira")
  expect(await documentIsNew(page)).toBe(true)
  await record()

  // B moves around with the app's own links (client navigation) and by address.
  await page.locator("aside").getByRole("link", { name: "Income", exact: true }).click()
  await expect(page).toHaveURL(/\/income$/)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await record()
  for (const path of ["/", "/transactions", "/settings"]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await record()
  }

  for (const text of seen) {
    expect(text).not.toContain("Zubin")
    expect(text).not.toContain("Qadri")
    expect(text).not.toContain("12,345")
    expect(text).not.toContain("7319")
  }
})

test("the sign-out route refuses posts from another site", async ({ page, request }) => {
  await signUpConfirmed(page, "Cross Site", uniqueEmail("signout-csrf"), { hideWelcome: true })
  const res = await request.post("/auth/sign-out", { headers: { origin: "https://evil.example" }, maxRedirects: 0 })
  expect(res.status()).toBe(403)
})
