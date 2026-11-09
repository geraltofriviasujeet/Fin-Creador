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
Last updated: 2026-11-06 (10.1, the opening greeting and 10.2 merged; loose category matching on `sprint-10-roma-category-match`.)

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
| **8a** | Loans and EMIs | Done, on prod | Completed 2026-10-28 (web). Backend PR #34 merged; web page PR #35 (draft, CI green, QA passed). Migration `20261028120000_loans.sql` on dev; prod with the rest of Sprint 8 at the end (PR #35 stays draft until then). Mobile loans in the backlog. See Sprint 8a steps. |
| **8b** | Credit cards and informal borrowing | Done, on prod | Completed 2026-10-28 (web). Backend draft PR #36 (`sprint-8b`, migration `20261028180000_cards_borrowing.sql` on dev); web box draft PR #37 (`sprint-8b-ui`, stacked on `sprint-8b`). Prod with the rest of Sprint 8 at the end. Mobile cards and borrowing in the backlog. Follow-up done 2026-10-28 (web): backend draft PR #38 (`sprint-8b-followup`, migration `20261028210000_borrowing_details_card_products.sql` on dev), web draft PR #39 (`sprint-8b-followup-ui`, stacked on #38), CI green, QA passed. Prod with the rest of Sprint 8. Next: 8d from `sprint-8b-followup-ui`. |
| **8d** | Statutory dues | Done, on prod | Completed 2026-10-28 (web). Backend draft PR #40 (`sprint-8d`, migration `20261028230000_statutory_dues.sql` on dev), web draft PR #41 (`sprint-8d-ui`, stacked on #40), CI green, QA passed. Prod with the rest of Sprint 8. Mobile in the backlog. |
| **8e** | Net worth | Done, on prod | Completed 2026-10-28 (web). Draft PR #42 (`sprint-8e`, stacked on #41), no migration. Overview "Net worth" card (own Suspense) from `netWorth` in `packages/domain/src/net-worth.ts`, loaded by `loadNetWorthData` (one `account_balances` read). Prod with the rest of Sprint 8. Mobile in the backlog. Next: 8c from `sprint-8e`. |
| **8c** | Cash-flow history and CSV export | Done, on prod | Completed 2026-10-29 (web). Backend draft PR #43 (`sprint-8c`, migration `20261029120000_account_balances_at.sql` on dev), web draft PR #44 (`sprint-8c-ui`, stacked on #43), CI green, QA passed. `/reports`: range bar, cash flow per month (chart and table, top 5 categories, links to Transactions), net worth trend (excluding shares, funds & ETFs, today with them beside it), CSV export form. Phone tab bar: four tabs and More (Income, Recurring, Loans & Liabilities, Reports). Export cap 10,000 rows and `maxDuration` 15 s kept: 10,000 rows took a median 348 ms in CI. Prod with the rest of Sprint 8. Mobile in the backlog. Deployed to prod 2026-10-29 with the rest of Sprint 8 (see the Sprint 8 rollout decision). |
| **9** | Statement import | Done | Completed 2026-11-05 (web): 9a card statement PDFs (PR #46), 9b bank statements, PNB PDF and CSV (PR #47), 9c refunds (PR #48), 9d generic bank reader (PR #49), all merged into `main`; 9d deployed. Excel (.xlsx) and the SBI layout in the backlog; statement import on mobile in the backlog. |
| **9a** | Credit card statement import (PDF) | Done (web) | Completed 2026-11-04; PR #46 merged into `main`. Steps 9a.1–9a.5 (owner, 2026-10-29) on `sprint-9a`, draft PR #46, CI green. Done: 9a.1 shared reader (`packages/domain/src/statements.ts`, with bank-ready pieces: balance, DR/CR column, UPI payee, balance chain); 9a.2 generic parser (`statement-generic.ts`) and PNB parser (`statement-pnb.ts`, `parseCardStatement` picks by issuer); "Punjab National Bank" in `CARD_ISSUERS` (name only); migration `20261029180000_bank_charges_category.sql` (system category "Bank charges & interest", not on dev yet: owner db push); difference picker defaults to it, no Archive for system categories; 9a.3 PDF read in the browser on `/loans-liabilities/import?card=<id>` (pdfjs-dist 6.4.299 legacy build, on demand, bundled worker, 10 MB / 30 pages, password in component state only, read-only preview); 9a.4 review (ticks, editable date / amount / category, bulk category, possible duplicates unticked, Already imported not tickable, skipped and unreadable notices, self-check reasons with a confirm, ticked vs bill total, Enter statement prefill or lines only; keys UUID v5 of the parsed line); 9a.5 save (confirm dialog, chunks of 10 lines each saved on its own through `record_transaction` under a server-recomputed key, then `enter_card_statement` once per card and date with any difference in Bank charges & interest; an imported key follows its edits to the latest version (batched reads, at most 20 edits, beyond that "Already imported") and is "Already imported (deleted)" when that version is voided; Save again finishes a cut-off import; a session ended mid-save says "Sign in again; your file is still here" and keeps the review). QA run 2026-10-29: edit-chain bug, signed-out save and phone-width test fixed. Real-PDF fixes (2026-10-29, synthetic fixtures): rows merge cells drawn slightly above or below and wrapped details (column by column, top line first, overprinted text once), and the whole Network/Last 4 Digit cell is dropped (digits or `#`/`X`/`*` masks); unreadable rows show their page, row and a masked shape ("date, text, no amount"); "Check statement dates" when the due date is before the statement date; Save with no line ticked enters the statement only. The statement date comes only from the Invoice Date label (beside it, after the last of the labels on its row, or in a values-only row under the label row with one value per label; a date field takes only a date), never a guess: else the field is empty with "Couldn't read the statement date; enter it" and Save waits for it. Real PNB layout (owner, text description; synthetic fixture `pnbRealLayoutPages`): debits have no marker (Dr also read), credits end in Cr, a missing marker never makes a row unreadable; box values may be whole rupees; the network group ("RUPAY -" and the last 4 digits, one piece or two, either order) is dropped between the dates and the details; lines stop at Total Purchase or End of Statement; a third self-check compares debit lines with Purchases and other charges. Issuers (owner): any card may pick a file; a PNB card's file that can't be read (scan, photo, wrong password, no text, nothing found) gets "We couldn't read this file..."; another issuer's statement is reviewed with the general reader only when it verifies itself (total found, summary and debit-lines checks pass; the general reader now makes both checks when the summary is printed beside its labels), with the note "Read with the general reader; compare the lines with your PDF.", else "We can't read [issuer] statements yet..." with no review and no Save. A new pick or a cleared input drops the previous result at once (a read counter drops late results). Real-file fixes (2026-11-04, synthetic fixtures with the real shapes): "Copy layout" under the unreadable rows (masked: page, row, and per piece kind, x, width, characters, dy; no text or digits); small print (under half or over twice a row's width per character) never joins a row, and a short piece such as Cr takes the nearest baseline; the import page starts empty for each card; the file picker names the issuer only. Web fonts self-hosted (Fontsource), no Google requests. Known limitations: two tabs saving the same lines at once can both report "saved" (each line is still posted once); any parser change that alters a line's parsed values gives it another key, so a line saved before the change shows as a Possible duplicate rather than Already imported (seen after the wrapped-row fix). |
| **9b** | Bank account statement import (PDF, CSV) | Done (web) | PR #47 merged into `main`, no migration. PNB savings PDF parser and CSV (columns by name: date, description, amount with DR / CR or debit and credit columns, balance; no Excel) in `packages/domain/src/statement-bank.ts`; nothing above the column header and no instrument, cheque or reference number kept; UPI payee only. Review at `/income/import?account=<id>` (Import statement in a bank account's menu), on the parts shared with 9a (`statement-shared.tsx`). Debits ticked as expenses; credits unticked until labelled (income with a source, transfer from an own account, refund, skip); card payment on debits only, through `pay_card`; transfers post as transfers. Already imported by key (entries and card payments) or by a transfer already recorded from the other account; Possible duplicate by date, amount and direction. Payee labels offered within one file (memory only). Balance chain and the statement's opening / closing gate Save; the app's balance vs the closing is a soft warning. 3,000 lines a file, 100 a page with filters, saved in chunks of 10. Matches count occurrences: N recorded transfers (or entries) with the same date, amount and direction mark only the first N identical lines; further lines stay new and tickable. Known limitations: refunds are skipped (no negative expense in the ledger; separate work, see Refund import in the Backlog); importing both sides of a transfer in two tabs at the same moment can post it twice (importing them one after the other is caught by the review); when the two banks book a transfer on different days, it is not matched and can post twice. |
| **9c** | Refunds (import and manual entry) | Done (web) | PR #48 merged into `main`; migration `20261104120000_refunds.sql`. Entry type `refund`: a positive inflow in an expense category, optionally linked to the purchase it reverses (`refund_of_id`). Spending nets refunds (transaction_summary, dashboard_breakdown, so budgets and Reports); balances, a card's owed amount and statements count them; a card may go into credit (an asset in net worth, never in Total available). Linked refunds capped at the purchase (live rows only); a voided purchase keeps its refunds and their link clears; an edited purchase takes its links along. Both importers: refund lines tickable with a category, linked when a purchase has exactly that amount left (else a picker or none). Web: Refund in the add form, Refund this on an expense, a Refunds tab, categories below zero listed apart on the Overview, charts drawn at zero, budgets count it as nothing spent. Mobile shows and edits refunds; adding one on mobile is in the backlog. Known limitations: suggestions are exact-amount only (part refunds are picked by hand); two refunds linked to one purchase in one review can pass the picker and the second is refused at save (FC055); a refund's link can't be changed after it is saved (void and add again). |
| **9d** | Generic bank statement reader (PDF, CSV) | Done (web), deployed | Completed 2026-11-05; PR #49 merged into `main` and deployed, no migration. QA passed (synthetic fixtures; masked row layout tested to carry only kinds and geometry). `packages/domain/src/statement-bank-generic.ts`: any bank's table read by structure (header naming a date, a description, debit and credit columns or one amount column with or without Dr / Cr, and a balance; synonyms such as Narration / Particulars, Withdrawal Amt. / Debit, Closing Balance, Txn / Post / Value date). PDF cells placed under headers by x position (`pdf-rows` now gives each cell's x range). Repeated headers, footers, totals skipped; wrapped descriptions joined. Accepted when opening + credits − debits = closing (when printed), else when the balance chain holds on every row after same-date reordering; otherwise the honest unreadable message. The chain only flags rows (listed as unreadable, not saveable, Save needs the check). PNB and the 9b CSV reader stay first (`readBankStatement`). A row with no date but an amount and a balance takes the date of the row above (date printed once per day). A row with no date and no amount joins the description above only when its text sits in the description column; other such rows (a page's customer block, legal text, text in an amount column) are skipped, not reported. A row is unreadable only when it has an amount or a date that can't be used. Opening / closing / carried-forward labels are found anywhere in a balance-only row. Total rows and lone page numbers are skipped; when the totals reconcile, a row printed without a date is not reported (it can't be a missed line). After a header, Copy layout shows the header row and the rows under it, each with what became of it. A file no reader can read shows Copy layout on the message: why the generic reader gave up (no header row and the closest row's missing column, no lines, dates out of order, reconciliation failed, balances don't follow) and the masked layout of the first 30 rows (and the closest header row), never text or digits from the file. Known limitations: a scanned PDF has no text; a page footer printed one line below the last row can merge into it. |
| **10a** | Clarity pass (web) | Done (web) | Completed 2026-11-05; PR #51 merged into `main` (merge commit 5e6c3d5), migration `20261105120000_entry_repeat.sql` (dev and prod by the owner's db push; check `supabase migration list --linked`). "Repeat this?" (Just once, Every month, Every year) on add income and add expense: `record_entry_with_repeat` creates a recurring rule starting on the entry date and confirms its first occurrence as the entry, in one call; a back-dated start makes the later dates due on Recurring (nothing posts by itself). Income page: three cards (Income this year, Money in banks with an "N accounts" list, Cash in hand), a small Rental income card only when rent came in this year; "Income by source" shows "₹X this month" and "₹Y this year", and a rate ("₹X every month") only from the source's active recurring rules (one line per rule, at its current amount); Total available shows under "Where your money is" only when it differs from Money in banks. Overview: four cards, always this month (Money left, Income this month, Spent this month, Savings rate); the period switcher now applies to the charts only. Sign-out after 2 hours without activity in any tab, with a one-minute warning (the server's `IDLE_LIMIT_MS` may only shorten it and is ignored on a Vercel production deployment; the E2E run uses 20 s on a second server), through `/auth/idle-sign-out` (Supabase `signOut`, this browser only) and the reason on the sign-in page. Wording: topbar "Add expense" with a menu (Add income, Transfer, Refund); the page stays "Transactions"; no database names changed. Mobile unchanged (backlog). |
| **10** | Roma, the AI assistant | In progress | Plan approved 2026-11-05 (steps 10.1–10.8, see Sprint 10 below). 10.1 in progress on draft PR #53: migration `20261105180000_roma_usage.sql` (approved, on dev), app code: provider abstraction (Anthropic SDK 1.1.0, mock), `POST /api/ai/chat`, `spending_for_period`, figure check, Settings toggle, Roma page; unit tests and E2E on the mock provider. 10.1 merged (PR #53). Owner follow-up merged (PR #54): static opening greeting and Enter to send. 10.2 merged (PR #55, no migration): `income_vs_expenses`, `savings_rate`, `category_breakdown`, `search_transactions`, `account_balances`, `net_worth`, `loans_and_cards`, the descriptions notice in Roma, and a Settings toggle that withdraws or gives description consent while Roma stays on; unit tests, pgTAP and E2E on the mock provider. Follow-up: `category_breakdown` and `search_transactions` match a category asked for by part of its name (shared `matchCategories`). 10.3 in progress on a draft PR (branch `sprint-10-roma-memory`): migration `20261106120000_roma_conversations.sql` (approved 2026-11-06, not yet on dev), pgTAP, history in code (`lib/ai/history.ts`), recording in the chat route, history list, open, new, delete one or all, retention line in Roma and Settings; unit tests pass, pgTAP and E2E to run in CI. 10.3 merged (PR #57). 10.4 on a draft PR (branch `sprint-10-roma-goal-check`, no migration): `goalProjection` in `packages/domain`, the `goal_projection` tool, the verdict check, the goal-check card in Roma, and the figure check no longer reads digits inside strings a tool returned (names such as "Car 2027") as figures; unit tests, lint, typecheck and build pass locally, E2E in CI. 10.4 merged (PR #58). 10.5 on a draft PR (branch `sprint-10-roma-trip-check`, no migration): `tripEstimate` and `findTravelRuns` in `packages/domain`, the `trip_check` tool on 10.4's projection (shared `loadProjectionBasis`), the trip-check card in Roma; the Goals page's "Roma · soon" badge is now an "Ask Roma" link that fills in the goal-check question (never sends it). Fix from dev ("can I go vietnam?" refused): the model asked for trip details itself in a numbered list and the markers 1–4 failed the figure check; now trip_check is called for any trip question, a missing detail returns a needs-input result whose question is built in code and replaces the model's text, numbered-list markers at the start of a line are not figures, a refusal names the unmatched numbers and what to do, and the server logs only those numbers (not stored). Second fix from dev (asked about Vietnam, answered with the "Assam Trip" goal check): goal_projection no longer picks a goal that wasn't named (even the only one) and says, from code, when a named goal doesn't exist, listing the real ones; trip_check treats an unknown goal name as a new trip's destination; a subject check beside the figure check refuses an answer whose check was about something the person didn't name, or that names a goal no check's result named, and shows a summary built in code. Domestic or international is worked out in code from the destination (`tripPlaceScope`, packages/schemas trip-places: Indian states, union territories and cities, countries other than India, and common other names; refreshed with the other lists), shown as an assumption the person can correct ("Goa is treated as domestic" from the list, "You said this trip is international" when it was passed in, so a scope the model put in is visible); their own word wins; an unlisted place is still asked about; unit tests, lint, typecheck and build pass locally, E2E in CI. 10.8 on a draft PR (branch `sprint-10-roma-web-search`, on `main` after #59): migration `20261107120000_roma_search.sql` (approved 2026-11-06, not yet on dev) and pgTAP; `SearchProvider` (Tavily via fetch, mock), `readSearchConfig`, query templates on the place list and vehicle catalogue, the web figure check (lakh / crore handled), `WebSession` credits, `web_price_lookup` and `web_price_figures`, tools of a round run in parallel; snippet rate measured (above). Migration on dev 2026-11-07 (types regenerated). Then: the records-only verdict always first and unchanged; a web-assisted line under it, marked "With web estimates, not your records", from the same projection on the web total in the profile currency (higher end; a total in another currency gives no line); "Web estimates. Check the source." block with each price as found, its site and link, and totals; the cap and daily-limit messages; unit test where a web price turns Yes into No and both show; E2E on the mock search. Figure check changed after dev refusals (list markers, "3", "8"): only money-shaped figures (a currency marker, a decimal part, thousands separators, lakh / crore / L / Cr / K, or 1000 or more) and percentages must match a tool result; small bare integers, dates and bare years 1900 to 2100 pass. Lookups are never silent: the trip check's "No outside prices were looked up." is replaced by what happened (lookups ran and prices are shown; or they ran, count toward the allowance and nothing is shown, with why); with no trip check that goes in the web notices, and an error after lookups says they were used. Web figure flow reversed: prices are found in the results in code (amount, currency, lakh / crore scale, the words around it, source) and handed to the model with ids; the model picks ids and writes labels, never an amount; the verifier stays as a backstop; kept prices accumulate across the question and count as verified figures. Live Goa measurement (5 runs): no figure dropped; credits spent with nothing shown 2 in 5 before, 1 in 5 after (a figure-check refusal, not a dropped price). 10.8 merged (PR #60). Follow-up on a draft PR (branch `sprint-10-roma-web-only-trip`, no migration): a trip with no comparable in the records now gets web lookups too (see decisions log). Merged (PR #61). Amounts by placeholder on a draft PR (branch `sprint-10-roma-placeholders`, no migration): see decisions log; live Goa measurement (`lib/ai/roma.live.test.ts`, by hand) refused 2 in 5 before, 0 in 5 and 1 in 5 in two runs after; with the "only kept prices" line in web_price_lookup, 1 in 5 (a $40 to $60 range from a result, not kept); with ranges and bounds found in code, 0 in 5. Placeholder doubles fixed (PR #63: no "USUSD", no "at least at least"). 10.9 detailed plans on draft PR #64 (branch `sprint-10.9-plans`): migration `20261107180000_roma_plans.sql` (owner applied to dev 2026-11-07, types regenerated); plan latency measured before any UI (5 live plans: median 9.8 s, worst 13.6 s of the 45 s deadline); stage 1 plan code with the timeout fallback, stage 2 intake, stage 3 modal, stage 4 Save as PDF; unit tests, pgTAP and E2E on the mock provider and mock search. Follow-up 2026-11-08 (no migration): a price needs its subject, one currency per plan, a trip verdict from two signals; then rupee lookups, a page's subject, converted prices (decisions log). Live Delhi-to-Chennai plan: 0 of 6 lines with an estimate before, 4 of 6 after; then listing pairs, units and food guides: 6 of 6 on the same live pages. Then "Add to my goals" from a plan (migration `20261108120000_goal_from_plan.sql`, owner applied to dev 2026-11-08, not on prod) and intake errors that name the question and the reason (decisions log), commit 7a6956e on PR #64. Purchase plans that suggest models: built on branch `sprint-10.9-suggest-models` with migration `20261109180000_plan_candidates.sql` (awaiting SQL review, not on dev). Handoff: "10.9 detailed plans: status and handoff" below and `docs/next-session.md`. |
| **11** | Notifications & reminders | Not started | |
| **12** | Mobile polish, offline & PWA | Not started | |
| **13** | Security & production release | Not started | |

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
| **2026-10-22** | Email links from the mobile app (sign-up confirmation, password reset) open the web app. Google sign-in on mobile uses the system auth browser with PKCE and returns to the app. | Deep-linking email links into the app needs real app builds (Sprint 12). Expo Go needs `exp://**` in the Supabase redirect allow list; builds use `fincreador://auth/callback`. |
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
| **2026-10-22** | Income entries cascade from their account and source (`ON DELETE CASCADE`), and a source's default account is cleared (`SET NULL`), only so that deleting a whole user works. Accounts and sources must never be deleted directly, only archived; account deletion (Sprint 13) goes through deleting the user. | Keeps the ledger intact: no client can delete an account or source, and deleting a user removes all of their data in any cascade order. |
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
| **2026-10-28** | Sprint 8d SQL review (owner, approved with changes): `statutory_dues` (income tax payable, fine, other statutory due) with one `statutory_due` due item; no liability account, nothing posted until paid. Paying posts an expense in "Taxes" (tax, other) or "Fines & penalties" (fines; and interest or a penalty on a tax due, not part of the amount due); system categories adopted by name, never null. Part payments: `due_payments.allows_parts` (set only by the guard), paid once active payments cover the amount; FC052 more than is still due, FC053 archived, FC054 amount below what is paid. Due date required (past allowed); fine details (vehicle kind, state, city from the shared lists) optional; description without a run of 4 digits; optional paying account on the due item. Archive only once fully paid; delete only without payment history. | Loans and card bills keep one active payment. |
| **2026-10-28** | Sprint 8b follow-up web (owner): Add borrowing asks the relationship, reason, how much to return ("Same as borrowed"), and only after a return date "How will you return it?" (one-time settlement or instalments, "First instalment on"), the account it is returned from, a schedule preview and "Nothing is deducted until you confirm Paid". Each instalment has Pay (prefilled from its account and what is left of it, split into principal and interest; asks for another account if that one is archived or gone) and Will pay later; Due soon and the bell list each instalment. Edit return plan warns that Will pay later plans are dropped; borrowings from before show "Add details". Add card: issuer and card dropdowns, Other typed, optional label. | PR #39; QA tests in `borrowing_followup_qa.test.sql`. |
| **2026-10-28** | Sprint 8d web (owner): the "Statutory & legal liabilities" box lists dues with what is left and badges (Due, Overdue, Part-paid X left, Paid), archived collapsed; Add / edit due (fines: vehicle, state, city from the shared lists; no challan, RTO or vehicle numbers); Pay prefilled from the due's account and what is left, interest or penalty on tax dues only, Pay anyway, edit / void, Will pay later; archive once paid, delete without history. Reminder links from the bell and the Overview open the pay dialog (`/loans-liabilities?pay=<id>`). | PR #41; QA tests in `statutory_dues_qa.test.sql`. |
| **2026-10-28** | Order after 8b (owner): (1) 8b follow-up (borrowing details, card product list, F1), (2) 8d, (3) 8e net worth, (4) 8c, (5) prod rollout once at the end: backup, merge PRs #35, #36, #37 and the next ones in order, dry run listing exactly the Sprint 8 migrations, push prod, live check. | Scope in "Sprint 8b follow-up" below. |
| **2026-10-28** | Statement import (owner): planned as Sprint 9 (web; credit card PDFs, then bank CSV / Excel, then bank PDFs, on one shared reader), after the Sprint 8 prod rollout; order 8d web, 8e, 8c, prod, then statement import. Client-side PDF parsing, password never leaves the browser, confirmed lines only, re-import is a no-op. | Full decisions in the Backlog item; roadmap renumbered: AI insights is Sprint 10, notifications 11, mobile polish 12, release 13. |
| **2026-10-28** | Sprint 8e net worth (owner): net worth = Total available (unchanged) + shares / funds / ETFs at the last known price + fixed deposits at today's value (the maturity amount once matured) + a liability account in credit as its own asset line "Card credit (overpaid)" − loans (owed + moratorium interest not yet added; card EMIs are loans) − cards owed (the card account) − borrowings (principal only) − statutory dues left. Due items are never subtracted (the account balance holds what is owed). Profile currency only; other currencies and holdings without a price listed as "Not included"; archived items out; no new rounding (sums of existing minor-unit figures). Each line shows its as-of date (prices: oldest to newest price date), the card the date and time zone, every flag its reason (Old price, Stale, Estimate, Matured). A part that fails to load: no total, the loaded parts shown with "Couldn't load X" and Try again. An Overview card in its own Suspense boundary, no nav tab; the trend is 8c. No migration. | One pure function for web and mobile; a property test checks the sum against every account balance. |
| **2026-10-29** | Sprint 8c reports (owner): a "Reports" tab (`/reports`, also on the phone tab bar or its More menu). Cash flow per calendar month (default the last 12 months, 3 / 6 / 12 / 24 or custom months, at most 24): income, expenses, net, savings rate ("—" without income, may be negative), the current month "so far", each month's largest category and the top 5 for the range; one `dashboard_breakdown` call per whole month, so a month equals the Overview's. Transfers (including principal paid to loans, cards and borrowing) are never income or expenses. Net worth trend: month-ends in the profile time zone and the last point today, with the 8e rules from `account_balances_at` (migration 20261029120000: own rows, security invoker, signed-in only, at most 120 dates, none in the future; an account counts from its opening-balance date until its archive date as a local date; voided entries never count, "as corrected"); moratorium interest until the day a payment adds it; fixed deposits by formula from the start date until archived; a statutory due from the day it was added, minus payments by then, until archived, at today's amount; shares, funds and ETFs excluded and labelled "Excluding shares, funds & ETFs", with today's net worth including them and the investments figure beside it; the trend starts at the first point with data. CSV export (`/reports/export`): the person's own session only, zod parameters (range up to 10 years, optional account or category, voided off by default), reads of 1,000 rows, at most 10,000 rows (413 above), current versions only; columns Date, Type, Amount, Currency, Account, To account, Category, Payment mode, Note, Voided; only the text columns get the leading-apostrophe guard (= + - @ tab CR); UTF-8 with BOM, CRLF; `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `maxDuration` 15 s; file name has only the dates; nothing logged or stored. | PDF export and a full "Export my data" stay in the backlog. |
| **2026-10-29** | Sprint 8c web: a phone fits five tabs, so the tab bar is Overview, Activity, Goals, Investments and More; More lists the pages not in the tab bar (Income, Recurring, Loans & Liabilities, Reports). Export cap and `maxDuration` from a CI measurement on the throwaway database (10,000 rows: median 348 ms through the route, 724 ms through the form; 413 in 257 ms): cap 10,000, 15 s unchanged. | Liabilities moved from the tab bar into More; desktop sidebar unchanged. |
| **2026-10-29** | Sprint 8 prod rollout (owner, `docs/deployment.md` 4c): stacked PRs #35–#44 merged into `main` in order; prod backed up; dry run listed exactly the five Sprint 8 migrations (`20261028120000`, `20261028180000`, `20261028210000`, `20261028230000`, `20261029120000`); pushed; the 4c verification query returned all `true` and the live check passed. | Sprint 8 is live (web). Next: the quick pre-launch checklist items, then Sprint 9. |
| **2026-10-29** | Sprint 9a card statement import (owner): order 9a.1 reader, 9a.2 generic then PNB parser (issuer name only, from PNB's own pages; layout from the owner in fake values), 9a.3 pdf.js in the browser (exact version, eval off, worker bundled, no CDN, size and page caps, a clear message for scanned PDFs), 9a.4 review, 9a.5 save. Per line the date, amount and Dr / Cr are read first, then runs of 4+ digits are stripped from the description only. Skipped payments, refunds and EMI lines are listed in a notice, never silent. Fee, interest and GST lines start ticked. Ticked lines are saved first through `record_transaction`, then `enter_card_statement` with the bill total (a test proves no double count). The request key (UUID v5) comes from the original parsed values only; the same key with edits shows "Already imported" and never overwrites. The server action caps line count, amount and date range. Open: `enter_card_statement` uses the category the person picks for the difference (no system category), so fee lines need the owner's choice; proposed a "Bank charges & interest" system category by migration, not "Utilities & bills". | Plan approved 2026-10-29. |
| **2026-10-29** | Sprint 9a PNB and categories (owner): fee, interest and GST lines and the Enter statement difference default go to the system category "Bank charges & interest" (`system_key` bank_charges, every user, adopted by name; migration 20261029180000); every category with a `system_key` can be renamed, never archived (FC042 "This category is used by the app and can't be archived"). PNB card statements (layout from the owner in text): Invoice Date = statement date, Total Amount Due = bill, Payment Due Date, Minimum Amount Due; lines by Transaction Date (Post Date ignored), Dr / Cr; the Network/Last 4 Digit cell is dropped in the parser; label-only total rows, ads, reward points and limits ignored, nothing read after "End of Statement"; self-checks Previous Balance + Purchases + Cash Advances − Payments = Total Amount Due and Dr lines = Total Invoice Value, a mismatch shows "Check this statement" and never unticks. Bank statements (9b, no parser yet): ignore everything above the column header row (account number, name, address are never kept); balances may have thousand commas, amounts none; Date, Instrument ID, Amount, Type (DR/CR), Balance, Remarks; newest first; Remarks wrap; UPI remarks keep the payee only; balance-chain self-check. | Synthetic fixtures only. |
| **2026-10-29** | Sprint 9a QA fixes (owner): an import key resolves through `replaces_id` to the latest version of its edit chain (TypeScript, batched per level, depth limit 20, no migration), in the review and in the save check. The proxy does not redirect a signed-out server-action POST to `/loans-liabilities/import` only (opt-in list `SIGNED_OUT_ACTION_PAGES` in `apps/web/lib/auth/routes.ts`; every other page and action still redirects, unit-tested); those actions check the user themselves and RLS refuses anon, so the page keeps its state and shows "sign in again". No action uses elevated credentials. |
| **2026-11-04** | Web fonts are self-hosted from npm (`@fontsource-variable/manrope` and `@fontsource-variable/dm-sans`, SIL OFL 1.1) instead of `next/font/google`. | No font is fetched from Google at dev, build or run time, so builds work offline. Same variable font files Google served; `--font-manrope` and `--font-dm-sans` unchanged, with the same metric-matched Arial fallbacks. |
| **2026-11-04** | Sprint 9a diagnostics (owner): under "rows could not be read", a "Copy layout" button copies, per unreadable row, its page and row, and per PDF piece its kind (date, text, number, amount), x, width, characters and baseline offset (dy), rounded; never text or digits from the statement. The import page remounts per card id, so another card's page starts empty. | Lets the owner send a real file's layout without sharing it; the layout stays on the device until copied. |
| **2026-11-04** | Sprint 9a complete (owner). Card statement PDFs are read in the browser by a TypeScript reader (`packages/domain`, pdf.js on web): the file and any password never leave the device. One issuer reader: Punjab National Bank only. Self-check gate: a statement whose summary, purchases or invoice total checks fail shows "Check this statement" and Save waits for "I have compared these lines with my PDF"; another issuer is reviewed with the general reader only when it verifies itself, with a note. Honest message otherwise: "We can't read [issuer] statements yet..." (no review, no Save; add purchases by hand or use Enter statement). Web fonts self-hosted from npm (Fontsource variable Manrope and DM Sans), with a browser test. | Known limitations kept: two tabs saving at once can both report "saved" (each line posted once); a parser change that alters parsed values changes line keys (an earlier import then shows as Possible duplicate). How to add an issuer: "How to add a new issuer parser" under Sprint 9. |
| **2026-11-04** | Sprint 9b plan (owner): the person picks the bank account; lines before its opening balance date are skipped. Debits default to an expense; credits start unticked with a required choice (income with a source, transfer from an own account, refund, skip), nothing posts until ticked. Card payment on debits only, through the card payment path; transfers never post as income or expense. A line matching a transfer already recorded from the other account's import is Already imported, never posted twice. Payee labels remembered within one import only. The balance chain and the statement's opening / closing gate Save; the app's closing balance is a soft warning only. CSV now, no Excel. Refunds: the ledger can't post a negative expense (amounts are positive, the category kind must match the type), so refunds are skipped with a note and become separate work. | No migration. |
| **2026-11-04** | Sprint 9d generic bank reader (owner): read by structure, not by bank. Acceptance is endpoint reconciliation, opening + credits − debits = closing to the paisa, whatever the row chain does; without printed endpoints, the chain must hold on every row after same-date reordering. No percentage anywhere. The chain only flags rows (same-date rows reordered first); a Dr / Cr or column that disagrees with the balance movement is flagged unless the totals reconcile with the markers as printed. Day-first dates that run out of order fail the file. PNB and the CSV reader stay the known-good path; the generic reader is the fallback. | No migration. Flagged rows are shown as unreadable and never saved; Save needs "I have compared these lines". |
| **2026-11-05** | Sprint 10a (owner): a repeating entry reuses `recurring_rules` (no second mechanism): the rule starts on the entry date and the entry is its first confirmed occurrence, so the one-entry-per-occurrence index keeps it from counting twice. A source's rate comes only from its recurring rules, never from past entries. Overview cards are always this month. Inactivity sign-out is 2 hours, detected in the browser (pointer, key, wheel, scroll, touch; shared across tabs through localStorage; a fresh sign-in counts as activity), and ends the session with Supabase `signOut` (scope local). No Supabase Auth setting was changed. Plain wording (the page keeps the name "Transactions", owner): "Everything", "Recent activity", "Search…", dialog titles name the thing ("Add expense", "Edit income", "Void this transfer?"); "transaction" stays in database names. | Faster daily entry and labels that say what a figure is (an actual, a rate or a balance). The idle timer runs in the browser only, so a closed browser's session ends at its next page load or by the Supabase session settings, not exactly at two hours. |
| **2026-11-04** | Sprint 9c refunds (owner): a refund is its own entry type (not a signed entry, not a link-only record): a positive inflow in an expense category, optionally linked to the purchase. It counts on its own date, so a category's net can go below zero. Only linked refunds are capped at the purchase, counting live rows only; unlinked refunds are uncapped. A voided purchase keeps its refunds and the link clears (no block, no cascade); an edit moves the links. A card may go into credit: an asset in net worth, never in Total available. `enter_card_statement` measures owed net of refunds, and a zero bill on a card in credit posts no difference. One migration, covered by the db-upgrade CI job (existing users see no change). | Migration 20261104120000; error codes FC055–FC057. |
| **2026-11-05** | Sprint 9d complete (owner). Bank statements from any bank are read by a generic, structure-based reader (`statement-bank-generic.ts`): the header row is found by what it names (date, description, debit and credit or one amount column with or without Dr / Cr, balance), not by bank. Endpoint reconciliation is the acceptance test: opening + credits − debits = closing to the paisa; without printed endpoints, the balance chain must hold on every row after same-date reordering. The row chain only flags rows (shown as unreadable, never saved); it never accepts or rejects the file on its own. The PNB parser (and the 9b CSV reader) stay first as the known-good path; the generic reader is the fallback (`readBankStatement`). A masked "Copy layout" diagnostic (kinds and geometry only, never text or digits from the file) is on both the review screen and the couldn't-read message. | No migration. Known limitations kept: a scanned PDF has no text; a page footer printed one line below the last row can merge into it. |
| **2026-11-05** | Sprint 9 complete (owner): 9a card statement import, 9b bank statement import, 9c refunds, 9d generic bank reader, all on `main` (web). Next: the pre-launch checklist (`docs/next-session.md`), then Sprint 10. | Known limitations of 9a–9d kept as recorded in their rows. Excel (.xlsx) import and the SBI layout added to the Backlog. |
| **2026-11-05** | Sprint 10a complete (owner): "Repeat this?" on add income and add expense; sign-out after 2 hours without activity, shared by every tab; plainer wording; four Overview cards, always this month; three Income cards; income sources show actual amounts this month and this year, and a rate only from active recurring rules (a total is never shown as a rate). Next: Sprint 10, the Roma assistant, step 10.1. | The idle limit is 2 hours in production: the server's `IDLE_LIMIT_MS` may only shorten it (10 s to 2 h) and is ignored when `VERCEL_ENV` is production; nothing from the browser changes it. Tabs sharing one clock is unit-tested; the idle E2E runs in real time against a 20 s server, with no fake clock. Voiding a version an edit just replaced closes the dialog, refreshes the list and says nothing was voided. Mobile unchanged (backlog). |
| **2026-11-05** | Sprint 10 plan (owner): the assistant is Roma, direct and not flattering. Claude Haiku 5.5 first behind our own provider abstraction (no LangChain); tools wrap existing loaders under RLS; no answer text streamed before validation; an answer with a number not matched to a tool result is refused, never corrected. Caps on the server: global and per-person monthly spend, a per-person daily limit, a one-row database kill switch; only a real provider call consumes budget. No service-role key in the web app: the ledger is written by three security-definer functions. Descriptions are not sent in 10.1; from 10.2 at most 20 per search, re-cleaned, with the same notice in Settings and in Roma. Web research (Tavily) is step 10.8, last; until then estimates use the person's own data only. | Figures stay deterministic and auditable; spend can't exceed the caps from the browser. Tavily's terms don't settle commercial use on the free plan: written confirmation before any commercial launch. |
| **2026-11-06** | Roma's opening screen (owner): before any question, two lines of static text, "Good morning, <first name>." (the profile's display name, left out when missing; morning, afternoon or evening in the person's own time zone, the same helper as the Overview greeting) and "I’m Roma, your Intelligent Finance Analyst. What do you want to know?". In the question box Enter sends and Shift+Enter adds a line; the send button stays. | The greeting is not a model call: it costs nothing and skips the output check. Conversation history stays in 10.3. |
| **2026-11-06** | Sprint 10.2 tools: each wraps the loader its page uses (`transaction_summary`, `dashboard_breakdown`, `list_transactions`, `loadIncomeData` + `summarizeHoldings`, `loadNetWorthData` + `netWorth`, `loadLoansData` + `buildLoansView`) under the person's RLS. Rates are a figure kind of their own (basis points), allowed in an answer only as the tool formatted them. Search sends at most 20 entries by account and category name (never digits or IDs); descriptions only after agreeing in Roma, re-cleaned (digit runs of 4+, anything with `@`, 80 characters). Money borrowed goes by relationship ("Borrowed from friends"), never the lender's name. Settings has its own descriptions toggle (shown while Roma is on, with the date agreed): withdrawing sets `roma_descriptions_ok_at` to null and leaves Roma on; turning Roma off still clears it. No migration: the consent column, trigger and grant came with 10.1. | Same figures as the screens, no new arithmetic; a person lent money is not named to a provider. |
| **2026-11-06** | Sprint 10.3 conversation memory (owner): `ai_conversations` and `ai_messages` (one row per question and answer), owner-only RLS, deleted with the account; no client writes: turns only through `roma_record_turn`, which needs the caller's own settled `roma_usage` row and is idempotent per request id (a retry returns the stored turn). Stored: question, answer text, as-of date, periods, tool names, whether descriptions were sent; no tool payloads. A question is sent with the last 3 turns as text and a summary built in code (questions, tools and periods, no answers, so no figures) in a third system block; an answer that quoted descriptions is left out once consent is withdrawn. Only answered turns are stored; turning Roma off keeps the history. Retention: deleted 180 days after the last message (daily `pg_cron`), stated beside the history list and in Settings; delete one or all at any time. At most 100 turns, then a new conversation. | Checked live on Haiku 5.5 with the history-editing check enforced: rebuilt plain-text history plus a summary is accepted and the question's own thinking blocks stay valid; an edited earlier turn is rejected. History is never a source of figures (figure check, unit-tested). |
| **2026-11-06** | Sprint 10.4 goal check (owner, plan approved with additions): the verdict is computed in code (`goalProjection`, `packages/domain`), never by the model. Rate: the median monthly net (income minus spending, Reports' figures) over the last 6 complete months, profile currency only (other currencies ignored, not added); a month with no records is not counted; 3–5 months with records gives a verdict marked thin; under 3 gives "Too early to say." with no projection. Each month's free money = median − pending loan, card EMI and borrowing instalments in their month (principal only when that loan or borrowing was paid in the months measured, the whole instalment otherwise) − unpaid statutory dues in their due month − other active goals' `savingPlan` monthly amount until their target month; card bills are not taken off again (purchases are already spending). Reached in the first month the running total covers what is left; horizon 10 years or to the target month. Verdicts: Yes / No (save X more a month, rounded up, or move the target to the month it is reached) / Too early to say; no date: Yes by month or No within 10 years; past date: No, still needed now, and when it would be reached. The answer must start with the verdict word or the code-built summary is shown instead. Roma shows the verdict, the figures (each other goal as "Assuming you keep saving for your other goals") and the assumptions, including that a statutory due paid in the months measured is already inside the median while an unpaid one is deducted again (deliberately conservative). | No migration. Figures and dates the answer may quote are all in the tool output, so the figure check still applies. |
| **2026-11-06** | Sprint 10.5 trip check (owner, plan approved with two decisions): the estimate comes only from the person's own trip goals (cost lines) and past travel runs: Travel-category expenses (icon `travel`) no more than 3 days apart in the last 24 months, runs over 30 days left out. A run is used only after the person confirms travellers and domestic or international, and picks one of its two figures, both added up from the records: the Travel category, or all spending in those dates ("which may include things unrelated to the trip"). Confirmations are not stored; they last for the conversation. Scaling: a goal's transport and visa/insurance per traveller, its other lines per traveller-day; a run per traveller-day; N nights = N + 1 days; same scope only; the median of the comparables. None: "I can't estimate this from your records.", never a guess. The verdict is `goalProjection` with the estimate as the target and the travel month as the date; it also names dated goals that would go from on time to late, and the change needed (more a month, a later month, fewer nights or travellers). | No migration. No web research until 10.8. |
| **2026-11-06** | Sprint 10.8 web lookups (owner, plan approved with changes): Tavily behind a `SearchProvider` adapter; queries only from a server template on 10.5's known-place list; a web figure is kept only if its URL is one of this request's results and its amount is in that result's text; the verdict comes from the person's records alone and is shown first, a web-assisted verdict only as a separate marked line; caps and a search kill switch in `roma_settings`, credits reserved per question in `roma_search_usage`. Snippet measurement before the UI with the owner's key from `apps/web/.env.local`. Tavily's written confirmation on free-plan commercial use is on the pre-launch checklist. | A wrong web price can't change the records-based verdict; search credits can't pass the caps from the browser. Migration `20261107120000_roma_search.sql`. |
| **2026-11-07** | 10.8 follow-up (owner): with no comparable in the records, the trip check's records verdict is "No estimate from your records." (was "I can't estimate this from your records."), and when web lookups are on the model is told to look up the trip's cost lines anyway. The web line is then marked web-only ("Web estimates only, no basis in your records"; its summary says it rests entirely on web prices) and the check carries "No outside prices were looked up." so the lookups line replaces it. Prices still found in code with their source, picked by id, credits counted as before. | No migration. The records verdict is unchanged by web prices. |
| **2026-11-07** | Amounts by placeholder (owner, after a prod Goa answer was refused for a made-up 1000 to 2000 range): the model never writes an amount. Each tool figure is sent with a placeholder made from its label (`{fig:trip_estimate}`), each kept web price and web total with one of its own (`{web:3}`, `{web:total_inr}`); the figure and subject checks read the answer with placeholders blanked, then the server fills each one in (a web price as currency and amount, without what it covers), dropping a currency sign or code the model wrote beside it. An unknown placeholder becomes "[amount left out]". A bare money-shaped number still goes through the figure check: one matching a figure passes (code-built summaries the model copies stay valid), anything else is refused. | No migration. Answers are stored with the amounts filled in. |
| **2026-11-07** | Web price ranges and bounds (owner): a range in a result ("$40 to $60", "₹3,000–₹5,000", "40-60 USD", "₹3-5 lakh", "between $40 and $60") gives both ends as prices with their own ids, linked (low below high, or it isn't a range); keeping either end keeps both with the same label and basis, and `web_price_figures` offers the range placeholder ("{web:12} to {web:13}"). "from", "starting at", "as low as", "onwards" mark a lower bound, "up to", "under", "below" an upper one, shown with the price. The text around each price is still sent. | Turns the commonest refusal (an unkept range) into a supported answer. Totals use each cost line's lowest and highest kept price, so a range gives a range total. |
| **2026-11-07** | Bounded web totals (owner): a total fed by any "from" price (also "from about") is a minimum, written "at least" its low end and checked at that amount; by any "up to" price a maximum, "at most" its high end; by both, its range said as neither. The web-assisted line says the same. | A "from" fare can't be presented as an estimate of the trip. |
| **2026-11-07** | Sprint 10.9 detailed plans (owner, plan approved with decisions): "plan my trip to X" and "can I buy a bike/car/house" open an intake written in code, asking only the fields the question didn't give; every field can be skipped and a skipped field makes the lines that need it "no estimate" while the plan still runs. Code sends the lookups (one per trip cost line a goal doesn't cover, plus route carriers and 4- and 5-star hotels; price and first-year insurance for a listed vehicle; none for a house). One model round picks prices and names by id and writes no prose; the chat summary, the modal and the PDF are all written in code from one checked plan, stored as `ai_messages.plan` (size, shape and blocked keys checked in the database). Carriers only from a list in code, hotels only with a 4- or 5-star mention in the same sentence, both shown as "listed on <site>", never as Roma's recommendation. Trip goal lines are scaled to the plan; a buffer of 10% of the estimated lines; the records verdict first, then the plan total checked on the same projection, with what would make it fit. If the model's round fails or the deadline comes first, looked-up lines are "no estimate" with their pages listed and the credits are settled, never a failed plan. Plan credits: `search_plan_reserve_credits` 8; daily search credits 16. Save as PDF is the browser's print with a print-only copy; a reopened plan says when it was made and that web prices may have changed. | Migration `20261107180000_roma_plans.sql`. No live fares or room rates: the plan says so. |
| **2026-11-08** | 10.9 plan sanity and context (owner, after a dev plan showed "INR 5 a person" for a flight): rupee prices outside a plausible range per line are dropped and the line says how many (flight a person ₹1,500–40,000 domestic, ₹8,000–2,00,000 international; hotel a night ₹600–60,000; food and local travel a person a day ₹200–10,000 and ₹100–10,000; sightseeing a person ₹200–20,000; other currencies not range-checked, never converted). Each price carries what it is for (hotel or area, kind of meal, mode, place), found in code next to it on its page; food lists named dishes, sightseeing well-known places, shopping is never estimated and lists what the place is known for buying, all from lists or patterns in code with their pages. Hotel names with a site, a domain or page words are dropped; names are kept once, compared without "The", the destination or "Hotel". Trips also ask where from (always shown); a plan with no model call is settled, not released, so it is saved. | No migration (optional nested fields). |
| **2026-11-08** | 10.9 a price needs its subject (owner): a trip price is kept only when code finds what it is for next to it on its page (transport: an airline from the carriers list; stay: a hotel or property name, an area alone no longer counts; food: a kind of meal, or "food for a day" when none is named; local travel: a mode; sightseeing: a named place or a tour from a list). Prices without one are never offered to the model and each line says how many were dropped; a line left with none is "no estimate" with its pages. Hotels are one dataset with the stay line: a hotel with a rate (the rate in its own sentence, never a neighbour's) is a stay price, one without is listed on the line as named, not priced; `plan.hotels` is null for new plans (older ones still show their list). A budget plan's hotels lookup is "budget hotels in X with prices per night" with no star mention needed: live (Goa, Jaipur) it named 8 properties each but tied a rate to none (prices there are generic ranges, or follow the name), so a budget stay line still often has no estimate; accepted. | No migration (`about` stays optional in the stored shape). |
| **2026-11-08** | 10.9 one currency per plan (owner): only prices in the profile currency are offered or used; a line whose prices are all in another currency is "No estimate: prices found only in USD. They aren't converted."; a mixed line says how many it left out. Nothing is converted (no rate source), and the assumptions say so. The plan has one total. | No migration. |
| **2026-11-08** | 10.9 more prices kept (owner, after a Delhi-to-Chennai plan priced only transport): (1) a domestic trip's priced lookups end "in rupees" and ask Tavily for Indian pages first (`country: "india"`); (2) a price whose own words don't say what it is for takes it from its page, in code: the title, else the address, of the kind its line's lookup asked for (a taxi firm's site is "taxi", a hotel's own page its name, a food guide "food"); a listing page or one about nothing still drops it; (3) prices in USD, EUR, GBP, AED, THB, SGD, MYR, LKR or NPR are converted to the profile currency with a fixed, dated rate table in code (`rates.ts`, refreshed quarterly: the refresh-prices job reads only AMFI and BSE, which publish no rates), exactly in integers; the original amount from the page is always shown beside "about ₹…", the rate and its date are in the assumptions, and the plausible range is checked after conversion. Other currencies (JPY, say) are not used. Supersedes "never converted" above. | No migration; `PlanPrice.converted` is optional, so stored plans still read. |
| **2026-11-08** | 10.9 listings, units, food guides (owner): (1) stay, food and local-travel lookups read up to 60 prices a page (12 still offered to the model per line), and a stay price on a listing page (Kayak, Trivago, Booking, Expedia, MakeMyTrip) takes the hotel named in its own card, just before it: the name the card repeats most, else one with a lodging word; a page's averages still have no hotel and are dropped. (2) The unit next to each price is read in code (right after it, else in its own table cell or clause): food and local travel use only prices written per day; per km, per trip, per hour, outstation, add-on charges (driver allowance, tolls, hill-station charges) and unstated ones are dropped and counted by reason; a stay price per km, hour, trip or month is dropped. A per-day price is counted per day whatever basis the model picks (new basis "day": the whole party, a car's day hire). (3) Cost-of-living and food-cost guides are a food page. A ₹ sign glued to a word ("80 km₹2,800") is now read. | No migration; "day" is a new optional basis in the stored plan. |
| **2026-11-08** | 10.9 trip verdict from both signals (owner): money (the plan total on the same projection: free money by the travel month after other goals) and past trip (the total against one travel run as spent, unscaled: the most recent of similar length, within 2 days or 25% of the plan's days, else the most recent; labelled "who went and where isn't known"). Yes if money holds; money fails but the total is at or below the past trip: "Not yet.", the money is the constraint, not the trip; both fail: No; money unknown: no verdict. Shown after the records verdict with both signals' figures; stored as `verdicts.both`. A run confirmed in the conversation can't be used: confirmations aren't stored (only question and answer text), so the plan can't read one. | No migration (nested optional key). `loadTravelRuns` shared with trip_check; `pastTripRun` in packages/domain. |
| **2026-11-08** | 10.9 "Add to my goals" (owner): the plan modal shows the normal goal form, prefilled in code from the checked plan (`lib/ai/plan/goal.ts`): a trip goes to a trip goal (transport + local travel → Transport, sightseeing → Activities, stay, food, buffer; travellers, nights + 1 days, the state or country when the destination is one, hotel for a comfort or luxury stay), a bike or car to a vehicle goal (make, model, price, extras), a house to a house goal; each figure is the line's higher end in the profile currency (a minimum's own figure); the trade-in or deposit is the amount already saved; the target date is the plan month's first day, or today once that has passed. Empty fields and what to check are listed above the form; nothing is saved until Add goal. The goal links to the plan's turn (`goals.plan_message_id`, set on insert only, checked by a trigger to be the person's own turn holding a plan, one goal per plan, set null when the conversation is deleted); the plan then shows "Added to your goals as …" and the goal is an ordinary goal for Roma. The plan now keeps its intake request (`intake.request`, optional) so older plans prefill less and say so. Intake: every answer is checked in code and a message names the question and the reason; a month typed as text (Safari shows a text box for a month picker) is read ("March 2027", "03/2027"). | Migration `20261108120000_goal_from_plan.sql` + pgTAP. |
| **2026-11-08** | 10.9 standing rules for plans (owner, restated for the handoff): (1) every web price needs its subject, what it is for, found in code next to it or from its page, else it is dropped and counted; (2) one currency per plan: prices in other listed currencies are converted with the fixed rate table in code (`rates.ts`, dated, refreshed quarterly), the original always shown beside it, others not used; (3) the records-only verdict always comes first and is never changed by web figures; (4) a trip's verdict has two signals, free money by the travel month after other goals, and the plan total against a past trip as spent; (5) shopping is never estimated; (6) names and prices are extracted in code and picked by id, never typed by the model; shown as "listed on ‹site›", not Roma's recommendation. | Applies to purchase plans that suggest models too. |
| **2026-11-09** | 10.9 plan modal redesign (owner, references in `docs/design/roma`): header (eyebrow "Roma · Travel plan" or "Roma · Purchase plan", route and month, nights, travellers, created date; Save as PDF and close at top right); one dark verdict card (the records-only verdict first, then Roma's verdict in plain words with its reason and a Fits / Needs adjustment / Can't say chip; "How Roma decided" opens the signals and the verdict with web estimates); three figures (estimated cost, free money by the month after other goals, red when negative, extra saving needed a month); numbered ways to make it fit (`changes` now title and one line; older plans' sentences still read); a cost breakdown whose rows open to their prices, subjects, links and dropped counts (a line with no estimate says why unopened); data sources and assumptions behind "View data sources"; sticky footer with Close and "Create travel goal" / "Create goal". The PDF prints the same layout with every row open. The projection's figures are stored as `verdicts.figures` (optional). Figure check: a number the person typed in their own questions (current and recent, not earlier answers) is never refused, with lakh and crore read either way ("12 lakh" lets 1200000 through, and back). | No migration (nested optional keys). |
| **2026-11-09** | Roma page redesign (owner, references in `docs/design/roma`): each turn is a card (the question in a dark bubble, Roma's reply beside her mark, "Checked against your records"); a plan's reply is a summary card only (status chip, headline, estimated cost, lines with an estimate, Open the plan), the stored answer text is unchanged but not shown for a plan; an answer's figures are a table with the period and sources under it; the question box is a card with the primary button; past conversations are cards with a type marker (Question, Travel plan, Purchase plan, from the kind of any plan the conversation holds) and the date. | No migration. The list reads only `plan->>kind`, never the plan. |
| **2026-11-09** | Plan estimates (owner): the headline estimated cost is the median, each line's middle price scaled (halfway between the two middle ones for an even count), added up, with the buffer on that; the range sits in the caption; stored as `median` on each amount (optional; older plans show their range). Every plan figure on screen and in the PDF is in whole units (paise on a web estimate is false precision); the checked total is rounded up to whole units; the verdict still checks the higher end. Roma page header: "Ask Roma" with a Ready / Off chip and "Your intelligent finance analyst, grounded in your records."; conversation column 26rem. | No migration (nested optional key). |
| **2026-11-09** | Plan verdict safety (owner, after a false "Fits" on a ₹30 lakh car checked at ₹30,500): purchase prices have plausible ranges like trip lines (bike ₹30,000 to ₹15,00,000; car ₹2,00,000 to ₹2,00,00,000; house ₹5,00,000 to ₹50,00,00,000), outside dropped as misreads and stated in the assumptions; the verdict always checks the higher end, also for minimums ("from" prices), and so does Create goal's prefill; the headline stays the median. A line whose highest price is more than 5 times its lowest says "Prices found vary widely; treat this as rough". | No migration. |
| **2026-11-09** | Purchase plans suggest models (owner-approved 8-point plan, built): a bike or car asked for without a make gets a shortlist; make and model stay behind "I already know the model". Intake: main use (city commute, touring, family, first vehicle; read from the question when it says), budget or skipped (then free money by the month after other goals, plus savings toward a matching goal and any trade-in), month, trade-in. Two fixed-template lookups (by use; by price band entry-level / mid-range / premium from the budget, edges bike ₹1,20,000 / ₹2,50,000, car ₹8,00,000 / ₹20,00,000), never a budget figure. Candidates in code (`plan/candidates.ts`): a `VEHICLE_CATALOGUE` make and model with the first rupee price on its own card (never a neighbour's), names blanked before reading prices, EMIs skipped, the purchase plausible range applied to both ends; kept when the lower price is within the budget; only the card's facts (cc, kmpl, EV range, fuel, seats, body word, "ex-showroom" when written). The model picks up to 6 ids by use; a fit per model on its higher price less trade-in; one verdict for the list. Modal: candidate cards (name, price, descriptor, fit, source chip and link, "Listed on ‹site›, not Roma's recommendation"), "Pick this model" runs the usual model plan; a shortlist has no cost lines and no Create goal. Live measurement before the UI (2 queries): bikes 46 of 52 named models with a usable price, cars 48 of 80 (1 dropped as implausible). | Migration `20261109180000_plan_candidates.sql`: `candidates` joins the `ai_messages_plan_shape` key list (20261107180000 is on dev and prod and is not edited). |

## Sprint 7 Investments: market data decisions

Mutual funds: AMFI's free daily NAV text file (scheme code, ISINs, name, NAV, date). NAV has 4 decimals and units are fractional, so prices and units need a finer stored scale than paise, with one rounding rule in `packages/domain`, decided at SQL review. Stocks: NSE/BSE end-of-day files and security lists are candidates; redistribution terms unverified, so check before any commercial use (licensed vendor API at the Pro stage); no scraping. Shared read-only instrument and price tables; a scheduled job (`pg_cron` + Edge Function, service role key only in Supabase secrets; verify `pg_cron` on Free) refreshes after market close; keep only the latest close for all instruments and daily history only for instruments users hold (500 MB limit); show 'closing price on <date>'. Holdings are per user with RLS; valuation and gain/loss follow CLAUDE.md.

## Before production (open items)

Development-only settings that must be removed or replaced before any production release (Sprint 13 at the latest):

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
- **Home city on the profile (for Roma plans' origin):** a plan's intake always asks where the person travels from (10.9) and can't prefill it: `profiles` stores a country, not a city. Needs a migration adding `profiles.city text null` with a check (trimmed, 1 to 60 characters), no new RLS (profiles' own-row policies cover it), regenerated types, a Settings field with a city suggestion list (`INDIAN_CITIES`), and the intake prefilling the origin from it (still shown and editable, still skippable). The city is personal data: it is never sent to the search provider except as the listed place name in a flight or airline query, as the origin already is.
- **Card list: PNB first, then more banks (next quarterly list refresh, January 2027):** add Punjab National Bank (PNB) credit cards to `packages/schemas/src/card-data.ts` from PNB's own pages only (verified sources cited in `docs/quarterly-list-refresh.md`, no guessing), then other public-sector and mid-size banks the same way. PNB comes first because the person holds a PNB card. Until then, "Other" with a typed name works.

- **Notifications step (email, web push, phone push):** EMI and card-bill reminders outside the app (Sprint 8a has in-app reminders only). Needs custom SMTP or a Resend domain, Expo push tokens and web push; reuse the `pg_cron` + Edge Function pattern from `refresh-prices`; never send amounts or account names on a lock screen by default.
- **Ongoing loans with capitalised interest:** Sprint 8a caps an ongoing loan's outstanding at the amount taken; an education loan already in repayment whose moratorium interest was added may owe more. Add an optional "interest added to the loan" field if testers need it.
- **Financial year setting:** optional April–March financial year for "this year" figures (Sprint 2 uses the calendar year).
- **Repeated sign-up email:** see Sprint 11.
- **Mobile category management:** add, rename, archive and restore expense categories in the mobile app (web has it on Settings since Sprint 3; owner, 2026-10-23).
- **Recurring reminders:** notify when a recurring item is due (deferred from Sprint 4; belongs with Sprint 11 notifications, using Supabase scheduling).
- **Overview card heights:** the Monthly budget card's empty state stretches to the height of the chart beside it (layout only).
- **Mobile Overview dashboard:** the Sprint 5 dashboard on mobile, reusing `dashboard_breakdown`, `transaction_summary` and `packages/domain/src/dashboard.ts` (owner, 2026-10-26: web only in Sprint 5).
- **Payee / merchant on entries:** a "paid to" field (the Figma shows merchant names). Not in Sprint 3 (owner, 2026-10-23).
- **Sprint 9: statement import (web)** (owner, 2026-10-28; docs only, not built yet). Order of the sprints: 8d web, 8e net worth, 8c history + CSV export, Sprint 8 prod rollout, then this. Order inside Sprint 9: (1) credit card PDFs, (2) bank-account statements as CSV / Excel (exact, preferred), (3) bank PDFs, all on one shared reader in `packages/domain`. Credit card decisions:
  - Parse the PDF in the browser with pdf.js. A statement password is held in memory only: never uploaded, stored or logged. A wrong password shows a plain message.
  - Text PDFs only (no OCR), with a file-size cap and a page cap.
  - Review table with a tick per line and an editable category, amount and date. Only ticked (confirmed) lines are saved, as card expenses through the existing writers.
  - The statement date, total, minimum due and due date prefill Enter statement.
  - Deterministic request keys per line, so re-importing the same statement is a no-op.
  - Possible duplicates (an existing card entry with the same date and amount) start unticked.
  - Runs of 4 or more digits are stripped from notes.
  - Skipped: payments received, refunds (void the matching purchase instead), EMI conversions, and lines dated before the card was added. Fees, interest and GST are imported as expenses.
  - First parsers for the issuers in `packages/schemas/src/card-data.ts` (HDFC Bank, SBI Card, ICICI Bank, Axis Bank, Kotak Mahindra Bank) plus a generic line parser. Parsers live in `packages/domain` and work on extracted text, so mobile can reuse them.
  - Tests use synthetic statements only (including a password-protected one); never real statements in the repo.
  - No new tables expected.
  - Bank statements (steps 2 and 3), extra rules: credits are imported as income and debits as expenses; transfers between the person's own accounts are detected and posted as transfers (neither income nor expense, no double count); the closing balance is reconciled against the account balance and any difference is shown before saving; duplicate detection against manual entries (unticked, like card lines); the same privacy rules (synthetic statements only in the repo, runs of 4 or more digits stripped from notes, a password in memory only, never uploaded, stored or logged).
- **Excel (.xlsx) statement import:** read bank statements saved as Excel, with the same column rules, reconciliation and privacy as CSV (9b / 9d read PDF and CSV only).
- **SBI statement layout:** a known-good SBI bank statement reader (or fixes to the generic reader) from the owner's masked Copy layout and synthetic fixtures only.
- **Refunds on mobile:** add a refund (and Refund this) from the mobile Add sheet; 9c shows and edits refunds on mobile but adds them on the web only.
- **Export my data (Settings):** a full export of everything the person holds (accounts, transactions, investments and fixed deposits, loans, cards, borrowing, statutory dues) from Settings, with the same rules as the 8c transactions CSV (own session only, formula-safe text cells, nothing stored or logged, no personal details in file names). PDF export also stays in the backlog (owner, 2026-10-29).
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
| **9** | Weeks 17–18 | Statement import | Import credit card and bank statements and save only the confirmed lines. |
| **10** | Weeks 19–20 | AI financial insights | Get explanations grounded in verified data. |
| **11** | Weeks 21–22 | Notifications & reminders | Configure reminders and upcoming-payment alerts. |
| **12** | Weeks 23–24 | Mobile polish, offline & PWA | Harden supported offline and cross-platform workflows. |
| **13** | Weeks 25–26 | Security & production release | Release candidate ready for deployment/store submission. |

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

Done 2026-10-28: rules in the Decisions row of that date ("Sprint 8e net worth").

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

## Sprint 9 — Statement import

**Weeks 17–18 \| Usable outcome:** A user imports a credit card or bank
statement and saves only the lines they confirm. Added on
2026-10-28 (owner); AI insights and later sprints moved up by one. Scope,
order and decisions: the "Sprint 9: statement import (web)" item in the
Backlog.

### How to add a new issuer parser

Card statements only (9a); a bank account parser (9b) follows the same steps on its own entry point.

1. **Layout first, never a real file.** The owner describes the issuer's layout in text, or sends
   the masked "Copy layout" output for rows that couldn't be read. Write a synthetic fixture in
   `apps/web/test-support/synthetic-pdf.ts` (invented names, values and card digits) that has
   the same shapes: kinds, x positions, character counts and offsets.
2. **Parser** in `packages/domain/src/statement-<issuer>.ts`, returning `CardStatementParse`
   like `statement-pnb.ts`: date, amount and Dr / Cr first, then the description through
   `cleanStatementDescription` (runs of 4+ digits stripped); issues by line number and
   `statementRowShape` only, never text; the summary only from labelled values, never guessed;
   self-checks (summary, purchases, invoice total) so `statementNeedsCheck` can gate Save.
3. **Pick it by issuer** in `parseCardStatement` (`statement-pnb.ts`), keyed by the issuer name
   exactly as in `CARD_ISSUERS` (`packages/schemas/src/card-data.ts`, names from the issuer's own
   pages). In `apps/web/components/statements/statement-import.tsx`, treat that issuer as having
   its own reader where PNB is checked today (`issuerIsPnb`, the "Read it as a PNB statement" offer).
4. **Tests:** unit tests for the parser (`statement-<issuer>.test.ts`), a reader test with the
   synthetic PDF (`apps/web/lib/statements/pdf-reader.test.ts`), and an E2E path in
   `apps/web/e2e/statement-import.spec.ts`: lines read, nothing unreadable, checks pass, no digits
   or card numbers on screen.
5. **Keys:** a parser change that alters parsed values changes line keys; note it in the sprint
   plan's known limitations when it affects lines already imported.

## Sprint 10 — Roma, the AI assistant

**Weeks 19–20 \| Usable outcome:** A person asks Roma, the FinCreador
assistant, about their own money and gets a direct answer whose every
figure comes from their records, computed in code. Plan approved by the
owner on 2026-11-05.

### Rules

- The assistant is called **Roma** in the UI, the docs and every product
  reference (never "AI Chat"). Roma is direct and honest, not flattering:
  a straight yes or no, then the reasoning and the numbers. She says
  plainly when a goal is not achievable and what would have to change. No
  praise openers, no softening of bad figures, no padding. These rules
  live in the system prompt and are covered by a test.
- The model is never the source of truth for balances, transactions,
  calculations or permissions. No SQL from the model, ever. Tools are
  thin wrappers around existing loaders and database functions, run with
  the person's own session (RLS). All money arithmetic stays in
  `packages/domain` or the database.
- The model receives compact, structured tool results, never transaction
  dumps. Prompts, tool definitions and model configuration are kept apart.
  The final output is validated with Zod.
- **Figure check:** every amount in Roma's answer must match a figure in
  this request's tool results. If any amount doesn't match, Roma refuses
  to show the answer and says a number could not be verified ("Roma
  couldn't check a number in this answer against your records, so it
  isn't shown. Try asking again."). An unmatched number is never
  stripped, rounded or corrected. The figures panel is built from the
  tool results, not from the model's text.
- Informational only. Roma can't move money, pay, trade or change any
  record.
- No streaming of answer text: an answer is shown only after it has been
  validated. Status-only streaming (progress lines) may come in 10.8.

### Provider

- Claude Haiku 5.5 (`claude-haiku-5-5`) first, server-side only. Prices
  checked against Anthropic's pricing page on 2026-11-05: $0.10 per
  million input tokens and $0.50 per million output tokens for prompts up
  to 100,000 tokens (cache reads $0.01, 5-minute cache writes $0.125);
  $0.50 / $2.50 above 100,000 tokens, which Roma's prompt bounds never
  reach. Estimate: about 4,000 input and 600 output tokens per question,
  about $0.0007, so $5 covers about 7,000 questions.
- A provider abstraction in `apps/web/lib/ai/llm`: our own message, tool
  definition, tool call, response, usage and error types; one adapter per
  provider (`anthropic.ts` is the only file that imports
  `@anthropic-ai/sdk`) and a mock provider. `LLM_PROVIDER` and
  `LLM_MODEL` choose them. Finance tools are provider-independent:
  `{name, description, input (Zod), run}`, converted to each provider's
  tool format by its adapter (`z.toJSONSchema`).
- Settings: adaptive thinking at effort `low`, about 1,500 output tokens,
  20 s per call, one retry, at most 4 model rounds per question, a 45 s
  deadline inside the route's `maxDuration = 60` (Vercel Hobby allows
  300 s with Fluid compute). Past the deadline Roma says the question took
  too long.
- LangChain.js: not used. The abstraction is a few types and one adapter;
  Zod tools exist already; the tool loop is short; a vector store is one
  RPC. Reconsidered only at 10.7 if orchestration grows.

### Cost and safety

- Off until `ANTHROPIC_API_KEY` is set **and** `LLM_ENABLED=true`, and
  off for each person until they turn Roma on in Settings.
- Kill switch and caps: one row in `roma_settings`, changed by the owner
  in the SQL editor with no redeploy (for example
  `update public.roma_settings set enabled = false;`). It holds the
  global monthly budget ($5), the per-person monthly budget ($1), the
  per-person daily question limit (50) and the amount reserved per
  question ($0.01). No client can read or change it, and no limit is
  taken from the caller. `LLM_ENABLED=false` (with a redeploy) and a
  monthly spend limit on a dedicated Anthropic workspace are the other
  two off switches.
- Spend ledger `roma_usage` (no client access): `roma_begin_request`
  checks, under one lock, the kill switch, the opt-in, the global monthly
  cap, the person's monthly cap and their daily question limit, then
  reserves the stored amount. A refusal writes nothing. A reservation
  ends once: **settled** with the real tokens and cost (normally lower
  than the reservation) when a provider call was made, or **released**
  (counts as nothing) when none was (bad input, a failed check, the
  provider not reached). Only a real call consumes budget or the day's
  allowance. A reservation never ended keeps counting at its reserved
  cost. Months are UTC calendar months; the day is the person's own. A
  person calling the function directly gets the same limits, so one
  person can use at most their own monthly cap.
- Consent: `roma_descriptions_ok_at` is set by the database to the time
  of agreeing (any value a client sends becomes now()); null withdraws
  it, and turning Roma off clears it.
- Keys never reach the browser: server-only variables, and the CI secret
  check gets a canary for `ANTHROPIC_API_KEY`.
- No test calls a paid API: every automated test uses the mock provider;
  the Anthropic adapter is tested through the SDK's `fetch` option with
  recorded responses; the factory refuses a real provider when `CI` is
  set; CI passes with no key. A real-model persona check
  (`roma:eval`) is owner-run only, never in CI.

### What leaves the app

- Sent to Anthropic: the question as typed, and tool results (totals,
  category names, account names, currency, date ranges). Never the
  email, display name, phone or record IDs (tools use short handles).
- Transaction descriptions (`transactions.note`) are not sent in 10.1.
  From 10.2, transaction search sends the descriptions of at most 20
  matching entries. Imported descriptions are already cleaned at import
  by `cleanStatementDescription` (UPI remarks keep the payee name only;
  the reference, bank code and handle are dropped; runs of 4 or more
  digits and masks removed), for card PDFs (9a), PNB PDF and CSV (9b)
  and the generic reader (9d). Notes typed by hand are not cleaned, so
  every note is cleaned again before it is sent: digit runs of 4 or more
  stripped (the same `stripDigitRuns` rule) and anything shaped like an
  email or UPI handle (`x@y`) removed.
- Settings toggle text, also shown in Roma the first time a question
  would send descriptions (agreeing there sets
  `roma_descriptions_ok_at`; until then search answers without them):
  "Roma sends your question and summaries of your figures to Anthropic to
  answer it. When you ask her to find transactions, up to 20 matching
  descriptions (which can include payee names) are sent too. Account
  numbers are masked. Off by default."
- The privacy page names Anthropic (and Tavily from 10.8) before outside
  testers; check the providers' current data-retention terms then.

### Steps

Each step is independently testable and deployable.

| **Step** | **Ships** | **Migration** |
|----|----|----|
| **10.1** | One question end to end: provider abstraction (Anthropic and mock), `POST /api/ai/chat` (signed-out callers get 401 JSON, not the sign-in redirect), caps, daily limit, kill switch, the `spending_for_period` tool (presets such as last month, or a from–to range, resolved against the person's own today; at most 5 years; the Overview's spending figure from `transaction_summary`), the figure check, the Roma page and the Settings toggle. "What did I spend last month" works on the live site. | `20261105180000_roma_usage.sql`: `profiles.roma_enabled`, `profiles.roma_descriptions_ok_at`, `roma_settings`, `roma_usage`, `roma_begin_request`, `roma_settle_request`, `roma_release_request` |
| **10.2** | Remaining tools: category breakdown, income vs expenses, savings rate, transaction search (descriptions as above), account balances, net worth, loans and cards. | None |
| **10.3** | Conversation memory: the last few turns as text plus a compact summary of earlier ones, built in code; history listed and deletable. Each request is rebuilt from stored text (check once against the live model that this is accepted with thinking on). | Conversations and messages tables (RLS, deleted with the account) |
| **10.4** | Goal check: projections from `savingPlan`, `monthsToTarget` and `goalFigures` with measured cash flow; a blunt verdict: achievable or not, by when, what would have to change. | None expected |
| **10.5** | Trip check: an estimate from the person's own Travel spending and trip-goal cost lines plus stated assumptions, against goals and cash flow; what to change. Own data only. | None expected |
| **10.6** | Knowledge base with real citations. Embeddings: Supabase's built-in `gte-small` in an Edge Function (free) or Postgres full-text search for a small base; Anthropic has no embeddings API. Who writes and licenses the content is decided before the step. | `vector` extension, documents and chunks |
| **10.7** | Personalised planning combining tools, retrieval and memory. | Maybe |
| **10.8** | Web research for trip and goal estimates (Tavily), after 10.1–10.7 have shipped. Until then estimates come from the person's own data only. | `20261107120000_roma_search.sql`: search caps on `roma_settings`, `roma_search_usage`, `roma_search_begin`, `roma_search_settle`, `roma_search_release` |
| **10.9** | Detailed plans: an intake in code, lookups sent by code, one model round picking by id, a checked plan in a modal and as a PDF, the records verdict first; "Add to my goals". Status below. | `20261107180000_roma_plans.sql`, `20261108120000_goal_from_plan.sql` |

### 10.8 web research (Tavily)

- Same shape as the LLM: a `SearchProvider` adapter (`tavily.ts` with
  plain `fetch`, and a mock), `SEARCH_ENABLED`, `SEARCH_PROVIDER`,
  `TAVILY_API_KEY` (server only), a mock in every test, and the factory
  refuses a real provider in CI.
- Queries are built by the server from a fixed template, never written
  by the model: `kind` (trip or a goal type), `destination` or `item`,
  `month`, `nights` and `travellers` (small integers), one cost line. The
  destination is positively constrained: letters and spaces only, at most
  40 characters and 4 words, no digits, and rejected if it matches
  anything in the person's own data (display name, email, account names,
  category names, payees in their descriptions). A goal item is chosen
  from fixed lists (goal types, vehicle kinds), not typed. Recommended: a
  known-place list for destinations (countries, Indian states and union
  territories, and a few hundred popular cities, about 600 entries,
  refreshed with the quarterly list refresh); a place not on it is not
  looked up. Never the person's names, amounts or account details.
- Searches: basic depth only (1 credit), at most 3 per question in
  parallel, 8 s each (a timed-out search is skipped and the answer says
  so; it still counts as a credit). Caps in `roma_settings` beside the
  model caps, not in the environment: `search_monthly_credits` 900 of the
  free 1,000 (UTC month), `search_user_daily_credits` 5 (the person's
  day), `search_reserve_credits` 3, and a `search_enabled` kill switch.
  Counted in `roma_search_usage` by `roma_search_begin` / `_settle` /
  `_release` on the question's own `roma_usage` reservation (a search not
  sent counts as nothing; begin may grant fewer than 3). At the cap Roma says "Web
  lookups are used up for this month (they reset on the 1st). This
  answer uses your own records only." and still answers.
- Web figures: the model returns each as label, amount, currency, source
  URL and quote. A figure is used only if its URL is one of this
  request's results and the amount appears in that result's text;
  otherwise the figure check above applies and the answer is not shown.
  Totals (nights × rate) are computed in code; foreign prices are never
  converted. The answer shows two blocks: **From your records** and
  **Web estimates — check the source**, each web figure with its link and
  site name.
- Verdict (owner, 2026-11-06): the verdict is always computed from the
  person's own records alone and shown first. A web-assisted verdict, if
  any, is a separate line marked as resting on web estimates; a wrong web
  price can never flip or replace the records-based verdict. Tested with
  a web figure that would change the verdict: both lines are shown.
  Search results are untrusted text and can't trigger any action.
- Gate before the UI: measure, with the owner's key (read from
  `apps/web/.env.local`, git-ignored; never in chat or the repo), how often a real
  web figure appears in the result snippet (about 50 representative
  queries, about 50 credits). If more than 30% would be dropped, use
  Tavily's fuller page content instead (check its credit cost first).
  The measured rate goes in the step's row. Measured 2026-11-06 (50
  basic searches from the templates, 10 domestic and 10 international
  places on stay and transport, food, activities, visa and 2 cars): a
  price in at least one result's snippet for 50 of 50 queries (195 of
  250 result snippets, 78%), so the drop rate is about 0% and snippets
  are used; page text comes in the same call and is also accepted for
  verification (Tavily's docs list no extra credit for it; their usage
  counter hadn't updated by the end of the run, so this is unconfirmed).
  Per search: median 1.7 s, 90th percentile 2.4 s, slowest 5.7 s. Indian
  prices are often written with a scale ("₹7.40 Lakh"): the model reports
  the scale word and the full value is worked out in code.
- Latency: an answer goes from about 3–8 s to about 8–15 s (one more
  model round, up to 3 parallel searches, 3,000–5,000 more input tokens,
  about $0.0004). Bounded by the 45 s deadline inside `maxDuration = 60`;
  `maxDuration` may go to 90 for this route only if measurement needs it.
  Status-only streaming ("Checking your records…", "Looking up
  prices…") while the validated answer is prepared.
- Tavily terms (read 2026-11-05): use is granted "solely for Customer's
  internal business purposes" (section 2); the free plan is "as is" with
  no support (section 5); Tavily holds a perpetual licence to queries and
  may use them to train models (sections 6.5, 9.1, 9.2), which is why
  queries carry nothing personal; no attribution or display requirement
  and nothing on storing results (Roma doesn't store them; each answer
  links its sources). The terms don't say whether the free plan allows
  commercial use: get Tavily's written confirmation before any commercial
  launch. Paid: pay-as-you-go $0.008 per credit, or Project $30 a month
  for 4,000 credits. Example: 1,000 questions a month with web lookups,
  3 searches each, is 3,000 credits, about $24 pay-as-you-go.

### 10.9 detailed plans: status and handoff (2026-11-08)

**Merged and deployed (before 10.9):** 10.1–10.5 and 10.8 (PRs #53–#63). **10.9 is all on draft PR #64** (branch `sprint-10.9-plans`), unmerged:
- Plan code with the timeout fallback, the intake, the modal, Save as PDF (migration `20261107180000_roma_plans.sql`, on dev, not prod).
- Follow-ups: a price needs its subject; rupee lookups and Indian pages first; prices converted with a fixed rate table; a trip verdict from two signals.
- The last round of fixes, all in the PR with CI green (commits 781c901, 903c930): (1) hotel listing pages (Kayak, Trivago, Booking, Expedia, MakeMyTrip) as a source of name-plus-rate pairs, the rate taking the hotel named in its own card; (2) per-km, per-trip, per-hour and outstation fares never feed a per-day line (food, local travel), each dropped and counted by reason; (3) cost-of-living and food guides count as a food page's subject. Live Delhi-to-Chennai plan: 6 of 6 lines on replayed live pages.
- "Add to my goals" and intake errors that name the question and the reason (commit 7a6956e). Migration `20261108120000_goal_from_plan.sql` (`goals.plan_message_id`): owner applied to dev 2026-11-08; not on prod.

**Built 2026-11-09 (branch `sprint-10.9-suggest-models`, see the decisions log): purchase plans suggest models instead of asking for make and model.**
1. Intake: what kind (bike, car, house, other); budget, or "work it out from my records" (free money by the month after other goals, plus any trade-in); main use (city commute, touring, family, first vehicle); when; trade-in or deposit. Make and model optional, behind "I already know the model".
2. Two fixed-template lookups, no budget figure in any query: "best ‹use› ‹bikes|cars› in India ‹month year› price list" and "‹entry-level|mid-range|premium› ‹bikes|cars› price list India" (the segment word from the budget band, in code). House and other: no model lookups.
3. Extraction in code: a candidate is a make and model from `VEHICLE_CATALOGUE` found on a page, paired with a price in the same listing card or sentence (as hotels are), checked against its page, kept when it fits the budget. The model picks candidate ids that fit the use; it never types a name or an amount.
4. Beyond name and price, only when on the same card: engine cc, mileage (kmpl) or EV range, fuel, seats (cars), a body word (SUV, sedan, hatchback, scooter, cruiser). Nothing inferred; "ex-showroom" only when the page says so.
5. Modal comparison: model, price range, descriptor, "listed on ‹site›" with the link; not Roma's recommendation.
6. Verdict per candidate on the same projection (price minus trade-in against free money by the month), one line for the shortlist; "Pick this model" runs today's model plan (price and first-year insurance).
7. Lookups: a shortlist plan 2, a picked model a second plan of 2 (at most 4, under the plan cap of 8). Storage: a new top-level `candidates` key on `ai_messages.plan`. It was to be folded into `20261108120000_goal_from_plan.sql`, but that migration is now on dev, so it needs its own new migration changing the `ai_messages_plan_shape` key list (never edit an applied migration).
8. Before any UI: a live measurement on two queries (`ROMA_LIVE=1`, `PLAN_RECORD` to save pages), reporting how many candidates come back with a price. Then fixtures (listing cards, unrelated nearby prices), a test that no amount reaches a query, a verdict per candidate, E2E on the mock search.

**Known gaps:** stay and food often have no estimate (prices without a subject or unit are dropped); budget trips name fewer hotels and rarely a rate; no live fares or room rates; mobile has no plans; a home city on the profile (to prefill the origin) is still backlog.

### Environment (server only)

`LLM_ENABLED=false`, `LLM_PROVIDER=anthropic` (or `mock`),
`LLM_MODEL=claude-haiku-5-5`, `ANTHROPIC_API_KEY=`. The caps are not
environment variables: they live in `roma_settings` (global $5 and
per-person $1 a month, 50 questions a day, $0.01 reserved per question),
so no caller can supply them. From 10.8: `SEARCH_ENABLED=false`,
`SEARCH_PROVIDER=tavily` (or `mock`), `TAVILY_API_KEY=` (a canary value
in CI); the search caps live in `roma_settings`. Preview
deployments keep Roma off or on the mock.

### Acceptance criteria

- Totals and comparisons are computed in validated code or SQL, never by
  the model; an answer with a number that can't be matched to a tool
  result is not shown.
- Responses are bounded, validated and labelled informational; Roma
  can't initiate payments, transfers, trades or any other action.
- Only the data listed under "What leaves the app" is sent; keys stay
  server-side.
- The caps, the daily limit and the kill switch are enforced on the
  server; a question that never reached the provider consumes nothing.
- The feature degrades gracefully when the provider is off, over budget
  or unavailable.
- CI passes with no API key and never calls a paid API.

**Dependencies:** stable dashboard, goals and portfolio data (Sprints
5–8).

## Sprint 11 — Notifications and reminders

**Weeks 21–22 \| Usable outcome:** A user can receive and control
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

## Sprint 12 — Mobile polish, offline support and PWA

**Weeks 23–24 \| Usable outcome:** The app is dependable across
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

## Sprint 13 — Security, release and production readiness

**Weeks 25–26 \| Usable outcome:** A tested release candidate is ready
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
| **Vercel Hobby is non-commercial only** | Treat Hobby as a testing tier; upgrade to Pro or move hosting before any paid or commercial launch (decision due in Sprint 13, or earlier if monetized). |
| **Design drift between Figma, web and mobile** | Single token source in `packages/design-tokens`; `docs/design-spec.md` as the visual source of truth; dev-only design review page. |
| **Local disk or tooling limits** | Run database, RLS and build checks in GitHub Actions; check free disk before large downloads; no local Docker/Supabase on the development Mac. |

# 8. Release milestones

| **When** | **Milestone** | **Exit condition** |
|----|----|----|
| **End Sprint 2** | Account foundation | Authentication and account setup work; internal testing starts. |
| **End Sprint 3** | Daily transaction ledger | Core expense tracking is usable. |
| **End Sprint 5** | MVP / controlled web release | Auth, accounts, transactions, income, dashboard. |
| **End Sprint 8** | Money management release | Goals, portfolio, liabilities, reports. |
| **End Sprint 11** | Insights and reminders | AI and notifications behind appropriate controls. |
| **End Sprint 13** | Production release candidate | Security, quality, deployment, and store-submission readiness. |

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
