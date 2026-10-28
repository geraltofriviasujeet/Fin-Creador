# Deployment guide (web MVP)

How the FinCreador web app is deployed for controlled testing. The owner creates and
configures the Vercel and Supabase projects; nothing here is automated. Placeholders such as
`<prod-project-ref>` and `<your-app>` stand for your own values; never commit real ones.

## Hosting decision and its limits

- **Vercel Hobby** (web) and **Supabase Free** (database and auth), for the owner's own use
  and invited testers only.
- Vercel Hobby is for **non-commercial personal use**: no payments, no paying customers, no
  public commercial launch while on it.
- Supabase Free: **no automatic backups and no point-in-time recovery**, the project pauses
  after 1 week of inactivity, 500 MB per project, 2 active projects (one for development,
  one for production).
- Scheduled jobs use Supabase scheduling (`pg_cron`, Edge Functions), never Vercel Cron.

## 1. Production Supabase project

Use the second free project slot. `fin-creador-dev` stays the development project; the
deployed app never points at it.

1. Create a new Supabase project (e.g. `fin-creador-prod`), region close to your users.
   Keep the database password in your password manager.
2. Push every migration to it from a clean `main` checkout:

   ```sh
   supabase link --project-ref <prod-project-ref>
   supabase migration list --linked     # all migrations show as local only
   supabase db push --dry-run           # review the list
   supabase db push
   supabase migration list --linked     # every migration now shows as remote
   supabase link --project-ref <dev-project-ref>   # link back to dev afterwards
   ```

   The same rules as development apply: never edit an applied migration, never reset the
   database, push only migrations whose CI is green. A Docker socket error after "Applying
   migration" is harmless; check the migration list.
3. **Authentication → URL Configuration:**
   - **Site URL:** `https://<your-app>.vercel.app`
   - **Redirect URLs:** `https://<your-app>.vercel.app/auth/callback**` only (the `**` is
     needed because the app adds a query string to the callback). Do not add `localhost`,
     `exp://**` or other wildcards to the production project.
4. **Authentication → Sign In / Providers:** Email on with "Confirm email" and a minimum
   password length of 8, as in development. For Google, add
   `https://<prod-project-ref>.supabase.co/auth/v1/callback` to the OAuth client's authorized
   redirect URIs in Google Cloud Console and enter the client ID and secret in this project's
   dashboard (never in the repository).
5. **Authentication → Email Templates:** the same subjects and templates as
   `supabase/templates/` (see `docs/setup.md` section 4).
6. **Custom SMTP** before inviting testers: the built-in sender allows only a few emails an
   hour.

## 2. Vercel project

1. Import the GitHub repository in Vercel. Framework: **Next.js**. Root directory:
   **`apps/web`** (the npm workspace packages in `packages/` are part of the build).
2. Environment variables (type **Config**, not Secret), for the **Production** environment only, all from the
   **production** Supabase project (Project Settings → API):

   | Variable | Value |
   |----|----|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<prod-project-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the project's publishable (anon) key |
   | `NEXT_PUBLIC_SITE_URL` | `https://<your-app>.vercel.app` (no trailing slash) |

   **Never** give Vercel the service-role or secret key: the web app does not use it, and
   any `NEXT_PUBLIC_` value is bundled into the browser.
3. Preview deployments: leave their variables unset (previews then show a configuration
   error), or point them at the development project. Never point a preview at production
   data you care about.
4. Deploy from `main`. The production Supabase project must already have every migration
   the deployed commit needs (step 1.2) before the deploy.

## 3. After the first deploy

Check on the deployed domain, with a test account (never real financial data):

- [ ] The app loads, and the browser's network requests go to `<prod-project-ref>`, not the
      development project.
- [ ] Sign-up email confirmation, password reset and Google sign-in all return to
      `https://<your-app>.vercel.app/...`, never `localhost`.
- [ ] Signed-out visits to app pages redirect to the deployed sign-in page.

If any redirect lands on `localhost`, build it from `NEXT_PUBLIC_SITE_URL` instead of the
request URL (`apps/web/app/auth/callback/route.ts`, `apps/web/lib/supabase/proxy.ts`). The
E2E tests keep running on `localhost:3000`.

