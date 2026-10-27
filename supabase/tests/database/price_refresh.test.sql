-- pgTAP tests for the price refresh run log and its pg_cron job (migration 20261027180000).
-- Run with `supabase test db` (CI). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- ------------------------------------------------------------ extensions and the job
select ok(exists (select 1 from pg_extension where extname = 'pg_cron'), 'pg_cron is installed');
select ok(exists (select 1 from pg_extension where extname = 'pg_net'), 'pg_net is installed');
select results_eq(
  $$ select schedule, active from cron.job where jobname = 'refresh-prices-daily' $$,
  $$ values ('30 1 * * *'::text, true) $$,
  'one active job refresh-prices-daily at 01:30 UTC (07:00 IST)'
);
select is((select count(*)::int from cron.job where jobname = 'refresh-prices-daily'), 1, 'the job exists once');
select ok(
  (select command like '%vault.decrypted_secrets%refresh_prices_url%' and command like '%refresh_prices_secret%'
          and command like '%x-refresh-secret%' and command not like '%supabase.co%'
   from cron.job where jobname = 'refresh-prices-daily'),
  'the job reads the URL and the secret from Vault (neither is stored in the job)'
);

-- ------------------------------------------------------------ privileges
select ok(not has_table_privilege('anon', 'public.price_refresh_runs', 'SELECT')
          and not has_table_privilege('anon', 'public.price_refresh_runs', 'INSERT'),
  'anon has no access to the run log');
select ok(not has_table_privilege('authenticated', 'public.price_refresh_runs', 'SELECT')
          and not has_table_privilege('authenticated', 'public.price_refresh_runs', 'INSERT'),
  'clients have no access to the run log');
select ok(not has_table_privilege('service_role', 'public.price_refresh_runs', 'UPDATE')
          and not has_table_privilege('service_role', 'public.price_refresh_runs', 'DELETE'),
  'the run log is append-only, even for the service role');

set local role anon;
select throws_ok($$ select count(*) from public.price_refresh_runs $$, '42501', null, 'anon cannot read the run log');
reset role;

select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$ select count(*) from public.price_refresh_runs $$, '42501', null, 'a signed-in client cannot read the run log');
select throws_ok(
  $$ insert into public.price_refresh_runs (source, status, started_at, finished_at) values ('amfi', 'ok', now(), now()) $$,
  '42501', null, 'a signed-in client cannot write the run log'
);
reset role;

-- ------------------------------------------------------------ the function (service role)
set local role service_role;
select lives_ok(
  $$ insert into public.price_refresh_runs
       (source, status, started_at, finished_at, price_date, rows_seen, rows_loaded, rows_skipped, skip_reasons, error)
     values ('amfi', 'ok', now() - interval '20 seconds', now(), '2026-10-26', 14413, 14172, 241, '{"no_price": 241}', null),
            ('bse', 'no_file', now() - interval '2 seconds', now(), null, 0, 0, 0, '{}', 'HTML page instead of a file') $$,
  'the service role can log runs'
);
select results_eq(
  $$ select source, status, rows_loaded, (skip_reasons ->> 'no_price')::int from public.price_refresh_runs order by source $$,
  $$ values ('amfi'::text, 'ok'::text, 14172, 241), ('bse'::text, 'no_file'::text, 0, null::int) $$,
  'the service role can read the run log'
);
select throws_ok(
  $$ insert into public.price_refresh_runs (source, status, started_at, finished_at) values ('nse', 'ok', now(), now()) $$,
  '23514', null, 'only amfi and bse are sources'
);
select throws_ok(
  $$ insert into public.price_refresh_runs (source, status, started_at, finished_at) values ('amfi', 'running', now(), now()) $$,
  '23514', null, 'status is ok, no_file or error'
);
select throws_ok(
  $$ insert into public.price_refresh_runs (source, status, started_at, finished_at) values ('amfi', 'ok', now(), now() - interval '1 second') $$,
  '23514', null, 'a run cannot finish before it starts'
);
select throws_ok(
  $$ insert into public.price_refresh_runs (source, status, started_at, finished_at, rows_seen) values ('amfi', 'ok', now(), now(), -1) $$,
  '23514', null, 'counts cannot be negative'
);
select throws_ok(
  $$ insert into public.price_refresh_runs (source, status, started_at, finished_at, skip_reasons) values ('amfi', 'ok', now(), now(), '[1]') $$,
  '23514', null, 'skip reasons are an object'
);
select throws_ok(
  $$ insert into public.price_refresh_runs (source, status, started_at, finished_at, error) values ('amfi', 'error', now(), now(), repeat('x', 1001)) $$,
  '23514', null, 'error text is at most 1,000 characters'
);
select throws_ok(
  $$ insert into public.price_refresh_runs (source, status, finished_at) values ('amfi', 'ok', now()) $$,
  '23502', null, 'started_at is required'
);
select throws_ok($$ update public.price_refresh_runs set status = 'error' $$, '42501', null, 'the service role cannot change a logged run');
select throws_ok($$ delete from public.price_refresh_runs $$, '42501', null, 'the service role cannot delete logged runs');
reset role;

select * from finish();
rollback;
