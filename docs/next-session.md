# Next session: Sprint 10.9, purchase plans that suggest models

**State (2026-11-08).** Sprints 1–9, 10a and Roma steps 10.1–10.5 and 10.8 are on `main` and deployed (PRs #53–#63). **10.9 detailed plans are all on draft PR #64** (branch `sprint-10.9-plans`), unmerged: the plan, intake, modal and Save as PDF; the follow-ups (subject per price, conversion, two verdict signals); the last round of fixes (hotel listing pairs, per-km fares kept off per-day lines, food guides as a subject); and "Add to my goals" with intake errors that name the question and the reason (commit 7a6956e). Migrations `20261107180000_roma_plans.sql` and `20261108120000_goal_from_plan.sql` are on dev only, not prod. Full status, the approved plan below, decisions and known gaps: "10.9 detailed plans: status and handoff" in `docs/sprint-plan.md` (Sprint 10 section) and Decisions 2026-11-07 to 2026-11-08.

**Next: build the approved purchase-plan redesign** (8 points in `docs/sprint-plan.md`):
1. Measure first: two live shortlist queries (`ROMA_LIVE=1`, `PLAN_RECORD`), report how many candidates come back with a price, before any UI.
2. Intake: kind, budget or "from my records", main use, when, trade-in; make and model optional.
3. Two fixed-template lookups (no budget figure in a query); candidates from `VEHICLE_CATALOGUE` paired with a price on the same listing card, checked in code; the model picks ids only.
4. A comparison in the modal, a verdict per candidate, "Pick this model" runs today's model plan.
5. Storage: a new top-level `candidates` key needs its own new migration (the plan-shape key list): `20261108120000` is applied on dev and can't be edited.

**Known gaps (kept).** Stay and food often have no estimate; budget trips name fewer hotels; no live fares or room rates; mobile has no plans; a home city on the profile is still backlog. Earlier sprints' limitations: `docs/sprint-plan.md` status rows.

**Migrations.** All in `supabase/migrations/`, all on **dev and prod**: `20261021183415` profiles · `20261022150000` accounts and income · `20261022190000` one cash account · `20261023120000` expenses, transfers, edits · `20261023180000` drop `void_income` · `20261024120000` recurring rules · `20261026120000` dashboard breakdown · `20261026180000` goals and budgets · `20261026200000` vehicle type · `20261026210000` delete archived goals · `20261027120000` instruments and investments · `20261027180000` price refresh run log and `pg_cron` job · `20261027200000` fixed deposits · `20261028120000` loans, due items and payments · `20261028180000` cards, statements, borrowing · `20261028210000` borrowing details, card products, digits in any script · `20261028230000` statutory dues · `20261029120000` account balances at a date. Sprint 9: `20261029180000` bank charges category · `20261104120000` refunds. Sprint 10a: `20261105120000` entry repeat. Sprint 10: `20261105180000` roma usage · `20261106120000` roma conversations · `20261107120000` roma search (dev and prod); `20261107180000` roma plans · `20261108120000` goal from plan (**dev only**, prod after PR #64 merges and a backup). (Confirm each on dev and prod with `supabase migration list --linked`.)

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
Next: Sprint 10.9, purchase plans that suggest models (see docs/next-session.md). Read CLAUDE.md, docs/sprint-plan.md (Sprint 10, "10.9 detailed plans: status and handoff") and docs/next-session.md first.
Work on branch sprint-10.9-plans (draft PR #64); never merge, no prod access.
Start with the live measurement (point 1), report it in at most 10 lines, and wait for my reply before building the UI.
Stop only at: the SQL review (the new migration for the `candidates` key), the db push (I run it), a rule the sprint plan doesn't cover, CI still red after two fix attempts, or before a PR is made ready.
Never mark a PR ready or merge it. Keep each report to at most 15 lines.
```