If Google sign-in lands on `/?code=…`, Supabase did not accept the `redirectTo`
(`NEXT_PUBLIC_SITE_URL` + `/auth/callback?next=…`) and fell back to the Site URL. The app
forwards a root `?code` to `/auth/callback`, but fix the cause: `NEXT_PUBLIC_SITE_URL` must be
exactly the Site URL host (set for Production, then **redeploy**, since `NEXT_PUBLIC_` values
are fixed at build time), and the allow list must contain `<site>/auth/callback**`.

## 4. Backups (until the Pro upgrade)

Supabase Free has no automatic backups. Back up the **production** database every week and
before every migration you push to it:

```sh
./scripts/backup-prod.sh
```

- It needs `pg_dump` (`brew install libpq`; no Docker).
- It asks for the prod **Session pooler** connection string (Supabase dashboard → Connect →
  Session pooler). The input is hidden and the string is never saved, echoed or put in shell
  history.
- It writes `~/FinCreador-backups/prod-YYYYMMDD-HHMM.dump` (schemas `public`, `auth` and
  `supabase_migrations`, custom format), checks it with `pg_restore --list`, and prints the
  path, size and number of tables.
- Plain messages for a wrong password, a `pg_dump` older than the server
  (`brew upgrade libpq`) and connection failures.

Backups contain personal financial data: keep them in `~/FinCreador-backups` or another
encrypted place, **never inside the repository**, and keep at least the last four. Check now
and then that a backup restores into a scratch database (`pg_restore`).

## 4a. Daily price refresh (Sprint 7)

The `refresh-prices` Edge Function loads AMFI NAVs and BSE closes into `instruments`; a
`pg_cron` job (migration `20261027180000`) calls it at 07:00 IST. Per project, dev first:

1. **Make a secret** in a private file, not on the command line:
   `umask 077; printf 'REFRESH_PRICES_SECRET=%s\n' "$(openssl rand -hex 32)" > ~/refresh.env`
2. **Function secret:** `supabase secrets set --project-ref <project-ref> --env-file ~/refresh.env`
   (or Dashboard → Edge Functions → Secrets).
3. **Deploy** (no Docker): `supabase functions deploy refresh-prices --use-api --project-ref <project-ref>`
   (`verify_jwt = false` comes from `supabase/config.toml`; the function checks the secret).
4. **Vault** (Dashboard → Project Settings → Vault → Add new secret, so the value is not kept
   in SQL editor history): `refresh_prices_secret` = the same value, and
   `refresh_prices_url` = `https://<project-ref>.supabase.co/functions/v1/refresh-prices`.
5. Delete `~/refresh.env`. **Migration:** `supabase db push` (as for any migration).
6. **Check** (SQL editor):

   ```sql
   -- Last 7 days: one row per source per day, with how long each took.
   select started_at at time zone 'Asia/Kolkata' as started_ist, source, status, price_date,
          rows_seen, rows_loaded, rows_skipped, skip_reasons, error,
          finished_at - started_at as duration
   from public.price_refresh_runs
   where started_at > now() - interval '7 days'
   order by started_at desc;

   -- Did the job fire? (pg_cron's own log)
   select start_time, status, return_message from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'refresh-prices-daily')
   order by start_time desc limit 7;
   ```

   **Rule:** every day needs two rows (amfi and bse). A day with no row, or with one, means
   the run died (the function crashed or hit its time limit before logging); check the
   function logs (Dashboard → Edge Functions → refresh-prices → Logs) and
   `cron.job_run_details`. `no_file` for BSE on weekends and exchange holidays is normal.

## 4b. Price refresh on production (Sprint 7 rollout)

After PR #32 is merged and the prod migrations are in (section 1.2, after a backup), from a
clean `main` checkout:

1. **New secret for prod** (never reuse the dev one), in a private file outside the repo:
   `umask 077; printf 'REFRESH_PRICES_SECRET=%s\n' "$(openssl rand -hex 32)" > ~/refresh-prod.env`
2. `supabase secrets set --project-ref <prod-project-ref> --env-file ~/refresh-prod.env`
3. Deploy: `supabase functions deploy refresh-prices --use-api --project-ref <prod-project-ref>`
4. **Vault** on the prod project (Dashboard → Project Settings → Vault): `refresh_prices_secret`
   (the same value) and `refresh_prices_url` = `https://<prod-project-ref>.supabase.co/functions/v1/refresh-prices`.
