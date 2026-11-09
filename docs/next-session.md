# Next session: Sprint 10.6b, the knowledge base Edge Function, ingestion script and documents

**State (2026-11-10).** Sprints 1–9, 10a and Roma steps 10.1–10.5, 10.8 and 10.9 are on `main` and live: 10.9 detailed plans with the plan modal redesign, the Roma page redesign and the model shortlist for bike and car plans (PRs #53–#65; #65 merged as 7a7a94a). **Open: draft PR #66** (branch `sprint-10.6-knowledge-base`): step 10.6a, migration `20261111120000_knowledge_base.sql` and `supabase/tests/database/knowledge_base.test.sql` (46 tests). CI fully green, E2E included. **The migration is applied nowhere.** The owner applies it to dev before 10.6b starts; then regenerate the types (`npm run db:types`) and commit them to PR #66 only if they differ.

Agreed 10.6 scope, its four steps and the 2026-11-10 decisions: "10.6 knowledge base: scope and handoff" in `docs/sprint-plan.md` (Sprint 10 section) and the decisions log.

**Next: 10.6b.**
1. An Edge Function that embeds text with Supabase's built-in `gte-small` (384 dimensions, normalised; English; reads 512 tokens). Signed-in callers only. No paid provider.
2. `scripts/ingest-knowledge.ts`, documented, run only by the owner. It reads the service-role key from the owner's private env file outside the repo. Claude never runs it against any project and never puts the key in the repo, a prompt or any output. It hashes each source file (SHA-256), re-chunks and re-embeds only what changed (chunks of at most 1,200 characters), and retires removed documents.
3. About 20 documents in the repo with frontmatter (slug, title, kind, publisher, URLs, reuse terms and their check date, dates, financial year if any). Official text only where the publisher's terms permit reuse, confirmed and recorded; otherwise a FinCreador explainer with the official page as "read more". New documents start as draft; the owner reviews them before any is approved.
4. Stop for the owner's review of the documents and their reuse terms before ingestion.

**Known gaps (kept).** Stay and food often have no estimate in plans; budget trips name fewer hotels; no live fares or room rates; mobile has no Roma or plans; a home city on the profile is still backlog. Sprint 11 (notifications and reminders) and Sprint 12 (mobile polish, offline, PWA) are not started; the backlog is in `docs/sprint-plan.md`. Earlier sprints' limitations: `docs/sprint-plan.md` status rows.

**Migrations.** All in `supabase/migrations/`, all on **dev and prod**: `20261021183415` profiles · `20261022150000` accounts and income · `20261022190000` one cash account · `20261023120000` expenses, transfers, edits · `20261023180000` drop `void_income` · `20261024120000` recurring rules · `20261026120000` dashboard breakdown · `20261026180000` goals and budgets · `20261026200000` vehicle type · `20261026210000` delete archived goals · `20261027120000` instruments and investments · `20261027180000` price refresh run log and `pg_cron` job · `20261027200000` fixed deposits · `20261028120000` loans, due items and payments · `20261028180000` cards, statements, borrowing · `20261028210000` borrowing details, card products, digits in any script · `20261028230000` statutory dues · `20261029120000` account balances at a date. Sprint 9: `20261029180000` bank charges category · `20261104120000` refunds. Sprint 10a: `20261105120000` entry repeat. Sprint 10: `20261105180000` roma usage · `20261106120000` roma conversations · `20261107120000` roma search · `20261107180000` roma plans · `20261108120000` goal from plan · `20261109180000` plan candidates · `20261110120000` roma search remaining. **Not applied anywhere:** `20261111120000` knowledge base (PR #66). (Confirm each on dev and prod with `supabase migration list --linked`.)

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
- No real project refs, URLs, emails or keys in the repository; use placeholders such as `<prod-project-ref>` and `<your-app>`. Secrets live in private files outside the repo, never in chat. The service-role key never appears in the repo, a prompt or any output, and Claude never runs the knowledge ingestion script.
- Web density: 14px root, 36px controls, minimum text 12px; dialogs with many fields keep a sticky footer and must fit a 720px-high window.
- Stop points: SQL ready for review; CI green on a migration (for the owner's db push); a rule the sprint plan doesn't cover; CI still red after two fix attempts; before a PR is made ready.
- Reports: at most 15 lines. No recaps of unchanged work.
- Mobile goes in a separate PR after web.

**Start prompt (paste into a fresh session):**

```text
Next: Sprint 10.6b, the knowledge base Edge Function, ingestion script and documents (see docs/next-session.md). Read CLAUDE.md, docs/sprint-plan.md (Sprint 10, "10.6 knowledge base: scope and handoff", and the decisions of 2026-11-10) and docs/next-session.md first.
I have applied 20261111120000_knowledge_base.sql to dev. Regenerate the database types and commit them to PR #66 only if they differ.
Work on branch sprint-10.6-knowledge-base (draft PR #66). No db push, no prod access, never mark a PR ready or merge it.
Never run the ingestion script and never put the service-role key in the repo, a prompt or any output.
Build the embedding Edge Function and the ingestion script, then draft the documents with their reuse terms and stop for my review before anything is ingested.
Stop only at: that review, a rule the sprint plan doesn't cover, CI still red after two fix attempts, or before a PR is made ready. Keep each report to at most 15 lines.
```
