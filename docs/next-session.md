# Next session: Sprint 9a prod rollout, then Sprint 9b (bank account statements)

**State (2026-11-04).** Sprints 1–8 are on `main` and deployed (Vercel Hobby, Supabase Free). Sprint 9a (credit card statement PDFs, web) is complete on `sprint-9a`, draft PR #46, CI green: an in-browser TypeScript reader (the file and password never leave the device), Punjab National Bank as the one issuer reader, a self-check gate before Save, an honest "We can't read [issuer] statements yet..." for other banks (unless the statement verifies itself with the general reader), "Copy layout" for unreadable rows, self-hosted fonts. Details and decisions: `docs/sprint-plan.md` (9a row, Decisions 2026-10-29 and 2026-11-04). Mobile Overview, Goals, Investments, Loans, cards, borrowing, statutory dues, net worth, Reports and statement import are in the backlog.

**Known limitations (9a, kept).** Two tabs saving the same lines at once can both report "saved" (each line is still posted once). A parser change that alters a line's parsed values gives it another key, so a line imported before the change shows as Possible duplicate rather than Already imported.

**Order (owner, 2026-11-04).**
1. **9a prod rollout.** Migration `20261029180000_bank_charges_category.sql` to dev first if `supabase migration list --linked` doesn't show it there (owner db push), re-test the import on dev with the real PNB file, then the owner marks PR #46 ready and merges it. Prod: manual backup, `db push` from a clean `main` checkout, then the deploy and a live check (`docs/deployment.md` section 4).
2. **Sprint 9b bank account statements (web).** First the PNB savings layout already described (Decisions 2026-10-29, "Bank statements (9b, no parser yet)": ignore everything above the column header row; Date, Instrument ID, Amount, Type DR/CR, Balance, Remarks; newest first; wrapped Remarks; UPI remarks keep the payee only; balance-chain self-check), then CSV / Excel (exact, preferred). Bank rules: credits as income, debits as expenses, own-account transfers posted as transfers, closing-balance reconciliation against the account balance, duplicates against manual entries unticked. Same privacy rules as 9a: synthetic statements only in the repo, runs of 4+ digits stripped, never uploaded. New parsers follow "How to add a new issuer parser" (Sprint 9 in `docs/sprint-plan.md`).

**Backlog (owner, 2026-10-28).** Card list: PNB cards first, from PNB's own pages only (verified, no guessing), then other public-sector and mid-size banks, as the next quarterly list refresh (January 2027, `docs/quarterly-list-refresh.md`, including `FD_BANKS` and `LENDERS`). Until then "Other" typed works.

**Migrations.** All in `supabase/migrations/`, all on **dev and prod**: `20261021183415` profiles · `20261022150000` accounts and income · `20261022190000` one cash account · `20261023120000` expenses, transfers, edits · `20261023180000` drop `void_income` · `20261024120000` recurring rules · `20261026120000` dashboard breakdown · `20261026180000` goals and budgets · `20261026200000` vehicle type · `20261026210000` delete archived goals · `20261027120000` instruments and investments · `20261027180000` price refresh run log and `pg_cron` job · `20261027200000` fixed deposits · `20261028120000` loans, due items and payments · `20261028180000` cards, statements, borrowing · `20261028210000` borrowing details, card products, digits in any script · `20261028230000` statutory dues · `20261029120000` account balances at a date. Pending: `20261029180000` bank charges category (Sprint 9a; dev after the owner's db push, prod with the 9a rollout).

Check `supabase migration list --linked` against each project before any database work. Status, steps and decisions: `docs/sprint-plan.md`; deploy steps: `docs/deployment.md` (4a dev refresh, 4b prod refresh, 4c Sprint 8 record).

**Every new migration goes to dev, then prod.** Dev after the owner's SQL review and green CI. Prod only from a clean `main` checkout and only after a manual backup of prod (`docs/deployment.md` section 4). Push prod before deploying code that needs the migration; link back to dev afterwards. Never edit an applied migration or reset a database.

**Before production.**
- Remove `exp://**` and `localhost` entries from the development project's redirect list once mobile release builds exist (prod has only `https://<your-app>.vercel.app/auth/callback**`); drop `npm run dev:mobile:google`; fixed `fincreador://` scheme in release builds.
- Custom SMTP before inviting testers; weekly manual prod backups; Vercel Pro and Supabase Pro before any commercial use.
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
Next: the Sprint 9a prod rollout, then Sprint 9b bank account statements (see docs/next-session.md). Read CLAUDE.md, docs/sprint-plan.md and docs/next-session.md first.
Branch from `main`; open draft PRs only, never merge, no prod access.
Then give me a plan of at most 25 lines: scope, what already exists, the first step, and only the questions that block the work, each with your recommendation.
Wait for my one reply. After it, work through everything that stays green without pausing.
Stop only at: the SQL review (show migration SQL before any test or push), the db push (I run it), a rule the sprint plan doesn't cover, CI still red after two fix attempts, or before a PR is made ready.
Never mark a PR ready or merge it. Keep each report to at most 15 lines.
```
