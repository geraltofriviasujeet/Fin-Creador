-- pgTAP tests for model shortlists on a plan (migration 20261109180000): the "candidates" key
-- joins the plan-shape check's key list; the rest of the check is unchanged. The check is
-- recreated, so both directions are asserted again: a malformed jsonpath fails open (silent
-- mode), so an accept case alone would pass with a broken expression, and a reject case alone
-- would pass with a check that rejects everything.
-- Run with `supabase test db` (CI). Everything is rolled back. Fictional users only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email) values ('a4000000-0000-4000-8000-00000000000a', 'meera@example.test');
update public.profiles set roma_enabled = true where id = 'a4000000-0000-4000-8000-00000000000a';

-- Settled model requests, as the API route leaves them.
insert into public.roma_usage (id, user_id, provider, model, status, reserved_usd, input_tokens, output_tokens, cost_usd, ended_at)
select ('00000000-0000-4000-8000-0000000004' || lpad(n::text, 2, '0'))::uuid, 'a4000000-0000-4000-8000-00000000000a',
       'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now()
  from generate_series(1, 8) as n;

-- Test-only: record a turn as the caller, with a plan; returns the turn's number.
create function public.t_turn(p_request uuid, p_plan jsonb) returns integer language sql set search_path = ''
  as $$ select t.seq from public.roma_record_turn(p_request, null, 'Which bike can I buy?', 'Here is your shortlist.',
          public.user_local_today((select auth.uid())), '{}', array['purchase_plan'], false, p_plan) as t $$;
-- A purchase plan with a shortlist (or with none, when p_candidates is null).
create function public.t_plan(p_candidates jsonb) returns jsonb language sql immutable set search_path = '' as $$
  select '{
    "v": 1, "kind": "purchase", "intake": {"title": "Bike"}, "lines": [], "saved": null, "carriers": null,
    "hotels": null, "verdicts": {"records": "fits", "web": "2 of 3 fit"}, "changes": [], "assumptions": [], "sources": []
  }'::jsonb || case when p_candidates is null then '{}'::jsonb else pg_catalog.jsonb_build_object('candidates', p_candidates) end $$;
create function public.t_shortlist() returns jsonb language sql immutable set search_path = '' as $$
  select '{"listed": [{"make": "Example", "model": "Commuter 125", "low": "95000", "high": "98000", "currency": "INR",
            "facts": ["124.7 cc"], "site": "example.test", "url": "https://example.test/bikes",
            "fit": {"met": "yes", "summary": "Fits by January 2027."}}], "note": "Listed on the pages found."}'::jsonb $$;
grant execute on function public.t_turn(uuid, jsonb), public.t_plan(jsonb), public.t_shortlist() to authenticated;

select set_config('request.jwt.claims', '{"sub": "a4000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

select ok(exists (select 1 from pg_catalog.pg_constraint
            where conrelid = 'public.ai_messages'::regclass and conname = 'ai_messages_plan_shape' and contype = 'c'),
  'the recreated plan-shape check is on ai_messages');
select is(public.t_turn('00000000-0000-4000-8000-000000000401', public.t_plan(public.t_shortlist())), 1,
  'a purchase plan with a candidates shortlist is accepted');
select is((select plan -> 'candidates' from public.ai_messages where request_id = '00000000-0000-4000-8000-000000000401'),
  public.t_shortlist(), '... and stored as sent');
select is(public.t_turn('00000000-0000-4000-8000-000000000402', public.t_plan(null)), 1,
  'a plan without candidates (as stored before this migration) still passes');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000403',
    public.t_plan(public.t_shortlist()) || '{"notes": "x"}'::jsonb) $$,
  '23514', null, 'a top-level key not on the list is still rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000403',
    public.t_plan(pg_catalog.jsonb_set(public.t_shortlist(), '{listed,0,account}', '"12345678"'))) $$,
  '23514', null, 'an "account" key inside a candidate is still rejected after the check is recreated');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000403',
    public.t_plan(public.t_shortlist()) || '{"lines": [{"line": "price", "pages": [{"account": "12345678"}]}]}'::jsonb) $$,
  '23514', null, 'an "account" key deep in arrays outside the shortlist is still rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000403',
    public.t_plan(pg_catalog.jsonb_set(public.t_shortlist(), '{listed,0,account_no}', '"12345678"'))) $$,
  '23514', null, 'an "account_no" key inside a candidate is rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000403',
    public.t_plan(pg_catalog.jsonb_set(public.t_shortlist(), '{listed,0,fit,Balance}', '"0"'))) $$,
  '23514', null, 'a key naming a balance, in any case, deep inside a candidate is rejected');
select throws_ok($$ select public.t_turn('00000000-0000-4000-8000-000000000403',
    public.t_plan(pg_catalog.jsonb_set(public.t_shortlist(), '{note}', to_jsonb(repeat('x', 33000))))) $$,
  '23514', null, 'a plan over 32 KB with a shortlist is rejected');
select is((select count(*)::int from public.ai_messages where request_id = '00000000-0000-4000-8000-000000000403'), 0,
  'a rejected plan records no turn');

select * from finish();
rollback;
