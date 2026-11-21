import { type Locator, type Page, expect, test } from "@playwright/test"
import { overviewHeading, signIn, signOut, signUpConfirmed, tourDialog, uniqueEmail, welcomeDialog } from "./helpers"

// The welcome carousel and the tour (before Sprint 12a; the Get started card was removed 2026-11-21). The welcome shows
// after each sign-in (a short-lived cookie set on sign-in, cleared when it closes), not on reloads
// or navigation, unless the person ticked "Don't show this again" or turned off Settings → "Show
// the welcome when I sign in" (profiles.welcome_hidden_at, saved by the database, so it follows
// them across devices).

// Desktop: + Add, then every sidebar item in nav order. Phones: + Add, the four tabs and More.
const DESKTOP_STEPS = ["Add", "Overview", "Income", "Recurring", "Transactions", "Goals", "Investments", "Loans & Liabilities", "Reports", "Ask Roma"]
const PHONE_STEPS = ["Add", "Overview", "Activity", "Goals", "Investments", "More"]

const stepName = (n: number, steps: string[]) => `Tour, step ${n} of ${steps.length}: ${steps[n - 1]}`

// The welcome carousel's slide titles, in order.
const SLIDES = ["Welcome to FinCreador", "Add your accounts", "Track every rupee", "See your investments", "Stay on top of loans", "Plan your goals", "Ask Roma"]

const slideTitle = (welcome: Locator) => welcome.getByRole("heading", { level: 2 })
/**
 * The slide is one centred column (title text, body under the picture), and Skip is a quiet
 * corner button (~14px, muted, 44px tap area) that never touches the title.
 */
async function expectCentredWithQuietSkip(welcome: Locator) {
  // Measure the slide at rest, not mid slide-in.
  await welcome.getByTestId("welcome-slide").evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
  const card = (await welcome.boundingBox())!
  const centre = card.x + card.width / 2
  // What the title actually draws (logo and every line of text) is centred in the card.
  const drawn = await slideTitle(welcome).evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const r = range.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  })
  expect(Math.abs(drawn.x + drawn.width / 2 - centre)).toBeLessThanOrEqual(2)
  const title = drawn
  expect(await slideTitle(welcome).evaluate((el) => getComputedStyle(el).textAlign)).toBe("center")
  expect(await welcome.getByTestId("welcome-slide").locator("p").evaluate((el) => getComputedStyle(el).textAlign)).toBe("center")

  const skip = welcome.getByRole("button", { name: "Skip", exact: true })
  const s = (await skip.boundingBox())!
  expect(s.width).toBeGreaterThanOrEqual(44)
  expect(s.height).toBeGreaterThanOrEqual(44)
  expect(s.x + s.width).toBeGreaterThan(card.x + card.width - 24)
  const style = await skip.evaluate((el) => ({ size: getComputedStyle(el).fontSize, color: getComputedStyle(el).color }))
  expect(style.size).toBe("14px")
  expect(style.color).toBe("rgb(95, 110, 102)") // --fc-color-muted
  // Skip never overlaps the title text.
  const apart = s.x >= title.x + title.width || s.y >= title.y + title.height || s.y + s.height <= title.y
  expect(apart).toBe(true)
}

const dontShow = (welcome: Locator) => welcome.getByRole("checkbox", { name: "Don't show this again" })
const welcomeSwitch = (page: Page) => page.getByRole("switch", { name: "Show the welcome when I sign in" })

async function expectSlide(welcome: Locator, n: number) {
  await expect(slideTitle(welcome)).toHaveText(SLIDES[n - 1]!)
  await expect(welcome.getByTestId("welcome-slide")).toBeVisible()
}

/** Next until the last slide. */
async function toLastSlide(welcome: Locator) {
  for (let n = 2; n <= SLIDES.length; n++) {
    await welcome.getByRole("button", { name: "Next" }).click()
    await expectSlide(welcome, n)
  }
}

