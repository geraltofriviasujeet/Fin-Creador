-- pgTAP tests for Roma's detailed plans (migration 20261107180000): the plan credit cap and
-- the checked plan stored on its turn.
-- Run with `supabase test db` (CI). Everything is rolled back. Fictional users only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- Users A and B, fictional, both with Roma on.
insert into auth.users (id, email) values
  ('a3000000-0000-4000-8000-00000000000a', 'meera@example.test'),
  ('b3000000-0000-4000-8000-00000000000b', 'kabir@example.test');
update public.profiles set roma_enabled = true
 where id in ('a3000000-0000-4000-8000-00000000000a', 'b3000000-0000-4000-8000-00000000000b');

-- ------------------------------------------------------------ settings and schema (1-8)
select is((select array[search_plan_reserve_credits, search_reserve_credits, search_user_daily_credits, search_monthly_credits]
             from public.roma_settings),
  array[8, 3, 16, 900], 'plan cap 8, ordinary 3, daily raised from 5 to 16, monthly unchanged');
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'roma_settings' and column_name = 'search_user_daily_credits'),
  '16', 'the daily cap''s default is 16');
select throws_ok($$ update public.roma_settings set search_plan_reserve_credits = 11 $$, '23514', null,
  'a plan cap above 10 breaks a constraint');
select throws_ok($$ update public.roma_settings set search_plan_reserve_credits = 0 $$, '23514', null,
  'a plan cap of 0 breaks a constraint');
select ok(
  to_regprocedure('public.roma_search_begin(uuid, text)') is null
  and to_regprocedure('public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean)') is null,
  'the old signatures are gone (no overload left to call)');
select ok(
  has_function_privilege('authenticated', 'public.roma_search_begin(uuid, text, boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roma_search_begin(uuid, text, boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb)', 'EXECUTE'),
  'the new signatures: signed-in users only');
