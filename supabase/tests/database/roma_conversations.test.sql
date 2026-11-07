-- pgTAP tests for Roma's conversation memory (migration 20261106120000).
-- Run with `supabase test db` (CI). Everything is rolled back. Fictional users only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

-- Users A and B, fictional, both with Roma on.
insert into auth.users (id, email) values
  ('a2000000-0000-4000-8000-00000000000a', 'meera@example.test'),
  ('b2000000-0000-4000-8000-00000000000b', 'kabir@example.test');
update public.profiles set roma_enabled = true
 where id in ('a2000000-0000-4000-8000-00000000000a', 'b2000000-0000-4000-8000-00000000000b');

-- Ledger rows as the API route leaves them: settled after a provider call (r1-r4, rb for B),
-- one still reserved (ropen).
insert into public.roma_usage (id, user_id, provider, model, status, reserved_usd, input_tokens, output_tokens, cost_usd, ended_at)
values
  ('00000000-0000-4000-8000-0000000000a1', 'a2000000-0000-4000-8000-00000000000a', 'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now()),
  ('00000000-0000-4000-8000-0000000000a2', 'a2000000-0000-4000-8000-00000000000a', 'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now()),
  ('00000000-0000-4000-8000-0000000000a3', 'a2000000-0000-4000-8000-00000000000a', 'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now()),
  ('00000000-0000-4000-8000-0000000000a4', 'a2000000-0000-4000-8000-00000000000a', 'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now()),
  ('00000000-0000-4000-8000-0000000000b1', 'b2000000-0000-4000-8000-00000000000b', 'anthropic', 'claude-haiku-5-5', 'settled', 0.01, 900, 100, 0.0002, now());
insert into public.roma_usage (id, user_id, provider, model, reserved_usd)
values ('00000000-0000-4000-8000-0000000000ae', 'a2000000-0000-4000-8000-00000000000a', 'anthropic', 'claude-haiku-5-5', 0.01);

-- Test-only: record a turn as the caller, with today's date and sensible defaults.
create function public.t_turn(p_request uuid, p_conversation uuid, p_question text default 'What did I spend last month?')
returns table (conversation_id uuid, seq integer) language sql set search_path = ''
  as $$ select * from public.roma_record_turn(p_request, p_conversation, p_question, 'You spent a little.',
          public.user_local_today((select auth.uid())), array[daterange('2026-10-01', '2026-10-31', '[]')],
          array['spending_for_period'], false) $$;
grant execute on function public.t_turn(uuid, uuid, text) to authenticated;
create table public.t_conv (name text primary key, id uuid);
grant select, insert on table public.t_conv to authenticated;

-- ------------------------------------------------------------ privileges (1-5)
select ok(
  not exists (
    select 1 from unnest(array['public.ai_conversations', 'public.ai_messages']) as t(tbl),
                  unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
     where has_table_privilege('anon', t.tbl, p.priv)),
  'anon has no access to conversations or messages');
select ok(
  has_table_privilege('authenticated', 'public.ai_conversations', 'SELECT')
  and has_table_privilege('authenticated', 'public.ai_conversations', 'DELETE')
  and not has_table_privilege('authenticated', 'public.ai_conversations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.ai_conversations', 'UPDATE'),
  'signed-in users may read and delete conversations, not write them');
select ok(
  has_table_privilege('authenticated', 'public.ai_messages', 'SELECT')
  and not has_table_privilege('authenticated', 'public.ai_messages', 'INSERT')
  and not has_table_privilege('authenticated', 'public.ai_messages', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.ai_messages', 'DELETE'),
  'signed-in users may only read messages');
select ok(
  has_function_privilege('authenticated', 'public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb)', 'EXECUTE'),
  'roma_record_turn: signed-in users only');
select ok(
  not has_function_privilege('authenticated', 'public.roma_prune_conversations()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roma_prune_conversations()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.roma_prune_conversations()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.ai_messages_periods_bounded()', 'EXECUTE'),
  'retention and trigger functions are not callable through the API');

-- ------------------------------------------------------------ recording and idempotency (6-14)
select set_config('request.jwt.claims', '{"sub": "a2000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

insert into public.t_conv select 'first', t.conversation_id from public.t_turn('00000000-0000-4000-8000-0000000000a1', null,
  '  What did   I spend' || chr(10) || 'last month on groceries and eating out, and how does that compare with the month before?') as t;
select is((select count(*)::int from public.ai_conversations), 1, 'a first turn starts a conversation');
select is((select title from public.ai_conversations),
  'What did I spend last month on groceries and eating out, and how does that compa',
  '... titled with the first question, spaces folded, cut to 80 characters');
select is((select array[seq::text, question, as_of::text, tools::text, periods::text, sent_descriptions::text] from public.ai_messages),
  array['1', 'What did   I spend' || chr(10) || 'last month on groceries and eating out, and how does that compare with the month before?',
        public.user_local_today('a2000000-0000-4000-8000-00000000000a')::text, '{spending_for_period}',
        '{"[2026-10-01,2026-11-01)"}', 'false'],
  '... the turn keeps the question, as-of date, tools and periods');

select results_eq(
  $$ select t.conversation_id, t.seq from public.t_turn('00000000-0000-4000-8000-0000000000a1', null) as t $$,
  $$ select (select id from public.t_conv where name = 'first'), 1 $$,
  'the same request id again returns the turn already recorded');
select results_eq(
  $$ select t.conversation_id, t.seq from public.t_turn('00000000-0000-4000-8000-0000000000a1', (select id from public.t_conv where name = 'first'), 'Another question') as t $$,
  $$ select (select id from public.t_conv where name = 'first'), 1 $$,
  '... whatever else is sent with it');
select is((select count(*)::int from public.ai_messages), 1, '... and records nothing twice');
select is((select count(*)::int from public.ai_conversations), 1, '... and starts no second conversation');

select results_eq(
  $$ select t.seq from public.t_turn('00000000-0000-4000-8000-0000000000a2', (select id from public.t_conv where name = 'first'), 'And the month before?') as t $$,
  $$ values (2) $$,
  'a later question in the same conversation is turn 2');
select is((select turn_count from public.ai_conversations), 2, '... and the conversation counts 2 turns');

-- ------------------------------------------------------------ refusals (15-24)
select throws_ok($$ select * from public.t_turn('00000000-0000-4000-8000-0000000000ae', null) $$,
  '42501', null, 'a reservation not yet settled can''t record a turn');
select throws_ok($$ select * from public.t_turn('00000000-0000-4000-8000-0000000000b1', null) $$,
  '42501', null, 'another person''s request id can''t record a turn');
select throws_ok($$ select * from public.t_turn(gen_random_uuid(), null) $$,
  '42501', null, 'an unknown request id can''t record a turn');
select throws_ok(
  $$ select * from public.roma_record_turn('00000000-0000-4000-8000-0000000000a3', null, 'Q', 'A',
       public.user_local_today((select auth.uid())) + 1, '{}', '{}', false) $$,
  '22023', null, 'an as-of date after the person''s today is refused');
select throws_ok(
  $$ select * from public.roma_record_turn('00000000-0000-4000-8000-0000000000a3', null, '   ', 'A',
       public.user_local_today((select auth.uid())), '{}', '{}', false) $$,
  '22023', null, 'a blank question is refused');
select throws_ok(
  $$ select * from public.roma_record_turn('00000000-0000-4000-8000-0000000000a3', null, 'Q', 'A',
       public.user_local_today((select auth.uid())), array[daterange('2026-10-01', null)], '{}', false) $$,
  '22023', null, 'an open-ended period is refused');
select throws_ok(
  $$ select * from public.roma_record_turn('00000000-0000-4000-8000-0000000000a3', null, 'Q', 'A',
       public.user_local_today((select auth.uid())), '{}', array['Spending; drop'], false) $$,
  '23514', null, 'a tool name that isn''t a plain name is refused');
select throws_ok(
  $$ insert into public.ai_conversations (title) values ('Mine') $$,
  '42501', null, 'a client can''t create a conversation directly');
select throws_ok(
  format($$ insert into public.ai_messages (conversation_id, user_id, seq, question, answer, as_of)
            values (%L, auth.uid(), 3, 'Q', 'You spent ₹1.', current_date) $$, (select id from public.t_conv where name = 'first')),
  '42501', null, 'a client can''t write a turn directly');
select throws_ok(
  $$ update public.ai_messages set answer = 'You spent ₹1.' $$,
  '42501', null, 'a client can''t change a stored answer');
reset role;

-- ------------------------------------------------------------ full conversation, Roma off (25-27)
update public.ai_conversations set turn_count = 100;
set local role authenticated;
select throws_ok(
  $$ select * from public.t_turn('00000000-0000-4000-8000-0000000000a3', (select id from public.t_conv where name = 'first')) $$,
  '22023', null, 'a conversation with 100 turns takes no more');
reset role;
update public.ai_conversations set turn_count = 2;
update public.profiles set roma_enabled = false where id = 'a2000000-0000-4000-8000-00000000000a';
set local role authenticated;
select throws_ok($$ select * from public.t_turn('00000000-0000-4000-8000-0000000000a3', null) $$,
  '42501', null, 'no new turn is recorded while Roma is off');
select is((select count(*)::int from public.ai_messages), 2, 'turning Roma off keeps the history');
reset role;
update public.profiles set roma_enabled = true where id = 'a2000000-0000-4000-8000-00000000000a';

-- ------------------------------------------------------------ cross-user (28-32)
select set_config('request.jwt.claims', '{"sub": "b2000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.ai_conversations), 0, 'B sees none of A''s conversations');
select is((select count(*)::int from public.ai_messages), 0, 'B sees none of A''s turns');
select throws_ok(
  $$ select * from public.t_turn('00000000-0000-4000-8000-0000000000b1', (select id from public.t_conv where name = 'first')) $$,
  '42501', null, 'B can''t add a turn to A''s conversation');
delete from public.ai_conversations where id = (select id from public.t_conv where name = 'first');
reset role;
select is((select count(*)::int from public.ai_messages where user_id = 'a2000000-0000-4000-8000-00000000000a'), 2,
  'B''s delete of A''s conversation removes nothing');
set local role authenticated;
insert into public.t_conv select 'b', t.conversation_id from public.t_turn('00000000-0000-4000-8000-0000000000b1', null) as t;
select is((select count(*)::int from public.ai_conversations), 1, 'B starts a conversation of their own');
reset role;

-- ------------------------------------------------------------ deleting (33-36)
select set_config('request.jwt.claims', '{"sub": "a2000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
insert into public.t_conv select 'second', t.conversation_id from public.t_turn('00000000-0000-4000-8000-0000000000a3', null) as t;
select is((select count(*)::int from public.ai_conversations), 2, 'A has two conversations');
delete from public.ai_conversations where id = (select id from public.t_conv where name = 'second');
select is((select count(*)::int from public.ai_messages where conversation_id = (select id from public.t_conv where name = 'second')), 0,
  'deleting a conversation deletes its turns');
insert into public.t_conv select 'third', t.conversation_id from public.t_turn('00000000-0000-4000-8000-0000000000a4', null) as t;
delete from public.ai_conversations where user_id = auth.uid();
select is((select count(*)::int from public.ai_conversations), 0, 'A deletes all their conversations at once');
reset role;
select is((select count(*)::int from public.ai_messages where user_id = 'b2000000-0000-4000-8000-00000000000b'), 1,
  '... and B''s turn is untouched');

-- ------------------------------------------------------------ retention (37-39)
insert into public.ai_conversations (id, user_id, title, last_message_at) values
  ('c2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-00000000000a', 'Old', now() - interval '181 days'),
  ('c2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-00000000000a', 'Recent', now() - interval '179 days');
select is(public.roma_prune_conversations(), 1, 'retention deletes one conversation');
select is((select array_agg(title order by title) from public.ai_conversations where user_id = 'a2000000-0000-4000-8000-00000000000a'),
  array['Recent'], '... the one whose last turn is more than 180 days old');
select is((select count(*)::int from cron.job where jobname = 'roma-conversations-retention' and schedule = '30 20 * * *'), 1,
  'retention runs daily by pg_cron');

-- ------------------------------------------------------------ account deletion (40-41)
delete from auth.users where id = 'b2000000-0000-4000-8000-00000000000b';
select is((select count(*)::int from public.ai_conversations where user_id = 'b2000000-0000-4000-8000-00000000000b')
        + (select count(*)::int from public.ai_messages where user_id = 'b2000000-0000-4000-8000-00000000000b'), 0,
  'deleting an account deletes its conversations and turns');
select is((select user_id from public.roma_usage where id = '00000000-0000-4000-8000-0000000000b1'), null,
  '... while its ledger row stays, with no owner');

select * from finish();
rollback;
