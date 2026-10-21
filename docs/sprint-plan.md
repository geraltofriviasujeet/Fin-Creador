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
Last updated: 2026-10-22.

## Sprint status

| **Sprint** | **Focus** | **Status** | **Notes** |
|----|----|----|----|
| **1** | Foundation, authentication & profile | In progress | See Sprint 1 steps below. |
| **2** | Accounts & starting balances | Not started | |
| **3** | Expense & transaction tracking | Not started | |
| **4** | Income sources & recurring items | Not started | |
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
| **1. Monorepo skeleton** | Done | npm workspaces: `apps/web` (Next.js), `apps/mobile` (Expo shell), `packages/schemas`, `packages/design-tokens`; shared TS/ESLint/Vitest config. In PR #1 (open, not merged). |
| **Design pass and app shell** | Done | Tokens, fonts, logo, primitives, web shell, styled auth and Settings screens, dev-only `/dev/design`. Visually reviewed and approved at desktop, tablet and phone widths. In PR #1. |
| **2. Profiles migration, RLS and pgTAP tests** | In progress | Migration (approved) and 35 pgTAP tests on branch `sprint-1-step-2-profiles`, in a PR into `sprint-1-foundation`; first CI run pending. Not pushed to the hosted Supabase project (`supabase db push` awaits approval). |
| **3. Web auth wiring (Supabase)** | Not started | Auth and Settings forms validate input but store nothing yet. |
| **4. Mobile shell (auth, profile)** | Not started | |
| **5. Tests (E2E, secret check)** | Not started | Unit tests exist for schemas, tokens and formatting. |
| **6. CI and setup docs** | In progress | CI workflow (`.github/workflows/ci.yml`) in the same PR; first run pending. `docs/setup.md` not started. |

## Decisions

| **Date** | **Decision** | **Reason / consequence** |
|----|----|----|
| **2026-10-21** | UI follows the Figma Make design, adopted as `docs/design-spec.md`: dark forest green with a lime accent. This replaces the emerald brand color. | One visual source of truth for web and mobile. Text colors that failed WCAG AA were darkened; input borders darkened to 3:1; minimum text 12px. |
| **2026-10-22** | Database and RLS tests run in GitHub Actions, not on the development Mac. Do not start Docker or local Supabase there; check free disk before any large download. | A local Supabase start filled the Mac's disk. CI uses a throwaway database and never touches the hosted project. |
| **2026-10-22** | Web hosting is Vercel Hobby. | Hobby is for non-commercial use only: upgrade to Pro (or move hosting) before any paid or commercial launch. |
| **2026-10-22** | Scheduled jobs and reminders use Supabase scheduling (`pg_cron` and Edge Functions), not Vercel Cron. | Vercel Hobby cron runs at most once a day with up to an hour of drift — not enough for a 10 PM reminder in each user's time zone. |

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
| **2** | Weeks 3–4 | Accounts & starting balances | Create bank, cash, savings, and other accounts. |
| **3** | Weeks 5–6 | Expense & transaction tracking | Add, edit, search, filter, and review transactions. |
| **4** | Weeks 7–8 | Income sources & recurring items | Track multiple income sources and recurring entries. |
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

## Sprint 2 — Accounts and starting balances

**Weeks 3–4 \| Usable outcome:** A user can create accounts and see
where their money is held.

### Scope and deliverables

- Support bank, cash, savings, and other account types.

- Add opening balances, account names, optional institution/labels, and
  currency.

- Implement create, edit, archive, and balance views.

- Add constraints, indexes, ownership checks, and RLS tests.

### Acceptance criteria

- Account CRUD works for an authenticated user.

- Users cannot read or modify another user’s accounts.

- Money uses exact representations, not binary floating point.

- Archived accounts do not corrupt historical reports.

### Design deliverables

- Accounts screens, following `docs/design-spec.md`.

**Dependencies:** Sprint 1 authentication and database foundation.

## Sprint 3 — Expense and transaction tracking

**Weeks 5–6 \| Usable outcome:** A user can maintain a reliable daily
transaction ledger.

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

## Sprint 4 — Income sources and recurring items

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
