# Next session: Sprint 8d (statutory and legal dues)

**State (2026-10-28).** Sprints 1–7 are on `main` and deployed (Vercel Hobby, Supabase Free). Sprint 8a (loans and EMIs, web) is done: backend in PR #34 (merged), web page "Loans & Liabilities" (`/loans-liabilities`: Due soon, three boxes, bell, Overview Due soon card) in PR #35 (draft, CI green). Mobile Overview, Goals, Investments and Loans are in the backlog.

**Prod rollout: once, at the end of Sprint 8 (owner, 2026-10-28).** Do not merge PR #35 or any later Sprint 8 PR, and do not push to prod, until the owner says so. Order: 8b credit cards and informal borrowing → 8d statutory dues → net worth (all three boxes) → 8c cash-flow history and CSV export. Each step branches from the previous step's branch (8b from `sprint-8a-ui`); the draft PRs stay stacked and unmerged. The owner runs `db push` on dev for each approved migration. At the end (`docs/deployment.md` 4c): merge the stacked PRs into `main` in order, then a manual prod backup, a dry run listing exactly the Sprint 8 migrations, push prod from `main`, relink dev, live check.

**Migrations.** All in `supabase/migrations/`.
On **dev and prod**: `20261021183415` profiles · `20261022150000` accounts and income · `20261022190000` one cash account · `20261023120000` expenses, transfers, edits · `20261023180000` drop `void_income` · `20261024120000` recurring rules · `20261026120000` dashboard breakdown · `20261026180000` goals and budgets · `20261026200000` vehicle type · `20261026210000` delete archived goals · `20261027120000` instruments and investments · `20261027180000` price refresh run log and `pg_cron` job · `20261027200000` fixed deposits.
On **dev only** (prod at the end of Sprint 8): `20261028120000` loans, due items and payments · `20261028180000` cards, statements, borrowing.

Check `supabase migration list --linked` against each project before any database work. Status, steps and decisions: `docs/sprint-plan.md`; deploy steps: `docs/deployment.md` (4a dev refresh, 4b prod refresh, 4c Sprint 8 on prod).

**First check (owner).** After 07:00 IST on 28 Oct 2026, check `price_refresh_runs` on dev and on prod (the last-7-days query in `docs/deployment.md` 4a): one `amfi` and one `bse` row on each project, both with `finished_at`.

**Every new migration goes to dev, then prod.** Dev after the owner's SQL review and green CI. Prod only from a clean `main` checkout and only after a manual backup of prod (`docs/deployment.md` section 4); in Sprint 8, all Sprint 8 migrations go to prod together at the end (above). Push prod before deploying code that needs the migration; link back to dev afterwards. Never edit an applied migration or reset a database.

**Before production.**
- Remove `exp://**` and `localhost` entries from the development project's redirect list once mobile release builds exist (prod has only `https://<your-app>.vercel.app/auth/callback**`); drop `npm run dev:mobile:google`; fixed `fincreador://` scheme in release builds.
- Custom SMTP before inviting testers; weekly manual prod backups; Vercel Pro and Supabase Pro before any commercial use.
- Review the licence terms of the market data (AMFI, BSE, and NSE if added) before any commercial use (upgrade checklist in `docs/deployment.md`).
- A paused Free project stops the daily price job: after a restore, check `cron.job_run_details` and run the refresh once by hand.
- Pending: Google sign-in on iPhone.

**Working rules (owner).**
- The owner marks PRs ready and merges them. Open draft PRs only; never mark one ready or merge it.
- No `db push` by Claude. Show new migration SQL for line-by-line review before any test, commit or push; the owner runs `supabase db push --dry-run`, then `db push`, on dev (prod at the end of Sprint 8). After a dev push, regenerate `npm run db:types` and commit only if it differs.
- Database and E2E tests run in CI only (no Docker or local Supabase on the Mac). Run `npm run typecheck`, `npm run lint` and `npm test` before every push. Screenshots come from CI (`e2e-screenshots` artifact); save the ones for review only in `docs/design/<area>/`.
- No real project refs, URLs, emails or keys in the repository; use placeholders such as `<prod-project-ref>` and `<your-app>`. Secrets live in private files outside the repo, never in chat.
- Web density: 14px root, 36px controls, minimum text 12px; dialogs with many fields keep a sticky footer and must fit a 720px-high window.
- Stop points: SQL ready for review; CI green on a migration (for the owner's db push); a rule the sprint plan doesn't cover; CI still red after two fix attempts; before a PR is made ready.
- Reports: at most 15 lines. No recaps of unchanged work.
- Mobile goes in a separate PR after web.

**Sprint 8d notes.** Scope in "Sprint 8d" of the plan; it fills the "Statutory & legal liabilities" box (no new tab). Each due: type (income tax payable, fine, unpaid e-challan, other), amount, due date, paid or unpaid, reminders through a due item (Due soon, the bell and the Overview need only a new kind in `buildReminders`, `packages/api/src/cards/view.ts`). Paying a statutory due is an expense from the chosen account (a category per type), not a transfer: no liability account. No challan, vehicle, PAN or card numbers: names and amounts only. Branch `sprint-8d` from `sprint-8b-ui`, draft PR stacked on it. Reuse 8a/8b: `due_items` / `due_payments`, the shortfall warning with "Pay anyway", `is_liability_kind` (statutory dues add no account kind). Then 8e net worth (all three boxes, including capitalised moratorium interest not yet posted; decide whether investments and fixed deposits count), then 8c cash-flow history and CSV export. Recurring: the quarterly list refresh (`docs/quarterly-list-refresh.md`, including `FD_BANKS` and `LENDERS`), next in January 2027.

**Start prompt (paste into a fresh session):**

```text
Continue Sprint 8 (next step in the status table of docs/sprint-plan.md). Read CLAUDE.md, docs/sprint-plan.md and docs/next-session.md first.
Branch from the previous Sprint 8 step's branch; do not merge any PR or push to prod (prod rollout is at the end of Sprint 8).
Then give me a plan of at most 25 lines: scope from the sprint plan, what already exists, the first step, and only the questions that block the work, each with your recommendation.
Wait for my one reply. After it, work through everything that stays green without pausing.
Stop only at: the SQL review (show migration SQL before any test or push), the db push (I run it on dev; prod at the end of Sprint 8), a rule the sprint plan doesn't cover, CI still red after two fix attempts, or before a PR is made ready.
Never mark a PR ready or merge it. Keep each report to at most 15 lines.
```
