# Next session: Sprint 10, the Roma assistant (step 10.1)

**State (2026-11-05).** Sprints 1–9 and 10a are on `main` and deployed (Vercel Hobby, Supabase Free). Sprint 9 (statement import, web) is complete: 9a card statement PDFs (PR #46), 9b bank statements, PNB PDF and CSV (PR #47), 9c refunds (PR #48), 9d generic structure-based bank reader with endpoint reconciliation and a masked Copy layout (PR #49). Statements are read in the browser; the file and any password never leave the device. Details and decisions: `docs/sprint-plan.md` (Sprint 9 rows, Decisions 2026-10-29 to 2026-11-05). Mobile Overview, Goals, Investments, Loans, cards, borrowing, statutory dues, net worth, Reports, statement import and adding refunds are in the backlog.

**Sprint 10a (clarity pass, web) is complete** (PR #51 merged into `main`): "Repeat this?" on add income and add expense, sign-out after 2 hours without activity across tabs, plainer wording, four Overview cards, three Income cards, and income sources showing actual amounts with a rate only from recurring rules. Migration `20261105120000_entry_repeat.sql` (confirm on dev and prod with `supabase migration list --linked`). Details: the 10a row and Decisions 2026-11-05 in `docs/sprint-plan.md`.

**Known limitations (kept).**
- 9a: two tabs saving the same lines at once can both report "saved" (each line is still posted once). A parser change that alters a line's parsed values gives it another key, so a line imported before the change shows as Possible duplicate rather than Already imported.
- 9b: importing both sides of a transfer in two tabs at the same moment can post it twice; a transfer the two banks book on different days is not matched and can post twice.
- 9c: refund suggestions are exact-amount only (part refunds are picked by hand); two refunds linked to one purchase in one review can pass the picker and the second is refused at save (FC055); a refund's link can't be changed after saving (void and add again).
- 9d: a scanned PDF has no text; a page footer printed one line below the last row can merge into it.

**Order (owner, 2026-11-05).**
1. **Sprint 10, the Roma assistant: step 10.1.** Sprint 10 in `docs/sprint-plan.md` and CLAUDE.md section 7 (figures computed in code, never by the model; provider keys server-side; informational only; no financial actions). The step's exact scope comes from the owner at the start of the session.

**Backlog (owner).** Card list: PNB cards first, from PNB's own pages only (verified, no guessing), then other public-sector and mid-size banks, as the next quarterly list refresh (January 2027, `docs/quarterly-list-refresh.md`, including `FD_BANKS` and `LENDERS`). Until then "Other" typed works. Statements: Excel (.xlsx) import; an SBI statement layout. Full list: Backlog in `docs/sprint-plan.md`.

**Migrations.** All in `supabase/migrations/`, all on **dev and prod**: `20261021183415` profiles · `20261022150000` accounts and income · `20261022190000` one cash account · `20261023120000` expenses, transfers, edits · `20261023180000` drop `void_income` · `20261024120000` recurring rules · `20261026120000` dashboard breakdown · `20261026180000` goals and budgets · `20261026200000` vehicle type · `20261026210000` delete archived goals · `20261027120000` instruments and investments · `20261027180000` price refresh run log and `pg_cron` job · `20261027200000` fixed deposits · `20261028120000` loans, due items and payments · `20261028180000` cards, statements, borrowing · `20261028210000` borrowing details, card products, digits in any script · `20261028230000` statutory dues · `20261029120000` account balances at a date. Sprint 9: `20261029180000` bank charges category · `20261104120000` refunds. Sprint 10a: `20261105120000` entry repeat. (Confirm each on dev and prod with `supabase migration list --linked`.)

Check `supabase migration list --linked` against each project before any database work. Status, steps and decisions: `docs/sprint-plan.md`; deploy steps: `docs/deployment.md` (4a dev refresh, 4b prod refresh, 4c Sprint 8 record).

**Every new migration goes to dev, then prod.** Dev after the owner's SQL review and green CI. Prod only from a clean `main` checkout and only after a manual backup of prod (`docs/deployment.md` section 4). Push prod before deploying code that needs the migration; link back to dev afterwards. Never edit an applied migration or reset a database.

**Before production.**
- Remove `exp://**` and `localhost` entries from the development project's redirect list once mobile release builds exist (prod has only `https://<your-app>.vercel.app/auth/callback**`); drop `npm run dev:mobile:google`; fixed `fincreador://` scheme in release builds.
- Pre-launch checklist, before inviting outside testers:
  - FinCreador name in the prod Supabase email templates (confirm sign-up, reset password, magic link, change email).
  - FinCreador as the app name on the Google OAuth consent screen.
  - Privacy and terms pages on the web app, linked from sign-up and sign-in.
  - Custom SMTP on prod before any outside tester (the built-in sender allows only a few emails per hour).
  - Weekly manual prod backup (`scripts/backup-prod.sh`, `docs/deployment.md`) until the move to Pro.
  - Leaked-password protection, once on Supabase Pro (not available on Free).
  - Tavily: written confirmation that the free plan allows commercial use, before any commercial launch (a launch blocker, not a build blocker; Roma's web lookups, step 10.8).
- Vercel Pro and Supabase Pro before any commercial use.
- Review the licence terms of the market data (AMFI, BSE, and NSE if added) before any commercial use (upgrade checklist in `docs/deployment.md`).
- A paused Free project stops the daily price job: after a restore, check `cron.job_run_details` and run the refresh once by hand.
- Pending: Google sign-in on iPhone.

**Working rules (owner).**
- The owner marks PRs ready and merges them. Open draft PRs only; never mark one ready or merge it.
- No `db push` by Claude. Show new migration SQL for line-by-line review before any test, commit or push; the owner runs `supabase db push --dry-run`, then `db push`, on dev, and on prod from `main` after a backup. After a dev push, regenerate `npm run db:types` and commit only if it differs.
- Database and E2E tests run in CI only (no Docker or local Supabase on the Mac). Run `npm run typecheck`, `npm run lint` and `npm test` before every push. Screenshots come from CI (`e2e-screenshots` artifact); save the ones for review only in `docs/design/<area>/`.
- No real project refs, URLs, emails or keys in the repository; use placeholders such as `<prod-project-ref>` and `<your-app>`. Secrets live in private files outside the repo, never in chat.
- Web density: 14px root, 36px controls, minimum text 12px; dialogs with many fields keep a sticky footer and must fit a 720px-high window.
- Stop points: SQL ready for review; CI green on a migration (for the owner's db push); a rule the sprint plan doesn't cover; CI still red after two fix attempts; before a PR is made ready.
- Reports: at most 15 lines. No recaps of unchanged work.
- Mobile goes in a separate PR after web.

**Start prompt (paste into a fresh session):**

```text
Next: Sprint 10, the Roma assistant, step 10.1 (see docs/next-session.md). Read CLAUDE.md, docs/sprint-plan.md and docs/next-session.md first.
Branch from `main`; open draft PRs only, never merge, no prod access.
Then give me a plan of at most 25 lines: scope, what already exists, the first step, and only the questions that block the work, each with your recommendation.
Wait for my one reply. After it, work through everything that stays green without pausing.
Stop only at: the SQL review (show migration SQL before any test or push), the db push (I run it), a rule the sprint plan doesn't cover, CI still red after two fix attempts, or before a PR is made ready.
Never mark a PR ready or merge it. Keep each report to at most 15 lines.
```
