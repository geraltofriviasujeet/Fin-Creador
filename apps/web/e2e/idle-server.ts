// The second E2E server (playwright.config.ts), for e2e/session.spec.ts only: same build,
// but the server's IDLE_LIMIT_MS shortens the idle sign-out to 20 s, so that test runs in
// real time (no fake clock). Same host as :3000, so a session from a sign-up there works here.
export const IDLE_PORT = 3001
export const IDLE_LIMIT_MS = 20_000
