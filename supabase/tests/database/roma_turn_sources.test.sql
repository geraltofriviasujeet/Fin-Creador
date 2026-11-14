-- pgTAP tests for the citations and the tax card stored on a turn (migration 20261114180000).
-- Every check is asserted in both directions: a malformed jsonpath fails open in silent mode,
-- so an accept case alone would pass with a broken expression, and a reject case alone would
-- pass with a check that rejects everything. The checks must also fail closed on null.
-- Run with `supabase test db` (CI). Everything is rolled back. Fictional users only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

insert into auth.users (id, email) values ('a5000000-0000-4000-8000-00000000000a', 'meera@example.test');
update public.profiles set roma_enabled = true where id = 'a5000000-0000-4000-8000-00000000000a';

-- Settled model requests, as the API route leaves them.
insert into public.roma_usage (id, user_id, provider, model, status, reserved_usd, input_tokens, output_tokens, cost_usd, ended_at)
select ('00000000-0000-4000-8000-0000000005' || lpad(n::text, 2, '0'))::uuid, 'a5000000-0000-4000-8000-00000000000a',
       'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now()
  from generate_series(1, 40) as n;

create function public.t_id(p_n integer) returns uuid language sql immutable set search_path = ''
  as $$ select ('00000000-0000-4000-8000-0000000005' || lpad(p_n::text, 2, '0'))::uuid $$;
-- Test-only: record a turn as the caller with citations and a tax card; returns the turn's number.
create function public.t_turn(p_n integer, p_citations jsonb, p_tax jsonb) returns integer language sql set search_path = ''
  as $$ select t.seq from public.roma_record_turn(public.t_id(p_n), null, 'What is an SIP?', 'An SIP invests [1].',
          public.user_local_today((select auth.uid())), '{}', array['knowledge_search'], false, null, p_citations, p_tax) as t $$;
-- The nine-argument call of 20261107180000_roma_plans.sql, as the app makes it today.
create function public.t_turn9(p_n integer) returns integer language sql set search_path = ''
  as $$ select t.seq from public.roma_record_turn(public.t_id(p_n), null, 'How much did I spend?', 'You spent ₹500.',
          public.user_local_today((select auth.uid())), '{}', array['spending_for_period'], false, null) as t $$;
create function public.t_citations() returns jsonb language sql immutable set search_path = '' as $$
  select '[
    {"n": 1, "title": "What an SIP is", "source": "FinCreador explainer, based on AMFI", "url": "https://example.test/sip",
     "financialYear": "2026-27", "passages": ["An SIP invests a fixed amount at regular intervals."]},
    {"n": 2, "title": "Income tax, new regime", "source": "FinCreador explainer, based on Income Tax Department",
     "linkPending": true, "url": null, "passages": ["Up to ₹4,00,000: nil.", "Above ₹24,00,000: 30%."]}
  ]'::jsonb $$;
create function public.t_tax() returns jsonb language sql immutable set search_path = '' as $$
  select '{
    "taxYear": "2026-27",
    "regimes": [
      {"title": "New regime", "rows": [{"label": "Total tax", "value": "₹84,240", "total": true}]},
      {"title": "Old regime", "rows": [{"label": "Total tax", "value": "₹2,30,880", "total": true}]}
    ],
    "comparison": "The new regime''s total is lower by ₹1,46,640.",
    "assumptions": ["No deductions given."],
    "sources": ["Income tax under the default (new) regime, tax year 2026-27"]
  }'::jsonb $$;
grant execute on function public.t_id(integer), public.t_turn(integer, jsonb, jsonb), public.t_turn9(integer),
  public.t_citations(), public.t_tax() to authenticated;

-- ------------------------------------------------------------ schema and the function (1-6)
select has_column('public', 'ai_messages', 'citations', 'ai_messages has citations');
select has_column('public', 'ai_messages', 'tax', 'ai_messages has tax');
select ok(
  to_regprocedure('public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb)') is null,
  'the nine-argument signature is gone (no overload left to call)');
select ok(
  has_function_privilege('authenticated', 'public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('public', 'public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb)', 'EXECUTE'),
  'the new signature: signed-in users only');

