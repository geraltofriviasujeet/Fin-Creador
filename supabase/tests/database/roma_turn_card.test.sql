-- pgTAP tests for the check card stored on a turn (migration 20261115120000).
-- Every check is asserted in both directions: a malformed jsonpath fails open in silent mode,
-- so an accept case alone would pass with a broken expression, and a reject case alone would
-- pass with a check that rejects everything. The checks must also fail closed on null.
-- Run with `supabase test db` (CI). Everything is rolled back. Fictional users only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

insert into auth.users (id, email) values ('a6000000-0000-4000-8000-00000000000a', 'meera@example.test');
update public.profiles set roma_enabled = true where id = 'a6000000-0000-4000-8000-00000000000a';

-- Settled model requests, as the API route leaves them.
insert into public.roma_usage (id, user_id, provider, model, status, reserved_usd, input_tokens, output_tokens, cost_usd, ended_at)
select ('00000000-0000-4000-8000-0000000006' || lpad(n::text, 2, '0'))::uuid, 'a6000000-0000-4000-8000-00000000000a',
       'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now()
  from generate_series(1, 40) as n;

create function public.t_id(p_n integer) returns uuid language sql immutable set search_path = ''
  as $$ select ('00000000-0000-4000-8000-0000000006' || lpad(p_n::text, 2, '0'))::uuid $$;
-- Test-only: record a turn as the caller with a card; returns the turn's number.
create function public.t_turn(p_n integer, p_card jsonb) returns integer language sql set search_path = ''
  as $$ select t.seq from public.roma_record_turn(public.t_id(p_n), null, 'What if I save 5000 more for Bike?', 'Reached in May 2028 (19 months).',
          public.user_local_today((select auth.uid())), '{}', array['goal_what_if'], false, null, null, null, p_card) as t $$;
-- The eleven-argument call of 20261114180000_roma_turn_sources.sql, as the app makes it today.
create function public.t_turn11(p_n integer) returns integer language sql set search_path = ''
  as $$ select t.seq from public.roma_record_turn(public.t_id(p_n), null, 'What is an SIP?', 'An SIP invests [1].',
          public.user_local_today((select auth.uid())), '{}', array['knowledge_search'], false, null, null, null) as t $$;
-- The nine-argument call of 20261107180000_roma_plans.sql.
create function public.t_turn9(p_n integer) returns integer language sql set search_path = ''
  as $$ select t.seq from public.roma_record_turn(public.t_id(p_n), null, 'How much did I spend?', 'You spent ₹500.',
          public.user_local_today((select auth.uid())), '{}', array['spending_for_period'], false, null) as t $$;
create function public.t_what_if() returns jsonb language sql immutable set search_path = '' as $$
  select '{
    "kind": "what_if",
    "goal": "Bike",
    "verdict": "Reached in May 2028 (19 months).",
    "caveat": "Your records show nothing free a month today; this assumes you find the extra ₹5,000.",
    "assumptions": ["Only INR entries are counted."],
    "lines": ["Savings only: no investment returns, no interest and no inflation."],
    "comparison": {"before": "As it is", "after": "₹5,000 a month", "rows": [
      {"label": "For this goal a month", "before": "nothing free", "after": "₹5,000"},
      {"label": "Reached in", "before": "not reached", "after": "May 2028 (19 months)"}
    ]},
    "figures": [{"label": "Bike: target", "value": "₹95,000"}, {"label": "Months with records", "value": "6"}]
  }'::jsonb $$;
create function public.t_trip() returns jsonb language sql immutable set search_path = '' as $$
  select '{
    "kind": "trip", "goal": "Goa", "verdict": "Yes.", "assumptions": [],
    "web": {"verdict": "Yes.", "summary": "With web estimates: yes.", "webOnly": true}
  }'::jsonb $$;
grant execute on function public.t_id(integer), public.t_turn(integer, jsonb), public.t_turn11(integer), public.t_turn9(integer),
  public.t_what_if(), public.t_trip() to authenticated;

-- ------------------------------------------------------------ schema and the function (1-8)
select has_column('public', 'ai_messages', 'card', 'ai_messages has card');
select ok(
  to_regprocedure('public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb)') is null,
  'the eleven-argument signature is gone (no overload left to call)');
