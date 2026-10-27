-- Sprint 7: the daily price refresh. A run log for the refresh-prices Edge Function and one
-- pg_cron job that calls it at 07:00 IST (01:30 UTC; pg_cron on Supabase runs in UTC).
--
-- Secrets are never in this file or the repository. The job reads two Vault secrets, added
-- by hand on each project (Dashboard → Project Settings → Vault, or vault.create_secret):
--   refresh_prices_url     https://<project-ref>.supabase.co/functions/v1/refresh-prices
--   refresh_prices_secret  the same value as the function's REFRESH_PRICES_SECRET
-- Until both exist the job fails harmlessly (visible in cron.job_run_details).

-- ---------------------------------------------------------------------------
-- Run log: one row per source per run. Service role only (no client access).
-- ---------------------------------------------------------------------------

create table public.price_refresh_runs (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,
  status       text not null,
  started_at   timestamptz not null,
  finished_at  timestamptz not null,
  price_date   date,
  rows_seen    integer not null default 0,
  rows_loaded  integer not null default 0,
  rows_skipped integer not null default 0,
  -- Skipped rows by reason, e.g. {"no_price": 241, "debt_series": 458}.
  skip_reasons jsonb not null default '{}'::jsonb,
  -- The function's own error text (key-like text removed), never a secret.
  error        text,

  constraint price_refresh_runs_source check (source in ('amfi', 'bse')),
  constraint price_refresh_runs_status check (status in ('ok', 'no_file', 'error')),
  constraint price_refresh_runs_order check (finished_at >= started_at),
  constraint price_refresh_runs_counts check (rows_seen >= 0 and rows_loaded >= 0 and rows_skipped >= 0),
  constraint price_refresh_runs_reasons check (jsonb_typeof(skip_reasons) = 'object'),
  constraint price_refresh_runs_error_length check (error is null or char_length(error) <= 1000)
);

create index price_refresh_runs_started_idx on public.price_refresh_runs (started_at desc);

comment on table public.price_refresh_runs is
  'Log of the daily refresh-prices runs (counts, status, error text). Service role only.';

revoke all on table public.price_refresh_runs from anon, authenticated, service_role;
grant select, insert on table public.price_refresh_runs to service_role;
-- RLS on with no policies: anon and authenticated could not read it even with a grant.
alter table public.price_refresh_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Scheduling: pg_cron (jobs) and pg_net (HTTP from the database)
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- cron.schedule with a job name replaces an existing job of that name, so this is safe to
-- run again. The secret is read from Vault when the job runs.
select cron.schedule(
  'refresh-prices-daily',
  '30 1 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_prices_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-refresh-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_prices_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);