select set_config('request.jwt.claims', '{"sub": "a5000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

select is(public.t_turn9(1), 1, 'a nine-argument call still records a turn');
select is((select array[citations is null, tax is null] from public.ai_messages where request_id = public.t_id(1)), array[true, true],
  '... with no citations and no tax card');

-- ------------------------------------------------------------ accepted (7-12)
select is(public.t_turn(2, public.t_citations(), null), 1, 'valid citations (a url, a null url, two passages) are accepted');
select is((select citations from public.ai_messages where request_id = public.t_id(2)), public.t_citations(), '... and stored as sent');
select is(public.t_turn(3, '[{"n": 1, "title": "T", "source": "S", "passages": ["p"]}]', null), 1,
  'a citation with no url key is accepted');
select is(public.t_turn(4, null, public.t_tax()), 1, 'a valid tax card is accepted');
select is((select tax from public.ai_messages where request_id = public.t_id(4)), public.t_tax(), '... and stored as sent');
select is(public.t_turn(5, public.t_citations(), (public.t_tax() - 'sources'::text) #- '{regimes,1}'::text[]), 1,
  'a tax card with one regime and no sources, beside citations, is accepted');

-- ------------------------------------------------------------ citations rejected (13-26)
select throws_ok($$ select public.t_turn(10, '{}', null) $$, '23514', null, 'citations {} are rejected');
select throws_ok($$ select public.t_turn(10, '[]', null) $$, '23514', null, 'an empty citations array is rejected');
select throws_ok($$ select public.t_turn(10, '[{}]', null) $$, '23514', null, 'a citation {} is rejected');
select throws_ok($$ select public.t_turn(10, public.t_citations() #- '{0,title}', null) $$, '23514', null,
  'a citation missing its title is rejected');
select throws_ok($$ select public.t_turn(10, public.t_citations() #- '{1,passages}', null) $$, '23514', null,
  'a citation missing its passages is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_citations(), '{0,n}', '"1"'), null) $$, '23514', null,
  'a citation whose n is not a number is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_citations(), '{0,source}', '7'), null) $$, '23514', null,
  'a citation whose source is not a string is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_citations(), '{0,notes}', '"x"'), null) $$, '23514', null,
  'a citation key not on the list is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_citations(), '{0,url}', '"http://example.test/sip"'), null) $$, '23514', null,
  'a non-https url is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_citations(), '{0,url}', '42'), null) $$, '23514', null,
  'a numeric url is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_citations(), '{0,passages}', '[]'), null) $$, '23514', null,
  'an empty passages array is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_citations(), '{0,passages}', '["a", "b", "c", "d", "e"]'), null) $$, '23514', null,
  'more than 4 passages are rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_citations(), '{0,passages}', '[{"Account_No": "12345678"}]'), null) $$, '23514', null,
  'a blocked key deep inside a citation is rejected');
select throws_ok($$ select public.t_turn(10, jsonb_set(public.t_citations(), '{0,passages}', to_jsonb(array[repeat('x', 33000)])), null) $$, '23514', null,
  'citations over 32 KB are rejected');

-- ------------------------------------------------------------ tax card rejected (27-38)
select throws_ok($$ select public.t_turn(10, null, '{}') $$, '23514', null, 'a tax card {} is rejected');
select throws_ok($$ select public.t_turn(10, null, '[]') $$, '23514', null, 'a tax card that is not an object is rejected');
select throws_ok($$ select public.t_turn(10, null, public.t_tax() - 'comparison'::text) $$, '23514', null,
  'a tax card missing its comparison is rejected');
select throws_ok($$ select public.t_turn(10, null, public.t_tax() - 'taxYear'::text) $$, '23514', null,
  'a tax card missing its tax year is rejected');
select throws_ok($$ select public.t_turn(10, null, public.t_tax() || '{"outOfDate": true}') $$, '23514', null,
  'a top-level key not on the list is rejected');
select throws_ok($$ select public.t_turn(10, null, jsonb_set(public.t_tax(), '{taxYear}', '"FY26"')) $$, '23514', null,
  'a tax year not shaped 2026-27 is rejected');
select throws_ok($$ select public.t_turn(10, null, jsonb_set(public.t_tax(), '{regimes}', '[]')) $$, '23514', null,
  'no regimes is rejected');
select throws_ok($$ select public.t_turn(10, null, jsonb_set(public.t_tax(), '{regimes,2}', '{"title": "Third", "rows": []}', true)) $$, '23514', null,
  'three regimes are rejected');
select throws_ok($$ select public.t_turn(10, null, jsonb_set(public.t_tax(), '{sources}', '"one"')) $$, '23514', null,
  'sources that are not an array are rejected');
select throws_ok($$ select public.t_turn(10, null, jsonb_set(public.t_tax(), '{regimes,0,rows,0,Balance}', '"0"')) $$, '23514', null,
  'a blocked key deep inside the tax card is rejected');
select throws_ok($$ select public.t_turn(10, null, jsonb_set(public.t_tax(), '{comparison}', to_jsonb(repeat('x', 17000)))) $$, '23514', null,
  'a tax card over 16 KB is rejected');
select is((select count(*)::int from public.ai_messages where request_id = public.t_id(10)), 0, 'a rejected value records no turn');

-- ------------------------------------------------------------ ownership (39-41)
select is((select count(*)::int from public.ai_messages where citations is not null or tax is not null), 4,
  'the owner reads the stored citations and cards');
reset role;
insert into auth.users (id, email) values ('b5000000-0000-4000-8000-00000000000b', 'kabir@example.test');
select set_config('request.jwt.claims', '{"sub": "b5000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.ai_messages), 0, 'another user reads none of them');
select ok(not has_table_privilege('authenticated', 'public.ai_messages', 'UPDATE'),
  'a client cannot write citations or a card except through roma_record_turn');

select * from finish();
rollback;
