# Next session: Sprint 8b (credit cards, informal borrowing and net worth)

**State (2026-10-27).** Sprints 1–7 are on `main` and deployed (Vercel Hobby, Supabase Free). Sprint 8a (loans and EMIs, web) is done: backend in PR #34 (merged), web page "Loans & Liabilities" (`/loans-liabilities`: Due soon, three boxes, bell, Overview Due soon card) in PR #35 (draft, CI green). Mobile Overview, Goals, Investments and Loans are in the backlog.

**Prod rollout of 8a (owner, before merging PR #35).** The loans migration is on dev only. Follow `docs/deployment.md` section 4c: backup, clean `main`, dry run lists only `20261028120000_loans.sql`, push, check, relink dev, then merge PR #35 and check the live page.

**Migrations.** All in `supabase/migrations/`.
On **dev and prod**: `20261021183415` profiles · `20261022150000` accounts and income · `20261022190000` one cash account · `20261023120000` expenses, transfers, edits · `20261023180000` drop `void_income` · `20261024120000` recurring rules · `20261026120000` dashboard breakdown · `20261026180000` goals and budgets · `20261026200000` vehicle type · `20261026210000` delete archived goals · `20261027120000` instruments and investments · `20261027180000` price refresh run log and `pg_cron` job · `20261027200000` fixed deposits.
On **dev only** (prod pending, section 4c): `20261028120000` loans, due items and payments.

Check `supabase migration list --linked` against each project before any database work. Status, steps and decisions: `docs/sprint-plan.md`; deploy steps: `docs/deployment.md` (4a dev refresh, 4b prod refresh, 4c loans on prod).

**First check (owner).** After 07:00 IST on 28 Oct 2026, check `price_refresh_runs` on dev and on prod (the last-7-days query in `docs/deployment.md` 4a): one `amfi` and one `bse` row on each project, both with `finished_at`.

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

**Sprint 8b notes.** Scope in "Sprint 8b" of the plan; it fills the "Short-term & operational liabilities" box on Loans & Liabilities (no new tab). Credit cards: issuer from `LENDERS`, optional nickname, never any card digits, limit, statement and due day; purchases are expenses from the card's liability account; bills are `card_bill` due items paid as transfers (full, minimum or custom); card EMIs stay loans (8a) and are not counted twice. Informal borrowing (friends, family, third parties): a liability account named after the lender, optional due date (a due item), part payments as transfers, interest as an expense. Net worth counts all three boxes (long-term, short-term & operational, statutory & legal once 8d exists), including capitalised moratorium interest not yet posted; decide whether investments and fixed deposits count. Reuse 8a: `due_items` / `due_payments`, the shortfall warning with "Pay anyway", Due soon and the bell, `packages/api/src/loans/view.ts` patterns. 8c is cash-flow history and CSV export; 8d statutory dues (income tax payable, fines, unpaid e-challans: payment is an expense, not a transfer). Recurring: the quarterly list refresh (`docs/quarterly-list-refresh.md`, including `FD_BANKS` and `LENDERS`), next in January 2027.

**Start prompt (paste into a fresh session):**

```text
Start Sprint 8b (credit cards, informal borrowing and net worth). Read CLAUDE.md, docs/sprint-plan.md and docs/next-session.md first.
Check that the 8a prod rollout (docs/deployment.md 4c) is done and PR #35 is merged; if not, stop and tell me.
Then give me a plan of at most 25 lines: scope from the sprint plan, what already exists, the first step, and only the questions that block the work, each with your recommendation.
Wait for my one reply. After it, work through everything that stays green without pausing.
Stop only at: the SQL review (show migration SQL before any test or push), the db push (I run it, dev then prod from main), a rule the sprint plan doesn't cover, CI still red after two fix attempts, or before a PR is made ready.
Never mark a PR ready or merge it. Keep each report to at most 15 lines.
```
