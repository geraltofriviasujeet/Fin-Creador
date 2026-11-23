import { defineConfig } from "@playwright/test";

// Mobile app on Expo web at phone width: the design-system preview (12c) and, with CI's local
// Supabase, the signed-in app (13a; see app-shell.spec.ts). Runs against a development
// web export (`npm run preview:web`), never a production build: the preview is left out of
// production. Uses the installed Google Chrome, like the web E2E (no browser download).
const PORT = 8090;

export default defineConfig({
  testDir: ".",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  outputDir: "../test-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: "chrome",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/serve.mjs",
    cwd: "..",
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
