-- pgTAP tests for Roma's opt-in, kill switch and spend ledger (migration 20261105180000).
-- Run with `supabase test db` (CI). Everything is rolled back. Fictional users only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- Users A and B, fictional.
insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-00000000000a', 'meera@example.test'),
  ('b1000000-0000-4000-8000-00000000000b', 'kabir@example.test');

-- Small limits so each cap is reached in a few calls.
update public.roma_settings
   set monthly_budget_usd = 0.05, user_monthly_budget_usd = 0.03, user_daily_requests = 2, reserve_usd = 0.01;

-- Test-only log of what each direct call returned (outcome and request id).
create table public.t_log (name text primary key, outcome text, request_id uuid);
grant select, insert on table public.t_log to authenticated;
create function public.t_begin(p_name text) returns text language sql set search_path = ''
  as $$ insert into public.t_log (name, outcome, request_id)
        select p_name, b.outcome, b.request_id from public.roma_begin_request('anthropic', 'claude-haiku-5-5') as b
        returning outcome $$;
create function public.t_id(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select l.request_id from public.t_log as l where l.name = p_name $$;
grant execute on function public.t_begin(text), public.t_id(text) to authenticated;

-- ------------------------------------------------------------ privileges (1-6)
select ok(
  not exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role']) as r(role),
                  unnest(array['public.roma_settings', 'public.roma_usage']) as t(tbl),
                  unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
     where has_table_privilege(r.role, t.tbl, p.priv)),
  'clients have no access to roma_settings or roma_usage');
select ok(
  not has_function_privilege('anon', 'public.roma_begin_request(text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roma_settle_request(uuid, integer, integer, numeric)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roma_release_request(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.roma_begin_request(text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.roma_settle_request(uuid, integer, integer, numeric)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.roma_release_request(uuid)', 'EXECUTE'),
  'begin, settle and release: signed-in users only');
select ok(
  not has_function_privilege('authenticated', 'public.roma_counted_usd(public.roma_usage)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.profiles_roma_consent()', 'EXECUTE'),
  'internal functions are not callable through the API');
select is(
  (select array_agg(pg_get_function_identity_arguments(p.oid)) from pg_proc as p
    where p.oid = any (array['public.roma_begin_request'::regproc])),
  array['p_provider text, p_model text'],
  'roma_begin_request takes no cap, limit or amount from the caller');