async function expectNoTourAfterReload(page: Page, heading: Locator) {
  await page.reload()
  await expect(heading).toBeVisible()
  await page.waitForTimeout(500)
  await expect(welcomeDialog(page)).toHaveCount(0)
  await expect(tourDialog(page)).toHaveCount(0)
}

test("welcome → Skip on slide 1: it closes, focus was trapped, and it doesn't come back after a reload", async ({ page }) => {
  await signUpConfirmed(page, "Asha Rao", uniqueEmail("welcome-skip"), { tour: true })

  const welcome = welcomeDialog(page)
  await expect(welcome).toBeVisible()
  await expectSlide(welcome, 1)
  await expect(welcome.getByText("Your money, all in one place.", { exact: false })).toBeVisible()
  const next = welcome.getByRole("button", { name: "Next" })
  const skip = welcome.getByRole("button", { name: "Skip", exact: true })
  await expect(welcome.getByRole("button", { name: "Back" })).toBeDisabled()
  await expect(dontShow(welcome)).not.toBeChecked()
  await expect(next).toBeFocused()
  // Keyboard: Tab stays inside the welcome (Back is off on slide 1).
  await page.keyboard.press("Tab")
  await expect(skip).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(dontShow(welcome)).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(next).toBeFocused()

  await skip.click()
  await expect(welcome).toBeHidden()
  await expect(tourDialog(page)).toHaveCount(0)
  await expectNoTourAfterReload(page, overviewHeading(page))
})

