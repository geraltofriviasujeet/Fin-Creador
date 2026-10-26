# Next session: Sprint 6 (Budgets and savings goals)

**State (2026-10-26).** Sprints 1–5 are on `main` (Sprint 5: PRs #25–#28). The web Overview dashboard is live, and the first production deploy (Vercel Hobby, Supabase Free) works, including Google sign-in. Overview shows budget and goals as "Coming soon"; Sprint 6 replaces them. Mobile Overview is in the backlog.

**Migrations.** Applied to **both** the development and the production Supabase project, all in `supabase/migrations/`:
`20261021183415` profiles · `20261022150000` accounts and income · `20261022190000` one cash account · `20261023120000` expenses, transfers, edits · `20261023180000` drop `void_income` · `20261024120000` recurring rules · `20261026120000` dashboard breakdown.
Check `supabase migration list --linked` against each project before any database work. Status, steps and decisions: `docs/sprint-plan.md`; deploy steps: `docs/deployment.md`.

**Every new migration goes to dev AND prod.** Dev first, after CI is green and the owner's review. Prod only from a clean `main` checkout after the PR is merged, and only after a manual `pg_dump` backup of prod (`docs/deployment.md` section 4). Push prod before deploying code that needs the migration; link back to dev afterwards. Never edit an applied migration or reset a database.

**Working rules (owner).**
- The owner marks PRs ready and merges them. Open draft PRs only; never mark one ready or merge it.
- No `db push` by Claude. Show new migration SQL for line-by-line review before any test, commit or push; the owner runs `supabase db push --dry-run`, then `db push`, on dev and then on prod. (A Docker socket error after "Applying migration" is harmless; check the migration list.)
- Database and E2E tests run in CI only (no Docker or local Supabase on the Mac). Run `npm run typecheck`, `npm run lint` and `npm test` before every push. Check `df -h` before dev servers; screenshots use system Chrome through playwright-core (channel "chrome").
- No real project refs, URLs, emails or keys in the repository; use placeholders such as `<prod-project-ref>` and `<your-app>`.
- Vercel `NEXT_PUBLIC_*` variables are type Config, not Secret; never give Vercel the service-role key.
- Stop points: SQL ready for review; CI green on a migration (for the owner's db push); a rule the sprint plan doesn't cover; CI still red after two fix attempts; before a PR is made ready.
- Reports: at most 15 lines (what changed, test/CI result, decisions needed). No recaps of unchanged work.
- Mobile goes in a separate PR after web.

**Before production (Sprint 12 at the latest).** Remove `exp://**` and `localhost` entries from the **development** project's redirect list once mobile release builds exist (the production project has only `https://<your-app>.vercel.app/auth/callback**`); drop `npm run dev:mobile:google`; fixed `fincreador://` scheme in release builds; custom SMTP before inviting testers; Vercel Pro and Supabase Pro before any commercial use; weekly manual prod backups until then. Pending: Google sign-in on iPhone.

**Start prompt (paste into a fresh session):**

```text
Start Sprint 6 (Budgets and savings goals). Read CLAUDE.md, docs/sprint-plan.md and docs/next-session.md first.
Then give me a plan of at most 25 lines: scope from the sprint plan, the first step, and only the questions that block the work.
Wait for my one reply. After it, work through everything that stays green without pausing.
Stop only at: the SQL review (show migration SQL before any test or push), the db push (I run it, dev then prod), a rule the sprint plan doesn't cover, CI still red after two fix attempts, or before a PR is made ready.
Never mark a PR ready or merge it. Keep each report to at most 15 lines.
```
