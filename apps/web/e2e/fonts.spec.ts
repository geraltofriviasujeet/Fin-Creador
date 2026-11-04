import { type Page, expect, test } from "@playwright/test"
import { signUpConfirmed, uniqueEmail } from "./helpers"

// The self-hosted fonts (Fontsource, imported in app/layout.tsx) render: body text in DM Sans,
// headings in Manrope, with the font files loaded from this site. Fails if the page falls back
// to another font (an undefined font variable makes the browser use its default serif).

async function fontsInUse(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready
    const heading = document.querySelector("h1")
    return {
      body: getComputedStyle(document.body).fontFamily,
      heading: heading ? getComputedStyle(heading).fontFamily : null,
      loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")),
    }
  })
}

async function expectBrandFonts(page: Page) {
  const fonts = await fontsInUse(page)
  expect(fonts.body).toMatch(/^"?DM Sans Variable"?,/)
  expect(fonts.heading).toMatch(/^"?Manrope Variable"?,/)
  expect(fonts.loaded).toContain("DM Sans Variable")
  expect(fonts.loaded).toContain("Manrope Variable")
}

test("body text is DM Sans and headings Manrope, loaded from this site, signed out and in", async ({ page, baseURL }) => {
  const fontRequests: string[] = []
  page.on("request", (r) => {
    if (r.resourceType() === "font") fontRequests.push(r.url())
  })

  await page.goto("/sign-in")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expectBrandFonts(page)

  await signUpConfirmed(page, "Font Check", uniqueEmail("fonts"))
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expectBrandFonts(page)

  expect(fontRequests.length).toBeGreaterThan(0)
  for (const url of fontRequests) expect(url.startsWith(`${baseURL}/_next/static/media/`), url).toBe(true)
})
