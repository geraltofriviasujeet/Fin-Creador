-- pgTAP tests for the tour and Get started checklist (migration 20261120120000): the two profile
-- times (database time only, own row only, only these columns), the upi_imports log (owner-only,
-- insert-only, saved_count > 0) and getting_started_status (own data, RLS, false when unknown).
-- The backfill of existing profiles can't be tested here (CI starts from an empty database);
-- new profiles starting with null is.
-- Run with `supabase test db` (CI). Everything is rolled back. Fictional users only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- Fictional users A (Asha) and B (Bala).
insert into auth.users (id, email) values
  ('a2000000-0000-4000-8000-00000000000a', 'asha-onboard@example.test'),
  ('b2000000-0000-4000-8000-00000000000b', 'bala-onboard@example.test');

create function pg_temp.status() returns record language sql as
  $$ select (s.has_account, s.has_expense, s.has_import, s.has_asked_roma) from public.getting_started_status() as s $$;
create function pg_temp.tour(p_id uuid) returns timestamptz language sql as
  $$ select p.tour_done_at from public.profiles as p where p.id = p_id $$;
create function pg_temp.dismissed(p_id uuid) returns timestamptz language sql as
  $$ select p.getting_started_dismissed_at from public.profiles as p where p.id = p_id $$;

-- ------------------------------------------------------------ privileges (1-7)
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'tour_done_at', 'UPDATE')
  and has_column_privilege('authenticated', 'public.profiles', 'getting_started_dismissed_at', 'UPDATE'),
  'signed-in users may update the two onboarding columns');
select ok(
  not has_column_privilege('anon', 'public.profiles', 'tour_done_at', 'UPDATE')
  and not has_column_privilege('anon', 'public.profiles', 'getting_started_dismissed_at', 'UPDATE'),
  'anon may not update them');
select ok(
  not has_function_privilege('authenticated', 'public.profiles_onboarding_times()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.profiles_onboarding_times()', 'EXECUTE'),
  'the trigger function is not callable through the API');
select ok(
  has_function_privilege('authenticated', 'public.getting_started_status()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.getting_started_status()', 'EXECUTE'),
  'getting_started_status: signed-in users only');
select is(
  (select pg_get_function_identity_arguments('public.getting_started_status'::regproc)), '',
  'getting_started_status takes no user id');
