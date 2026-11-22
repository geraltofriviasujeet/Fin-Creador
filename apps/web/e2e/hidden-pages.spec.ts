import { type Page, expect, test } from "@playwright/test"
import { addBank, addCash, addEntry, signUpConfirmed, uniqueEmail } from "./helpers"

// Sprint 12a-4 hidden-page audit. With cacheComponents, Next keeps a visited page mounted but
// hidden (React Activity): it still re-renders with the current URL and new data, and its
// Effects run again when it is shown. Each test: visit A, go to B, change something, come back
// (or stay on B): A does nothing by itself.

const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name, exact: true })

/** Records every frame of the visible Total available (Income or Overview) until `stopSampling`. */
async function startSampling(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __totals: number[]; __raf: number }
    w.__totals = []
    const loop = () => {
      for (const el of document.querySelectorAll('[data-testid="amount-total-available"]')) {
        if (el.getClientRects().length === 0) continue // on a hidden page
        w.__totals.push(Math.round(Number((el.textContent ?? "").replace(/[^\d.]/g, "")) * 100))
      }
      w.__raf = requestAnimationFrame(loop)
    }
    loop()
  })
}

async function stopSampling(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __totals: number[]; __raf: number }
    cancelAnimationFrame(w.__raf)
    return w.__totals
  })
}

const total = (page: Page) => page.getByTestId("amount-total-available").filter({ visible: true })

async function incomeAfterACount(page: Page, label: string) {
  await signUpConfirmed(page, "Test Person", uniqueEmail(label))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "52,300" })
  await expect(total(page)).toHaveText("₹52,300.00")
  // A save on the Income page itself: Total available counts 52,300 → 53,800 here.
  await addCash(page, "1,500")
  await expect(total(page)).toHaveText("₹53,800.00")
  await page.waitForTimeout(2000) // the count is over
}

test("Total available: coming back with the same value doesn't count again", async ({ page }) => {
  await incomeAfterACount(page, "hidden-count-same")
  await startSampling(page)
  await nav(page, "Overview").click()
  await expect(page).toHaveURL(/\/$/)
  await expect(total(page)).toHaveText("₹53,800")
  await nav(page, "Income").click()
  await expect(page).toHaveURL(/\/income$/)
  await expect(total(page)).toHaveText("₹53,800.00")
  await page.waitForTimeout(2000)
  const frames = await stopSampling(page)
  expect(frames.length).toBeGreaterThan(0)
  // Before 12a-4 the Income page counted 52,300 → 53,800 again on the way back.
  expect([...new Set(frames)]).toEqual([53_800_00])
})

for (const reduced of [false, true]) {
  test(`Total available: changed while hidden, it counts from the last shown value${reduced ? " (reduced motion: jumps)" : ""}`, async ({ page }) => {
    if (reduced) await page.emulateMedia({ reducedMotion: "reduce" })
    await incomeAfterACount(page, reduced ? "hidden-count-reduced" : "hidden-count-changed")
    // An expense saved on Transactions while Income is hidden.
    await addEntry(page, { amount: "300", category: "Groceries", from: "HDFC Bank ··4821" })
    await expect(page).toHaveURL(/\/transactions/)
    await startSampling(page)
    await nav(page, "Income").click()
    await expect(page).toHaveURL(/\/income$/)
    await expect(total(page)).toHaveText("₹53,500.00")
    await page.waitForTimeout(500)
    const frames = await stopSampling(page)
    // Never below the new value or above the last shown one (no replay from 52,300).
    expect(frames.every((v) => v >= 53_500_00 && v <= 53_800_00), `frames: ${[...new Set(frames)].join(", ")}`).toBe(true)
    const between = frames.filter((v) => v > 53_500_00 && v < 53_800_00)
    if (reduced) expect(between, "reduced motion: no frames between").toEqual([])
    else expect(between.length, "counted through values between").toBeGreaterThan(0)
  })
}