select ok(
  has_function_privilege('authenticated', 'public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('public', 'public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'),
  'the new signature: signed-in users only');

select set_config('request.jwt.claims', '{"sub": "a6000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

select is(public.t_turn11(1), 1, 'an eleven-argument call still records a turn');
select is((select card is null from public.ai_messages where request_id = public.t_id(1)), true, '... with no card');
select is(public.t_turn9(2), 1, 'a nine-argument call still records a turn');
select is((select card is null from public.ai_messages where request_id = public.t_id(2)), true, '... with no card');
select is(public.t_turn(3, null), 1, 'a null card is accepted');

-- ------------------------------------------------------------ accepted (9-14)
select is(public.t_turn(4, public.t_what_if()), 1, 'a what-if card (caveat, lines, comparison, figures) is accepted');
select is((select card from public.ai_messages where request_id = public.t_id(4)), public.t_what_if(), '... and stored as sent');
select is(public.t_turn(5, '{"kind": "goal", "goal": "Car", "verdict": "Yes.", "assumptions": []}'), 1,
  'a goal card with only the required keys is accepted');
select is(public.t_turn(6, public.t_trip()), 1, 'a trip card with a web-only line is accepted');
select is(public.t_turn(7, public.t_trip() #- '{web,webOnly}'), 1, 'a trip card whose web line has no webOnly is accepted');
select is(public.t_turn(8, jsonb_set(public.t_what_if(), '{figures}', '[]')), 1, 'an empty figures table is accepted');

-- ------------------------------------------------------------ rejected: the card itself (15-24)
select throws_ok($$ select public.t_turn(10, '{}') $$, '23514', null, 'a card {} is rejected');
select throws_ok($$ select public.t_turn(10, '[]') $$, '23514', null, 'a card that is not an object is rejected');
select throws_ok($$ select public.t_turn(10, 'null'::jsonb) $$, '23514', null, 'a JSON null card is rejected');
select throws_ok($$ select public.t_turn(10, public.t_what_if() - 'kind'::text) $$, '23514', null, 'a card missing its kind is rejected');
select throws_ok($$ select public.t_turn(10, public.t_what_if() - 'verdict'::text) $$, '23514', null, 'a card missing its verdict is rejected');
select throws_ok($$ select public.t_turn(10, public.t_what_if() - 'assumptions'::text) $$, '23514', null, 'a card missing its assumptions is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{kind}', '"tax"')) $$, '23514', null, 'a kind not on the list is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{kind}', 'null')) $$, '23514', null, 'a null kind is rejected');
select throws_ok($$ select public.t_turn(10, public.t_what_if() || '{"summary": "x"}') $$, '23514', null, 'a top-level key not on the list is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{caveat}', '7')) $$, '23514', null, 'a caveat that is not a string is rejected');

-- ------------------------------------------------------------ rejected: comparison (25-32)
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{comparison}', 'null')) $$, '23514', null, 'a null comparison is rejected');
select throws_ok($$ select public.t_turn(10, public.t_what_if() #- '{comparison,rows}') $$, '23514', null, 'a comparison missing its rows is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{comparison,rows}', '[]')) $$, '23514', null, 'a comparison with no rows is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{comparison,rows}',
  '[{"label":"a","before":"b","after":"c"},{"label":"a","before":"b","after":"c"},{"label":"a","before":"b","after":"c"},{"label":"a","before":"b","after":"c"},{"label":"a","before":"b","after":"c"},{"label":"a","before":"b","after":"c"},{"label":"a","before":"b","after":"c"}]')) $$,
  '23514', null, 'more than 6 rows are rejected');
select throws_ok($$ select public.t_turn(10, public.t_what_if() #- '{comparison,rows,0,after}') $$, '23514', null, 'a row missing its after is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{comparison,rows,0,note}', '"x"')) $$, '23514', null, 'a row key not on the list is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{comparison,rows,1,before}', '0')) $$, '23514', null, 'a row value that is not a string is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{kind}', '"goal"')) $$, '23514', null, 'a comparison on a goal card is rejected');

-- ------------------------------------------------------------ rejected: web, figures, lines, keys, size (33-42)
select throws_ok($$ select public.t_turn(10, public.t_trip() #- '{web,summary}') $$, '23514', null, 'a web line missing its summary is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_trip(), '{web,webOnly}', 'false')) $$, '23514', null, 'webOnly other than true is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_trip(), '{web}', 'null')) $$, '23514', null, 'a null web line is rejected');
select throws_ok($$ select public.t_turn(10, public.t_what_if() #- '{figures,0,value}') $$, '23514', null, 'a figure missing its value is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{figures,0,minor}', '100')) $$, '23514', null, 'a figure key not on the list is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{figures}',
  (select jsonb_agg(jsonb_build_object('label', 'L' || n, 'value', 'V')) from generate_series(1, 41) as n))) $$,
  '23514', null, 'more than 40 figures are rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{lines}', '"one"')) $$, '23514', null, 'lines that are not an array are rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{lines}', '[{"Account_No": "12345678"}]')) $$, '23514', null,
  'a blocked key deep inside the card is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_what_if(), '{assumptions}', to_jsonb(array[repeat('x', 17000)]))) $$, '23514', null,
  'a card over 16 KB is rejected');
select is((select count(*)::int from public.ai_messages where request_id = public.t_id(10)), 0, 'a rejected card records no turn');

-- ------------------------------------------------------------ ownership (43-46)
select is((select count(*)::int from public.ai_messages where card is not null), 5, 'the owner reads the stored cards');
reset role;
insert into auth.users (id, email) values ('b6000000-0000-4000-8000-00000000000b', 'kabir@example.test');
select set_config('request.jwt.claims', '{"sub": "b6000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.ai_messages), 0, 'another user reads none of them');
select ok(not has_table_privilege('authenticated', 'public.ai_messages', 'UPDATE'),
  'a client cannot write a card except through roma_record_turn');
select ok(not has_column_privilege('authenticated', 'public.ai_messages', 'card', 'INSERT'),
  'a client cannot insert a card directly');

select * from finish();
rollback;
