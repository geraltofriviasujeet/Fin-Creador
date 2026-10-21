# Fin Creador --- Claude Code Project Instructions

> **Purpose:** This file is the persistent source of truth for Claude
> Code. Read it before making changes. Follow it across every sprint so
> the product, architecture, calculations, security, and UI remain
> consistent while avoiding repeated explanations.

## 1. How to work in this repository

1.  Before coding, inspect the existing repository, `package.json`, app
    routes, database schema/migrations, shared components, tests, and
    Git status.
2.  Treat the current codebase as authoritative for implementation
    details. Do not replace working architecture or rewrite files
    wholesale without a clear reason.
3.  Read this file first. Then read only the relevant feature
    documentation and code. Do not re-ask for requirements already
    specified here.
4.  Work only on the requested sprint or task. Do not silently begin
    later-sprint features, broad refactors, or unrelated redesigns.
5.  Implement a complete, usable vertical slice: data model/migration
    (when needed), validation, server-side logic, UI,
    error/loading/empty states, and tests.
6.  Prefer small, reviewable changes. Reuse existing patterns and
    dependencies. Do not add a dependency if the existing stack can
    solve the problem cleanly.
7.  Do not fabricate successful test results. Run relevant checks and
    report exactly what passed, failed, or could not be run.
8.  Never delete user data, reset a database, rewrite migration history,
    force-push, or run destructive commands without explicit approval.
9.  Do not commit, push, deploy to production, or change external
    services unless explicitly requested.
10. If requirements are genuinely ambiguous and the choice affects
    security, data integrity, or a major architecture decision, ask one
    concise question. Otherwise choose the simplest consistent approach
    and document it.
11. At the end, summarize: what changed, files affected,
    migrations/environment variables, tests run, known limitations, and
    the exact next step.
12. Keep this file concise as the project evolves. Update it when a
    durable decision changes; do not append temporary sprint notes here.
13. When finishing a sprint or step, update the status table and
    decisions log at the top of `docs/sprint-plan.md`.

## 2. Product definition

**Product name:** Fin Creador\
**Product type:** Personal Financial Operating System\
**Primary goal:** Make it effortless for a person to record daily money
activity, understand their financial position, manage investments, and
plan future expenses.

### Platforms

-   Web: responsive web application.
-   Mobile: Android and iOS using React Native with Expo.
-   All clients share one backend, financial definitions, validation
    rules, and data model.
-   Do not build three independent products or duplicate financial logic
    in each client.
-   A feature is complete only when it works on the platform(s) in the
    sprint scope and has appropriate tests.

### Core feature areas

1.  Authentication and user profile.
2.  Bank, cash, savings, and other accounts.
3.  Expenses, income, transfers, categories, search, and transaction
    history.
4.  Income sources: salary, rent, freelance, business, cash, and other
    sources.
5.  Dashboard with daily, weekly, monthly, yearly, and custom date
    ranges.
6.  Budgets and savings goals for travel, vehicles, a home, emergency
    funds, and other plans.
7.  Investment portfolio: shares/stocks, mutual funds, ETFs, deposits,
    and other assets.
8.  Loans, credit-card liabilities, repayments, and EMIs.
9.  Reports and CSV export; PDF export where in scope.
10. AI-powered explanations and financial insights.
11. Notifications, including an optional daily 10 PM expense reminder.
12. Security, privacy, accessibility, offline handling, and account
    deletion.

Build in the sprint explicitly requested. Do not assume all features
belong in the MVP.

## 3. Product and UX principles

-   Optimize first for fast, low-friction daily expense entry.
-   Use a premium, calm, trustworthy finance-product aesthetic: dark
    forest green (ink, nav, accent-deep) with a lime accent, restrained
    neutrals, Manrope headings and DM Sans body text. Token values live
    only in `packages/design-tokens`; the visual spec is
    `docs/design-spec.md`.
-   Lime is a fill/highlight color, never text on light backgrounds.
    Text colors must meet WCAG AA (4.5:1); minimum text size is 12px.
-   Favor clarity and accessibility over decorative effects. Avoid
    excessive gradients, oversized cards, visual clutter, and
    unnecessary animations.
-   Maintain consistent spacing, typography, icons, buttons, forms,
    dialogs, tables, chart styles, and navigation.
-   Prefer reusable design tokens and shared components over duplicated
    styling.
-   Design responsive web layouts and mobile-native interaction
    patterns. Do not simply shrink the desktop layout onto mobile.
-   Every data screen should have loading, empty, error, and success
    states as appropriate.
-   Use realistic, clearly labeled demo data only in seed/demo
    environments. Never show fake data as if it were a user's real
    financial information.
