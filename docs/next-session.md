# Next session: Sprint 7 (Investment portfolio)

**State (2026-10-26).** Sprints 1–5 are on `main`. Sprint 6 (Goals: planned expenses and monthly budgets, web only) is complete on draft PR #30, CI green, waiting for the owner's merge. The first production deploy (Vercel Hobby, Supabase Free) works, including Google sign-in. Mobile Overview and mobile Goals are in the backlog.

**Migrations.** All in `supabase/migrations/`. On **both** dev and prod:
`20261021183415` profiles · `20261022150000` accounts and income · `20261022190000` one cash account · `20261023120000` expenses, transfers, edits · `20261023180000` drop `void_income` · `20261024120000` recurring rules · `20261026120000` dashboard breakdown.
On **dev only** (Sprint 6): `20261026180000` goals and budgets · `20261026200000` vehicle type · `20261026210000` delete archived goals.
Check `supabase migration list --linked` against each project before any database work. Status, steps and decisions: `docs/sprint-plan.md`; deploy steps: `docs/deployment.md`.

**Every new migration goes to dev AND prod.** Dev first, after the owner's SQL review and green CI. Prod only from a clean `main` checkout after the PR is merged, and only after a manual backup of prod (`./scripts/backup-prod.sh`, `docs/deployment.md` section 4). Push prod before deploying code that needs the migration; link back to dev afterwards. Never edit an applied migration or reset a database.

**Before production.**
- Sprint 6 on prod: after PR #30 is merged, back up prod, then push `20261026180000`, `20261026200000` and `20261026210000` from `main`, then deploy.
- Remove `exp://**` and `localhost` entries from the development project's redirect list once mobile release builds exist (prod has only `https://<your-app>.vercel.app/auth/callback**`); drop `npm run dev:mobile:google`; fixed `fincreador://` scheme in release builds.
- Custom SMTP before inviting testers; weekly manual prod backups; Vercel Pro and Supabase Pro before any commercial use.
- Pending: Google sign-in on iPhone.

**Working rules (owner).**
- The owner marks PRs ready and merges them. Open draft PRs only; never mark one ready or merge it.
- No `db push` by Claude. Show new migration SQL for line-by-line review before any test, commit or push; the owner runs `supabase db push --dry-run`, then `db push`, on dev and then on prod.
- Database and E2E tests run in CI only (no Docker or local Supabase on the Mac). Run `npm run typecheck`, `npm run lint` and `npm test` before every push. Screenshots come from CI (`e2e-screenshots` artifact); copy the ones for review into `docs/design/<sprint>/`.
- No real project refs, URLs, emails or keys in the repository; use placeholders such as `<prod-project-ref>` and `<your-app>`.
- Web density (2026-10-26): 14px root, 36px controls, minimum text 12px; dialogs with many fields keep a sticky footer and must fit a 720px-high window.
- Stop points: SQL ready for review; CI green on a migration (for the owner's db push); a rule the sprint plan doesn't cover; CI still red after two fix attempts; before a PR is made ready.
- Reports: at most 15 lines. No recaps of unchanged work.
- Mobile goes in a separate PR after web.

**Sprint 7 notes.** Scope in the Sprint 7 section of the plan (stocks, mutual funds, ETFs, deposits, custom assets; units, cost basis, fees, valuation date; invested, current value, unrealized gain/loss, allocation; manual valuations; manual / delayed / live values told apart). Market-data decisions are in "Sprint 7 Investments: market data decisions" (AMFI NAV file, NSE/BSE end-of-day files only after checking redistribution terms, `pg_cron` + Edge Function, "closing price on <date>", no live claims). Recurring: the quarterly list refresh (`docs/quarterly-list-refresh.md`), next in January 2027.

**Start prompt (paste into a fresh session):**

```text
Start Sprint 7 (Investment portfolio). Read CLAUDE.md, docs/sprint-plan.md and docs/next-session.md first.
Then give me a plan of at most 25 lines: scope from the sprint plan, what already exists, the first step, and only the questions that block the work, each with your recommendation.
Wait for my one reply. After it, work through everything that stays green without pausing.
Stop only at: the SQL review (show migration SQL before any test or push), the db push (I run it, dev then prod from main), a rule the sprint plan doesn't cover, CI still red after two fix attempts, or before a PR is made ready.
Never mark a PR ready or merge it. Keep each report to at most 15 lines.
```
