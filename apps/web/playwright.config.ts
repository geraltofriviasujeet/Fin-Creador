import { defineConfig, devices } from "@playwright/test"

// End-to-end tests for the web auth and profile flows. They run in CI against a throwaway
// local Supabase (with the Mailpit test inbox), never against the hosted project:
// e2e/global-setup.ts refuses to start unless the app points at a local Supabase.
// Playwright uses the installed Google Chrome, locally and on the CI runner (no download).

// Must match site_url in supabase/config.toml (email links use it). "localhost", not
// 127.0.0.1: under `next start` the app's redirects are built from a localhost request URL,
// and session cookies only work if every redirect stays on the same host.
const PORT = 3000
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, channel: "chrome" },
    },
  ],
  webServer: {
    // The production build must already exist (`next build` with the local Supabase env).
    command: `npx next start -p ${PORT}`,
    url: `${BASE_URL}/sign-in`,
    // Never attach to a server that is already running (it might use the hosted project).
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
