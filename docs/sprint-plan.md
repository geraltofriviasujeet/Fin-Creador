**FIN CREADOR**

Product & Sprint Plan

**Web • Android • iOS**

A delivery roadmap built around one principle: every sprint ends with a
tested, usable feature—not just setup work or static screens.

| **Planning item** | **Decision** |
|----|----|
| **Planning horizon** | 12 two-week sprints • approximately 24 weeks |
| **Initial release** | MVP after Sprint 5, then staged feature releases |
| **Platforms** | Responsive web app + Android and iOS apps |
| **Core principle** | One backend, consistent financial rules, security from Sprint 1 |

# Status and decisions log

Update this section at the end of every sprint or step (see section 9).
Last updated: 2026-10-23.

## Sprint status

| **Sprint** | **Focus** | **Status** | **Notes** |
|----|----|----|----|
| **1** | Foundation, authentication & profile | Done | Completed 2026-10-22; released to `main` via PR #7. Mobile app runs on Android and iPhone in Expo Go 58 (iPhone from 2026-10-22). See Sprint 1 steps below. |
| **2** | Accounts & Income page | Done | Completed 2026-10-22 (PRs #9–#16). Accounts, income sources, income entries with void, one cash account with "Update cash in hand", the Income page on web and mobile. Tested on web (E2E in CI) and on Android and iPhone (Expo Go 58). Scope widened from the original plan (see decisions). See Sprint 2 steps below. |
| **3** | Expense & transaction tracking | Done | Completed 2026-10-23 (PR #20 into the sprint branch; PR #19 merged into `main` 2026-10-23, merge commit ac916de). Expenses, one-row transfers, edits with history, voids with request keys, search and filters in the database with keyset paging, expense categories (web Settings), the Transactions page on web and the Activity tab and Add / Edit sheet on mobile (checked in Expo Go). Migrations 20261023120000 and 20261023180000 applied to fin-creador-dev. See Sprint 3 steps. |
| **4** | Recurring items | In progress | Recurring rules with due items you confirm (decisions 2026-10-23). Phase 1 prototype on demo data first. See Sprint 4 steps. |
| **5** | Dashboard & analytics | Not started | |
| **6** | Budgets & savings goals | Not started | |
| **7** | Investment portfolio | Not started | |
| **8** | Loans, liabilities & reports | Not started | |
| **9** | AI financial insights | Not started | |
| **10** | Notifications & reminders | Not started | |
| **11** | Mobile polish, offline & PWA | Not started | |
| **12** | Security & production release | Not started | |

## Sprint 1 steps

| **Step** | **Status** | **Notes** |
|----|----|----|
| **0. Environment hygiene** | Done | Fixed `.gitignore` (env files were not ignored); added `.env.example` files; moved CLAUDE.md to the repo root. |
| **1. Monorepo skeleton** | Done | npm workspaces: `apps/web` (Next.js), `apps/mobile` (Expo shell), `packages/schemas`, `packages/design-tokens`; shared TS/ESLint/Vitest config. Merged to `main` (PR #1). |
| **Design pass and app shell** | Done | Tokens, fonts, logo, primitives, web shell, styled auth and Settings screens, dev-only `/dev/design`. Visually reviewed and approved at desktop, tablet and phone widths. Merged to `main` (PR #1). |
| **2. Profiles migration, RLS and pgTAP tests** | Done | Migration applied to the dev project (fin-creador-dev). 42 pgTAP tests pass in CI. Merged to `sprint-1-foundation` and `main` (PR #2). |
| **3. Web auth wiring (Supabase)** | Done (not yet on `sprint-1-foundation`) | Email/password, Google OAuth, recovery, sign-out, protected routes and profile editing. Real round trip on the dev project passed 2026-10-22. PR #3 merged into `sprint-1-step-2-profiles` after that branch had already merged, so the auth code is not on `sprint-1-foundation` or `main` yet; it needs a follow-up PR from `sprint-1-step-2-profiles`. |
| **4. Mobile shell (auth, profile)** | Done (Android) | Expo Router shell with five tabs, native primitives, email/password and Google sign-in, sign-up with confirmation, password-reset email, Settings with profile editing through RLS, encrypted session storage. Tested 2026-10-22 on an Android phone in Expo Go 58.0.5. iPhone test pending SDK 58 support in the App Store Expo Go. Merged to `sprint-1-foundation` (PR #5). |
| **5. Tests (E2E, secret check)** | Done | 13 Playwright E2E tests (sign-up with email confirmation, unconfirmed sign-in and resend, sign-in errors, protected routes and safe `next`, profile save, password reset, sign-out) run in CI against a throwaway local Supabase with the Mailpit inbox; never against fin-creador-dev. Secret check (`scripts/check-secrets.mjs`) scans tracked files, the web client bundle and the mobile bundles, with a canary for server-only env. Google sign-in stays a manual check. All 13 E2E tests green in CI (PR #6); they found and fixed one app bug (sign-up revealed registered emails). |
| **6. CI and setup docs** | Done | CI runs lint, typecheck, unit tests, web build, mobile bundles, secret check, migrations and pgTAP, and the E2E job on every PR. `docs/setup.md` (placeholders only) and README written. All CI jobs green on PR #6. |

## Sprint 2 steps

| **Step** | **Status** | **Notes** |
|----|----|----|
| **0. Docs** | Done | Scope change recorded here; Income screens added to `docs/design-spec.md`; CLAUDE.md §5 clarified. |
| **1. Migration and pgTAP** | Done | `accounts`, `categories` (income sources), `transactions` (income only), balance view, `record_income` / `void_income`, default sources; 105 pgTAP tests green in CI (PR #9). Applied to fin-creador-dev 2026-10-22; types regenerated. |
| **2. Domain and schemas** | Done | `packages/domain`: dates and periods in the user's time zone, money parsing, balances, holdings totals, income by source (incl. voided-only), rental, trend; `packages/schemas`: account, income, source and void forms, bank list; `packages/api`: FC001–FC013 messages. Unit tests at month, year, leap-year and time-zone boundaries (PR #10). |
| **3. Web Income page** | Done | `/income`: six cards, Income sources, Where your money is with Total available; Add income, Add bank / other account, Add / Update cash, edit, archive and restore, Add source, void. Topbar "Add transaction" opens Add income. CI fixes: breakpoints, real links, form values kept after errors, restore confirmation (PRs #10–#12). |
| **4. E2E tests** | Done | 6 Playwright tests for the Income page (empty states, accounts and totals, cash update, double submit, void / archive / restore, future date and deep link, cross-user); 19 in total, green in CI with screenshots at three widths. |
| **5. Mobile** | Done | Shared loader and writers in `packages/api` (#13); mobile Income screen and add / edit screens (#14), iOS modal cards and Android full-screen modals (#15), one cash account with Update cash in hand (#16, migration 20261022190000 applied to fin-creador-dev). Tested on Android and iPhone in Expo Go 58. |
| **6. Status and PR** | Done | Status and decisions updated; PR from `sprint-1-foundation` into `main` opened for review. |

## Sprint 3 steps

Sprint 3 runs in two phases (owner, 2026-10-23). Phase 1 is a UI prototype on demo data with no database changes; Phase 2 builds the real feature. No PR into `main` until Phase 2 has removed the prototype route.

| **Step** | **Status** | **Notes** |
|----|----|----|
| **Phase 1. Web prototype** | Done (approved 2026-10-24) | `/dev/recurring` on in-memory demo data (development only; dev sign-in exception and nav preview): the /recurring page (cost tiles; Due, Needs attention, Coming in 30 days and Ended panels; Subscriptions, Memberships and Other recurring), the compact Upcoming card for Income and Transactions, Confirm through the Add dialog. `packages/domain/src/recurrence.ts` (dates, status, costs) with unit tests; 8 screenshots in `docs/design/recurring-prototype/`. |
| **Phase 2.1 Migration and pgTAP** | In progress (SQL in owner review) | Rules table (type, frequency and start date fixed), posting function (occurrence date within start..min(end, today); rule + occurrence date posts once among non-voided entries; entry date not in the future), skips, RLS. Categories: a stable internal `key` column (not client-writable) on the Membership and Subscription defaults; icons `membership` and `subscription` added to `categories_icon`; `ensure_default_expense_categories` creates 14 defaults; a one-time idempotent backfill adds the two new defaults (by key) to existing users, because the existing function skips anyone who already has expense categories. |
| **Phase 2.2 Shared schemas, loaders and writers** | Done | `packages/schemas` transaction form; `packages/api/src/transactions`: context, page (opaque keyset cursor), totals, history, `saveTransaction`, `voidTransaction`; every write takes a request key. Income page and mobile void moved to `void_transaction`. |
| **Phase 2.3 Web wiring** | Not started | `/recurring` page and its sidebar item (between Income and Transactions); the compact Upcoming card on Income and Transactions links to it. |
| **Phase 2.4 Remove the prototype** | Done | `/dev/transactions`, its demo data and the dev-only sign-in exception removed; unit test (no exception) and E2E against the production build (redirect signed out, 404 signed in). |
| **Phase 2.5 E2E tests** | Done | 7 Playwright journeys in `e2e/transactions.spec.ts` (validation, totals and balances, edit and history, void, double submit, stale edit, search and filters, income edit, production check, cross-user), green in CI on PR #19; screenshots of the final pages only. |
| **Phase 2.5b Expense categories (web)** | Done | Settings → Categories: add, rename (and icon), archive, restore; defaults archivable, never deleted; no duplicate active names; archived categories keep their history. Shared writers in `packages/api`; E2E `e2e/categories.spec.ts` with one screenshot. |
| **Phase 2.6 Mobile** | Not started | Separate PR: its own Recurring screen, reached from the Overview card and Activity. |
| **Phase 2.7 Status and PR** | Done | Status and decisions updated; PR #19 merged into `main` 2026-10-23. |

## Sprint 4 steps

Same two phases as Sprint 3 (owner, 2026-10-23): Phase 1 is a prototype on demo data with no database changes; Phase 2 builds the real feature (web first, mobile in its own PR).

| **Step** | **Status** | **Notes** |
|----|----|----|
| **Phase 1. Web prototype** | Done (owner review pending) | `/dev/recurring` on in-memory demo data (development only; dev sign-in exception in `lib/auth/routes.ts`), shared `components/recurring/upcoming.tsx`, `packages/domain/src/recurrence.ts` with unit tests, 8 screenshots in `docs/design/recurring-prototype/`. |
| **Phase 2.1 Migration and pgTAP** | In progress (SQL in owner review) | Rules table, posting function (date within start..min(end, today); rule + date posts once among non-voided entries), RLS. |
| **Phase 2.2 Shared loaders and writers** | Not started | `packages/api`; every write takes a request key. |
| **Phase 2.3 Web wiring** | Not started | Upcoming on the Income and Transactions pages; manage rules. |
| **Phase 2.4 Remove the prototype** | Not started | |
| **Phase 2.5 E2E tests** | Not started | |
| **Phase 2.6 Mobile** | Not started | Separate PR. |
| **Phase 2.7 Status and PR** | Not started | |

## Decisions

| **Date** | **Decision** | **Reason / consequence** |
|----|----|----|
| **2026-10-21** | UI follows the Figma Make design, adopted as `docs/design-spec.md`: dark forest green with a lime accent. This replaces the emerald brand color. | One visual source of truth for web and mobile. Text colors that failed WCAG AA were darkened; input borders darkened to 3:1; minimum text 12px. |
| **2026-10-22** | Database and RLS tests run in GitHub Actions, not on the development Mac. Do not start Docker or local Supabase there; check free disk before any large download. | A local Supabase start filled the Mac's disk. CI uses a throwaway database and never touches the hosted project. |
| **2026-10-22** | Web hosting is Vercel Hobby. | Hobby is for non-commercial use only: upgrade to Pro (or move hosting) before any paid or commercial launch. |
| **2026-10-22** | ~~Wordmark is written "FinCreador" with a capital F and C (Figma used lowercase "fincreador").~~ Superseded below. | Brand name reads correctly; applied everywhere through the single Wordmark component. |
| **2026-10-22** | Scheduled jobs and reminders use Supabase scheduling (`pg_cron` and Edge Functions), not Vercel Cron. | Vercel Hobby cron runs at most once a day with up to an hour of drift — not enough for a 10 PM reminder in each user's time zone. |
| **2026-10-22** | Mobile uses Expo Router (`apps/mobile/src/app`), with protected `(auth)` and `(app)` groups and five bottom tabs matching the web tab bar. | Expo's recommended navigation; route guards keep signed-out users out of the app screens. |
| **2026-10-22** | The mobile session is stored in AsyncStorage, encrypted with AES-256-GCM (`expo-crypto`); the key lives in the Keychain / Android Keystore (`expo-secure-store`, after first unlock, this device only). | The secure store cannot hold a whole session; this keeps tokens encrypted at rest. A session that can't be decrypted is dropped and the user signs in again. |
| **2026-10-22** | Email links from the mobile app (sign-up confirmation, password reset) open the web app. Google sign-in on mobile uses the system auth browser with PKCE and returns to the app. | Deep-linking email links into the app needs real app builds (Sprint 11). Expo Go needs `exp://**` in the Supabase redirect allow list; builds use `fincreador://auth/callback`. |
| **2026-10-22** | Country, currency and time-zone lists (with English names) are generated into `packages/schemas/src/region-data.ts` and used by web and mobile. | Hermes (mobile) lacks `Intl.supportedValuesOf` and `Intl.DisplayNames`; one static list means both clients offer the same choices. |
| **2026-10-22** | Auth error messages, the publishable-key guard and profile column mapping live in `packages/api`, shared by web and mobile. | One set of messages and rules; the clients cannot drift apart. |
| **2026-10-22** | Google sign-in in Expo Go is tested with `npm run dev:mobile:google`, which serves Expo under an sslip.io hostname (e.g. `192-168-1-6.sslip.io`). | Supabase refuses OAuth redirects to bare IP addresses even when allow-listed, and the ngrok tunnel was unreliable. App builds use `fincreador://auth/callback`, which Supabase already accepts. |
| **2026-10-22** | The mobile app supplies `crypto.getRandomValues` and `crypto.subtle.digest` from `expo-crypto` before Supabase loads. | Hermes has no WebCrypto, so supabase-js was falling back to `Math.random()` and a "plain" PKCE challenge. |
| **2026-10-22** | Web E2E tests run only in CI, against a throwaway Supabase started on the runner, with emails read from its Mailpit inbox. A global setup refuses to run against anything but a local Supabase. | No test users in fin-creador-dev and no service-role key needed. `supabase/config.toml` mirrors the hosted auth settings (confirmation on, password minimum 8, same token-hash email templates) and has higher local rate limits; it is not pushed to the hosted project. |
| **2026-10-22** | The secret check scans a plain-JS export of the mobile app, not the Hermes bytecode. | Bytecode stores strings back to back, so harmless prefixes merge with neighbouring strings and look like keys. |
| **2026-10-22** | Sign-up answers "Check your email…" for an email that already has an account, exactly as for a new one (web and mobile, shared `isExistingAccountError`). | Found by the E2E tests: Supabase returns `user_already_exists` for confirmed accounts and the app showed "Something went wrong", which revealed that the email was registered. |
| **2026-10-22** | Sprint 2 covers accounts and the full Income page from `docs/design/Income*.png`. Moved in from Sprint 3: income entry, the transactions table (designed for income, expense and transfer; only income enabled) and safe void. Moved in from Sprint 4: income sources and the Income page. Sprint 3 keeps expenses, transfers, editing and history, search and filters; Sprint 4 keeps recurring rules and mark received/paid. | Owner's scope decision; the Income page is the first screen that needs accounts, so both ship together. There is no separate Accounts page. |
| **2026-10-22** | An income source is an income category (`categories` with `kind = income`): a type (salary, rent, freelance, business, interest, other) and an optional default account. Sources hold no balance; money lives only in accounts, and cash and other holdings are accounts. | Avoids two overlapping concepts and double counting (CLAUDE.md §5). |
| **2026-10-22** | Total available = sum of active accounts' balances in the profile currency. Accounts in other currencies are listed but not totalled (no conversion). Account balance = opening balance + posted inflows − posted outflows, counting entries on or after the opening balance's "as of" date (the balance at the start of that day). Voided entries never count. | Exact, explainable totals; income dated before the as-of date still counts as period income but is already inside the opening figure. |
| **2026-10-22** | Opening balance may be negative for bank accounts only; cash and other accounts must be zero or more until Sprint 8 (liabilities). ~~Multiple cash accounts are allowed; the Cash in hand card sums them and the first "Add cash" pre-fills "Cash in hand".~~ Superseded by "one cash account" below. | Overdrawn current accounts exist; negative cash does not. |
| **2026-10-22** | Add income has a single "Received into" account (banks, cash, other); no separate payment-method field. | The account already records where the money landed. |
| **2026-10-22** | A mistaken income entry is voided, never deleted or edited (editing is Sprint 3). Voiding is one-way and enforced in the database. Creating income is idempotent (client key, unique per user). | Auditable history and no double posting. |
| **2026-10-22** | An account's currency and opening-balance date are locked once it has entries (error codes FC004, FC011); the opening amount can still be corrected. The as-of date is only re-checked against "today" when it is set or changed, so editing and archiving keep working after a time-zone change. | The as-of date decides which entries count toward the balance; moving it later would silently re-classify existing income. |
| **2026-10-22** | Income entries cascade from their account and source (`ON DELETE CASCADE`), and a source's default account is cleared (`SET NULL`), only so that deleting a whole user works. Accounts and sources must never be deleted directly, only archived; account deletion (Sprint 12) goes through deleting the user. | Keeps the ledger intact: no client can delete an account or source, and deleting a user removes all of their data in any cascade order. |
| **2026-10-22** | Default income sources (Salary, Freelance, Rental income, Business, Interest & dividends, Other income) are created for every user by a separate function that can never block sign-up, with a backfill and a lazy fallback on first use. The Income sources panel lists only sources with income this year or added by the user. | Ready-to-use categories without showing rows of ₹0. |
| **2026-10-22** | "This month" and "this year" use the calendar in the user's time zone. The Rental income card sums all rent-type sources. "Linked account" on a source is the account that actually received its income this year ("Multiple accounts" if several), else its default account. | Matches the Figma; financial year is a backlog setting. |
| **2026-10-22** | Wordmark is lowercase "fincreador" as in the Figma ("fin" white, "creador" lime on dark; both ink on light). Screen readers hear "Fin Creador"; titles, emails and body text keep "Fin Creador". | Owner's decision; reverses the earlier "FinCreador". Lime stays off light backgrounds (contrast). |
| **2026-10-22** | Income loading and writes live in `packages/api` (`loadIncomeData`, `saveAccount`, `setAccountArchived`, `saveSource`, `recordIncome`, `voidIncome`) and take the signed-in user's Supabase client (RLS applies, never a service-role key). The web's server actions are thin wrappers; the mobile app calls the same functions. "Today" comes from the database (`user_local_today`) on both clients and drives the month and year; if it can't be read, nothing is saved (no device-clock fallback). | One code path for validation, writes and error messages on web and mobile. |
| **2026-10-22** | Mobile add and edit screens open as the standard iOS modal card (slides up, swipe down to dismiss) and as full-screen modals on Android, set in one place in `apps/mobile/src/app/(app)/_layout.tsx`. Dates use the native picker (`onValueChange`), capped at today from the database. | Native form sheets were tried first but rendered empty on both platforms in device tests (their `flex: 1` content got no height). Tested on Android and iPhone in Expo Go 58 on 2026-10-22. |
| **2026-10-22** | One active cash account per person ("Cash in hand"), enforced in the database (trigger, FC012; a trigger rather than a unique index so existing duplicates don't block the migration). "Add cash" asks only for the amount held now; afterwards "Update cash in hand" (`set_cash_on_hand`) sets the cash held now by moving the as-of date to today and setting the opening amount, without changing any income entry. Cash received as income is recorded as income into Cash in hand; ATM withdrawals become transfers (Sprint 3). Same on web and mobile. | Owner's choice (option A) after a second "Cash in hand 2" appeared. Telling the app how much cash you have is a correction, not income (CLAUDE.md §5). |
| **2026-10-23** | Sprint 3 rules (owner): expense categories are user-editable (12 defaults; add, rename, archive), separate from income sources (both are rows in `categories`, by kind). Payment mode is an optional label (UPI, Debit card, Net banking, Cheque) on expenses from a bank account; the account moves the money. Credit cards wait for Sprint 8. An expense may take cash or other accounts below zero (the app warns) and bank accounts may go negative. Entries carry a date only, no time of day. | Approved after the Phase 1 prototype. |
| **2026-10-23** | A transfer is one ledger row (`account_id` = from, `counter_account_id` = to), never income or expense; voiding it restores both accounts. Both accounts must be active and in the same currency. | One row keeps a transfer atomic and impossible to half-void. |
| **2026-10-23** | Editing voids the old version and inserts the new one, linked by `replaces_id`, in one database transaction. Type cannot change; a stale edit (the version was already voided or replaced) is refused. Every write (income, expense, transfer, edit, void) takes an idempotency key, so a retry saves once. | Ledger rows stay immutable; history is exact. |
| **2026-10-23** | Transaction search and lists run through parameterised database functions (never client-built filter strings), with keyset paging, not offset. Search matches note, category and account names (literal text, any case) or an exact amount. | No injection through PostgREST filter syntax; stable paging while entries are added. |
| **2026-10-23** | Type shapes are enforced by CHECKs (`transactions_shape`, `transactions_payment_mode`, `account_id NOT NULL`); triggers add the FC codes. Editing a plainly voided entry is FC005; FC014 only when another edit replaced it. | Owner review of the Phase 2 SQL; one pgTAP test per violation. |
| **2026-10-23** | The list cursor is opaque and keeps `created_at` as the raw database string (microseconds), never a JS Date. | A Date cuts to milliseconds, so keyset paging would repeat or skip rows. |
| **2026-10-23** | `void_income` is dropped (migration 20261023180000) in the same PR that moves web and mobile to `void_transaction`; `record_income` stays for the Income page. | Owner decision B; one void path with a request key. |
| **2026-10-23** | Income entries are edited from the Income page by opening `/transactions?edit=<id>` (and `?history=<id>`), the same dialog as every other entry; the Income page hides versions an edit replaced. | One edit form and one set of rules on web. |
| **2026-10-23** | Expense categories are managed on web only, in a "Categories" section on Settings, following the Income sources pattern: add, rename, archive, restore. Defaults can be archived, never deleted; no duplicate active names; archived categories keep their history. Mobile category management is in the backlog. | Owner decision after Phase 2.5. |
| **2026-10-23** | On mobile one Add / Edit transaction sheet (Expense, Income, Transfer) replaces the Add income sheet; the header + opens it on Expense, the Income screen on Income. Entry text, filters and the balance preview live in `packages/api` and are used by web and mobile. | One form and one set of rules per platform; no duplicated money logic (CLAUDE.md §4–5). |
| **2026-10-23** | Sprint 4 recurring rules (owner): (A) a rule creates due items you confirm; nothing posts by itself. (B) Weekly, monthly, quarterly and yearly, always anchored to the original day; a day 29–31 falls on the month's last day in shorter months. (C) A fixed amount, editable when confirming. (D) Income, expense and transfer. | Explicit control over every posted entry; no surprise balances. |
| **2026-10-23** | (E) Only the latest missed occurrence shows as due; Skip covers an entry already added by hand. (F) One occurrence can be skipped; editing a rule changes future occurrences only; posted entries never change. (G) A rule ends with an end date or by archiving; no pause. | Keeps the Upcoming list short and history immutable. |
| **2026-10-23** | (H) One shared Upcoming component on the Income and Transactions pages, filtered by type. (I) Due items are computed from the rules (no cron); the date logic lives in `packages/domain` with unit tests; the database checks the date is within start..min(end, today) and that a rule and date post at most once among non-voided entries. (J) Prototype on demo data first, at most 8 screenshots. | One calculation for web and mobile; the database is the final guard against double posting. |
| **2026-10-23** | (K) Voiding a posted occurrence makes it due again (the once-only rule counts non-voided entries). (L) A rule whose account or category is archived shows "Needs attention" and must be fixed before it can post. | Mistakes stay correctable; nothing posts into an archived account or category. |
| **2026-10-23** | Sprint 4 prototype feedback (owner): 14 default expense categories, adding "Membership" and "Subscription" with a stable internal key the user can't edit (grouping follows the key, so a rename doesn't break it). The recurring form lists every expense category. Recurring management is its own page, `/recurring` (sidebar item between Income and Transactions, as in the Figma nav); the Upcoming card on Income and Transactions stays compact and links to it. | Subscriptions and memberships are the common recurring costs; one place to manage rules. |
| **2026-10-23** | `/recurring` has four panels, each with a count, its own list and empty state: Due, Needs attention, Coming in 30 days, Ended. Then group panels: Subscriptions and Memberships (by category key) and Other recurring. Three cost tiles: Subscriptions, Memberships, Total recurring cost, from active expense rules only (not income, transfers, ended or archived), in integer minor units: yearly = amount × occurrences a year (weekly 52, monthly 12, quarterly 4, yearly 1), monthly = yearly / 12 rounded half up, labelled "estimated from default amounts"; each currency shown separately, never summed. The math is in `packages/domain` with unit tests. | Exact, explainable figures; no conversion without rates. |
| **2026-10-23** | Recurring rules answers: Upcoming window 30 days. Type, frequency and start date are fixed after creation (end the rule and add a new one to change them). Confirming opens the normal Add dialog pre-filled: amount, entry date (not in the future), account and note editable; category fixed; a rule + occurrence date can't post twice. Archived rules can be restored. A skip can be undone only while it is still the rule's latest handled occurrence. Mobile Recurring is a separate PR (its own screen, from the Overview card and Activity). | Owner's answers to the first prototype's questions. |
| **2026-10-24** | Prototype approved (owner). Confirming uses the entered date for the entry; the once-only check uses the rule's occurrence date. Rules that need attention count in the cost tiles. Ended rules show only in the Ended panel (not in the group panels or tiles). Restoring a rule makes only its latest occurrence due. Zero tiles show for the profile currency; empty tiles for other currencies are hidden. | Answers to the second prototype's questions. |

## Before production (open items)

Development-only settings that must be removed or replaced before any production release (Sprint 12 at the latest):

- **Supabase redirect allow list:** remove `exp://**` (Expo Go) and the `http://localhost:3000/...` entries; keep only the production web URL and the app's own scheme.
- **Dev scripts:** drop `npm run dev:mobile:google` (`apps/mobile/scripts/start-lan-hostname.sh`); it exists only so Google sign-in can return to Expo Go during development.
- **App scheme:** use a fixed `fincreador://` scheme in the release builds (and keep `fincreador://auth/callback` as the only mobile OAuth return address). Remove the Expo Go `exp://` branch in `oauthRedirectUrl` once development builds replace Expo Go.
- **Site URL:** set it to the production web URL.

- **Email sender:** add custom SMTP (Supabase's built-in sender allows only a few emails per hour).

Pending tests:

- **Google sign-in on iPhone:** the app runs on iPhone in Expo Go 58 (tested 2026-10-22), but Google sign-in has only been tested on Android so far (`npm run dev:mobile:google`).

## Backlog

- **Financial year setting:** optional April–March financial year for "this year" figures (Sprint 2 uses the calendar year).
- **Repeated sign-up email:** see Sprint 10.
- **Mobile category management:** add, rename, archive and restore expense categories in the mobile app (web has it on Settings since Sprint 3; owner, 2026-10-23).
- **Payee / merchant on entries:** a "paid to" field (the Figma shows merchant names). Not in Sprint 3 (owner, 2026-10-23).
- **Past months of income:** browsing last month and earlier months (Sprint 3: transaction list with date filters; Sprint 5: dashboard periods; Sprint 8: reports). Owner's choice on 2026-10-22: not added to Sprint 2.

# 1. Executive summary

Fin Creador is a personal finance platform for recording daily expenses
and income, understanding cash flow, tracking investments, planning
future expenses, and receiving reminders and insights. Build the
everyday money-tracking core first, then add planning, portfolio
management, AI, notifications, and production hardening.

- Track expenses and income by day, week, month, year, and custom date
  range.

- Manage salary, rent, freelance/business income, cash, bank accounts,
  and other sources.

- Plan goals such as travel, a car, a bike, a home, and an emergency
  fund.

- Track shares, mutual funds, ETFs, deposits, liabilities, and net
  worth.

- Offer optional AI explanations based on verified user data.

- Send configurable reminders, including an optional 10 PM expense
  reminder.

# 2. Recommended technical baseline

| **Area** | **Recommendation** |
|----|----|
| **Web** | Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui |
| **Mobile** | React Native with Expo for Android and iOS |
| **Backend** | Supabase, PostgreSQL, Supabase Auth, server-side functions |
| **Security** | Row Level Security (RLS), server-side validation, secret management |
| **AI** | Server-side provider abstraction; code calculates, AI explains |
| **Notifications** | Scheduled delivery, Expo push, supported web notifications |
| **Quality** | Git branches/PRs, migrations, automated tests, lint, typecheck, build |
| **Hosting** | Vercel Hobby for now. Hobby is non-commercial only; upgrade to Pro (or move hosting) before any paid or commercial launch |
| **CI** | GitHub Actions on pull requests: lint, typecheck, unit tests, build, migrations and pgTAP database tests |
| **Design** | `docs/design-spec.md` and the Figma Make file it references; single token source in `packages/design-tokens` |
| **Scheduling** | Supabase scheduling (`pg_cron`, Edge Functions) for reminders and other scheduled jobs; not Vercel Cron |

Preserve the existing repository and working conventions. Inspect before
restructuring; do not force a new architecture onto working code.

# 3. Sprint roadmap at a glance

| **Sprint** | **Timeline** | **Focus** | **Usable outcome** |
|----|----|----|----|
| **1** | Weeks 1–2 | Foundation, authentication & profile | Register/sign in; manage profile. |
| **2** | Weeks 3–4 | Accounts & Income page | Create accounts, record income, see income and balances on the Income page. |
| **3** | Weeks 5–6 | Expense & transaction tracking | Add, edit, search, filter, and review transactions. |
| **4** | Weeks 7–8 | Recurring items | Recurring rules and mark received/paid. |
| **5** | Weeks 9–10 | Dashboard & analytics | View meaningful time-based financial insights. |
| **6** | Weeks 11–12 | Budgets & savings goals | Plan targets and track progress. |
| **7** | Weeks 13–14 | Investment portfolio | Track holdings and manual valuations. |
| **8** | Weeks 15–16 | Loans, liabilities & reports | View liabilities, net worth, and export records. |
| **9** | Weeks 17–18 | AI financial insights | Get explanations grounded in verified data. |
| **10** | Weeks 19–20 | Notifications & reminders | Configure reminders and upcoming-payment alerts. |
| **11** | Weeks 21–22 | Mobile polish, offline & PWA | Harden supported offline and cross-platform workflows. |
| **12** | Weeks 23–24 | Security & production release | Release candidate ready for deployment/store submission. |

# 4. Sprint detail and acceptance criteria

## Sprint 1 — Foundation, authentication and profile

**Weeks 1–2 \| Usable outcome:** A user can create an account, sign in,
and manage their profile.

### Scope and deliverables

- Inspect repository, routes, dependencies, migrations, auth setup, and
  tests before changing anything.

- Set up environments, migration conventions, CI checks, and web/mobile
  application shells.

- Implement email/password, Google OAuth, password recovery, sign-out,
  and session handling.

- Add profile editing, currency, country, and time-zone preferences;
  default to India, INR, Asia/Kolkata.

- Plan Apple sign-in where required by iOS distribution/authentication
  setup.

- Design foundation from `docs/design-spec.md`: tokens, fonts, logo,
  shared primitives (Button, Input, Card, Badge, Toast) and a dev-only
  design review page with clearly labeled demo data.

- App shell: web sidebar, topbar and mobile bottom tab bar; styled auth
  and profile/Settings screens.

### Acceptance criteria

- Sign-up, sign-in, sign-out, and recovery flows work with clear errors.

- Profile changes persist after a fresh login.

- Baseline RLS and server authorization are implemented and tested.

- No service-role or provider secrets appear in client bundles.

- Local setup and test deployment are documented.

- All text is at least 12px.

- Text and background color pairs meet WCAG AA contrast.

- The CI workflow passes on the pull request.

- No demo data appears in real screens.

## Sprint 2 — Accounts and the Income page

**Weeks 3–4 \| Usable outcome:** A user can record where their money is
held, record income into it, and see income and balances on the Income
page.

Scope widened on 2026-10-22 (see the decisions log): income entry, the
transactions table and income sources moved in from Sprints 3 and 4.

### Scope and deliverables

- Accounts: bank (savings or current), cash and other; opening balance
  with an "as of" date; optional institution and last 4 digits;
  currency; create, edit, archive and restore. Archived accounts leave
  the list and totals but stay in history.

- Income sources (income categories) with a type and optional default
  account; default sources for every user; Add source.

- Income entries: amount, date, source, "Received into" account, note;
  idempotent creation; one-way void. The transactions table is designed
  for income, expense and transfer, with only income enabled.

- Income page exactly as in `docs/design/Income*.png`: Income this month,
  Income this year, Bank accounts, Money in banks, Cash in hand, Rental
  income, Income sources (monthly and yearly, linked account), Where your
  money is with Total available. No separate Accounts page.

- Calculations in `packages/domain`, shared by web and mobile. Web first,
  then mobile screens.

### Acceptance criteria

- Account and income flows work for an authenticated user; another user
  can read or change nothing (RLS, tested in pgTAP including the balance
  view).

- Money is stored as integer minor units (`bigint`) with a currency;
  never binary floating point.

- Account balance = opening balance + posted inflows − outflows; Total
  available = sum of active accounts' balances in the profile currency;
  period income is reported separately from balances.

- Month, year and leap-year boundaries are correct in the user's time
  zone (unit tests).

- A double-submitted income is recorded once; voided income drops out of
  balances and totals but stays in history.

- Archived accounts do not corrupt historical income figures.

- Loading, empty, validation and error states are present; no demo data
  in real screens.

### Design deliverables

- Income page, Add income modal, Add bank / cash / other account, Add
  source, account actions and empty states (`docs/design-spec.md` §9).

**Dependencies:** Sprint 1 authentication and database foundation.

## Sprint 3 — Expense and transaction tracking

**Weeks 5–6 \| Usable outcome:** A user can maintain a reliable daily
transaction ledger.

Already delivered in Sprint 2: income entry, the transactions table
(income only) and void. Sprint 3 enables expenses and transfers on the
same table and adds editing with history, search and filters.

### Scope and deliverables

- Add expenses and income with amount, date, category, account, and
  optional note.

- Add transfers between the user’s accounts.

- Support edit, delete/safe reversal, search, date/category/account
  filters, and recent history.

- Build fast-entry forms and default categories such as food, transport,
  rent, utilities, shopping, and health.

### Acceptance criteria

- Transactions can be added, edited, filtered, and found.

- Transfers affect balances but are not counted as income or expenses.

- Amount, account ownership, category, and date are validated
  server-side.

- Duplicate submission and edit behavior are tested.

- Loading, empty, validation, and error states are present.

### Design deliverables

- Add transaction modal (web) and bottom sheet (mobile).

- Transactions list, search and filters.

**Dependencies:** Sprint 2 accounts.

## Sprint 4 — Recurring items

Income sources and the Income page moved into Sprint 2 (2026-10-22).
Sprint 4 keeps recurring rules and mark received/paid; the original list
below is kept for reference.

**Weeks 7–8 \| Usable outcome:** A user can track multiple income
sources and recurring transactions.

### Scope and deliverables

- Support salary, rent, freelance, business, cash, and custom sources.

- Create recurring rules for salary, rent, subscriptions, bills, and
  supported entries.

- Allow items to be marked received/paid and prevent duplicate postings.

- Build an Income page with source history and clearly labeled balances.

### Acceptance criteria

- Multiple income sources can be managed.

- Recurring entries follow schedules without accidental duplicates.

- Period income is distinct from current account/source balance.

- Total Balance definition is documented and tested.

### Design deliverables

- Income page.

**Dependencies:** Sprints 2–3 account and transaction models.

## Sprint 5 — Dashboard and analytics

**Weeks 9–10 \| Usable outcome:** A user can understand finances through
real, date-filtered data.

### Scope and deliverables

- Show total balance, income, expenses, net cash flow, and recent
  transactions.

- Add daily, weekly, monthly, yearly, and custom date-range views.

- Add category spending charts, income-versus-expense trends, and period
  comparisons.

- Provide useful first-run empty states and links to filtered
  transactions.

### Acceptance criteria

- Metrics reconcile to underlying transactions/accounts.

- Date filters handle month/year boundaries and user time zone.

- Dashboard metrics match corresponding reports.

- Charts do not imply data exists when it does not.

- Web MVP can be deployed for controlled user testing.

### Design deliverables

- Dashboard: summary cards, spending chart and budget donut, using real data with empty states.

- Controlled web deployment on Vercel (Hobby) for user testing.

- At the start of Sprint 5, write `docs/deployment.md`: Vercel project setup, environment variables, Supabase auth redirect URLs, and the Hobby non-commercial limit.
- After the first Vercel deployment, verify the auth redirects (email confirmation, password reset, Google, signed-out redirects) stay on the deployment's own domain. If any land on `localhost`, build those redirects from `NEXT_PUBLIC_SITE_URL` instead of the request URL (`app/auth/callback/route.ts`, `lib/supabase/proxy.ts`). The E2E tests run on `localhost:3000` because `next start` builds request URLs from `localhost`.

**Dependencies:** Sprints 2–4 data and calculation rules.

## Sprint 6 — Budgets and savings goals

**Weeks 11–12 \| Usable outcome:** A user can plan a purchase and
understand the savings required.

### Scope and deliverables

- Create monthly category budgets and progress indicators.

- Create goals for travel, car, bike, home, emergency fund, and custom
  goals.

- Capture target amount, target date, current saved amount; calculate
  monthly savings.

- Add budget warnings, starting with in-app alerts if notification
  infrastructure is not ready.

### Acceptance criteria

- Goal progress and monthly target calculations are tested.

- Users can edit/archive goals without damaging transaction history.

- Budget indicators use correct period and categories.

- Assumptions are shown when a goal lacks a target date.

### Design deliverables

- Budgets and Goals pages.

**Dependencies:** Sprint 5 reporting and validated calculations.

## Sprint 7 — Investment portfolio

**Weeks 13–14 \| Usable outcome:** A user can record holdings and see
portfolio composition and performance estimates.

### Scope and deliverables

- Support shares/stocks, mutual funds, ETFs, deposits, and custom
  assets.

- Record units, purchase price/cost basis, fees, history, and valuation
  date.

- Show invested amount, current value, unrealized gain/loss, and asset
  allocation.

- Allow manual valuation updates and distinguish manual, delayed, and
  live values.

### Acceptance criteria

- Portfolio totals reconcile to included holdings.

- Gain/loss assumptions are documented and tested.

- Valuation timestamp and source are visible.

- No live price is claimed without a trusted provider and timestamp.

### Design deliverables

- Investments page.

**Dependencies:** Sprints 2 and 5 account/reporting foundations.

## Sprint 8 — Loans, liabilities and reports

**Weeks 15–16 \| Usable outcome:** A user can see broader financial
position and export records.

### Scope and deliverables

- Track loans, credit-card liabilities, repayments, and EMI schedules.

- Separate principal, interest, and fees where supported.

- Add net worth and cash-flow history.

- Provide CSV exports; PDF export is optional if time permits.

### Acceptance criteria

- Net worth equals included assets minus included liabilities.

- Repayments do not double-count principal as ordinary expenses where
  modeled separately.

- Exports respect user permissions and date filters.

- Exports cannot leak another user’s data.

**Dependencies:** Sprints 3, 5, and 7.

## Sprint 9 — AI-powered financial insights

**Weeks 17–18 \| Usable outcome:** A user receives explanations grounded
in verified financial data.

### Scope and deliverables

- Summarize spending patterns and period-over-period changes.

- Detect potential unusually high spending and budget overruns using
  deterministic checks first.

- Generate savings scenarios based on goals and stated assumptions.

- Add optional financial Q&A through a server-side provider abstraction.

- Show context period, source figures, and links to relevant records.

### Acceptance criteria

- Totals and comparisons are computed in validated code/SQL, not
  generated by AI.

- Responses are bounded, validated, and labeled informational.

- Only necessary summarized data is sent; secrets remain server-side.

- Feature degrades gracefully if provider is unavailable.

- AI cannot initiate payments, transfers, trades, or other financial
  actions.

**Dependencies:** Stable dashboard, goals, and portfolio data.

## Sprint 10 — Notifications and reminders

**Weeks 19–20 \| Usable outcome:** A user can receive and control
reminders across supported platforms.

### Scope and deliverables

- Add optional daily 10 PM expense-entry reminder in the user’s time
  zone.

- Allow time changes, opt-out, and preference management.

- Add upcoming bill/EMI and recurring-transaction reminders where data
  exists.

- Backlog (from Sprint 1): when someone tries to sign up with an email
  that already has an account, email the owner ("someone tried to sign
  up with your address; sign in or reset your password"). Sign-up itself
  already answers identically for new and existing emails. Needs a
  server-side email sender (custom SMTP or an Edge Function).

- Implement supported mobile push, supported web notifications, and
  in-app notification center.

- Handle permission denial, token refresh, delivery errors, and
  time-zone changes.

### Acceptance criteria

- Preferences persist and sync across devices.

- Scheduling uses a reliable supported server-side mechanism.

- Sensitive transaction details are not exposed on lock screens by
  default.

- UI explains missing permissions or disabled notifications.

- Do not promise exact delivery when OS/provider cannot guarantee it.

### Design deliverables

- Reminder and notification settings screens.

- Reminders built on Supabase scheduling (`pg_cron` and Edge Functions), not Vercel Cron.

**Dependencies:** Sprints 1 and 4; notification infrastructure.

## Sprint 11 — Mobile polish, offline support and PWA

**Weeks 21–22 \| Usable outcome:** The app is dependable across
supported web and mobile workflows.

### Scope and deliverables

- Polish mobile navigation, safe areas, keyboard behavior, loading
  states, and accessibility.

- Add secure local caching and limited offline expense entry where
  feasible.

- Queue offline changes with synchronization, idempotency, and conflict
  handling.

- Make web installable as a PWA where supported.

- Test session expiry, app lifecycle, push permissions, and
  cross-platform consistency.

### Acceptance criteria

- Offline state is clear; unsynced data is not falsely reported as
  remotely saved.

- Synchronization avoids duplicate transactions and handles conflicts.

- Critical flows work on supported devices/browsers.

- Accessibility and responsive checks are completed.

**Dependencies:** Stable core flows on web and mobile.

## Sprint 12 — Security, release and production readiness

**Weeks 23–24 \| Usable outcome:** A tested release candidate is ready
for deployment and store submission.

### Scope and deliverables

- Run end-to-end tests for auth, expenses, transfers, reports, goals,
  and reminders.

- Review RLS, authorization, rate limits, secrets, logs, and cross-user
  isolation.

- Validate backups, recovery, migrations, monitoring, and performance.

- Complete privacy policy, terms, account deletion, support contact, and
  store metadata.

- Prepare web deployment and Android/iOS release builds.

- Clear the development-only items in "Before production (open items)"
  at the top of this document (redirect allow list, dev scripts, fixed
  `fincreador://` scheme, Site URL).

### Acceptance criteria

- Critical financial flows pass end-to-end tests.

- Cross-user isolation tests pass for all user-owned data.

- No known critical security issue remains open.

- Production configuration and recovery steps are documented.

- Release notes and store-submission materials are ready; store approval
  is not assumed.

### Design deliverables

- Hosting-plan decision for a commercial launch: upgrade Vercel Hobby to Pro or move hosting before any paid or commercial use.

**Dependencies:** All launch-critical features and environments.

# 5. Financial rules that must remain consistent

These are product invariants. Implement them in shared domain logic or
trusted server-side code, and cover them with tests.

| **Metric** | **Rule** |
|----|----|
| **Period income** | Sum eligible income transactions in the selected period; not the same as current balance. |
| **Period expenses** | Sum eligible expenses in the period with documented refund/reversal handling. |
| **Net cash flow** | Period income minus period expenses; exclude transfers and avoid double counting. |
| **Account balance** | Opening balance plus posted inflows minus outflows, including transfers and balance-affecting events. |
| **Net worth** | Included assets minus included liabilities, with valuation dates defined. |
| **Income page Total Balance** | Bank Balance plus all other income-source balances, including Cash and other sources—not just bank plus cash if more sources exist. |
| **Investment gain/loss** | Current value minus cost basis, with explicit treatment of fees/distributions and valuation timestamps. |

- Use integer minor units or PostgreSQL numeric for authoritative money
  calculations; avoid binary floating point.

- Use the user’s time zone for day/week/month boundaries and scheduled
  reminders.

- Transfers must not inflate income or expenses.

- Prevent double-counting when funds move between accounts or a source
  is linked to an account.

- Keep investment purchases distinct from ordinary expenses.

# 6. Definition of done for every sprint

- Acceptance criteria are met and the feature works end to end.

- Schema/migrations are version-controlled where applicable.

- Server-side validation, authorization, and RLS are in place.

- Financial formulas and date-boundary behavior have automated tests.

- Loading, empty, error, retry, and success states exist where relevant.

- Relevant tests, lint, typecheck, and build are run; failures are
  reported honestly.

- No secrets or sensitive financial data leak into client code or logs.

- Documentation/configuration is updated and feature is deployable to a
  safe test environment.

# 7. Key risks and mitigations

| **Risk** | **Mitigation** |
|----|----|
| **Scope expansion** | Keep sprint scope fixed; add new ideas to a prioritized backlog. |
| **Inconsistent balances** | Canonical metrics, shared domain functions, database constraints, reconciliation tests. |
| **Financial data exposure** | RLS, server authorization, secret management, cross-user tests, careful logging from Sprint 1. |
| **Market data costs** | Start with manual valuations; assess coverage, licensing, freshness, and costs before integration. |
| **AI hallucinations/privacy** | Calculate in code, send minimal summaries, validate output, label suggestions. |
| **Notification limits** | Test each platform; communicate permissions and delivery limitations. |
| **Offline conflicts** | Limit offline scope; use idempotency and explicit pending/synced states. |
| **App-store delays** | Test mobile builds throughout; treat review approval as an external dependency. |
| **Vercel Hobby is non-commercial only** | Treat Hobby as a testing tier; upgrade to Pro or move hosting before any paid or commercial launch (decision due in Sprint 12, or earlier if monetized). |
| **Design drift between Figma, web and mobile** | Single token source in `packages/design-tokens`; `docs/design-spec.md` as the visual source of truth; dev-only design review page. |
| **Local disk or tooling limits** | Run database, RLS and build checks in GitHub Actions; check free disk before large downloads; no local Docker/Supabase on the development Mac. |

# 8. Release milestones

| **When** | **Milestone** | **Exit condition** |
|----|----|----|
| **End Sprint 2** | Account foundation | Authentication and account setup work; internal testing starts. |
| **End Sprint 3** | Daily transaction ledger | Core expense tracking is usable. |
| **End Sprint 5** | MVP / controlled web release | Auth, accounts, transactions, income, dashboard. |
| **End Sprint 8** | Money management release | Goals, portfolio, liabilities, reports. |
| **End Sprint 10** | Insights and reminders | AI and notifications behind appropriate controls. |
| **End Sprint 12** | Production release candidate | Security, quality, deployment, and store-submission readiness. |

# 9. How to use Claude Code efficiently

- Keep CLAUDE.md in the repository root as the stable source of product,
  architecture, security, and financial rules.

- For each sprint prompt, name only the sprint and acceptance criteria;
  do not paste this entire plan every time.

- Ask Claude to inspect existing code and relevant files before
  implementation.

- Request a short plan, focused implementation, tests, and an honest
  completion report.

- Do not let Claude silently start later sprints, rewrite architecture,
  add speculative dependencies, or deploy to production.

- Update CLAUDE.md only when a durable decision changes; keep
  sprint-specific tasks in this plan or tickets.

- At the end of every sprint or step, update the status table and
  decisions log at the top of this plan. Update CLAUDE.md only for
  durable decisions.

# 10. Recommended first task

Ask Claude Code to inspect the repository and compare the current state
with CLAUDE.md. Have it identify existing functionality, missing setup,
migrations/auth risks, and the smallest safe Sprint 1 implementation
plan. Then implement only Sprint 1. This reduces unnecessary rewrites
and avoids building a second version of something that already works.

**FIN CREADOR • Build small. Validate every sprint. Protect user
trust.**
