# Next session: Sprint 5 in progress (SQL review)

**State (2026-10-26).** Sprints 1–4 are done and on `main`. Sprint 5 (web dashboard) is on branch `sprint-5-dashboard`, pushed. Done: `docs/deployment.md`, `packages/domain/src/dashboard.ts` with unit tests. SQL for `20261026120000_dashboard_breakdown` approved (owner, 2026-10-26) and pushed in draft PR #25; CI green (2026-10-26). **Waiting for the owner's `db push`.** Start the loader and web Overview (step 5.4) only after the owner says the push is done; label a partial first month bucket on custom ranges.
Applied to fin-creador-dev, all in `supabase/migrations/`:
`20261021183415` profiles · `20261022150000` accounts and income · `20261022190000` one cash account · `20261023120000` expenses, transfers, edits · `20261023180000` drop `void_income` · `20261024120000` recurring rules.
Check with `supabase migration list --linked` before any database work. Status, steps and decisions: `docs/sprint-plan.md`.

**Working rules (owner).**
- The owner marks PRs ready and merges them. Open draft PRs only; never mark one ready or merge it unless the owner says "this time only".
- No `db push` by Claude. Show new migration SQL for line-by-line review before any test, commit or push; the owner runs `supabase db push --dry-run`, then `db push`. (A Docker socket error after "Applying migration" is harmless; check the migration list.)
- Database and E2E tests run in CI only (no Docker or local Supabase on the Mac). Run `npm run typecheck`, `npm run lint` and `npm test` before every push. Check `df -h` before dev servers; screenshots use system Chrome through playwright-core (channel "chrome").
- Stop points: SQL ready for review; CI green on a migration (for the owner's db push); a rule the sprint plan doesn't cover; CI still red after two fix attempts; before a PR is made ready.
- Reports: at most 15 lines (what changed, test/CI result, decisions needed). No recaps of unchanged work.
- Prototype first on demo data (dev-only route, at most 8 screenshots), then Phase 2. Mobile goes in a separate PR after web.

**Open before production (Sprint 12 at the latest).** Remove `exp://**` and `localhost` from the Supabase redirect allow list; drop `npm run dev:mobile:google`; fixed `fincreador://` scheme in release builds; set the Site URL to the production web URL; custom SMTP. Pending: Google sign-in on iPhone.

**Sprint 5 notes.** Dashboard and analytics (see the Sprint 5 section of the plan). Write `docs/deployment.md` first (Vercel Hobby: project, env vars, auth redirect URLs, non-commercial limit). After the first deploy, check that auth redirects stay on the deployment's domain. The backlog lists a web Overview Recurring card for this sprint.

**Start prompt (paste into a fresh session):**

```text
Start Sprint 5 (Dashboard and analytics). Read CLAUDE.md, docs/sprint-plan.md and docs/next-session.md first.
Then give me a plan of at most 25 lines: scope from the sprint plan, the first step, and only the questions that block the work.
Wait for my one reply. After it, work through everything that stays green without pausing.
Stop only at: the SQL review (show migration SQL before any test or push), the db push (I run it), a rule the sprint plan doesn't cover, CI still red after two fix attempts, or before a PR is made ready.
Never mark a PR ready or merge it. Keep each report to at most 15 lines.
```