5. **First manual run:**
   `curl -sS -X POST -H @<(printf 'x-refresh-secret: %s\n' "$(cut -d= -f2 ~/refresh-prod.env)") https://<prod-project-ref>.supabase.co/functions/v1/refresh-prices`
   answers `{"status":"accepted"}`; then delete `~/refresh-prod.env`.
6. After about 2 minutes, run the last-7-days query of section 4a in the prod SQL editor: one
   `amfi` and one `bse` row, both with `finished_at`.
7. Relink the CLI to dev: `supabase link --project-ref <dev-project-ref>`.

**A paused project stops the daily job.** Supabase Free pauses a project after a week without
activity; a paused project runs no `pg_cron` jobs, so prices stop updating (holdings then show
"Old price" and later "Stale, over 30 days"). After restoring the project, check
`cron.job_run_details` and make one manual run (step 5).

## 4c. Sprint 8 on production (once, at the end of Sprint 8)

Sprint 8 goes to prod once, after its last step (owner, 2026-10-28). Until then every Sprint 8
migration is on dev only and every Sprint 8 PR stays a stacked draft: PR #35 (8a web), then
8b, 8d, 8e and 8c, each branched from the one before. The owner runs every step:

1. **Merge in order:** merge the stacked Sprint 8 PRs into `main`, oldest first (PR #35, then
   8b, 8d, 8e, 8c), retargeting each to `main` after the one below it is merged. Vercel deploys
   `main` on every merge and the pages need the new tables, so the live Loans & Liabilities
   page fails until step 6; do this in one sitting (or pause production deploys in Vercel
   first and redeploy after step 6).
2. **Backup:** `./scripts/backup-prod.sh` (section 4); check that it prints the path, size and
   number of tables.
3. **Clean `main`:** `git checkout main && git pull && git status` (nothing to commit).
4. **Link prod:** `supabase link --project-ref <prod-project-ref>`.
5. **Dry run:** `supabase db push --dry-run` must list **exactly** the Sprint 8 migrations,
   oldest first: `20261028120000_loans.sql`, `20261028180000_cards_borrowing.sql`, then the
   8d, 8e and 8c migrations (named in `docs/sprint-plan.md` when they are written). If it lists
   anything else, or misses one, stop.
6. **Push:** `supabase db push`, then `supabase migration list --linked`: every Sprint 8
   migration appears in both the Local and Remote columns.
7. **Check** in the prod SQL editor (all `true`):
   ```sql
   select to_regclass('public.loans') is not null as loans,
          to_regclass('public.due_items') is not null as due_items,
          to_regclass('public.credit_cards') is not null as credit_cards,
          to_regclass('public.borrowings') is not null as borrowings,
          to_regclass('public.liability_payments') is not null as liability_payments,
          exists (select 1 from pg_proc where proname = 'enter_card_statement') as enter_card_statement;
   ```
8. **Relink dev:** `supabase link --project-ref <dev-project-ref>`.
9. **Live check** (after Vercel has deployed `main`): on Loans & Liabilities add a test loan
   and pay one EMI from cash, add a test card with a purchase, a statement and a payment, add a
   test borrowing and repay it; void the payments, then archive and delete the test items.

If the push fails, the migrations are rolled back (each runs in one transaction) and prod is
unchanged from the last one applied; restore from the backup only if prod data is damaged.

## 5. Upgrade before any commercial launch

Do all of these before payments, paying customers or a public launch, and only once the
product is complete and QA has passed:

- [ ] Move the web app to **Vercel Pro**.
- [ ] Move the production database to **Supabase Pro** (daily backups; add point-in-time
      recovery if needed) and stop relying on manual backups.
- [ ] Clear the "Before production" list in `docs/sprint-plan.md` (redirect allow list,
      dev scripts, fixed `fincreador://` scheme, Site URL, custom SMTP).
- [ ] Re-check the auth redirects (section 3) on the production domain.
- [ ] Point the mobile release builds at the production project (Sprint 13).
- [ ] Review the licence and redistribution terms of the market data (AMFI NAV file, BSE
      bhavcopy, and NSE files if added) for commercial use; move to a licensed data vendor
      if they don't allow it (Sprint 7).