select ok(
  not has_table_privilege('authenticated', 'public.ai_messages', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.ai_messages', 'INSERT'),
  'a client cannot write a plan except through roma_record_turn');
select ok(
  not has_function_privilege('public', 'public.roma_search_begin(uuid, text, boolean)', 'EXECUTE')
  and not has_function_privilege('public', 'public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb)', 'EXECUTE'),
  'the default grant to public was revoked');

-- ------------------------------------------------------------ plan credits (9-17)
update public.roma_settings set user_daily_requests = 50;

create table public.t_log (name text primary key, request_id uuid);
grant select, insert on table public.t_log to authenticated;
create function public.t_question(p_name text) returns text language sql set search_path = ''
  as $$ insert into public.t_log (name, request_id)
        select p_name, b.request_id from public.roma_begin_request('anthropic', 'claude-haiku-5-5') as b
        returning name $$;
create function public.t_id(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select l.request_id from public.t_log as l where l.name = p_name $$;
-- outcome:credits, e.g. 'ok:8' or 'daily_limit:0'.
create function public.t_search(p_name text, p_plan boolean) returns text language sql set search_path = ''
  as $$ select b.outcome || ':' || b.credits
          from public.roma_search_begin(public.t_id(p_name), 'tavily', p_plan) as b $$;
create function public.t_search(p_name text) returns text language sql set search_path = ''
  as $$ select b.outcome || ':' || b.credits
          from public.roma_search_begin(p_request_id => public.t_id(p_name), p_provider => 'tavily') as b $$;
grant execute on function public.t_question(text), public.t_id(text), public.t_search(text, boolean), public.t_search(text) to authenticated;

select set_config('request.jwt.claims', '{"sub": "a3000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
select public.t_question('q1');
select is(public.t_search('q1', true), 'ok:8', 'a plan: 8 searches granted');
select public.t_question('q2');
select is(public.t_search('q2'), 'ok:3', 'an ordinary question, called the 10.8 way (no p_plan): 3 granted');
select public.t_question('q3');
select is(public.t_search('q3', true), 'ok:5', 'daily cap 16 with 11 reserved: a plan gets the 5 left');
select is(public.roma_search_settle(public.t_id('q1'), 8), true, 'a plan settles all 8 credits');
select is(public.roma_search_settle(public.t_id('q3'), 6), false, 'settling more credits than reserved is refused');
select throws_ok(format($$ select public.roma_search_settle(%L, 11) $$, public.t_id('q3')),
  '22023', null, 'settling more than 10 credits is refused');
select public.t_question('q4');
select is(public.t_search('q4', true), 'daily_limit:0', '16 credits counted today: a plan is refused');
select throws_ok(format($$ select * from public.roma_search_begin(%L, 'tavily', null) $$, public.t_id('q4')),
  '22023', null, 'p_plan null is refused');
reset role;
select throws_ok(
  format($$ insert into public.roma_search_usage (request_id, user_id, provider, reserved_credits)
            values (%L, 'a3000000-0000-4000-8000-00000000000a', 'tavily', 11) $$, public.t_id('q4')),
  '23514', null, 'a reservation of more than 10 credits breaks a constraint');

-- ------------------------------------------------------------ the plan on its turn (18-36)
-- Settled model requests for A (p1-p9) and B (pb), as the API route leaves them.
insert into public.roma_usage (id, user_id, provider, model, status, reserved_usd, input_tokens, output_tokens, cost_usd, ended_at)
select ('00000000-0000-4000-8000-0000000003' || lpad(n::text, 2, '0'))::uuid, 'a3000000-0000-4000-8000-00000000000a',
       'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now()
  from generate_series(1, 9) as n;
insert into public.roma_usage (id, user_id, provider, model, status, reserved_usd, input_tokens, output_tokens, cost_usd, ended_at)
values ('00000000-0000-4000-8000-0000000003b1', 'b3000000-0000-4000-8000-00000000000b',
        'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now());

-- Test-only: record a turn as the caller, with a plan; returns the turn's number.
create function public.t_turn(p_request uuid, p_plan jsonb) returns integer language sql set search_path = ''
  as $$ select t.seq from public.roma_record_turn(p_request, null, 'Plan my trip to Goa', 'Here is your plan.',
          public.user_local_today((select auth.uid())), '{}', array['trip_plan'], false, p_plan) as t $$;
grant execute on function public.t_turn(uuid, jsonb) to authenticated;

-- A valid plan, with objects inside arrays at several depths, so the key check has to walk
-- the whole document. "card_fees" is a legitimate key the narrowed pattern must allow.
create function public.t_valid() returns jsonb language sql immutable set search_path = '' as $$
  select '{
    "v": 1,
    "kind": "trip",
    "intake": {"destination": "Goa", "month": "2027-01", "nights": 4, "travellers": 2, "style": null},
    "lines": [
      {"line": "transport", "from": "web", "low": "9000", "high": "14000", "currency": "INR",
       "sources": [{"site": "example.test", "url": "https://example.test/flights"}]},
      {"line": "stay", "from": "none"},
      {"line": "shopping", "from": "records", "extras": {"card_fees": "0"}}
    ],
    "saved": {"minor": 2500000, "currency": "INR"},
    "carriers": [{"name": "Example Air", "site": "example.test", "url": "https://example.test/route"}],
    "hotels": [],
    "verdicts": {"records": "fits", "web": "short"},
    "changes": ["one night fewer"],
    "assumptions": ["2 travellers"],
    "sources": ["https://example.test/flights"]
  }'::jsonb $$;
-- The valid plan with one value set at a path.
create function public.t_with(p_path text[], p_value jsonb) returns jsonb language sql immutable set search_path = ''
  as $$ select pg_catalog.jsonb_set(public.t_valid(), p_path, p_value) $$;
grant execute on function public.t_valid(), public.t_with(text[], jsonb) to authenticated;

set local role authenticated;

-- Both directions of the key check: a malformed jsonpath fails open (silent mode), so the
-- accept case alone would pass with a broken expression and the reject cases alone would
-- pass with a check that rejects everything.
select is(public.t_turn('00000000-0000-4000-8000-000000000301', public.t_valid()), 1,
  'a valid plan (nested objects in arrays, a card_fees key) is accepted');
select is((select plan from public.ai_messages where request_id = '00000000-0000-4000-8000-000000000301'), public.t_valid(),
  '... and stored as sent, for reopening from history');
select is(public.t_turn('00000000-0000-4000-8000-000000000302', null), 1, 'an ordinary answer stores no plan');
select is((select plan from public.ai_messages where request_id = '00000000-0000-4000-8000-000000000302'), null,
  '... plan is null');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000303',
    public.t_with('{lines,0,sources,0,account}', '"12345678"')) $$,
  '23514', null, 'an "account" key deep inside arrays is rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000303',
    public.t_with('{saved,Account_No}', '"12345678"')) $$,
  '23514', null, 'an "Account_No" key, in any case, is rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000303',
    public.t_with('{intake,iban}', '"GB00TEST00000000000000"')) $$,
  '23514', null, 'an "iban" key is rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000303',
    public.t_with('{lines,2,extras,ifsc}', '"TEST0000000"')) $$,
  '23514', null, 'an "ifsc" key is rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000303',
    public.t_with('{carriers,0,card_number}', '"4000000000000000"')) $$,
  '23514', null, 'a "card_number" key is rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000303',
    public.t_with('{saved,opening_balance}', '100')) $$,
  '23514', null, 'a key naming a balance is rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000303',
    public.t_with('{notes}', '"x"')) $$,
  '23514', null, 'a top-level key not on the list is rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000303',
    public.t_with('{v}', '2')) $$,
  '23514', null, 'a plan version other than 1 is rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000303',
    public.t_with('{kind}', '"holiday"')) $$,
  '23514', null, 'a kind other than trip or purchase is rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000303', '[1, 2]'::jsonb) $$,
  '23514', null, 'a plan that is not an object is rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000303',
    public.t_with('{assumptions}', to_jsonb(array[repeat('x', 33000)]))) $$,
  '23514', null, 'a plan over 32 KB is rejected');
select is((select count(*)::int from public.ai_messages where request_id = '00000000-0000-4000-8000-000000000303'), 0,
  'a rejected plan records no turn');
select is((select count(*)::int from public.ai_conversations), 2,
  '... and starts no conversation (only the two accepted turns did)');
select is(public.t_turn('00000000-0000-4000-8000-000000000303', public.t_with('{kind}', '"purchase"')), 1,
  'the same request can still be recorded with a valid plan');
select throws_ok($$ update public.ai_messages set plan = public.t_valid() $$, '42501', null,
  'a client cannot rewrite a stored plan');
reset role;

-- ------------------------------------------------------------ other people (37-38)
select set_config('request.jwt.claims', '{"sub": "b3000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.ai_messages where plan is not null), 0, 'B cannot read A''s plans');
select is(public.t_turn('00000000-0000-4000-8000-0000000003b1', public.t_valid()), 1, 'B records a plan of their own');
reset role;

select * from finish();
rollback;