test("Escape closes the welcome without opting out: signing in on another device shows it again", async ({ page, browser }) => {
  const email = uniqueEmail("welcome-escape")
  await signUpConfirmed(page, "Kabir Shah", email, { tour: true })
  await expect(welcomeDialog(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(welcomeDialog(page)).toBeHidden()
  await expect(overviewHeading(page)).toBeVisible()

  const other = await browser.newContext()
  const phone = await other.newPage()
  await phone.goto("/sign-in")
  await signIn(phone, email)
  await expectSlide(welcomeDialog(phone), 1)
  await other.close()
})

test("the welcome shows after each sign-in, not on reload; Don't show this again; the Settings switch brings it back", async ({ page }) => {
  const email = uniqueEmail("welcome-every")
  await signUpConfirmed(page, "Tara Nair", email, { tour: true })
  const welcome = welcomeDialog(page)
  await expectSlide(welcome, 1)
  await welcome.getByRole("button", { name: "Skip", exact: true }).click()
  await expect(welcome).toBeHidden()
  // Reloads and navigation: not again.
  await expectNoTourAfterReload(page, overviewHeading(page))
  await page.goto("/settings")
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible()
  await expect(welcomeSwitch(page)).toHaveAttribute("aria-checked", "true")
  await expect(welcomeDialog(page)).toHaveCount(0)

  // Sign out and in: it shows again. Tick the box (it stays ticked across slides) and finish.
  await signOut(page)
  await signIn(page, email)
  await expectSlide(welcome, 1)
  await dontShow(welcome).check()
  await toLastSlide(welcome)
  await expect(dontShow(welcome)).toBeChecked()
  await welcome.getByRole("button", { name: "Start using FinCreador" }).click()
  await expect(welcome).toBeHidden()

  // The next sign-in: no welcome.
  await signOut(page)
  await signIn(page, email)
  await expect(overviewHeading(page)).toBeVisible()
  await page.waitForTimeout(500)
  await expect(welcomeDialog(page)).toHaveCount(0)

  // Settings: the switch is off; turning it on is saved, and doesn't open the welcome now.
  await page.goto("/settings")
  await expect(welcomeSwitch(page)).toHaveAttribute("aria-checked", "false")
  await welcomeSwitch(page).click()
  await expect(welcomeSwitch(page)).toHaveAttribute("aria-checked", "true")
  await page.reload()
  await expect(welcomeSwitch(page)).toHaveAttribute("aria-checked", "true")
  await expect(welcomeDialog(page)).toHaveCount(0)

  // The next sign-in shows it again. Ticked + Show me around also saves the choice.
  await signOut(page)
  await signIn(page, email)
  await expectSlide(welcome, 1)
  await dontShow(welcome).check()
  await toLastSlide(welcome)
  await welcome.getByRole("button", { name: "Show me around" }).click()
  const tour = tourDialog(page)
  await expect(tour).toHaveAccessibleName(stepName(1, DESKTOP_STEPS))
  await tour.getByRole("button", { name: "Skip tour" }).click()
  await expect(tour).toBeHidden()
  await page.goto("/settings")
  await expect(welcomeSwitch(page)).toHaveAttribute("aria-checked", "false")
})

test("welcome → Next through all 7 slides, arrows and Back, pictures with alt text, Start using FinCreador", async ({ page }) => {
  await signUpConfirmed(page, "Meera Iyer", uniqueEmail("welcome-all"), { tour: true })
  const welcome = welcomeDialog(page)
  await expectSlide(welcome, 1)

  // Arrow keys move; Back goes back.
  await page.keyboard.press("ArrowRight")
  await expectSlide(welcome, 2)
  await page.keyboard.press("ArrowLeft")
  await expectSlide(welcome, 1)
  await welcome.getByRole("button", { name: "Next" }).click()
  await welcome.getByRole("button", { name: "Back" }).click()
  await expectSlide(welcome, 1)

  for (let n = 1; n <= SLIDES.length; n++) {
    if (n > 1) {
      await welcome.getByRole("button", { name: "Next" }).click()
      await expectSlide(welcome, n)
    }
    // The slide's picture has alt text; only it and the next slide's picture are in the page.
    const picture = welcome.getByTestId("welcome-slide").getByRole("img")
    await expect(picture).toHaveAttribute("alt", /\w{4,}/)
    await expect(picture).toHaveJSProperty("complete", true)
    expect(await picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    await expect(welcome.locator("img")).toHaveCount(n < SLIDES.length ? 2 : 1)
  }
  await expect(welcome.getByText("She answers from your own records and checked sources.", { exact: false })).toBeVisible()
  await expect(welcome.getByRole("button", { name: "Next" })).toHaveCount(0)
  const start = welcome.getByRole("button", { name: "Start using FinCreador" })
  await expect(start).toBeFocused()
  // ArrowRight on the last slide stays there.
  await page.keyboard.press("ArrowRight")
  await expectSlide(welcome, SLIDES.length)

  await start.click()
  await expect(welcome).toBeHidden()
  await expect(tourDialog(page)).toHaveCount(0)
  await expectNoTourAfterReload(page, overviewHeading(page))
})

test("Show me around: every nav item in order, Back and Next, Done; no page change", async ({ page }) => {
  await signUpConfirmed(page, "Meera Iyer", uniqueEmail("tour-full"), { tour: true })
  const welcome = welcomeDialog(page)
  await toLastSlide(welcome)
  await welcome.getByRole("button", { name: "Show me around" }).click()
  await expect(welcome).toBeHidden()

  const tour = tourDialog(page)
  await expect(tour).toHaveAccessibleName(stepName(1, DESKTOP_STEPS))
  await expect(tour).toBeFocused()
  await expect(tour.getByRole("button", { name: "Back" })).toBeDisabled()
  // Keyboard: Tab moves through the card's buttons and wraps (Back is off on step 1).
  await page.keyboard.press("Tab")
  await expect(tour.getByRole("button", { name: "Next" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(tour.getByRole("button", { name: "Skip tour" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(tour.getByRole("button", { name: "Next" })).toBeFocused()

  await tour.getByRole("button", { name: "Next" }).click()
  await expect(tour).toHaveAccessibleName(stepName(2, DESKTOP_STEPS))
  await tour.getByRole("button", { name: "Back" }).click()
  await expect(tour).toHaveAccessibleName(stepName(1, DESKTOP_STEPS))

  for (let n = 2; n <= DESKTOP_STEPS.length; n++) {
    await tour.getByRole("button", { name: "Next" }).click()
    await expect(tour).toHaveAccessibleName(stepName(n, DESKTOP_STEPS))
  }
  await expect(tour.getByText("Ask Roma about your money in plain words", { exact: false })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  await tour.getByRole("button", { name: "Done" }).click()
  await expect(tour).toBeHidden()
  await expectNoTourAfterReload(page, overviewHeading(page))
})

test("Replay the tour in Settings opens the welcome on slide 1, again after skipping it, even when it's off at sign-in", async ({ page }) => {
  await signUpConfirmed(page, "Ravi Menon", uniqueEmail("tour-replay"))
  await page.goto("/settings")
  await expect(page.getByText("A quick look at what FinCreador does and where things are.")).toBeVisible()
  await expect(welcomeDialog(page)).toHaveCount(0)
  await welcomeSwitch(page).click()
  await expect(welcomeSwitch(page)).toHaveAttribute("aria-checked", "false")
  await page.getByRole("button", { name: "Replay the tour" }).click()

  const welcome = welcomeDialog(page)
  await expect(welcome).toBeVisible()
  await expectSlide(welcome, 1)
  await welcome.getByRole("button", { name: "Next" }).click()
  await expectSlide(welcome, 2)
  await welcome.getByRole("button", { name: "Skip", exact: true }).click()
  await expect(welcome).toBeHidden()

  // Replay again in the same visit: slide 1 again, not where it was left.
  await page.getByRole("button", { name: "Replay the tour" }).click()
  await expect(welcome).toBeVisible()
  await expectSlide(welcome, 1)
  await toLastSlide(welcome)
  await welcome.getByRole("button", { name: "Show me around" }).click()
  const tour = tourDialog(page)
  await expect(tour).toHaveAccessibleName(stepName(1, DESKTOP_STEPS))
  await tour.getByRole("button", { name: "Skip tour" }).click()
  await expect(tour).toBeHidden()
  await expectNoTourAfterReload(page, page.getByRole("heading", { level: 1, name: "Settings" }))
})

test.describe("at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("the welcome is a centred card ~720px wide; each tour step sits beside its nav item with an arrow", async ({ page }) => {
    await signUpConfirmed(page, "Nisha Pillai", uniqueEmail("tour-desktop"), { tour: true })
    const welcome = welcomeDialog(page)
    await expect(welcome).toBeVisible()
    const w = (await welcome.boundingBox())!
    expect(w.width).toBeCloseTo(720, -1)
    expect(w.x + w.width / 2).toBeCloseTo(640, -1)
    expect(w.y + w.height / 2).toBeCloseTo(400, -1)
    expect(w.y).toBeGreaterThanOrEqual(0)
    expect(w.y + w.height).toBeLessThanOrEqual(800)
    // The title above the picture, big and bold, with the logo mark on slide 1.
    const title = slideTitle(welcome)
    expect(await title.evaluate((el) => getComputedStyle(el).fontSize)).toBe("32px")
    expect(Number(await title.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(700)
    await expect(title.locator("svg")).toHaveCount(1)
    const picBox = (await welcome.getByTestId("welcome-slide").getByRole("img").boundingBox())!
    expect((await title.boundingBox())!.y + (await title.boundingBox())!.height).toBeLessThanOrEqual(picBox.y)
    await expectCentredWithQuietSkip(welcome)
    // "Don't show this again" at the bottom left.
    const box = (await dontShow(welcome).boundingBox())!
    expect(box.x).toBeLessThan(w.x + 60)
    expect(box.y).toBeGreaterThan(picBox.y + picBox.height)
    // The desktop picture (16:10), not the phone one.
    const picture = welcome.getByTestId("welcome-slide").getByRole("img")
    await expect(picture).toHaveJSProperty("complete", true)
    expect(await picture.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain("-desktop.webp")
    for (let n = 1; n <= SLIDES.length; n++) {
      if (n > 1) await welcome.getByRole("button", { name: "Next" }).click()
      await expectSlide(welcome, n)
      await expect(welcome.getByTestId("welcome-slide").getByRole("img")).toHaveJSProperty("complete", true)
      if ([1, 3, 7].includes(n)) await page.screenshot({ path: `e2e-screenshots/1280-welcome-slide-${n}.png`, animations: "disabled" })
    }
    await welcome.getByRole("button", { name: "Show me around" }).click()

    const tour = tourDialog(page)
    const arrow = page.getByTestId("tour-arrow")

    // Step 1, + Add in the top bar: the card is below it, the arrow pointing up at it.
    await expect(tour).toHaveAccessibleName(stepName(1, DESKTOP_STEPS))
    const add = (await page.locator('[data-tour="add"]').boundingBox())!
    let card = (await tour.boundingBox())!
    expect(card.y).toBeGreaterThanOrEqual(add.y + add.height)
    let tip = (await arrow.boundingBox())!
    expect(tip.x + tip.width / 2).toBeGreaterThanOrEqual(add.x)
    expect(tip.x + tip.width / 2).toBeLessThanOrEqual(add.x + add.width)

    // Every sidebar step: the card to the right of the item, the arrow at the item's middle.
    for (let n = 2; n <= DESKTOP_STEPS.length; n++) {
      await tour.getByRole("button", { name: "Next" }).click()
      await expect(tour).toHaveAccessibleName(stepName(n, DESKTOP_STEPS))
      const item = page.locator("aside").getByRole("link", { name: DESKTOP_STEPS[n - 1], exact: true })
      await expect(async () => {
        const link = (await item.boundingBox())!
        card = (await tour.boundingBox())!
        tip = (await arrow.boundingBox())!
        expect(card.x).toBeGreaterThanOrEqual(link.x + link.width)
        expect(card.y + card.height).toBeLessThanOrEqual(800)
        expect(Math.abs(tip.y + tip.height / 2 - (link.y + link.height / 2))).toBeLessThanOrEqual(2)
      }).toPass()
      if (n === 2) await page.screenshot({ path: "e2e-screenshots/1280-tour-step-2.png", animations: "disabled" })
    }
    await tour.getByRole("button", { name: "Done" }).click()
    await expect(tour).toBeHidden()
  })
})

test.describe("at 360px", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true })

  test("the welcome is a full-screen sheet with swipe; the steps are a card above the tab bar; the ring stays on screen", async ({ page }) => {
    await signUpConfirmed(page, "Ravi Kumar", uniqueEmail("tour-phone"), { tour: true })
    const welcome = welcomeDialog(page)
    await expect(welcome).toBeVisible()
    const w = (await welcome.boundingBox())!
    expect(w.x).toBeCloseTo(0, 0)
    expect(w.y).toBeCloseTo(0, 0)
    expect(w.width).toBeCloseTo(360, 0)
    expect(w.height).toBeCloseTo(740, 0)
    expect(await slideTitle(welcome).evaluate((el) => getComputedStyle(el).fontSize)).toBe("26px")
    // Centred, wrapping cleanly (two lines at most), clear of Skip.
    await expectCentredWithQuietSkip(welcome)
    const lines = await welcome.getByTestId("welcome-title-text").evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
    expect(lines).toBeLessThanOrEqual(2)
    // The phone picture (square), and the buttons fit on screen.
    const picture = welcome.getByTestId("welcome-slide").getByRole("img")
    await expect(picture).toHaveJSProperty("complete", true)
    expect(await picture.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain("-phone.webp")
    const nextBox = (await welcome.getByRole("button", { name: "Next" }).boundingBox())!
    expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(740)
    await page.screenshot({ path: "e2e-screenshots/360-welcome-slide-1.png", animations: "disabled" })

    // Swipe left: next slide; swipe right: back.
    const swipe = async (fromX: number, toX: number) => {
      await welcome.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: fromX, clientY: 300 }], changedTouches: [{ identifier: 1, clientX: fromX, clientY: 300 }] })
      await welcome.dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 1, clientX: toX, clientY: 305 }] })
    }
    await swipe(300, 80)
    await expectSlide(welcome, 2)
    await swipe(80, 300)
    await expectSlide(welcome, 1)
    // A short drag doesn't move.
    await swipe(200, 180)
    await expectSlide(welcome, 1)
    for (let n = 2; n <= SLIDES.length; n++) {
      await swipe(300, 80)
      await expectSlide(welcome, n)
      await expect(welcome.getByTestId("welcome-slide").getByRole("img")).toHaveJSProperty("complete", true)
      await expectCentredWithQuietSkip(welcome)
      if (n === 3 || n === 7) await page.screenshot({ path: `e2e-screenshots/360-welcome-slide-${n}.png`, animations: "disabled" })
    }
    const around = welcome.getByRole("button", { name: "Show me around" })
    const aroundBox = (await around.boundingBox())!
    expect(aroundBox.y + aroundBox.height).toBeLessThanOrEqual(740)
    const startBox = (await welcome.getByRole("button", { name: "Start using FinCreador" }).boundingBox())!
    expect(startBox.y + startBox.height).toBeLessThanOrEqual(740)
    await around.click()

    const tour = tourDialog(page)
    await expect(tour).toHaveAccessibleName(stepName(1, PHONE_STEPS))
    const box = (await tour.boundingBox())!
    // The page's own side gutter: px-4 is 1rem, and the root font size is 87.5% (14px).
    const main = (await page.locator("main").boundingBox())!
    const gutter = await page.locator("main").evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
    expect(box.x).toBeCloseTo(main.x + gutter, 0)
    expect(box.x + box.width).toBeCloseTo(main.x + main.width - gutter, 0)
    // Covers neither the bottom nav nor the Add button it points at.
    const tabBar = (await page.getByRole("navigation", { name: "Main" }).last().boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(tabBar.y)
    const add = (await page.locator('[data-tour="add"]').boundingBox())!
    expect(add.y + add.height).toBeLessThanOrEqual(box.y)
    await page.screenshot({ path: "e2e-screenshots/360-tour-step-1.png", animations: "disabled" })

    const ring = page.getByTestId("tour-highlight")
    for (let n = 2; n <= PHONE_STEPS.length; n++) {
      await tour.getByRole("button", { name: "Next" }).click()
      await expect(tour).toHaveAccessibleName(stepName(n, PHONE_STEPS))
      const card = (await tour.boundingBox())!
      expect(card.y + card.height).toBeLessThanOrEqual(tabBar.y)
      // The ring is fully inside the window, even on the edge item (More).
      const r = (await ring.boundingBox())!
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.x + r.width).toBeLessThanOrEqual(360)
      expect(r.y + r.height).toBeLessThanOrEqual(740)
    }
    await expect(tour.getByText("Income and accounts, Recurring, Loans & Liabilities, Reports and Ask Roma.", { exact: false })).toBeVisible()
    await page.screenshot({ path: "e2e-screenshots/360-tour-step-6.png", animations: "disabled" })
    await tour.getByRole("button", { name: "Done" }).click()
    await expect(tour).toBeHidden()
  })
})

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" })

  test("slides change without animation", async ({ page }) => {
    await signUpConfirmed(page, "Dev Anand", uniqueEmail("welcome-motion"), { tour: true })
    const welcome = welcomeDialog(page)
    await welcome.getByRole("button", { name: "Next" }).click()
    await expectSlide(welcome, 2)
    const animation = await welcome.getByTestId("welcome-slide").evaluate((el) => getComputedStyle(el).animationName)
    expect(animation).toBe("none")
  })
})