select ok(
  has_table_privilege('authenticated', 'public.upi_imports', 'SELECT')
  and has_column_privilege('authenticated', 'public.upi_imports', 'saved_count', 'INSERT')
  and not has_column_privilege('authenticated', 'public.upi_imports', 'user_id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.upi_imports', 'created_at', 'INSERT')
  and not has_table_privilege('authenticated', 'public.upi_imports', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.upi_imports', 'DELETE'),
  'upi_imports: read, and insert of the count only; no update or delete');
select ok(
  not exists (select 1 from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
               where has_table_privilege('anon', 'public.upi_imports', p.priv)),
  'anon has no access to upi_imports');

-- ------------------------------------------------------------ profile times (8-16)
select ok(pg_temp.tour('a2000000-0000-4000-8000-00000000000a') is null
          and pg_temp.dismissed('a2000000-0000-4000-8000-00000000000a') is null,
  'a new profile starts with the tour not done and the checklist not dismissed');

select set_config('request.jwt.claims', '{"sub": "a2000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

update public.profiles set tour_done_at = '2001-02-03 04:05:06+00' where id = 'a2000000-0000-4000-8000-00000000000a';
select is(pg_temp.tour('a2000000-0000-4000-8000-00000000000a'), now(), 'any tour time a client sends becomes the database''s now()');

update public.profiles set getting_started_dismissed_at = '2099-01-01 00:00:00+00' where id = 'a2000000-0000-4000-8000-00000000000a';
select is(pg_temp.dismissed('a2000000-0000-4000-8000-00000000000a'), now(), 'any dismiss time a client sends becomes the database''s now()');

update public.profiles set tour_done_at = null where id = 'a2000000-0000-4000-8000-00000000000a';
select is(pg_temp.tour('a2000000-0000-4000-8000-00000000000a'), null, 'null clears the tour (Replay the tour)');

update public.profiles set tour_done_at = now() where id = 'b2000000-0000-4000-8000-00000000000b';
reset role;
select is(pg_temp.tour('b2000000-0000-4000-8000-00000000000b'), null, 'A cannot set B''s tour time');

select set_config('request.jwt.claims', '{"sub": "a2000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ update public.profiles set created_at = now() where id = 'a2000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'other profile columns stay closed');

-- A fixed earlier time (set as the owner with the trigger off), to tell "kept" from "now()".
reset role;
alter table public.profiles disable trigger profiles_onboarding_times;
update public.profiles set tour_done_at = '2020-05-05 10:00:00+00' where id = 'a2000000-0000-4000-8000-00000000000a';
alter table public.profiles enable trigger profiles_onboarding_times;

select set_config('request.jwt.claims', '{"sub": "a2000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
update public.profiles set display_name = 'Asha R' where id = 'a2000000-0000-4000-8000-00000000000a';
select is(pg_temp.tour('a2000000-0000-4000-8000-00000000000a'), '2020-05-05 10:00:00+00'::timestamptz, 'another column''s update leaves the tour time');
update public.profiles set tour_done_at = '2020-05-05 10:00:00+00' where id = 'a2000000-0000-4000-8000-00000000000a';
select is(pg_temp.tour('a2000000-0000-4000-8000-00000000000a'), '2020-05-05 10:00:00+00'::timestamptz, 'repeating the same value leaves the tour time');
update public.profiles set tour_done_at = '2020-05-06 10:00:00+00' where id = 'a2000000-0000-4000-8000-00000000000a';
select is(pg_temp.tour('a2000000-0000-4000-8000-00000000000a'), now(), 'a different value becomes now()');

-- ------------------------------------------------------------ upi_imports (17-24)
select lives_ok($$ insert into public.upi_imports (saved_count) values (3) $$, 'A logs an import of their own');
select is((select u.user_id from public.upi_imports as u), 'a2000000-0000-4000-8000-00000000000a'::uuid, 'the row is A''s (user_id from auth.uid())');
select throws_ok(
  $$ insert into public.upi_imports (user_id, saved_count) values ('b2000000-0000-4000-8000-00000000000b', 1) $$,
  '42501', null, 'A cannot log an import for B');
select throws_ok($$ insert into public.upi_imports (saved_count) values (0) $$, null, null, 'saved_count 0 is refused');
select throws_ok($$ insert into public.upi_imports (saved_count, created_at) values (1, '2000-01-01') $$,
  '42501', null, 'a client cannot set created_at');
select throws_ok($$ update public.upi_imports set saved_count = 9 $$, '42501', null, 'no update');
select throws_ok($$ delete from public.upi_imports $$, '42501', null, 'no delete');

select set_config('request.jwt.claims', '{"sub": "b2000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
select is((select count(*) from public.upi_imports), 0::bigint, 'B cannot see A''s imports');

-- ------------------------------------------------------------ getting_started_status (25-33)
select set_config('request.jwt.claims', '{"sub": "a2000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
reset role;
delete from public.upi_imports;   -- start A's checklist from nothing
set local role authenticated;
select is(pg_temp.status()::text, '(f,f,f,f)', 'nothing yet: all four false');

reset role;
insert into public.accounts (id, user_id, kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('a2000000-0000-4000-8000-0000000000c1', 'a2000000-0000-4000-8000-00000000000a', 'bank', 'savings', 'Bank', 'INR', 100000, current_date - 10);
set local role authenticated;
select is(pg_temp.status()::text, '(t,f,f,f)', 'a bank account ticks the first item');

reset role;
insert into public.transactions (user_id, id, type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key)
select 'a2000000-0000-4000-8000-00000000000a', 'a2000000-0000-4000-8000-0000000000e1', 'expense', 50000, 'INR',
       'a2000000-0000-4000-8000-0000000000c1', c.id, current_date - 1, gen_random_uuid()
  from public.categories as c
 where c.user_id = 'a2000000-0000-4000-8000-00000000000a' and c.kind = 'expense' and c.archived_at is null
 order by c.name limit 1;
-- Inserts always start live; deleting (voiding) is an update.
update public.transactions set voided_at = now(), void_reason = 'Test' where id = 'a2000000-0000-4000-8000-0000000000e1';
set local role authenticated;
select is(pg_temp.status()::text, '(t,f,f,f)', 'a deleted expense doesn''t count');

reset role;
insert into public.transactions (user_id, id, type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key)
select 'a2000000-0000-4000-8000-00000000000a', 'a2000000-0000-4000-8000-0000000000e2', 'expense', 50000, 'INR',
       'a2000000-0000-4000-8000-0000000000c1', c.id, current_date - 1, gen_random_uuid()
  from public.categories as c
 where c.user_id = 'a2000000-0000-4000-8000-00000000000a' and c.kind = 'expense' and c.archived_at is null
 order by c.name limit 1;
set local role authenticated;
select is(pg_temp.status()::text, '(t,t,f,f)', 'a live expense ticks the second item');

insert into public.upi_imports (saved_count) values (2);
select is(pg_temp.status()::text, '(t,t,t,f)', 'a logged UPI import ticks the third item');

reset role;
insert into public.ai_conversations (id, user_id, title) values
  ('a2000000-0000-4000-8000-0000000000d1', 'a2000000-0000-4000-8000-00000000000a', 'Where did my money go?');
insert into public.ai_messages (conversation_id, user_id, seq, question, answer, as_of) values
  ('a2000000-0000-4000-8000-0000000000d1', 'a2000000-0000-4000-8000-00000000000a', 1, 'Where did my money go?', 'Mostly food.', current_date);
set local role authenticated;
select is(pg_temp.status()::text, '(t,t,t,t)', 'a Roma question ticks the fourth item');

select set_config('request.jwt.claims', '{"sub": "b2000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
select is(pg_temp.status()::text, '(f,f,f,f)', 'B sees none of A''s data');

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select is(pg_temp.status()::text, '(f,f,f,f)', 'no signed-in user: all false, never null');

reset role;
set local role anon;
select throws_ok($$ select * from public.getting_started_status() $$, '42501', null, 'anon cannot call getting_started_status');

select * from finish();
rollback;