select set_config('request.jwt.claims', '{"sub": "a1000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$ select count(*) from public.roma_settings $$, '42501', null, 'a signed-in client cannot read the settings');
select throws_ok($$ update public.roma_settings set monthly_budget_usd = 1000 $$, '42501', null,
  'a signed-in client cannot raise a cap');

-- ------------------------------------------------------------ opt-in and consent (7-13)
select is(public.t_begin('off'), 'not_enabled', 'Roma off on the profile: refused');
reset role;
select is((select count(*)::int from public.roma_usage), 0, '... and a refusal writes nothing');

set local role authenticated;
update public.profiles set roma_descriptions_ok_at = '2000-01-01T00:00:00Z'
 where id = 'a1000000-0000-4000-8000-00000000000a';
select is((select roma_descriptions_ok_at from public.profiles where id = 'a1000000-0000-4000-8000-00000000000a'),
  null, 'consent can''t be given while Roma is off');
update public.profiles set roma_enabled = true, roma_descriptions_ok_at = '2000-01-01T00:00:00Z'
 where id = 'a1000000-0000-4000-8000-00000000000a';
select is((select roma_descriptions_ok_at from public.profiles where id = 'a1000000-0000-4000-8000-00000000000a'),
  now(), 'a consent time sent by the client is replaced by the server''s now()');
select lives_ok(
  $$ update public.profiles set roma_enabled = false where id = 'a1000000-0000-4000-8000-00000000000a' $$,
  'turning Roma off after agreeing to descriptions works');
select is((select roma_descriptions_ok_at from public.profiles where id = 'a1000000-0000-4000-8000-00000000000a'),
  null, '... and clears the consent');
update public.profiles set roma_enabled = true where id = 'a1000000-0000-4000-8000-00000000000a';
select is((select roma_enabled from public.profiles where id = 'a1000000-0000-4000-8000-00000000000a'),
  true, 'A turns Roma on');
reset role;

-- ------------------------------------------------------------ kill switch (14-15)
update public.roma_settings set enabled = false;
set local role authenticated;
select is(public.t_begin('killed'), 'disabled', 'kill switch off: refused');
reset role;
delete from public.roma_settings;
set local role authenticated;
select is(public.t_begin('no-row'), 'disabled', 'a missing settings row counts as off');
reset role;
insert into public.roma_settings (id, monthly_budget_usd, user_monthly_budget_usd, user_daily_requests, reserve_usd)
values (true, 0.05, 0.03, 2, 0.01);

-- ------------------------------------------------------------ daily limit, release, settle (16-23)
set local role authenticated;
select is(public.t_begin('a1'), 'ok', 'first question today: reserved');
select is(public.t_begin('a2'), 'ok', 'second question today: reserved');
select is(public.t_begin('a3'), 'daily_limit', 'third question with a daily limit of 2: refused');
select is(public.roma_release_request(public.t_id('a1')), true, 'a reservation with no provider call is released');
select is(public.t_begin('a4'), 'ok', '... and a released question doesn''t use up the day''s allowance');
select is(public.roma_release_request(public.t_id('a1')), false, 'a reservation ends only once');
select is(public.roma_settle_request(public.t_id('a2'), 3000, 400, 0.002), true, 'a provider call is settled');
select throws_ok(
  format($$ select public.roma_settle_request(%L, 1, 1, -0.5) $$, public.t_id('a4')),
  '22023', null, 'a negative cost is refused');
reset role;

-- ------------------------------------------------------------ what each row counts (24-26)
select is((select status from public.roma_usage where id = public.t_id('a1')), 'released', 'a1 is released');
select is((select public.roma_counted_usd(u) from public.roma_usage as u where u.id = public.t_id('a1')), 0::numeric,
  '... and counts as nothing toward the caps');
select is((select array[u.status, u.cost_usd::text, u.input_tokens::text, u.output_tokens::text]
             from public.roma_usage as u where u.id = public.t_id('a2')),
  array['settled', '0.002000', '3000', '400'], 'a2: the real cost and tokens replace the reservation');

-- ------------------------------------------------------------ personal monthly cap (27-28)
-- A now counts 0.002 (a2) + 0.01 (a4) = 0.012 against a personal cap of 0.03.
update public.roma_settings set user_daily_requests = 50;
set local role authenticated;
select is(public.t_begin('a5'), 'ok', 'within the personal cap: reserved (0.022)');
select is(public.t_begin('a6'), 'user_budget', 'past the stored personal cap (0.032 > 0.03): refused');
reset role;

-- ------------------------------------------------------------ global cap and other people (29-33)
update public.profiles set roma_enabled = true where id = 'b1000000-0000-4000-8000-00000000000b';
select set_config('request.jwt.claims', '{"sub": "b1000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is(public.t_begin('b1'), 'ok', 'B: reserved (everyone: 0.032)');
select is(public.t_begin('b2'), 'ok', 'B: reserved (everyone: 0.042)');
select is(public.t_begin('b3'), 'global_budget', 'past the stored global cap (0.052 > 0.05): refused');
select is(public.roma_release_request(public.t_id('a4')), false, 'B cannot release A''s reservation');
select is(public.roma_settle_request(public.t_id('a4'), 0, 0, 0), false, 'B cannot settle A''s reservation');
reset role;

-- ------------------------------------------------------------ ledger totals (34)
select is((select array[count(*)::int, (sum(public.roma_counted_usd(u)) * 1000)::int] from public.roma_usage as u),
  array[6, 42], 'six rows (no refusal wrote one); 0.042 counted, A''s reservation untouched by B');

-- ------------------------------------------------------------ a missing time zone (35-37)
-- profiles.time_zone is not null and validated, so this can't happen today. Lift both rules
-- inside this rolled-back test to prove the daily limit fails closed if it ever did.
select col_not_null('public', 'profiles', 'time_zone', 'profiles.time_zone is not null');
alter table public.profiles alter column time_zone drop not null;
alter table public.profiles disable trigger profiles_validate_time_zone;
update public.profiles set time_zone = null where id = 'b1000000-0000-4000-8000-00000000000b';
update public.roma_settings set monthly_budget_usd = 1, user_daily_requests = 2;
select is((select time_zone from public.profiles where id = 'b1000000-0000-4000-8000-00000000000b'), null,
  'B''s time zone is null');
set local role authenticated;
select is(public.t_begin('b4'), 'daily_limit', 'with a null time zone the daily limit still applies (UTC day)');
reset role;

select * from finish();
rollback;
