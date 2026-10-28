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
Last updated: 2026-10-28 (Sprints 8a and 8b done on stacked draft PRs #35, #36, #37, none merged. Next: 8b follow-up (borrowing details, card product list, F1), then 8d, 8e net worth, 8c; prod once at the end).

## Sprint status

| **Sprint** | **Focus** | **Status** | **Notes** |
|----|----|----|----|
| **1** | Foundation, authentication & profile | Done | Completed 2026-10-22; released to `main` via PR #7. Mobile app runs on Android and iPhone in Expo Go 58 (iPhone from 2026-10-22). See Sprint 1 steps below. |
| **2** | Accounts & Income page | Done | Completed 2026-10-22 (PRs #9–#16). Accounts, income sources, income entries with void, one cash account with "Update cash in hand", the Income page on web and mobile. Tested on web (E2E in CI) and on Android and iPhone (Expo Go 58). Scope widened from the original plan (see decisions). See Sprint 2 steps below. |
| **3** | Expense & transaction tracking | Done | Completed 2026-10-23 (PR #20 into the sprint branch; PR #19 merged into `main` 2026-10-23, merge commit ac916de). Expenses, one-row transfers, edits with history, voids with request keys, search and filters in the database with keyset paging, expense categories (web Settings), the Transactions page on web and the Activity tab and Add / Edit sheet on mobile (checked in Expo Go). Migrations 20261023120000 and 20261023180000 applied to fin-creador-dev. See Sprint 3 steps. |
| **4** | Recurring items | Done | Completed 2026-10-24 (PR #22 into the sprint branch, PR #21 merged into `main`, merge commit 1964d50). Recurring rules with due items you confirm or skip, the /recurring page with cost tiles and groups, the Upcoming card on Income and Transactions, the Recurring screen on mobile (tested in Expo Go). Migration 20261024120000 applied to fin-creador-dev. See Sprint 4 steps. |
| **5** | Dashboard & analytics | Done | Completed 2026-10-26 (PRs #25–#28 merged into `main`). Web Overview dashboard with chart types; first production deploy on Vercel Hobby and Supabase Free works, including Google sign-in. Migration 20261026120000 applied to dev and prod. Mobile Overview in the backlog. See Sprint 5 steps. |
| **6** | Budgets & savings goals | Done | Completed 2026-10-26 (PR #30 merged into `main`, merge commit 672ab75). One Goals page (`/goals`): Planned expenses (Trip, Wheeler, House, Furniture, Electronics, Mobile, Other; exact maths, EMI, archive, restore, permanent delete of archived goals) and Monthly budgets (80% / 100% warnings, page and Overview); web density pass; `scripts/backup-prod.sh`. Migrations 20261026180000, 20261026200000, 20261026210000 applied to dev and prod (prod from `main` after a backup); live site checked. Web only (mobile Goals in the backlog). See Sprint 6 steps. |
| **7** | Investment portfolio | Done | Completed 2026-10-27 (PR #32 merged into `main`). Holdings tracker (not trading), web only: shares, mutual funds and ETFs at the previous close (BSE, AMFI), fixed deposits, tabs per kind, Overview card. Migrations 20261027120000, 20261027180000 and 20261027200000 applied to dev and prod (prod from `main` after a backup); `refresh-prices` deployed on prod, first run ok (AMFI 14,172 and BSE 4,643 loaded, as on dev); live site checked. Mobile Investments in the backlog. See Sprint 7 steps. |
| **8a** | Loans and EMIs | Done | Completed 2026-10-28 (web). Backend PR #34 merged; web page PR #35 (draft, CI green, QA passed). Migration `20261028120000_loans.sql` on dev; prod with the rest of Sprint 8 at the end (PR #35 stays draft until then). Mobile loans in the backlog. See Sprint 8a steps. |
| **8b** | Credit cards and informal borrowing | Done | Completed 2026-10-28 (web). Backend draft PR #36 (`sprint-8b`, migration `20261028180000_cards_borrowing.sql` on dev); web box draft PR #37 (`sprint-8b-ui`, stacked on `sprint-8b`). Prod with the rest of Sprint 8 at the end. Mobile cards and borrowing in the backlog. Follow-up in progress: backend on draft PR (`sprint-8b-followup`, stacked on `sprint-8b-ui`, migration `20261028210000_borrowing_details_card_products.sql` unapplied); web step after the owner's go-ahead. Then 8d. |
| **8d** | Statutory dues | Not started | Step 2. Branch from 8b's branch, stacked draft PR. Fills the "Statutory & legal liabilities" box. |
| **8e** | Net worth | Not started | Step 3. Branch from 8d's branch, stacked draft PR. All three liability boxes. |
| **8c** | Cash-flow history and CSV export | Not started | Step 4 (last). Branch from 8e's branch, stacked draft PR. Then the Sprint 8 prod rollout (owner, `docs/deployment.md` 4c): merge the stacked PRs into `main` in order, backup, dry run listing exactly the Sprint 8 migrations, push prod, live check. |
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
| **Phase 2.1 Migration and pgTAP** | Done | Migration 20261024120000 applied to fin-creador-dev 2026-10-24 (the owner's `db push`); 85 pgTAP tests and the 2,239-case parity fixture green in CI on draft PR #21. |
| **Phase 2.2 Shared schemas, loaders and writers** | Done | `packages/schemas` transaction form; `packages/api/src/transactions`: context, page (opaque keyset cursor), totals, history, `saveTransaction`, `voidTransaction`; every write takes a request key. Income page and mobile void moved to `void_transaction`. |
| **Phase 2.3 Web wiring** | Done | `/recurring` page (cost tiles, Due / Needs attention / Coming in 30 days / Ended, Subscriptions / Memberships / Other recurring, archived with Restore, Undo skip); sidebar item live; compact Upcoming card on Income (income only) and Transactions (the type tab), Confirm through the Add dialog. |
| **Phase 2.4 Remove the prototype** | Done | `/dev/transactions`, its demo data and the dev-only sign-in exception removed; unit test (no exception) and E2E against the production build (redirect signed out, 404 signed in). |
| **Phase 2.5 E2E tests** | Done | 7 Playwright journeys in `e2e/transactions.spec.ts` (validation, totals and balances, edit and history, void, double submit, stale edit, search and filters, income edit, production check, cross-user), green in CI on PR #19; screenshots of the final pages only. |
| **Phase 2.5b Expense categories (web)** | Done | Settings → Categories: add, rename (and icon), archive, restore; defaults archivable, never deleted; no duplicate active names; archived categories keep their history. Shared writers in `packages/api`; E2E `e2e/categories.spec.ts` with one screenshot. |
| **Phase 2.6 Mobile** | Done | PR #22: Recurring screen (cost tiles, panels, groups, archived with Restore, Undo skip), rule and skip sheets, Confirm in the Add / Edit sheet, Overview Recurring card and an Activity link. Tested in Expo Go 2026-10-24. |
| **Phase 2.7 Status and PR** | Done | PR #22 merged into `sprint-4-recurring`, then PR #21 into `main` (2026-10-24). |

## Sprint 8a steps

Loans only (owner, 2026-10-27): see Decisions. Web first; mobile in a separate PR.

| **Step** | **Status** | **Notes** |
|----|----|----|
| **8a.1 Domain, schemas and SQL review** | Done | `packages/domain/src/loans.ts` (EMI estimate reusing `emi` from goals.ts, schedule that follows the EMI in use, moratorium interest, default split, progress) and `due-items.ts` (generic reminders, shortfall); `packages/schemas/src/loan-forms.ts` (add / edit loan, pay, will pay later, `LENDERS`); migration `20261028120000_loans.sql`. Approved 2026-10-27 with changes (see Decisions). |
| **8a.2 pgTAP and draft PR** | Done | `supabase/tests/database/loans.test.sql` (posting from bank, cash and other; idempotency; shortfall with and without "Pay anyway"; before tracking; capitalisation once and again after a void; edit / void together; FC034–FC044; direct-write refusals; archive and delete; RLS and anon; user and planned-account deletion) and the generated `loan_dates_parity.test.sql` (`npm run fixtures:loans`); writers `addLoan`, `editLoan`, `setLoanArchived`, `deleteLoan`, `payDueItem`, `editDuePayment`, `voidDuePayment`, `planDueItem`, `clearDuePlan`, `loadPaymentContext` and `loanErrorMessage` in `packages/api/src/loans`; loan accounts filtered from every account loader (`MONEY_ACCOUNT_KINDS`). Draft PR. |
| **8a.3 Dev db push** | Done | Owner pushed to dev 2026-10-27; `npm run db:types` replaced the hand-written entries (generated relationships and `transactions.due_payment_id`). Prod not pushed. |
| **8a.4 Web Loans page** | Done | Draft PR: `/loans-liabilities` (`components/loans/*`), loader and view `packages/api/src/loans/{load,view}.ts`, bell (`components/shell/bell.tsx`, streamed from the app layout), Overview Due soon card, nav tab, E2E `e2e/loans.spec.ts`. Plan: Add loan flow, EMI cards with schedule, pay / will pay later, the shortfall warning with "Pay anyway" (also ahead of time on the EMI card), bell and Overview "Due soon". Helper text for an ongoing loan whose interest was added to the balance: enter the current outstanding as the amount taken. For a capitalised moratorium: "Interest added when EMIs start (estimate X)". Navigation (owner, 2026-10-27): a new tab "Loans & Liabilities" after Investments, route `/loans-liabilities`, the same page title and heading; on narrow screens the nav may show the short label "Liabilities" (nav only), kept compact and reachable (More menu if needed). Page: "Due soon" card and "Add loan" at the top; loan list (lender, type, outstanding, next EMI date and amount, badge Paid / Due / Overdue); archived loans in a collapsed section; empty state "No loans yet" with Add loan. Layout (owner, 2026-10-27): Due soon at the top, then three boxes: "Long-term liabilities" (loans, Add loan, "No loans yet" inside), "Short-term & operational liabilities" (8b) and "Statutory & legal liabilities" (8d), the last two as "Coming next" until built (no new tab). Nav test updated. At most 8 screenshots from CI. |
| **8a.5 Wrap-up and prod** | Done (prod pending, owner) | QA (fincreador-qa role): `supabase/tests/database/loans_qa.test.sql` (84 assertions: posting split, Total available by hand, direct writes, RLS and anon, retries, void / edit together, delete rules, month-end and moratorium dates, capitalised interest once, shortfall boundaries) and `packages/api/src/loans/qa.test.ts`; no application bugs. Amount inputs show digit grouping (`minorToGroupedInputString`, `regroupAmountInput` in packages/domain). Prod steps in `docs/deployment.md` 4c; next is 8b, then 8c and 8d. |

## Sprint 7 steps

Tracker, not trading (owner, 2026-10-27): see Decisions. Web only; mobile in the backlog.

| **Step** | **Status** | **Notes** |
|----|----|----|
| **7.1 Data spike** | Done | `packages/domain/src/market-files.ts` parsers (AMFI `NAVAll.txt`, BSE bhavcopy UDiFF and legacy) with tiny inline fixtures. 26 Oct files: AMFI 14,413 schemes (8,731 on the latest date, 241 NAV 0 / missing, 167 without a usable ISIN, 5 shared ISINs); BSE 5,170 rows (traded securities only; no corporate-action flags). `pg_cron` 1.6.4 available on dev (Free), not installed. |
| **7.2 Domain and SQL review** | Done | Profit / loss in `packages/domain` (4-decimal scaled units and prices, BigInt, one rounding to minor units half away from zero, basis points); migration for `instruments` (shared, client read-only) and `investments` (per user, RLS, column grants, delete only when archived), `search_instruments` (strpos); FC027–FC029; instruments guard trigger (older price date keeps the price, null ISIN keeps the ISIN, source / code / kind fixed). SQL approved 2026-10-27; `supabase/tests/database/investments.test.sql` (71 tests); `saveHolding` writer with double-submit handling. |
| **7.3 Refresh function and schedule** | Done (dev) | Edge Function (service role only in Supabase secrets) loads AMFI and BSE into `instruments` (`last_price`, `price_date`); `pg_cron` schedule after market close; no price history. Every row is validated with the domain parser first; invalid rows are skipped and counted in the log (one bad row would fail a whole batch). Built: `supabase/functions/refresh-prices` (the secret header is the only gate; `verify_jwt = false`), migration `20261027180000_price_refresh.sql` (run log, `pg_cron` + `pg_net`, job `refresh-prices-daily`), pgTAP `price_refresh.test.sql`; dev deploy steps in `docs/deployment.md` 4a. |
| **7.4 Web Investments page** | Done (dev, PR #32) | Built: `/investments` (sidebar link live) with a summary strip (invested, current value, profit or loss with sign, arrow and percent; "Prices as of"; tracking-only note), holdings grouped per instrument (kind chip, total units, weighted average buy price, last price with BSE close / NAV date, value, profit or loss), expandable records with Edit / Archive, tabs (All, Shares, Mutual funds, ETFs, Fixed deposits; `?tab=`) with their own summary and a by-category table on All, badges "Old price" (over 7 days), "Stale, over 30 days" and "Identifier changed, check your units", an archived view with Restore / Delete permanently; Add holding dialog (search via `search_instruments`, then units, buy price, buy date with a live preview); Overview card "Not included in Total available". Writers `setHoldingArchived` / `deleteHolding`, `loadInvestmentsData`, `buildInvestmentsView`, `searchInstruments` (packages/api) with unit tests. E2E `investments.spec.ts` on fictional instruments seeded only in the CI database (`e2e/fixtures/instruments.sql`). Fixed deposits: migration `20261027200000` (pgTAP `fixed_deposits.test.sql`), writers `saveFixedDeposit` / `setFixedDepositArchived` / `deleteFixedDeposit`, the Fixed deposits tab and Add fixed deposit dialog, E2E `fixed-deposits.spec.ts`. |
| **7.5 Wrap-up and prod rollout** | Done | Docs updated (this plan, `docs/next-session.md`, `docs/deployment.md` 4b). After the owner merges PR #32: prod backup, the three Sprint 7 migrations from a clean `main`, the refresh function with its own prod secret and Vault entries, one manual run and the run-log check (`docs/deployment.md` 4a–4b), then the live site check. Screenshots in `docs/design/investments/`. Done 2026-10-27: prod backup, the three migrations, the prod function with its own secret and Vault entries, first manual run ok, live check passed. |

## Sprint 6 steps

No demo-data prototype (owner, 2026-10-26). Web only; at most 8 screenshots for the owner's review.

| **Step** | **Status** | **Notes** |
|----|----|----|
| **6.1 Domain and schemas** | Done | `packages/domain/src/goals.ts`: EMI and total interest (integer/BigInt only), percent of an amount, monthly saving, cost-line sum, upfront amount per type, budget per month, 80% / 100% warnings; tests against independently computed values. `packages/schemas/src/goal-forms.ts`: guided form per type, stored-details check, budget form. |
| **6.2 Navigation** | Done | "Budgets" renamed to "Goals" (`/goals`) in its place after Transactions; the old last "Goals" item removed (web and mobile); `design-spec.md` updated. |
| **6.3 Migration and pgTAP** | Done | `20261026180000_goals_and_budgets.sql` (SQL approved with edits), `supabase/tests/database/goals_budgets.test.sql` (50 tests, green in CI on draft PR #30); applied to fin-creador-dev 2026-10-26 (owner's db push); generated types match. Prod: only from `main` after a backup. |
| **6.4 Writers** | Done | `packages/api/src/goals`: `saveGoal` (target always recomputed; a repeated request key returns the existing goal), `setGoalSaved`, `setGoalArchived`, `setCategoryBudget`; loader and `buildGoalsView` (budgets compared only in the profile currency, else "Set your budget again"); FC024–FC026 messages. |
| **6.5 Web Goals page and Overview** | Done | `/goals`: Planned expenses (guided form per type with live figures, "Amount to save upfront", EMI and rounding note, disabled "AI insights: coming soon" card, saved amount, archive and restore) and Monthly budgets (donut, per-category progress, Near limit / Over budget). Overview: Monthly budget and Your goals cards on real data; Goals nav item live. |
| **6.6 E2E, screenshots, PR** | Done | `e2e/goals.spec.ts` (6 journeys incl. permanent delete, cross-user, 720px-high dialog fit, card overflow); 5 screenshots in `docs/design/goals/`; draft PR #30 green. |
| **6.7 Density pass and follow-ups** | Done | Web density (14px root, denser type scale, 36px controls, 232px sidebar, 56px top bar); Wheeler type (`vehicle`: bike, car, HMV) with make and model suggestions; state and country lists for trips, city suggestions; permanent delete of archived goals; `docs/quarterly-list-refresh.md`. Migrations 20261026200000 and 20261026210000 applied to dev. |

## Sprint 5 steps

No demo-data prototype (owner, 2026-10-26): built on real data with real loading, empty, error and success states; budget and goals stay "Coming soon". Web only.

| **Step** | **Status** | **Notes** |
|----|----|----|
| **5.1 Deployment guide** | Done | `docs/deployment.md`: separate production Supabase project, Vercel env vars (public URL and publishable key only), redirects, weekly backups, upgrade checklist. |
| **5.2 Domain** | Done | `packages/domain/src/dashboard.ts`: Monday weeks, periods, comparisons over the same elapsed days, change in basis points, buckets, top 5 categories; unit tests. |
| **5.3 Migration and pgTAP** | Done | `20261026120000_dashboard_breakdown.sql` (one read-only function), `supabase/tests/database/dashboard.test.sql` (24 tests), green in CI on draft PR #25; applied to fin-creador-dev 2026-10-26 (owner's db push); types regenerated. |
| **5.4 Loader and web Overview** | Done | `packages/api/src/dashboard` (URL period, breakdown loader, Transactions links); Overview: cards with comparisons, spending and income-vs-expenses SVG charts with table alternatives and partial-month labels, top categories, recent transactions, the Recurring card (backlog item done); budget and goals "Coming soon". |
| **5.5 E2E, screenshots, PR** | Done (PR #25 merged) | `e2e/overview.spec.ts` green in CI on draft PR #25; screenshots in `docs/design/dashboard/`. Next: owner's screenshot review, then the first Vercel deploy (`docs/deployment.md`). |
| **5.6 Chart types** | Done (PR #26 merged) | Spending overview and Income vs expenses: Bar or Line; Spending by category: Bars or Pie (donut). Choice kept in the URL (`spending`, `flow`, `categories`), carried across periods and the custom range. |
| **5.7 First production deploy** | Done | PR #27 (test files and `e2e` out of the Next build type check), PR #28 (a `?code` that lands on `/` is forwarded to `/auth/callback`; one callback URL helper). Production Supabase project has every migration; deploy, email auth and Google sign-in checked on the deployed domain 2026-10-26. |

## Sprint 4 steps

Same two phases as Sprint 3 (owner, 2026-10-23): Phase 1 is a prototype on demo data with no database changes; Phase 2 builds the real feature (web first, mobile in its own PR).

| **Step** | **Status** | **Notes** |
|----|----|----|
| **Phase 1. Web prototype** | Done (owner review pending) | `/dev/recurring` on in-memory demo data (development only; dev sign-in exception in `lib/auth/routes.ts`), shared `components/recurring/upcoming.tsx`, `packages/domain/src/recurrence.ts` with unit tests, 8 screenshots in `docs/design/recurring-prototype/`. |
| **Phase 2.1 Migration and pgTAP** | Done | Migration 20261024120000 applied to fin-creador-dev 2026-10-24 (the owner's `db push`); 85 pgTAP tests and the 2,239-case parity fixture green in CI on draft PR #21. |
| **Phase 2.2 Shared loaders and writers** | Done | `packages/schemas` rule, confirm and skip forms; `packages/api/src/recurring`: loader, `buildRecurringView` (panels, groups by key, cost tiles), writers with request keys; FC018–FC023 messages; types regenerated. |
| **Phase 2.3 Web wiring** | Done | `/recurring` page (cost tiles, Due / Needs attention / Coming in 30 days / Ended, Subscriptions / Memberships / Other recurring, archived with Restore, Undo skip); sidebar item live; compact Upcoming card on Income (income only) and Transactions (the type tab), Confirm through the Add dialog. |
| **Phase 2.4 Remove the prototype** | Done | `/dev/recurring`, its demo data, the nav preview and the dev sign-in exception removed; unit test and E2E (redirect signed out, 404 signed in). |
| **Phase 2.5 E2E tests** | Done | Green in CI on draft PR #21. `e2e/recurring.spec.ts`: due and confirm with a changed amount, cost tiles, skip and undo, archive and restore, needs attention and fix, double confirm, income-only card, cross-user, production check. |
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
| **2026-10-22** | ~~Wordmark is lowercase "fincreador" as in the Figma ("fin" white, "creador" lime on dark; both ink on light). Screen readers hear "Fin Creador"; titles, emails and body text keep "Fin Creador".~~ Superseded on 2026-10-26 below. | Owner's decision; reverses the earlier "FinCreador". Lime stays off light backgrounds (contrast). |
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
| **2026-10-24** | Recurring SQL review (owner): a matching archived "Subscription" / "Membership" takes the key too and stays archived (an active one is preferred); occurrence dates are computed on `timestamp` so the session time zone never matters; a rule with linked entries can't be deleted (`ON DELETE NO ACTION`). A parity fixture generated from `packages/domain/src/recurrence.ts` (`npm run fixtures:recurrence`) is checked by the unit tests and by pgTAP. A posted occurrence is two columns on `transactions` (rule and occurrence date), so "once among non-voided entries" is one partial unique index. | Same answer in TypeScript and SQL; no orphaned entries. |
| **2026-10-24** | Voiding an entry confirmed from a recurring item is done on the Transactions page like any entry; the occurrence then shows as due again. The Recurring page has no "Void last" button (the prototype had one). | One place to void; no second void path. |
| **2026-10-26** | The product name is written "FinCreador" (capital F and C, one word) wherever people read it: UI text, page titles, emails, the mobile app name, docs, comments and screen-reader text. Wordmark "Fin" + "Creador": on dark, Fin white and Creador lime; on light, both ink. Technical identifiers (package names, repo and folders, the `fincreador://` scheme, bundle ids, env vars, URLs, the Supabase project name) are unchanged. | Owner's decision; supersedes the lowercase wordmark of 2026-10-22. |
| **2026-10-26** | Hosting (owner): MVP runs on Vercel Hobby and Supabase Free, for my own use and invited testers only: no payments, no paying customers, no public commercial launch (Vercel Hobby is non-commercial personal use only). Upgrade to Vercel Pro and Supabase Pro only when the product is complete and QA is passed, and before any commercial use. Free-tier limits: Supabase Free has no automatic backups or point-in-time recovery, pauses after 1 week of inactivity, 500 MB per project, 2 active projects. Until the upgrade, take a manual backup of the MVP database weekly and before every migration. | Stays within the free tiers' terms until a commercial launch; manual backups cover the missing automatic backups. |
| **2026-10-26** | Sprint 5 dashboard (owner): periods Week (Monday to Sunday), Month, Year and Custom (no Day). Each compares the days so far with the same elapsed days of the previous period ("vs same days last month"); a custom range with the same number of days just before it. Changes in integer basis points; "—" when the previous value is 0; savings rate "—" when income is 0. Totals in the profile currency only (total balance = active accounts' balances); other currencies get a one-line note, never summed. Totals come from `transaction_summary`; chart and category breakdowns from one read-only, security-invoker function `dashboard_breakdown` on `transactions_matching` (by day up to 62 days, else by month). Category chart: top 5 plus "Everything else"; archived categories keep their history. Charts are plain SVG with the tokens, 12px minimum text, not colour alone, each with a text or table alternative. Recent transactions: the last 5 from `list_transactions`, any period. | Aggregating in the database avoids paging a year of entries on every load (and over mobile networks); one source for totals keeps the dashboard equal to the Transactions page. |
| **2026-10-26** | Web UI density (owner): 14px root on web (rem sizes 12.5% smaller), web type scale 12/13/14/16/18/22/28/32/38px (never below 12), radii 8/12/16, controls 36px (primary 40px), sidebar 232px, top bar 56px. Shared tokens keep their sizes for mobile, except the web-only shell sizes. Dialogs with many fields keep a sticky footer and scroll inside; the Trip form fits a 720px-high window. | A calmer, more compact app; 12px minimum text kept. |
| **2026-10-26** | Dashboard chart types (owner): Bar or Line for charts over time (Spending overview, Income vs expenses); Bars or Pie for Spending by category. No pie over time (one slice per day or month hides the trend). The choice lives in the URL only (no profile setting, no migration); defaults are bar charts and bars. Pie slices follow the legend order, which gives name, amount and share; two lines differ by dash as well as colour. | Each type only where it reads correctly; nothing to store. |
| **2026-10-26** | Sprint 6 goals and budgets (owner): one Goals page and route (`/goals`) with Planned expenses and Monthly budgets. A goal's saved amount is entered by the person, not linked to accounts. Planned-expense types Trip, Wheeler (stored `vehicle`: bike, car or HMV; renamed from `car` in migration 20261026200000), House, Furniture, Electronics, Mobile, Other with short guided forms; trip places from complete lists (Indian states and UTs, countries other than India); city, vehicle make and model from suggestion lists that accept any typed value (names only, no prices); answers stored as versioned JSON (`details`, object only, size capped in the database; shape per type in `packages/schemas`). The app does exact arithmetic only (no price data, no estimates): money in minor units, interest in basis points, tenure in months, one rounding rule (exact, then half away from zero once). The target is the "Amount to save upfront" derived from the answers (trip: cost lines; vehicle: cash price + extras, or down payment + extras, or extras on a full loan; house: as car without extras; items: price in cash, 0 on EMI), entered only for Other; every write recomputes it. Monthly saving: what is left ÷ months from this month to the target month, both counted; no target date assumes 12 months (shown); a past target month needs everything now. Budgets: one amount per expense category from a month onward (latest row at or before the month applies, 0 ends it), only this month or later; warnings at 80% and 100% inside the app on the page and the Overview. Currency: goals keep their creation currency; budget rows take the profile currency on every write; clients show only rows in the profile currency. An archived goal can be deleted permanently after a confirmation (migration 20261026210000: delete grant and an owner-and-archived RLS policy); no other table gets client delete. Each goal shows a disabled "AI insights: coming soon" card (the AI API comes in its own sprint). Web only; mobile in the backlog. | Exact, explainable figures from the person's own numbers; past months keep their budgets; structured answers let later insights read them safely. |
| **2026-10-26** | First production deploy (Vercel Hobby, Supabase Free) works, including Google sign-in. Vercel `NEXT_PUBLIC_*` variables are added with type **Config**, not Secret. The production Supabase redirect allow list uses the pattern `https://<your-app>.vercel.app/auth/callback**`, because the app adds a query string (`next`) to the callback URL. Every new migration goes to both dev and prod; prod only from a clean `main` checkout, after a manual backup. No real project refs or URLs in the repository. | `NEXT_PUBLIC_*` values are public and bundled into the browser anyway; an exact callback entry without `**` rejects the redirect. Dev and prod must never drift in schema. |
| **2026-10-27** | Sprint 7 investments (owner): a holdings tracker, not trading: no buy/sell transactions or ledger. A record is an instrument (BSE share or AMFI mutual fund), units, buy price per unit and buy date; several records per instrument, grouped in the UI. The only calculation is profit / loss (units × latest price − units × buy price) in rupees and basis points. Archive / restore / permanent delete only when archived, like goals. INR only; not linked to accounts or Total available. Shared `instruments` table (latest price and date only, written by the service role); no price history; no split / bonus / dividend handling (backlog). | Narrows the Sprint 7 scope above (no custom assets, fees or manual valuations in this sprint). ETFs as their own kind and fixed deposits were added later in the sprint (rows below). |
| **2026-10-27** | Sprint 7 market data (owner, after the spike): instruments keyed by (source, code); ISIN non-unique, null when junk; each record keeps `isin_at_entry` and the UI says "identifier changed, check your units" when it differs (skipped when null); no remarks-based badge. Load AMFI schemes with NAV above 0 and BSE rows with INE / INF ISINs, excluding government securities and debt series F / G (counts logged). A NAV of 0 or missing never overwrites a price; 5–8 decimal NAVs round to 4, half away from zero; a missing column stops the run and keeps old prices; a day without a file is logged as "no file", not a failure. Rows are never deleted; search offers prices at most 30 days old; holdings always show their price date, with "Old price" after 7 days. One refresh a day at 07:00 IST (`30 1 * * *` UTC) for the previous day's closes. Valuation only in `packages/domain`, none in SQL. | Market-data licence review added to the upgrade checklist in `docs/deployment.md`. |
| **2026-10-27** | Sprint 7 step 7.4 (owner, replaces the 30-day "no current price" rule): every holding is valued at its last known price whatever its age; the price date is always shown, with "Old price" after 7 days and "Stale, over 30 days" after 30 (`priceAge` in `packages/domain`). /investments has tabs All, Shares, Mutual funds, ETFs, Fixed deposits (`?tab=`), each with its own summary; All adds a by-category table; the Overview card shows the four category lines. Fixed deposits: see the next row. | No unpriced banner or not-counted branch. |
| **2026-10-27** | Sprint 7 fixed deposits (owner approved the SQL and formulas): per-user `fixed_deposits` (migration `20261027200000`) in the goals style: bank 1–80, optional label 1–40 (blank is none), principal in paise up to 10^13, rate 0–2500 bp, compounding monthly / quarterly / half-yearly / yearly (quarterly default), start not in the future (FC031), maturity after start and at most 10 years later, edit in place, archived locked except restore (FC030), delete only when archived. Values only in `packages/domain/src/fixed-deposits.ts`: whole periods of calendar months from the start (month-end clamped) compound by (1 + r/(10000·n)); the partial last period earns simple interest B·r·d/(365·10000); exact rationals rounded once to paise, half away from zero; capped at maturity. On the Investments page: invested = principal, value = worth today, profit = interest so far. | Not linked to accounts or Total available; INR only. |
| **2026-10-27** | Sprint 7 wrap-up (summary of the rows above): (1) a tracker, not trading: records and fixed deposits only, no ledger, not in Total available, INR only; (2) sources: AMFI `NAVAll.txt` for mutual funds and the BSE bhavcopy for shares and ETFs (NSE files only after a licence check); (3) prices are the previous close, refreshed once a day at 07:00 IST by `refresh-prices` and labelled "BSE close" / "NAV" with their date, never live; (4) fixed deposits: whole calendar-month periods from the start (month-end clamped), simple interest for the partial last period on a 365-day year, one rounding, at most 10 years; (5) last-known-price rule: every holding is valued at its last price whatever its age, with "Old price" after 7 days and "Stale, over 30 days" after 30; (6) per-kind tabs: All (holdings and deposits, by-category table), Shares, Mutual funds and ETFs (each adds and searches only its own kind), Fixed deposits. | One place to read Sprint 7's rules before Sprint 8 (net worth will need to decide whether investments count). |
| **2026-10-27** | Sprint 8 split (owner): 8a = loans only (add loan, schedule, EMI payments that move money, insufficient-funds warning, in-app reminders); 8b = credit cards and net worth; 8c = cash-flow history and CSV export. Each is its own PR and prod push. | Smaller releases; 8a's due-item model is generic so 8b reuses it. |
| **2026-10-27** | Sprint 8a add loan (owner): "Add loan" → type (Home, Vehicle, Personal, Education, Gold, Business, Consumer / EMI, Loan against property or securities, Credit card EMI, Other with a description) → lender type-ahead (`LENDERS`: banks, small finance banks, housing finance companies, NBFCs, card issuers; any name allowed; quarterly refresh) → details: optional nickname, sanctioned amount, amount taken (not above sanctioned), yearly rate typed as text and stored in basis points without floats, fixed or floating (information only), tenure in months, Ongoing or Starts later. Ongoing: outstanding today (not above the amount taken), EMIs left, next EMI date, and "this month's EMI": already paid (recorded as before tracking, never posted; the next EMI is after today) or still due (the next EMI date is this month's, possibly past). Starts later: first EMI date (after today), moratorium months, and interest during it added to the loan (simple interest, posted with the first EMI paid) or paid monthly (an interest-only instalment each month; months already past are before tracking). The EMI is calculated (goals.ts maths, exact, rounded once) and shown as an estimate; the bank's EMI overwrites it and the schedule follows it (a higher EMI finishes early; the last instalment clears what is left). No card or account digits: four digits in a row are refused in the lender and nickname. | Loan amounts, dates and tenure are fixed once added; names, rate, sanctioned amount and EMI can be edited. Archive, restore, delete only when archived and never paid. |
| **2026-10-27** | Sprint 8a payments (owner): each due EMI is paid from any active bank, cash or other account (balances shown): "Paid" (date defaults to today) or "Will pay later" (planned date and account; the EMI stays pending). Paid posts atomically and once per request key: principal as a transfer to the loan's liability account, interest and fees as expenses (system categories "Loan interest" and "Loan fees & charges"), all from the chosen account; the split defaults from the schedule (one month's interest on what is owed) and every part can be edited. A payment may not take the paying account below zero: "You need X more in <account> to pay this EMI", and the person can pick another account; the EMI card shows the same warning in advance. Edits and voids move all parts together. EMIs dated before the loan was added are before tracking and never post. Credit card EMI is a loan type with the same flow; issuer from the same list, optional nickname, rate 0 allowed (EMI = amount / months), a one-time processing fee and GST go in the fees of the first payment. | No double counting: principal is never an expense; a loan account is never in Total available. |
| **2026-10-27** | Sprint 8a reminders (owner): in-app only. The bell and an Overview "Due soon" card show EMIs due tomorrow (within 24 hours; entries have no time of day), due today, overdue, and the day before and on a planned pay date, derived from stored dates (`packages/domain/src/due-items.ts`), no scheduled job. Email, web push and phone push are a later notifications step (backlog). | |
| **2026-10-27** | Sprint 8a SQL review (owner, changes): (1) a shortfall is a warning, not a block: `pay_due_item` and `edit_due_payment` take `p_allow_shortfall` (default false); without it FC035 (detail = shortfall) is raised, and "Pay anyway" sends the same request key again with it; this replaces "may not take the paying account below zero" above. (2) Deleting a planned account clears the whole plan (date and account). (3) Account names need not be unique; a loan account is named after the nickname or lender and shown as "<name> (loan)" in lists. (4) `loan_category_id` adopts an archived same-name category (restored) and never returns null. (5) SQL due dates come from one function, `loan_due_date`, checked against the domain by a generated parity test. (6) Loan accounts are never in Total available, account pickers, the Accounts page or balances. Optional parameters of `create_loan` and `update_loan` come last, with defaults. | Approved 2026-10-27. |
| **2026-10-27** | Sprint 8 due items (owner): one generic model for anything due on a date and paid from an account (`due_items` + `due_payments`): due date, amount due, optional minimum due, status (pending, paid, before tracking), planned pay date and account, paying account, the atomic idempotent posting, the shortfall refusal, the in-app reminders and the Due soon card. Loan EMIs and moratorium interest in 8a; card bills in 8b add only the card-specific parts (see Sprint 8b). | 8a must not block 8b. |
| **2026-10-27** | Liability boxes (owner): the Loans & Liabilities page (capital L) has three boxes: Long-term (loans, 8a), Short-term & operational (credit card dues and EMIs, informal borrowing: 8b), Statutory & legal (income tax payable, fines, unpaid e-challans: 8d). 8b adds informal borrowing (liability account, optional due date, part payments as transfers, interest as an expense); new 8d statutory dues (type, amount, due date, paid / unpaid, reminders; payment is an expense, not a transfer). Net worth counts all three boxes. Never store card numbers or any digits of cards or accounts. | Same due-item model throughout. |
| **2026-10-27** | Sprint 8a web page (8a.4): loan badge Paid / Due / Overdue, plus "Not due yet" before anything has fallen due (a loan that starts later) and "Closed" once nothing is owed; EMIs left after a loan is cleared show as "Not needed" and never remind. The EMI card warns ahead of time against the planned account, otherwise only when no account can cover the EMI (named after the one with the most money). Loan screens show account names only (no last four digits). Pending schedule rows are estimates from what is owed now. The bell's list streams from the app layout. | Built on the shared view `packages/api/src/loans/view.ts`, so mobile shows the same. |
| **2026-10-28** | Sprint 8 order and rollout (owner): 8b credit cards and informal borrowing, then 8d statutory dues, then 8e net worth (all three boxes), then 8c cash-flow history and CSV export. Each step branches from the previous one's branch (8b from `sprint-8a-ui`); draft PRs stay stacked and unmerged; the owner runs `db push` on dev per approved migration. Prod once at the end (`docs/deployment.md` 4c): merge the stacked PRs into `main` in order, then backup, dry run listing exactly the Sprint 8 migrations, push prod, live check. | Replaces "own PR and prod push" per step and the 8a prod rollout before merging PR #35. |
| **2026-10-28** | Sprint 8b SQL review (owner, approved with changes): liability kinds only in `is_liability_kind` / `LIABILITY_ACCOUNT_KINDS`; card purchases are expenses on the card (recurring too, starting on or after the day the card was added), refunds by void; a statement once per card and date, on or before today, owed measured on its date, the difference posted as an expense only when positive and a category is picked; bill = total − card EMIs ("Card EMIs are paid from the loan row"); one active payment per bill (a part-paid bill closes), plus `pay_card` for any amount up to what is owed (FC047 "record the missing purchase first"); `card_sync_due` marks a bill paid once transfers dated on or after its statement cover it (pending again after a void), `card_bill_paid` / `card_bill_progress` drive "Minimum paid" / "Part-paid" and stop reminders once the minimum is covered; borrowing received into an account (posted) or earlier (owed only), repayments as transfers plus interest as an expense, the due item closes when nothing is owed; archive only at a zero balance (credit included); delete only without history; the difference expense and the money-received entry change only with their statement or borrowing; no digits in issuer, nickname or who you owe. | Error codes FC045–FC051. |
| **2026-10-28** | Sprint 8b web (owner): the "Short-term & operational liabilities" box lists credit cards (owed, limit used with 80% / 100% warnings, latest bill and due date, badges Due, Overdue, Paid, Minimum paid, "Part-paid, X left"), card EMIs (moved from Long-term, with Link to card) and money borrowed from people (what is still owed). Pay card defaults to the pending bill (full, minimum, custom: closes it) with "Other amount" (does not close it until covered). A card is offered only as "<name> (card)" for expenses and recurring expenses, with the limit warning; never in income, transfer or payment pickers, the Accounts page or Total available (`cardAccounts` in the ledger context). Due soon, the bell and the Overview list card bills (until the minimum is covered), borrowing due dates and "Add your <card> statement" (from the day after the statement day). | Shared view `packages/api/src/cards/view.ts`, so mobile can show the same. |
| **2026-10-28** | Sprint 8b follow-up SQL review (owner, approved with changes): `has_digit(text, min_run)` counts every Unicode decimal digit plus superscripts and subscripts, a run may mix scripts (parity with `packages/schemas/src/digits.ts`); card issuer, nickname and who you owe refuse any digit, card product a run of 3, borrowing reason and loan lender / nickname a run of 4 (loans `NOT VALID`: earlier rows untouched). Card product from `CARD_PRODUCTS` (names carry the issuer) or typed under Other; the card account is named nickname, else product ("<issuer> <typed>" for Other), else issuer. Borrowing: relationship (family, friends, others), optional reason, how much to return (≥ borrowed; the extra is interest), and only with a return date: once (seq 0) or 2–60 monthly instalments (seq 1…n, the return day clamped to the end of each month, not chained; floor amounts, the last takes the remainder; interest spread on the cumulative amount, rounded down once per instalment, so it never exceeds an instalment). Each due item names the account it is paid from; nothing moves until the person confirms Paid. Repayments cover items first in, first out (interest first within one); a part-paid item stays pending; all paid once nothing is owed. `set_borrowing_return_plan` (SECURITY DEFINER, own borrowing, locked) rebuilds the items and drops "Will pay later" plans. The paying account is required only by the functions (set null if deleted). Old borrowings backfilled: amount to return = borrowed, a due date becomes a one-time plan. Net worth (8e) counts only principal still owed. | Migration `20261028210000`; CI upgrade check `supabase/upgrade-checks`. The borrowing E2E test is `test.fixme` until the web step. |
| **2026-10-28** | Order after 8b (owner): (1) 8b follow-up (borrowing details, card product list, F1), (2) 8d, (3) 8e net worth, (4) 8c, (5) prod rollout once at the end: backup, merge PRs #35, #36, #37 and the next ones in order, dry run listing exactly the Sprint 8 migrations, push prod, live check. | Scope in "Sprint 8b follow-up" below. |

## Sprint 7 Investments: market data decisions

Mutual funds: AMFI's free daily NAV text file (scheme code, ISINs, name, NAV, date). NAV has 4 decimals and units are fractional, so prices and units need a finer stored scale than paise, with one rounding rule in `packages/domain`, decided at SQL review. Stocks: NSE/BSE end-of-day files and security lists are candidates; redistribution terms unverified, so check before any commercial use (licensed vendor API at the Pro stage); no scraping. Shared read-only instrument and price tables; a scheduled job (`pg_cron` + Edge Function, service role key only in Supabase secrets; verify `pg_cron` on Free) refreshes after market close; keep only the latest close for all instruments and daily history only for instruments users hold (500 MB limit); show 'closing price on <date>'. Holdings are per user with RLS; valuation and gain/loss follow CLAUDE.md.

## Before production (open items)

Development-only settings that must be removed or replaced before any production release (Sprint 12 at the latest):

- **Supabase redirect allow list:** remove `exp://**` (Expo Go) and the `http://localhost:3000/...` entries; keep only the production web URL and the app's own scheme.
- **Dev scripts:** drop `npm run dev:mobile:google` (`apps/mobile/scripts/start-lan-hostname.sh`); it exists only so Google sign-in can return to Expo Go during development.
- **App scheme:** use a fixed `fincreador://` scheme in the release builds (and keep `fincreador://auth/callback` as the only mobile OAuth return address). Remove the Expo Go `exp://` branch in `oauthRedirectUrl` once development builds replace Expo Go.
- **Site URL:** done for the production project (the deployed web URL, 2026-10-26).
- **Migrations:** every new migration goes to dev and prod; prod only from a clean `main` after a manual backup (`docs/deployment.md`).

- **Email sender:** add custom SMTP (Supabase's built-in sender allows only a few emails per hour).
- **Upgrade before commercial launch:** move to Vercel Pro and Supabase Pro once the product is complete and QA is passed, and before any payments, paying customers or public commercial launch. Until then, back up the MVP database manually every week and before every migration.

Pending tests:

- **Google sign-in on iPhone:** the app runs on iPhone in Expo Go 58 (tested 2026-10-22), but Google sign-in has only been tested on Android so far (`npm run dev:mobile:google`).

## Backlog

- **Mobile Investments and Goals:** the Investments page (holdings, fixed deposits, tabs) and Goals (planned expenses, monthly budgets) in the mobile app, reusing `packages/api` and `packages/domain` (web only in Sprints 6 and 7).
- **Splits and bonus issues:** adjust units and buy prices for share splits, bonus issues and fund mergers (Sprint 7 shows "Identifier changed, check your units" only).
- **Interest-payout fixed deposits:** monthly or quarterly payout deposits, where interest is paid out instead of added (Sprint 7 supports cumulative deposits only).
- **More asset types:** recurring deposits, bonds, gold (including sovereign gold bonds) and PPF.
- **Price history and charts:** keep daily prices and show value over time (Sprint 7 stores the latest price only).
- **XIRR:** annualised returns per holding and for the portfolio, with dated cash flows.
- **NSE data:** NSE prices only after reviewing NSE's licence and redistribution terms (see also the upgrade checklist in `docs/deployment.md`).
- **Custom holdings with manual prices:** assets that aren't in the BSE or AMFI files, valued at a price the person enters and labelled as manual.
- **Fuller instrument names:** BSE names are short and upper-case in the file; use a fuller official name where a free source allows it.
- **Quarterly list refresh (recurring, Jan / Apr / Jul / Oct):** refresh the Goals suggestion lists (mainly vehicle makes and models; states, countries and cities only on a real change) following `docs/quarterly-list-refresh.md`: official India manufacturer sites, models on sale in India only, no prices, a diff table with a source URL per change, `LISTS_REVIEWED_ON` updated, one draft PR. Next: January 2027.

- **Notifications step (email, web push, phone push):** EMI and card-bill reminders outside the app (Sprint 8a has in-app reminders only). Needs custom SMTP or a Resend domain, Expo push tokens and web push; reuse the `pg_cron` + Edge Function pattern from `refresh-prices`; never send amounts or account names on a lock screen by default.
- **Ongoing loans with capitalised interest:** Sprint 8a caps an ongoing loan's outstanding at the amount taken; an education loan already in repayment whose moratorium interest was added may owe more. Add an optional "interest added to the loan" field if testers need it.
- **Financial year setting:** optional April–March financial year for "this year" figures (Sprint 2 uses the calendar year).
- **Repeated sign-up email:** see Sprint 10.
- **Mobile category management:** add, rename, archive and restore expense categories in the mobile app (web has it on Settings since Sprint 3; owner, 2026-10-23).
- **Recurring reminders:** notify when a recurring item is due (deferred from Sprint 4; belongs with Sprint 10 notifications, using Supabase scheduling).
- **Overview card heights:** the Monthly budget card's empty state stretches to the height of the chart beside it (layout only).
- **Mobile Overview dashboard:** the Sprint 5 dashboard on mobile, reusing `dashboard_breakdown`, `transaction_summary` and `packages/domain/src/dashboard.ts` (owner, 2026-10-26: web only in Sprint 5).
- **Payee / merchant on entries:** a "paid to" field (the Figma shows merchant names). Not in Sprint 3 (owner, 2026-10-23).
- **Past months of income:** browsing last month and earlier months (Sprint 3: transaction list with date filters; Sprint 5: dashboard periods; Sprint 8: reports). Owner's choice on 2026-10-22: not added to Sprint 2.

# 1. Executive summary

FinCreador is a personal finance platform for recording daily expenses
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

Split into five steps (owner, 2026-10-27; reordered 2026-10-28), in this
order: 8a loans, 8b credit cards and informal borrowing, 8d statutory
dues, 8e net worth, 8c cash-flow history and CSV export. Each step is a
stacked draft PR from the previous step's branch; Sprint 8 goes to prod
once, at the end. The Loans &
Liabilities page has three boxes: Long-term (8a), Short-term &
operational (8b), Statutory & legal (8d). Rules for 8a are in the Decisions log above.

### Sprint 8a — Loans and EMIs

- Add a loan (type, lender, amounts, rate, tenure, Ongoing or Starts
  later with a moratorium), with a calculated EMI the person can
  overwrite, and its schedule.

- Pay each EMI from an account or cash, or plan it ("Will pay later");
  principal is a transfer to the loan's liability account, interest and
  fees are expenses; refused with "You need X more in <account>" when the
  balance is too low.

- In-app reminders: the bell and the Overview "Due soon" card.

- Credit card EMIs are loans of type "Credit card EMI".

### Sprint 8b — Credit cards and informal borrowing

Built on 8a's due items (`due_items`, `due_payments`): due date, amount
due, minimum due, status, planned pay date and account, the posting,
the shortfall refusal, reminders and Due soon need no new mechanism.
8b adds only the card-specific parts:

- Add a card: issuer (the `LENDERS` list), optional nickname, never any
  card digits, credit limit, statement day, due day, and the opening
  amount owed (not posted to any account). A card is a liability
  account (a new account kind, like a loan's).

- Card purchases are expenses from the card account and raise the
  amount owed. Paying the bill is a transfer to the card's liability
  account, never an expense.

- Enter a statement (total due, minimum due, due date) as a due item of
  kind `card_bill`. Pay in full, the minimum or a custom amount; the
  unpaid rest stays owed.

- If the statement total is higher than what is logged as owed, offer to
  record the difference as an expense (the person picks the category)
  before paying.

- Card EMIs are tracked as loans (8a), so bill payments exclude amounts
  already tracked as card EMIs, to avoid deducting them twice.

- Utilisation warnings at 80% and 100% of the limit.

- Informal borrowing (friends, family, third parties): a liability
  account named after the lender (a name only), the amount borrowed, an
  optional due date (a due item, so Due soon and the bell remind), part
  payments as transfers to the liability account, interest (if any) as
  an expense. Shown in the "Short-term & operational liabilities" box
  with credit card dues and card EMIs.

### Sprint 8b follow-up (owner, 2026-10-28; before 8d)

New migration only (never edit an applied one); SQL shown to the owner before applying.

- Borrowing: "Borrowed from" name plus a relationship (Family, Friends,
  Others); "Borrowed for" short reason (no run of 4 or more digits);
  received into any account (Cash in hand offered explicitly) or already
  received earlier; "How much to return" with "Same as borrowed" (the
  extra is interest or a charge, planned from the start, posted as an
  expense when repaid); optional return date, and only then "How will you
  return it?" (one payment on that date, or instalments: open question,
  ask the owner first); reminders use the return date. Columns
  relationship, reason, amount_to_return_minor and the return plan, with
  checks, RLS, grants and guards like the other borrowing columns.

- Credit cards: Add card asks issuer, then card product (e.g. HDFC
  Regalia), with "Other" typed; the nickname stays optional, shown only as
  "Label if you hold two of the same card" (no digits). List of cards in
  India in `packages/schemas/src/card-data.ts` with `LISTS_REVIEWED_ON`,
  from issuers' own pages only (sources cited in the docs, not the app),
  refreshed every quarter (January, April, July, October) through
  `docs/quarterly-list-refresh.md`.

- F1 (QA): the database refuses digits from other scripts too
  (full-width, Devanagari, Arabic-Indic) in card issuer, nickname and who
  you owe; pgTAP for each; the QA TODO becomes a normal test.

- Unchanged: card statements and bills, and Pay card.

### Sprint 8e — Net worth (after 8d)

- Net worth: included assets minus included liabilities, with valuation
  dates; liabilities from all three boxes (long-term loans, short-term
  and operational: cards and informal borrowing, statutory and legal:
  unpaid statutory dues from 8d); decide whether investments
  and fixed deposits count. Liabilities must include capitalised moratorium
  interest not yet posted (it is posted with the first EMI paid).

### Sprint 8c — Cash-flow history and CSV export

- Cash-flow history over months; browse past months of income.

- CSV export with date filters; PDF only if time permits.

### Sprint 8d — Statutory dues

- The "Statutory & legal liabilities" box: income tax payable, fines and
  unpaid e-challans, and other statutory dues.

- Each due: type, amount, due date, paid or unpaid, and reminders (a due
  item, so Due soon and the bell need no new mechanism).

- Paying a statutory due is an expense from the chosen account (a
  category per type), not a transfer: there is no liability account.
  Unpaid dues count in net worth.

- No challan, vehicle, PAN or card numbers: names and amounts only.

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