-   Provide helpful form validation and preserve user input after
    recoverable errors.
-   Do not make important actions available only through color or hover.
-   Respect reduced motion and keyboard/screen-reader accessibility
    where applicable.
-   Avoid adding a new design system or component library without
    checking the existing repository first.

## 4. Technology and architecture

Use the following defaults unless the existing repository or an
explicitly approved decision says otherwise.

### Web

-   Next.js App Router, React, and TypeScript.
-   Tailwind CSS and shadcn/ui for consistent accessible components.
-   Use server components by default; add client components only when
    interaction or browser APIs require them.
-   Keep route-specific UI in the relevant `app/` route and reusable UI
    in `components/`.
-   Keep server-side database operations and domain services out of
    client components.

### Mobile

-   React Native with Expo for Android and iOS.
-   Share pure TypeScript domain logic, validation schemas, API
    contracts, and design tokens where practical.
-   Do not import web-only components into mobile.
-   Treat mobile navigation, keyboard handling, safe areas, offline
    states, and permissions as first-class requirements.

### Backend and data

-   Supabase with PostgreSQL and Supabase Auth.
-   Use `@supabase/ssr` for the Next.js server/browser clients where
    appropriate.
-   Keep the existing auth callback route at
    `app/auth/callback/route.ts` if it exists; do not casually move or
    duplicate it.
-   Put schema changes in versioned Supabase migrations.
-   Use generated or maintained database types. Avoid untyped database
    access and `any` unless narrowly justified.
-   Use server actions, route handlers, or Supabase Edge Functions
    according to existing project patterns. Do not create multiple
    competing patterns for the same operation.
-   Enforce user data isolation with Row Level Security (RLS), not just
    UI filters.
-   Keep service-role credentials and AI provider secrets server-side
    only.

### Hosting, CI and scheduling

-   Web hosting: Vercel Hobby for now. Hobby is non-commercial only;
    upgrade to Pro (or move hosting) before any paid or commercial
    launch.
-   CI: GitHub Actions on pull requests (`.github/workflows/ci.yml`)
    runs lint, typecheck, unit tests, build, migrations and pgTAP tests
    on a throwaway database. Database and RLS tests run there, not on
    the development Mac: do not start Docker or local Supabase, and
    check free disk before any large download.
-   Scheduled jobs and reminders use Supabase scheduling (`pg_cron`,
    Edge Functions), not Vercel Cron (Hobby cron is once a day with up
    to an hour of drift).
-   Visual source of truth: `docs/design-spec.md`; token values live
    only in `packages/design-tokens`.

### Suggested monorepo layout

Adapt to the existing repository rather than forcing this structure onto
an established codebase.

``` text
apps/
  web/                 # Next.js web app, if using a monorepo
  mobile/              # Expo app, if using a monorepo
packages/
  domain/              # Pure financial rules and calculations
  schemas/             # Shared validation schemas
  api/                 # Shared typed API contracts/client
  design-tokens/       # Shared brand tokens
supabase/
  migrations/
  functions/
  tests/
docs/
  product-requirements.md
  architecture.md
  data-model.md
  sprint-plan.md
```

In an existing single-app repository, preserve its current layout and
use clear folders such as `app/`, `components/`, `lib/`, `hooks/`,
`types/`, and `supabase/` where suitable.

## 5. Financial domain rules --- critical

Financial calculations must be deterministic, tested, documented, and
consistent across web and mobile. Never ask an LLM to calculate
authoritative balances.

### Transaction types

Keep these concepts distinct:

-   **Income:** money earned or received and classified as income.
-   **Expense:** money spent and classified as an expense.
-   **Transfer:** money moved between accounts owned by the same user;
    it is neither income nor expense.
-   **Investment purchase/sale:** movement into or out of an investment
    asset; do not automatically treat the purchase amount as ordinary
    spending.
-   **Liability payment:** distinguish principal repayment, interest,
    and fees where the data model supports it.
-   **Refund/reversal:** preserve traceability and avoid silently
    double-counting the original transaction.

### Canonical metrics

-   **Period income:** sum of eligible income transactions in the
    selected period.
-   **Period expenses:** sum of eligible expense transactions in the
    selected period.
-   **Net cash flow:** period income minus period expenses, with
    explicitly documented treatment of refunds and excluded transaction
    types.
-   **Account balance:** opening/starting balance plus posted inflows
    minus posted outflows, including transfers and other
    balance-affecting events.
-   **Net worth:** assets minus liabilities, using clearly defined
    valuation timestamps.
-   **Investment gain/loss:** current investment value minus cost basis,
    with fees, distributions, realized gains, and taxes handled
    according to the supported model. Do not imply precision the data
    cannot support.

### Balance and income-source rules

