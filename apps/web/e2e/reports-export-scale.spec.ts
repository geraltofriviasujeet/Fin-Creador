import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { addBank, signUpConfirmed, uniqueEmail } from "./helpers"

// CSV export at the row cap (Sprint 8c): how long 10,000 rows take through /reports/export, on
// the throwaway local Supabase in CI only. The rows are seeded straight into that database with
// psql (e2e/fixtures/export-rows.sql); E2E_DB_URL is set only by the CI step and only to the
// runner's local database, so this never seeds a hosted project. The timings go to
// e2e-screenshots/export-timing.json and set EXPORT_ROW_CAP and maxDuration.

const DB_URL = process.env.E2E_DB_URL ?? ""
const RUNS = 3

const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
function daysBack(days: number) {
  const [y, m, d] = todayInIndia().split("-").map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10)
}

function seed(email: string, rows: number) {
  const host = new URL(DB_URL).hostname
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Seeding only runs against the local CI database.")
  execFileSync("psql", [DB_URL, "-q", "-v", `email=${email}`, "-v", `rows=${rows}`, "-f", "e2e/fixtures/export-rows.sql"], { stdio: "pipe" })
}

test.skip(!DB_URL, "Needs the CI database URL (E2E_DB_URL); runs in CI only.")
test.setTimeout(180_000)

test("10,000 rows export within the time limit; one more is refused with 'narrow the range'", async ({ page }) => {
  mkdirSync("e2e-screenshots", { recursive: true })
  const email = uniqueEmail("export-scale")
  await signUpConfirmed(page, "Scale Test", email)
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "1111", opening: "1,00,000" })
  seed(email, 10_000)

  const url = `/reports/export?from=${daysBack(400)}&to=${todayInIndia()}`
  const timings: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now()
    const res = await page.request.get(url)
    const body = await res.text()
    timings.push(Math.round(performance.now() - started))
    expect(res.status()).toBe(200)
    expect(res.headers()["x-row-count"]).toBe("10000")
    expect(body.split("\r\n").filter(Boolean)).toHaveLength(10_001) // the header and every row
    if (i === 0) {
      expect(body).toContain("'=SUM(A1:A9) test 10") // guarded
      expect(body).not.toMatch(/,=SUM/)
      writeFileSync("e2e-screenshots/export-10k-bytes.txt", String(Buffer.byteLength(body)))
    }
  }

  // The same file through the form, as a person downloads it.
  await page.goto("/reports")
  await page.getByLabel("From", { exact: true }).fill(daysBack(400))
  const started = performance.now()
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()])
  await download.path()
  const viaForm = Math.round(performance.now() - started)
  await expect(page.getByText("Downloaded 10,000 entries.")).toBeVisible()

  seed(email, 1)
  const overStarted = performance.now()
  const over = await page.request.get(url)
  const overMs = Math.round(performance.now() - overStarted)
  expect(over.status()).toBe(413)
  expect(await over.text()).toContain("Choose a shorter range")

  const sorted = [...timings].sort((a, b) => a - b)
  const result = { rows: 10_000, runsMs: timings, medianMs: sorted[Math.floor(sorted.length / 2)], viaFormMs: viaForm, overCapMs: overMs }
  writeFileSync("e2e-screenshots/export-timing.json", JSON.stringify(result, null, 2))
  console.warn(`Export timing: ${JSON.stringify(result)}`)
  test.info().annotations.push({ type: "export-timing", description: JSON.stringify(result) })
})
