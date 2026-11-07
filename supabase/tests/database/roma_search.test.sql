-- pgTAP tests for Roma's web lookup credits (migration 20261107120000).
-- Run with `supabase test db` (CI). Everything is rolled back. Fictional users only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- Users A and B, fictional, both with Roma on.
insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-00000000000a', 'meera@example.test'),
  ('b1000000-0000-4000-8000-00000000000b', 'kabir@example.test');
update public.profiles set roma_enabled = true;

-- Small credit caps so each is reached in a few calls; model caps out of the way.
update public.roma_settings
   set user_daily_requests = 50,
       search_monthly_credits = 6, search_user_daily_credits = 5, search_reserve_credits = 3;

-- Test-only log: each question's model reservation, and what its search begin returned.
create table public.t_log (name text primary key, request_id uuid, search text);
grant select, insert, update on table public.t_log to authenticated;
create function public.t_question(p_name text) returns text language sql set search_path = ''
  as $$ insert into public.t_log (name, request_id)
        select p_name, b.request_id from public.roma_begin_request('anthropic', 'claude-haiku-5-5') as b
        returning name $$;
create function public.t_id(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select l.request_id from public.t_log as l where l.name = p_name $$;
-- outcome:credits, e.g. 'ok:3' or 'daily_limit:0'.
create function public.t_search(p_name text) returns text language sql set search_path = ''
  as $$ select b.outcome || ':' || b.credits
          from public.roma_search_begin(public.t_id(p_name), 'tavily') as b $$;
grant execute on function public.t_question(text), public.t_id(text), public.t_search(text) to authenticated;

-- ------------------------------------------------------------ privileges (1-5)
select ok(
  not exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role']) as r(role),
                  unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
     where has_table_privilege(r.role, 'public.roma_search_usage', p.priv)),
  'clients have no access to roma_search_usage');
select ok(
  not has_function_privilege('anon', 'public.roma_search_begin(uuid, text, boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roma_search_settle(uuid, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roma_search_release(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.roma_search_begin(uuid, text, boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.roma_search_settle(uuid, integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.roma_search_release(uuid)', 'EXECUTE'),
  'search begin, settle and release: signed-in users only');
select ok(
  not has_function_privilege('authenticated', 'public.roma_search_counted(public.roma_search_usage)', 'EXECUTE'),
  'roma_search_counted is not callable through the API');
select is(
  (select array_agg(pg_get_function_identity_arguments(p.oid)) from pg_proc as p
    where p.oid = 'public.roma_search_begin'::regproc),
  array['p_request_id uuid, p_provider text, p_plan boolean'],
  'roma_search_begin takes no cap or credit count from the caller (only whether it is a plan)');

select set_config('request.jwt.claims', '{"sub": "a1000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$ update public.roma_settings set search_monthly_credits = 100000 $$, '42501', null,
  'a signed-in client cannot raise a search cap');

-- ------------------------------------------------------------ grants, partial grants, settle (6-18)
select public.t_question('a1');
select is(public.t_search('a1'), 'ok:3', 'A''s first question: 3 searches granted');
select is(public.t_search('a1'), 'no_request:0', 'a question gets one search reservation only');
select public.t_question('a2');
select is(public.t_search('a2'), 'ok:2', 'daily cap 5 with 3 reserved: only 2 granted');
select is(public.roma_search_settle(public.t_id('a2'), 3), false, 'settling more credits than reserved is refused');
select throws_ok(format($$ select public.roma_search_settle(%L, 0) $$, public.t_id('a2')),
  '22023', null, 'settling 0 credits is refused (nothing sent is a release)');
select throws_ok(format($$ select public.roma_search_settle(%L, 11) $$, public.t_id('a2')),
  '22023', null, 'settling more than 10 credits is refused');
select is(public.roma_search_settle(public.t_id('a2'), 2), true, 'searches sent: settled');
select is(public.roma_search_settle(public.t_id('a2'), 1), false, 'a reservation is settled only once');
select is(public.roma_search_release(public.t_id('a2')), false, 'a settled reservation can''t be released');
select public.t_question('a3');
select is(public.t_search('a3'), 'daily_limit:0', '5 credits counted today: refused');
select is(public.roma_search_release(public.t_id('a1')), true, 'no search sent: released');
select is(public.roma_search_release(public.t_id('a1')), false, 'a reservation is released only once');
reset role;
select is((select count(*)::int from public.roma_search_usage where request_id = public.t_id('a3')), 0,
  'a refusal writes nothing');

-- ------------------------------------------------------------ released credits come back (19-20)
-- A today: a1 released (0) + a2 settled (2) = 2 of 5.
set local role authenticated;
select public.t_question('a4');
select is(public.t_search('a4'), 'ok:3', 'released credits don''t count: 3 granted again');
-- An open question with no search yet, for B to try below.
select public.t_question('a5');
-- A question already answered (model reservation ended) can't start lookups.
select public.t_question('a6');
select public.roma_release_request(public.t_id('a6'));
select is(public.t_search('a6'), 'no_request:0', 'a question no longer open: refused');
reset role;

-- ------------------------------------------------------------ other people, monthly cap (21-26)
-- Everyone this month: 2 (a2) + 3 (a4) = 5 of 6.
select set_config('request.jwt.claims', '{"sub": "b1000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is(public.t_search('a5'), 'no_request:0', 'B cannot start lookups on A''s question');
select is(public.roma_search_settle(public.t_id('a4'), 1), false, 'B cannot settle A''s reservation');
select is(public.roma_search_release(public.t_id('a4')), false, 'B cannot release A''s reservation');
select public.t_question('b1');
select is(public.t_search('b1'), 'ok:1', 'monthly cap 6 with 5 counted: only 1 granted');
select public.t_question('b2');
select is(public.t_search('b2'), 'monthly_cap:0', 'monthly cap reached: refused');
reset role;
select is((select status from public.roma_search_usage where request_id = public.t_id('a4')), 'reserved',
  'A''s reservation is untouched by B');

-- ------------------------------------------------------------ kill switches (27-28)
update public.roma_settings set search_monthly_credits = 100, search_enabled = false;
select set_config('request.jwt.claims', '{"sub": "a1000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
select is(public.t_search('a5'), 'disabled:0', 'search kill switch off: refused');
reset role;
update public.roma_settings set search_enabled = true, enabled = false;
set local role authenticated;
select is(public.t_search('a5'), 'disabled:0', 'Roma''s kill switch off: no lookups either');
reset role;

-- ------------------------------------------------------------ ledger (29-32)
select is((select array[count(*)::int, sum(public.roma_search_counted(r))::int] from public.roma_search_usage as r),
  array[4, 6], 'four rows (no refusal wrote one); 0 + 2 + 3 + 1 credits counted');
select is((select array[r.status, r.credits::text] from public.roma_search_usage as r
            where r.request_id = public.t_id('a2')),
  array['settled', '2'], 'a2: the credits used replace the reservation');
select throws_ok(
  format($$ insert into public.roma_search_usage (request_id, user_id, provider, reserved_credits)
            values (%L, 'a1000000-0000-4000-8000-00000000000a', 'tavily', 11) $$, public.t_id('a5')),
  '23514', null, 'a reservation of more than 10 credits breaks a constraint');
delete from auth.users where id = 'b1000000-0000-4000-8000-00000000000b';
select is((select user_id from public.roma_search_usage where request_id = public.t_id('b1')), null,
  'a deleted account''s row stays, with no user, so the month''s count stays true');

select * from finish();
rollback;