-   The Income page must combine bank accounts and other income-source
    balances.
-   **Total Balance = Bank Balance + all other income-source balances,
    including Cash and any other income/source balances.**
-   Do not calculate Total Balance as Bank Balance plus Cash only.
-   Define which source types contribute to this metric in code and
    tests.
-   Prevent double-counting when money moves between accounts or when an
    income source is linked to an account.
-   Income earned during a period is not necessarily the same thing as
    the current balance of an account or source. Keep these metrics
    separate.
-   Do not add all historical income to current balances a second time
    if the same receipts are already reflected in account transactions.

### Date, currency, and precision

-   Store timestamps consistently; use the user's configured time zone
    for day/week/month boundaries and scheduled reminders.
-   Default user settings for the India-first experience: country
    `India`, currency `INR`, time zone `Asia/Kolkata`. Let users change
    these settings.
-   Store monetary values using an exact database representation such as
    integer minor units or PostgreSQL `numeric`; do not use binary
    floating point for authoritative money arithmetic.
-   Format values according to the user's currency and locale.
-   Document whether date ranges are inclusive and test month/year
    boundaries, leap years, and time-zone boundaries.
-   Do not assume all users use INR or the same time zone.

### Data integrity

-   Use stable IDs and explicit ownership.
-   Prefer soft archive for user-facing categories/accounts when hard
    deletion could damage historical reporting.
-   Use database transactions for multi-step balance-affecting
    operations.
-   Prevent duplicate submissions with idempotency or duplicate
    protection where needed.
-   Use constraints and indexes for integrity and common queries.
-   Keep transaction history auditable; never silently rewrite
    historical financial data when updating a category or account.

## 6. Authentication, authorization, and privacy

-   Support email/password and Google OAuth as planned; add Apple
    sign-in where required by platform distribution and chosen auth
    setup.
-   Support secure sign-out, password recovery, session handling,
    profile editing, and account deletion.
-   Use the existing Supabase SSR/auth conventions. Do not create a
    second auth system.
-   Enforce RLS for every user-owned table and storage bucket. Test both
    allowed access and cross-user denial.
-   Verify authorization on the server for every sensitive operation;
    hidden UI is not authorization.
-   Never expose Supabase service-role keys, API secrets, access tokens,
    or private financial data in browser bundles, logs, analytics, or
    error messages.
-   Validate and normalize all user input on the server, including
    transaction amount, ownership, category, account, date, and
    currency.
-   Use rate limiting and abuse protections for auth, AI, exports, and
    other sensitive endpoints where applicable.
-   Collect only data needed for the feature. Make optional AI
    processing clear to users.
-   Provide a safe account-deletion flow and follow the product's
    data-retention policy.
-   Never use real personal financial data in test fixtures,
    screenshots, prompts, or logs.

## 7. AI insight rules

-   AI insights are optional enhancements, not a source of truth for
    financial calculations.
-   Calculate figures, comparisons, totals, trends, and anomalies in
    validated SQL/TypeScript first; pass only the necessary summarized
    data to the model.
-   Explain the period and data behind each insight. Distinguish
    observed facts from suggestions or hypotheses.
-   Never invent transactions, balances, holdings, market prices, or
    user goals.
-   Never claim a market price is live unless a trusted provider and
    timestamp confirm it.
-   Do not send secrets or unnecessary personally identifying
    information to an AI provider.
-   Keep provider keys server-side and use a provider abstraction so the
    model can be changed without rewriting business logic.
-   Treat user financial data and model output as untrusted input.
    Validate structured model output before rendering.
-   Do not let the model execute transfers, trade securities, make
    payments, or perform other financial actions.
-   Present insights as informational, not guaranteed outcomes or
    personalized regulated investment/tax advice.
-   Do not call a model for simple arithmetic that application code can
    perform.

## 8. Notifications and scheduled tasks

-   Daily expense reminder default: 10:00 PM in the user's local time
    zone, configurable and opt-out.
-   Ask for OS notification permission at an appropriate moment; do not
    assume permission is granted.
-   Schedule notifications through a reliable server-side/supported
    delivery mechanism rather than relying on the app remaining open.
    Use Supabase scheduling, not Vercel Cron (see section 4).
-   Handle disabled reminders, time-zone changes, daylight-saving
    changes, invalid push tokens, and delivery failures.
-   Do not promise exact delivery time where the operating system or
    push provider cannot guarantee it.
-   Keep notification preferences synchronized across devices.
-   Never send sensitive transaction details in a lock-screen
    notification by default.

## 9. Data model guidance

Adapt names to existing schema and avoid duplicate tables for concepts
already modeled.

Likely entities include:

