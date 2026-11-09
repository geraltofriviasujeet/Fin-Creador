-- pgTAP tests for the web lookups left (migration 20261110120000): roma_search_remaining agrees
-- with what roma_search_begin grants, counts open reservations, is the caller's own, and
-- writes nothing. Run with `supabase test db` (CI). Everything is rolled back. Fictional users only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, email) values
  ('a5000000-0000-4000-8000-00000000000a', 'meera@example.test'),
  ('b5000000-0000-4000-8000-00000000000b', 'kabir@example.test');
update public.profiles set roma_enabled = true
 where id in ('a5000000-0000-4000-8000-00000000000a', 'b5000000-0000-4000-8000-00000000000b');
update public.roma_settings set user_daily_requests = 50, search_enabled = true;

select ok(
  has_function_privilege('authenticated', 'public.roma_search_remaining()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roma_search_remaining()', 'EXECUTE')
  and not has_function_privilege('public', 'public.roma_search_remaining()', 'EXECUTE'),
  'signed-in users only');

create table public.t_log (name text primary key, request_id uuid);
grant select, insert on table public.t_log to authenticated;
create function public.t_question(p_name text) returns text language sql set search_path = ''
  as $$ insert into public.t_log (name, request_id)
        select p_name, b.request_id from public.roma_begin_request('anthropic', 'claude-haiku-5-5') as b
        returning name $$;
create function public.t_id(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select l.request_id from public.t_log as l where l.name = p_name $$;
-- begin: outcome:credits ('ok:8'); left: outcome:credits:limited_by ('ok:8:day').
create function public.t_begin(p_name text) returns text language sql set search_path = ''
  as $$ select b.outcome || ':' || b.credits from public.roma_search_begin(public.t_id(p_name), 'tavily', true) as b $$;
create function public.t_left() returns text language sql set search_path = ''
  as $$ select r.outcome || ':' || r.credits || ':' || coalesce(r.limited_by, '-') from public.roma_search_remaining() as r $$;
grant execute on function public.t_question(text), public.t_id(text), public.t_begin(text), public.t_left() to authenticated;

select set_config('request.jwt.claims', '{"sub": "a5000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

select is(public.t_left(), 'ok:16:day', 'a fresh day: the whole daily allowance');
select public.t_question('q1');
select is(public.t_begin('q1'), 'ok:8', 'a plan reserves 8');
select is(public.t_left(), 'ok:8:day', 'an open reservation counts at its reserved credits');
select is(public.roma_search_settle(public.t_id('q1'), 2), true, 'the plan sent 2');
select is(public.t_left(), 'ok:14:day', 'once settled, only the 2 sent count');
select public.t_question('q2');
select is(public.t_begin('q2'), 'ok:8', 'the next plan reserves 8');
select is(public.t_left(), 'ok:6:day', '6 left while it is open');
select public.t_question('q3');
select is(public.t_begin('q3'), 'ok:6', '... and begin grants exactly the 6 it said were left');
select is(public.t_left(), 'daily_limit:0:day', 'the day used up: daily_limit, as begin says');

reset role;
select is((select count(*)::int from public.roma_search_usage where user_id = 'a5000000-0000-4000-8000-00000000000a'), 3,
  'asking what is left writes nothing (3 reservations, from begin only)');

select set_config('request.jwt.claims', '{"sub": "b5000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is(public.t_left(), 'ok:16:day', 'another user''s day is their own');

reset role;
update public.roma_settings set search_monthly_credits = 20;
select set_config('request.jwt.claims', '{"sub": "b5000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is(public.t_left(), 'ok:4:month', 'fewer left in the month than in the day: the month''s 4, and it says so');

reset role;
update public.roma_settings set search_monthly_credits = 16;
select set_config('request.jwt.claims', '{"sub": "b5000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is(public.t_left(), 'monthly_cap:0:month', 'the month used up by everyone (16 counted): monthly_cap, before the day');

reset role;
update public.roma_settings set search_monthly_credits = 900, search_enabled = false;
set local role authenticated;
select is(public.t_left(), 'disabled:0:-', 'web lookups switched off: disabled');

select * from finish();
rollback;
