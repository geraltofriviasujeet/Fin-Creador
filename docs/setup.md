# Setup guide

How to configure, run and test FinCreador. Every value below is a placeholder: use your
own project's values, and never commit them.

- [1. Prerequisites](#1-prerequisites)
- [2. Install](#2-install)
- [3. Environment files](#3-environment-files)
- [4. Supabase project settings](#4-supabase-project-settings)
- [5. Database migrations](#5-database-migrations)
- [6. Run the web app](#6-run-the-web-app)
- [7. Run the mobile app](#7-run-the-mobile-app)
- [Tests and CI](#tests-and-ci)
- [Manual checks](#manual-checks)
- [Troubleshooting](#troubleshooting)

## 1. Prerequisites

- Node.js 22.12 or later (CI uses Node 24) and npm.
- A Supabase project for development. Its URL looks like
  `https://<project-ref>.supabase.co`.
- The Supabase CLI, only for linking the project, generating types and pushing migrations.
- For the mobile app: an Android or iOS phone with **Expo Go** for the SDK the app uses
  (see `apps/mobile/package.json`, `expo` version), on the same Wi-Fi as your computer.

Docker and a local Supabase are **not** needed on your computer. Database, RLS and
end-to-end tests run in GitHub Actions against a throwaway database.

## 2. Install

```sh
npm install
```

## 3. Environment files

Both apps read only **public** values. A secret key or service-role key must never be
placed in either file; both apps refuse to start if one is configured.

**Web:** copy `apps/web/.env.example` to `apps/web/.env.local`:

```sh
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<your-key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**Mobile:** copy `apps/mobile/.env.example` to `apps/mobile/.env.local`:

```sh
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<your-key>
EXPO_PUBLIC_WEB_URL=http://<your-computer-lan-ip>:3000
```

The publishable key is under Supabase Dashboard → Project Settings → API Keys.
`.env.local` files are git-ignored; only the `.env.example` templates are committed, and
the secret check fails CI if a real env file is ever tracked.

## 4. Supabase project settings

Set these in the Supabase dashboard of your development project. They are not stored in
the repository (`supabase/config.toml` configures only the throwaway CI database).

### Authentication → URL Configuration

- **Site URL:** `http://localhost:3000`
- **Redirect URLs:**
  - `http://localhost:3000/auth/callback` (web)
  - `exp://**` (mobile, Expo Go during development)
  - `fincreador://**` (mobile, app builds)

### Authentication → Sign In / Providers

- **Email:** enabled, "Confirm email" on, minimum password length **8**.
- **Google:** enabled with your Google Cloud OAuth client ID and secret. The secret is
  entered in the dashboard only and never goes in the repository. In Google Cloud Console,
  the OAuth client's authorized redirect URI is
  `https://<project-ref>.supabase.co/auth/v1/callback`.

### Authentication → Email Templates

Use the same templates as `supabase/templates/`. Their token-hash links work even when
the email is opened on a different device or browser.

**Confirm signup.** Subject: `Confirm your FinCreador account`. Body: the contents of
[`supabase/templates/confirmation.html`](../supabase/templates/confirmation.html).

**Reset password.** Subject: `Reset your FinCreador password`. Body: the contents of
[`supabase/templates/recovery.html`](../supabase/templates/recovery.html).

Supabase's built-in email sender allows only a few emails per hour; add custom SMTP before
inviting other testers.

## 5. Database migrations

Migrations live in `supabase/migrations/` and are tested in CI on every pull request
(migrations and pgTAP tests on a fresh database).

```sh
supabase link --project-ref <project-ref>   # once
supabase db push --dry-run                  # review what would be applied
supabase db push                            # apply, only after CI is green
npm run db:types                            # regenerate packages/api/src/database.types.ts
```

Rules: never edit an applied migration (add a new one), never reset the hosted database,
and run `supabase db push` only after the pull request's CI is green.

If `db push` prints "Applying migration …" and then a Docker socket error
(`failed to connect to the docker API`), do not run it again. Check
`supabase migration list --linked`: if the migration is listed as remote, it was applied.
A migration and its history row are written in one transaction. The error comes from a
step that runs after the migration and needs Docker, which this setup does not run locally.

## 6. Run the web app

```sh
npm run dev          # http://localhost:3000
```

Production build: `npm run build`, then `npm run start -w @fin-creador/web`.

## 7. Run the mobile app

```sh
npm run dev:mobile   # scan the QR code with Expo Go
```

- Use Expo Go's own scanner (Android) or the Camera app (iOS).
- The store version of Expo Go must support the app's Expo SDK. Right after a new SDK
  release the stores can lag behind; Expo publishes matching Android builds of Expo Go on
  GitHub (`expo/expo-go-releases`).

**Google sign-in in Expo Go** needs a different start command:

```sh
npm run dev:mobile:google
```

Supabase never redirects to a bare IP address (it falls back to the Site URL), and Expo Go
normally runs from your computer's LAN IP. This command serves Expo under a hostname that
resolves to that IP (`<ip-with-dashes>.sslip.io`), so Google can return to Expo Go. App
builds use `fincreador://auth/callback` and don't need it. This is a development-only
workaround; see "Before production" in `docs/sprint-plan.md`.

## Tests and CI

| What | Where | Command |
|---|---|---|
| Lint, typecheck | local and CI | `npm run lint`, `npm run typecheck` |
| Unit tests (Vitest) | local and CI | `npm test` |
| Web build, mobile bundles | local and CI | `npm run build`, `npm run bundle:mobile` |
| Secret check | local and CI | `npm run check:secrets` |
| Migrations and pgTAP (RLS) | CI only | `supabase test db` |
| End-to-end (Playwright, web) | CI only | `npm run test:e2e` |

GitHub Actions (`.github/workflows/ci.yml`) runs on every pull request and uses no
repository secrets:

- **Lint, typecheck, unit tests, build:** also bundles the mobile app and runs the secret
  check on the tracked files, the web client bundle and the mobile bundles. A fake
  server-only "canary" value is set during the web build, and the check fails if it
  appears in client code.
- **Migrations and pgTAP tests:** applies every migration to a fresh Postgres and runs
  `supabase/tests`.
- **E2E (web):** starts a throwaway Supabase on the runner (Auth, API and the Mailpit test
  inbox), builds the web app against it and runs the Playwright tests in
  `apps/web/e2e`: sign-up with email confirmation, unconfirmed sign-in and resend, sign-in
  errors, protected routes and safe redirects, profile save, password reset and sign-out.
  On failure the Playwright report is uploaded as a build artifact.

The end-to-end tests refuse to run unless the app points at a local Supabase, so they can
never create users in a hosted project.

### Secret check

`npm run check:secrets` scans tracked files. To scan build output too:

```sh
npm run build
npm run bundle:mobile:js
node scripts/check-secrets.mjs apps/web/.next/static apps/mobile/dist-js
```

It reports Supabase secret keys, JWTs whose role is not `anon`, Google OAuth client
secrets, private keys, AWS keys and tracked `.env` files, without printing the values.

## Manual checks

Google sign-in can't be automated. After auth changes, check by hand:

- **Web:** "Continue with Google" on `/sign-in`, choose an account, land on Overview with
  your name; sign out.
- **Mobile (Expo Go, started with `npm run dev:mobile:google`):** "Continue with Google",
  choose an account, the browser closes and Overview opens; sign out from Settings.
- **Mobile email links:** sign up in the app, open the confirmation email (it opens the
  web app), then sign in on the phone.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Project is incompatible with this version of Expo Go" | The installed Expo Go doesn't support the app's SDK yet. Install the matching Expo Go (Android builds on GitHub) or wait for the store update. |
| Google sign-in on the phone ends on `localhost:3000` | The return address was rejected. Start Expo with `npm run dev:mobile:google`, and check `exp://**` is in the Supabase Redirect URLs. |
| Google sign-in on the phone stays on the Google page | The return address uses a scheme Expo Go can't open. Make sure the app is running in Expo Go from `npm run dev:mobile:google`. |
| "App configuration needed" on the phone | `apps/mobile/.env.local` is missing or has a non-public key. Fix it and restart Expo. |
| Email links on the phone open `localhost` and fail | `localhost` on the phone is the phone itself. Open the link on your computer, or set the web URL to your computer's LAN address. |
| Too many emails / rate limited | Supabase's built-in email sender is limited to a few emails per hour. Wait, or configure custom SMTP. |