test("Roma: while hidden, an address change on Transactions leaves the chat, its draft and live answer alone", async ({ page }) => {
  await signUpConfirmed(page, "Test Person", uniqueEmail("hidden-roma"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addEntry(page, { amount: "250", category: "Groceries", from: "HDFC Bank ··4821" })
  await page.goto("/settings")
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByRole("status").getByText("Roma is on.")).toBeVisible()

  await page.goto("/roma")
  const box = page.getByLabel("Your question")
  const answers = page.getByRole("list", { name: "Roma's answers" })
  await box.fill("What did I spend this month?")
  await box.press("Enter")
  await expect(answers.getByText(/^You spent ₹250 from /)).toBeVisible()
  await expect(page).toHaveURL(/\/roma\?c=[0-9a-f-]{36}$/)
  await box.fill("A draft I haven't sent")
  // The hidden page keeps its DOM (display: none). Hold on to this textarea: if the hidden chat
  // started afresh, it would be replaced.
  await box.evaluate((el) => ((window as unknown as { __roma: Element }).__roma = el))

  // Away to Transactions (client navigation), then a search there with the page's own box: the
  // address changes in the app, with no ?c=.
  await nav(page, "Transactions").click()
  await expect(page).toHaveURL(/\/transactions$/)
  await page.getByRole("main").getByRole("searchbox", { name: "Search transactions" }).fill("groceries")
  await page.getByRole("main").getByRole("button", { name: "Search", exact: true }).click()
  await expect(page).toHaveURL(/\/transactions\?q=groceries$/)
  await expect(page.getByTestId("search-summary")).toBeVisible()
  await page.waitForTimeout(1000) // time for the hidden page to re-render with this address

  // The hidden Roma chat is the same one, with its draft and live answer.
  const hidden = await page.evaluate(() => {
    const el = (window as unknown as { __roma: HTMLTextAreaElement }).__roma
    const list = document.querySelector('[aria-label="Roma\'s answers"]')
    return { connected: el.isConnected, value: el.value, answered: list?.textContent?.includes("Answered on") ?? null, items: list?.querySelectorAll(":scope > li").length ?? 0 }
  })
  expect(hidden).toEqual({ connected: true, value: "A draft I haven't sent", answered: false, items: 1 })
})

// 12a-4b: the top-bar search is a client navigation (it was a full-page form submit, which
// reloaded the app and reset every hidden page).
test("top-bar search doesn't reload the app: a Roma draft is still there after searching and coming back", async ({ page }) => {
  await signUpConfirmed(page, "Test Person", uniqueEmail("hidden-topbar-search"))
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "10,000" })
  await addEntry(page, { amount: "250", category: "Groceries", from: "HDFC Bank ··4821", note: "Weekly groceries" })
  await page.goto("/settings")
  await page.getByRole("button", { name: "Turn Roma on" }).click()
  await expect(page.getByRole("status").getByText("Roma is on.")).toBeVisible()

  await page.goto("/roma")
  const box = page.getByLabel("Your question")
  const answers = page.getByRole("list", { name: "Roma's answers" })
  await box.fill("What did I spend this month?")
  await box.press("Enter")
  await expect(answers.getByText(/^You spent ₹250 from /)).toBeVisible()
  await expect(page).toHaveURL(/\/roma\?c=[0-9a-f-]{36}$/)
  const conversation = page.url()
  await box.fill("A draft I haven't sent")
  // A full page load would drop this marker.
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true))

  const topSearch = page.getByRole("banner").getByRole("searchbox", { name: "Search transactions" })
  await topSearch.fill("groceries")
  await topSearch.press("Enter")
  await expect(page).toHaveURL(/\/transactions\?q=groceries$/)
  await expect(page.getByTestId("search-summary")).toHaveText(/^1 result for “groceries”/)
  await expect(page.locator("main li").filter({ hasText: "Weekly groceries" })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)

  // Back to the conversation: the same chat, with its draft and the live answer.
  await page.goBack()
  await expect(page).toHaveURL(conversation)
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
  await expect(box).toHaveValue("A draft I haven't sent")
  await expect(answers.getByRole("listitem")).toHaveCount(1)
  await expect(answers.getByText(/^Answered on /)).toHaveCount(0)
})
