-- pgTAP tests for goals added from a plan (migration 20261108120000): the link to the plan's
-- turn, who may set it, one goal per plan, and what happens when the conversation goes.
-- Run with `supabase test db` (CI). Everything is rolled back. Fictional users only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email) values
  ('a4000000-0000-4000-8000-00000000000a', 'meera@example.test'),
  ('b4000000-0000-4000-8000-00000000000b', 'kabir@example.test');

-- Settled requests and turns as the API route leaves them: A has a plan turn and an ordinary
-- turn; B has a plan turn.
insert into public.roma_usage (id, user_id, provider, model, status, reserved_usd, input_tokens, output_tokens, cost_usd, ended_at) values
  ('00000000-0000-4000-8000-000000000401', 'a4000000-0000-4000-8000-00000000000a', 'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now()),
  ('00000000-0000-4000-8000-000000000402', 'a4000000-0000-4000-8000-00000000000a', 'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now()),
  ('00000000-0000-4000-8000-0000000004b1', 'b4000000-0000-4000-8000-00000000000b', 'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now());
insert into public.ai_conversations (id, user_id, title) values
  ('c4000000-0000-4000-8000-00000000000a', 'a4000000-0000-4000-8000-00000000000a', 'Plan'),
  ('c4000000-0000-4000-8000-00000000000b', 'b4000000-0000-4000-8000-00000000000b', 'Plan');
insert into public.ai_messages (id, conversation_id, user_id, seq, request_id, question, answer, as_of, plan) values
  ('d4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-00000000000a', 'a4000000-0000-4000-8000-00000000000a', 1,
   '00000000-0000-4000-8000-000000000401', 'Can I buy a bike?', 'Here is your plan.', current_date,
   '{"v": 1, "kind": "purchase", "intake": {}, "lines": [], "saved": null, "carriers": null, "hotels": null, "verdicts": {}, "changes": [], "assumptions": [], "sources": []}'),
  ('d4000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-00000000000a', 'a4000000-0000-4000-8000-00000000000a', 2,
   '00000000-0000-4000-8000-000000000402', 'How much did I spend?', 'Some.', current_date, null),
  ('d4000000-0000-4000-8000-0000000000b1', 'c4000000-0000-4000-8000-00000000000b', 'b4000000-0000-4000-8000-00000000000b', 1,
   '00000000-0000-4000-8000-0000000004b1', 'Can I buy a car?', 'Here is your plan.', current_date,
   '{"v": 1, "kind": "purchase", "intake": {}, "lines": [], "saved": null, "carriers": null, "hotels": null, "verdicts": {}, "changes": [], "assumptions": [], "sources": []}');

-- Test-only: add a goal as the caller, from a plan turn (or none).
create function public.t_goal(p_key uuid, p_message uuid) returns uuid language sql set search_path = ''
  as $$ insert into public.goals (type, name, target_amount_minor, saved_amount_minor, details, idempotency_key, plan_message_id)
        values ('other', 'Bike', 15000000, 6000000, '{"v": 1, "description": "Bike"}', p_key, p_message)
        returning id $$;
grant execute on function public.t_goal(uuid, uuid) to authenticated;

select ok(
  has_column_privilege('authenticated', 'public.goals', 'plan_message_id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.goals', 'plan_message_id', 'UPDATE'),
  'a client may set the plan on insert only');

select set_config('request.jwt.claims', '{"sub": "a4000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
select isnt(public.t_goal('e4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001'), null,
  'A adds a goal from their own plan');
select is((select plan_message_id from public.goals where idempotency_key = 'e4000000-0000-4000-8000-000000000001'),
  'd4000000-0000-4000-8000-000000000001'::uuid, '... linked to the plan''s turn');
select is((select saved_amount_minor from public.goals where idempotency_key = 'e4000000-0000-4000-8000-000000000001'),
  6000000::bigint, '... with the trade-in as already saved');
select throws_ok($$ select public.t_goal('e4000000-0000-4000-8000-000000000002', 'd4000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'a second goal from the same plan is refused');
select throws_ok($$ select public.t_goal('e4000000-0000-4000-8000-000000000003', 'd4000000-0000-4000-8000-000000000002') $$,
  'FC058', null, 'a turn without a plan is refused');
select throws_ok($$ select public.t_goal('e4000000-0000-4000-8000-000000000004', 'd4000000-0000-4000-8000-0000000000b1') $$,
  'FC058', null, 'another person''s plan is refused');
select throws_ok($$ select public.t_goal('e4000000-0000-4000-8000-000000000005', 'f4000000-0000-4000-8000-000000000009') $$,
  'FC058', null, 'a plan that doesn''t exist is refused');
select throws_ok($$ update public.goals set plan_message_id = null $$, '42501', null,
  'a client cannot change the link');
select isnt(public.t_goal('e4000000-0000-4000-8000-000000000006', null), null, 'a goal without a plan is added as before');
reset role;

-- Deleting the conversation clears the link and keeps the goal.
delete from public.ai_conversations where id = 'c4000000-0000-4000-8000-00000000000a';
select is((select plan_message_id from public.goals where idempotency_key = 'e4000000-0000-4000-8000-000000000001'), null,
  'the conversation deleted: the goal stays, without its plan');

select set_config('request.jwt.claims', '{"sub": "b4000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.goals), 0, 'B cannot see A''s goals');
reset role;

select * from finish();
rollback;
