# Next session: Sprint 8 (Loans, liabilities and reports)

**State (2026-10-27).** Sprints 1–7 are on `main` and deployed (Vercel Hobby, Supabase Free). Sprint 7 (Investments, web only: shares, mutual funds and ETFs at the previous close from BSE and AMFI, fixed deposits, per-kind tabs, Overview card, daily `refresh-prices` job) merged with PR #32; prod migrations, the prod function and its first run are done and the live site is checked. Mobile Overview, Goals and Investments are in the backlog.

**Migrations.** All in `supabase/migrations/`.
On **dev and prod**: `20261021183415` profiles · `20261022150000` accounts and income · `20261022190000` one cash account · `20261023120000` expenses, transfers, edits · `20261023180000` drop `void_income` · `20261024120000` recurring rules · `20261026120000` dashboard breakdown · `20261026180000` goals and budgets · `20261026200000` vehicle type · `20261026210000` delete archived goals · `20261027120000` instruments and investments · `20261027180000` price refresh run log and `pg_cron` job · `20261027200000` fixed deposits.

Check `supabase migration list --linked` against each project before any database work. Status, steps and decisions: `docs/sprint-plan.md`; deploy steps: `docs/deployment.md` (4a dev refresh, 4b prod refresh).

**First check (owner).** After 07:00 IST on 28 Oct 2026, check `price_refresh_runs` on dev and on prod (the last-7-days query in `docs/deployment.md` 4a): the first scheduled run should add one `amfi` and one `bse` row on each project, both with `finished_at`. A missing row means the run died (function logs and `cron.job_run_details`).

**Every new migration goes to dev AND prod.** Dev first, after the owner's SQL review and green CI. Prod only from a clean `main` checkout after the PR is merged, and only after a manual backup of prod (`docs/deployment.md` section 4). Push prod before deploying code that needs the migration; link back to dev afterwards. Never edit an applied migration or reset a database.

**Before production.**
- Remove `exp://**` and `localhost` entries from the development project's redirect list once mobile release builds exist (prod has only `https://<your-app>.vercel.app/auth/callback**`); drop `npm run dev:mobile:google`; fixed `fincreador://` scheme in release builds.
- Custom SMTP before inviting testers; weekly manual prod backups; Vercel Pro and Supabase Pro before any commercial use.
- Review the licence terms of the market data (AMFI, BSE, and NSE if added) before any commercial use (upgrade checklist in `docs/deployment.md`).
- A paused Free project stops the daily price job: after a restore, check `cron.job_run_details` and run the refresh once by hand.
- Pending: Google sign-in on iPhone.

**Working rules (owner).**
- The owner marks PRs ready and merges them. Open draft PRs only; never mark one ready or merge it.
- No `db push` by Claude. Show new migration SQL for line-by-line review before any test, commit or push; the owner runs `supabase db push --dry-run`, then `db push`, on dev and then on prod. After a dev push, regenerate `npm run db:types` and commit only if it differs.
- Database and E2E tests run in CI only (no Docker or local Supabase on the Mac). Run `npm run typecheck`, `npm run lint` and `npm test` before every push. Screenshots come from CI (`e2e-screenshots` artifact); save the ones for review only in `docs/design/<area>/`.
- No real project refs, URLs, emails or keys in the repository; use placeholders such as `<prod-project-ref>` and `<your-app>`. Secrets live in private files outside the repo, never in chat.
- Web density: 14px root, 36px controls, minimum text 12px; dialogs with many fields keep a sticky footer and must fit a 720px-high window.
- Stop points: SQL ready for review; CI green on a migration (for the owner's db push); a rule the sprint plan doesn't cover; CI still red after two fix attempts; before a PR is made ready.
- Reports: at most 15 lines. No recaps of unchanged work.
- Mobile goes in a separate PR after web.

**Sprint 8 notes.** Scope in the Sprint 8 section of the plan: loans, credit-card liabilities, repayments and EMI schedules (principal, interest and fees kept apart where supported); net worth and cash-flow history; CSV export (PDF optional). Acceptance: net worth = included assets − included liabilities; repayments don't double-count principal as ordinary expenses; exports respect permissions and date filters and never leak another user's data. Decide early whether investments and fixed deposits count in net worth (they are "Not included in Total available" today) and at which valuation date. Reuse the EMI maths in `packages/domain/src/goals.ts` and the goals pattern (archive, restore, delete when archived). Credit cards were deferred from Sprint 3 to here. Recurring: the quarterly list refresh (`docs/quarterly-list-refresh.md`, now including `FD_BANKS`), next in January 2027.

**Start prompt (paste into a fresh session):**

```text
Start Sprint 8 (Loans, liabilities and reports). Read CLAUDE.md, docs/sprint-plan.md and docs/next-session.md first.
Then give me a plan of at most 25 lines: scope from the sprint plan, what already exists, the first step, and only the questions that block the work, each with your recommendation.
Wait for my one reply. After it, work through everything that stays green without pausing.
Stop only at: the SQL review (show migration SQL before any test or push), the db push (I run it, dev then prod from main), a rule the sprint plan doesn't cover, CI still red after two fix attempts, or before a PR is made ready.
Never mark a PR ready or merge it. Keep each report to at most 15 lines.
```
