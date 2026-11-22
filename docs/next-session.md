# Next session: Sprint 12c (mobile design system)

**State (2026-11-22).** Sprints 1–9, 10a, Roma (10.1–10.6, 10.7a, 10.8–10.9), the pre-12a work (balance feedback and tour #76, Income redesign #77–#78, Continue card #79), **Sprint 12a phone web (PRs #81–#86)** and **12b installable PWA with a read-only offline view (#87)** are merged into `main`. The mobile app design is approved (`docs/design-spec.md` section 5).

**Next:** **12c mobile design system** in the Expo app: approved tokens in `packages/design-tokens`; components (buttons, inputs incl. amount and keypad, list row, card, bottom sheet, tab bar, chips, progress bar and ring, warning banner, balance card, empty state, offline banner); a preview screen with every component, screenshots in `docs/design/mobile/`. Scope and acceptance criteria: "Sprint 12c: mobile design system" in `docs/sprint-plan.md`. Then the native sprints 13a–13e (13e test builds only) and Sprint 11 (notifications); Sprint 14 is security, release and store submission. Offline saving (queue, sync, conflicts) is the next release.

**Known gaps (kept).** Stay and food often have no estimate in plans; budget trips name fewer hotels; no live fares or room rates; mobile has no Roma or plans; a home city on the profile is still backlog; the rest of 10.7 (allocation between goals, prepay-or-invest, naming products) waits for soft-launch feedback and a regulatory check. Earlier sprints' limitations: `docs/sprint-plan.md` status rows.

**Migrations.** All in `supabase/migrations/`, all on **dev and prod**: `20261021183415` profiles · `20261022150000` accounts and income · `20261022190000` one cash account · `20261023120000` expenses, transfers, edits · `20261023180000` drop `void_income` · `20261024120000` recurring rules · `20261026120000` dashboard breakdown · `20261026180000` goals and budgets · `20261026200000` vehicle type · `20261026210000` delete archived goals · `20261027120000` instruments and investments · `20261027180000` price refresh run log and `pg_cron` job · `20261027200000` fixed deposits · `20261028120000` loans, due items and payments · `20261028180000` cards, statements, borrowing · `20261028210000` borrowing details, card products, digits in any script · `20261028230000` statutory dues · `20261029120000` account balances at a date. Sprint 9: `20261029180000` bank charges category · `20261104120000` refunds. Sprint 10a: `20261105120000` entry repeat. Sprint 10: `20261105180000` roma usage · `20261106120000` roma conversations · `20261107120000` roma search · `20261107180000` roma plans · `20261108120000` goal from plan · `20261109180000` plan candidates · `20261110120000` roma search remaining · `20261111120000` knowledge base · `20261113120000` knowledge embed · `20261114180000` roma turn sources. Since then: `20261115120000` roma turn card · `20261115180000` gift, fuel, loan revisions · `20261116120000` UPI import · `20261116180000` move account opening · `20261120120000` onboarding · `20261120200000` welcome hidden (where each is applied is not recorded here). (Confirm each on dev and prod with `supabase migration list --linked`.)

Check `supabase migration list --linked` against each project before any database work. Status, steps and decisions: `docs/sprint-plan.md`; deploy steps: `docs/deployment.md` (4a dev refresh, 4b prod refresh, 4c Sprint 8 record).

**Every new migration goes to dev, then prod.** Dev after the owner's SQL review and green CI. Prod only from a clean `main` checkout and only after a manual backup of prod (`docs/deployment.md` section 4). Push prod before deploying code that needs the migration; link back to dev afterwards. Never edit an applied migration or reset a database.

**Before production.**
- Remove `exp://**` and `localhost` entries from the development project's redirect list once mobile release builds exist (prod has only `https://<your-app>.vercel.app/auth/callback**`); drop `npm run dev:mobile:google`; fixed `fincreador://` scheme in release builds.
- Pre-launch checklist, before inviting outside testers:
  - FinCreador name in the prod Supabase email templates (confirm sign-up, reset password, magic link, change email).
  - FinCreador as the app name on the Google OAuth consent screen.
  - Privacy and terms: on the website (www.fincreador.com); 12b links them from sign-up, Settings and the Roma switch.
  - Custom SMTP on prod before any outside tester (the built-in sender allows only a few emails per hour).
  - Weekly manual prod backup (`scripts/backup-prod.sh`, `docs/deployment.md`) until the move to Pro.
  - Leaked-password protection, once on Supabase Pro (not available on Free).
  - Tavily: written confirmation that the free plan allows commercial use, before any commercial launch (a launch blocker, not a build blocker; Roma's web lookups, step 10.8).
  - RBI: home-page notice and deep-link request sent 2026-11-15 (no reply yet); links stay on the home page until permission. Tell SEBI and EPFO about the links (they ask to be told). Linking terms: `docs/knowledge-base-links.md`.
  - Request the Income Tax Department's permission to link (draft in `docs/knowledge-base-links.md`). Until it is given, tax explainers carry `link_permission_pending: true` and no link; when it is, set `read_more_url`, drop the flag and re-ingest.
  - Move to Supabase's new API keys before the legacy keys are retired.
  - After any edit to a knowledge base document, run the ingestion on prod (owner, `docs/knowledge-runbook.md`).
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
Next: see docs/next-session.md. Read CLAUDE.md, docs/sprint-plan.md (status table and the decisions log) and docs/next-session.md first.
Work on a new branch from main with a draft PR. No db push, no prod access, never mark a PR ready or merge it.
Stop only at: SQL for review, a rule the sprint plan doesn't cover, CI still red after two fix attempts, or before a PR is made ready. Keep each report to at most 15 lines.
```