-   `profiles`
-   `accounts`
-   `transactions`
-   `categories`
-   `income_sources` (only if distinct from accounts and not redundant)
-   `budgets`
-   `financial_goals`
-   `investment_accounts`
-   `investment_holdings`
-   `investment_transactions`
-   `liabilities`
-   `recurring_rules`
-   `notifications` or notification preferences/tokens
-   `subscriptions` only if/when subscription functionality is in scope

For every table, decide: primary key, `user_id` ownership, timestamps,
constraints, indexes, deletion behavior, RLS policies, and whether it
contains money or sensitive data. Do not create a separate table merely
because a screen exists. Keep the model normalized enough to prevent
conflicting sources of truth.

Existing profile conventions to preserve if present: India, INR,
`Asia/Kolkata`; profile fields may include phone, avatar, country,
currency, and time zone. Preserve existing subscription triggers and
trial behavior unless the requested task explicitly changes them.

## 10. Testing and quality gates

For each feature, add tests appropriate to its risk:

-   Unit tests for financial formulas, date ranges, currency formatting,
    and validation.
-   Integration tests for database operations, RLS, and server-side
    authorization.
-   End-to-end tests for critical journeys such as sign-up, adding an
    expense, editing a transaction, transferring money, and viewing
    reports.
-   Cross-user tests proving one user cannot read or modify another
    user's data.
-   Responsive/accessibility checks for web and device/platform checks
    for mobile.
-   Tests for loading, empty, error, and retry states.

Before declaring a task done, run the repository's existing scripts,
typically lint, typecheck, unit tests, and build. Discover actual script
names in `package.json`; do not invent commands. If a check cannot run,
explain why. Fix issues caused by the change.

## 11. Sprint workflow

For each requested sprint:

1.  **Inspect:** read this file, sprint requirements, relevant source
    files, existing tests, and current Git diff.
2.  **Plan:** list the smallest implementation steps and acceptance
    criteria. Identify schema, RLS, migration, and environment changes.
3.  **Implement:** finish one vertical slice with reusable patterns and
    no unrelated scope.
4.  **Validate:** run migrations/tests safely in the intended
    environment, plus lint/typecheck/build as available.
5.  **Review:** inspect the diff for security, data integrity, duplicate
    logic, responsive behavior, and accidental changes.
6.  **Document:** update relevant product/architecture/data-model docs
    if durable decisions changed.
7.  **Report:** state implemented behavior, files changed, migration/env
    steps, test results, known limitations, and next sprint dependency.

Every sprint must end with a usable feature. Prefer a working, narrow
feature over many unfinished screens.

## 12. Definition of done

A feature is done only when:

-   Its acceptance criteria are met.
-   Data model and migrations are correct and version-controlled, if
    applicable.
-   Server-side validation and authorization are in place.
-   RLS policies are tested for allowed and denied access.
-   UI includes loading, empty, error, and success states where
    applicable.
-   Financial calculations are tested and consistent across clients.
-   Relevant tests, lint, typecheck, and build pass, or failures are
    explicitly reported.
-   No secrets or sensitive data leak to clients/logs.
-   Documentation and configuration instructions are updated where
    needed.
-   The change is deployable to the intended test environment without
    destructive shortcuts.

## 13. Token-efficiency rules for Claude Code

-   Treat this file as the persistent project brief; do not repeatedly
    restate it in every prompt.
-   Inspect only files relevant to the requested sprint, expanding scope
    when dependencies require it.
-   Search for an existing component, helper, schema, or calculation
    before creating another.
-   Do not re-read large files or whole directories unnecessarily; use
    targeted searches and diffs.
-   Do not regenerate files that already work just to match personal
    preferences.
-   Prefer concise plans and focused patches over long explanations.
-   Do not add speculative features, dependencies, abstractions, or
    documentation.
-   Reuse established names and patterns. If a pattern is flawed,
    explain the issue and make the smallest safe correction.
-   Keep this file as the stable baseline; put sprint-specific
    acceptance criteria in `docs/sprint-plan.md` or the task prompt.
-   If this file conflicts with the actual repository, inspect evidence
    and explain the discrepancy before making a structural change.

## 14. Sprint completion response format

At the end of each task, report:

1.  **Outcome:** what is now usable.
2.  **Files changed:** concise list grouped by purpose.
3.  **Database/config:** migrations and environment variables required.
4.  **Validation:** exact commands run and their results.
5.  **Security/data integrity:** relevant checks performed.
6.  **Known limitations:** only real remaining issues.
7.  **Next step:** the next logical task, without starting it
    automatically.

------------------------------------------------------------------------

**Default decision:** favor correctness, privacy, consistency, and a
small usable release over feature count or visual novelty.
