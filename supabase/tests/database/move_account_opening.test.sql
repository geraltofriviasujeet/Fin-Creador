-- pgTAP tests for move_account_opening (migration 20261116180000): payments dated before an
-- account's opening added and the opening moved back, with the balance today and on every date
-- on or after the old opening date identical before and after; the trace; the request key; and
-- every refusal, including the self-check against account_balances_at. Fictional users and data only. Run with `supabase test db` (CI). Everything is
-- rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(39);

-- A (Asia/Kolkata) and B.
insert into auth.users (id, email) values
  ('9f000000-0000-4000-8000-00000000000a', 'move-asha@example.test'),
  ('9f000000-0000-4000-8000-00000000000b', 'move-bala@example.test');
update public.profiles set time_zone = 'Asia/Kolkata', currency = 'INR'
 where id in ('9f000000-0000-4000-8000-00000000000a', '9f000000-0000-4000-8000-00000000000b');

create function pg_temp.today() returns date language sql stable as $$ select public.user_local_today('9f000000-0000-4000-8000-00000000000a') $$;
create function pg_temp.as_user(p_user uuid) returns text language sql
  as $$ select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true) $$;

-- All opened 20 days ago. a1 bank 10,000.00 · a2 cash 100.00 · a3 bank, archived · b1 B's bank.
insert into public.accounts (id, user_id, kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('9fa00000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-00000000000a', 'bank', 'savings', 'Bank', 'INR', 1000000, pg_temp.today() - 20),
  ('9fa00000-0000-4000-8000-000000000002', '9f000000-0000-4000-8000-00000000000a', 'cash', null, 'Cash in hand', 'INR', 10000, pg_temp.today() - 20),
  ('9fa00000-0000-4000-8000-000000000003', '9f000000-0000-4000-8000-00000000000a', 'bank', 'savings', 'Old bank', 'INR', 0, pg_temp.today() - 20),
  ('9fa00000-0000-4000-8000-000000000004', '9f000000-0000-4000-8000-00000000000a', 'bank', 'savings', 'Drift bank', 'INR', 500000, pg_temp.today() - 20),
  ('9fa00000-0000-4000-8000-0000000000b1', '9f000000-0000-4000-8000-00000000000b', 'bank', 'savings', 'B bank', 'INR', 0, pg_temp.today() - 20);
update public.accounts set archived_at = now() where id = '9fa00000-0000-4000-8000-000000000003';

create function pg_temp.cat(p_kind text) returns uuid language sql stable as $$
  select c.id from public.categories as c
  where c.user_id = '9f000000-0000-4000-8000-00000000000a' and c.kind = p_kind and c.archived_at is null order by c.name limit 1 $$;

-- Entries already on a1, inserted as the owner: two after the opening, and one 25 days ago that
-- the opening date leaves out (the move must count it, or today's balance would change).
insert into public.transactions (user_id, type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key) values
  ('9f000000-0000-4000-8000-00000000000a', 'income', 500000, 'INR', '9fa00000-0000-4000-8000-000000000001', pg_temp.cat('income'), pg_temp.today() - 10, gen_random_uuid()),
  ('9f000000-0000-4000-8000-00000000000a', 'expense', 200000, 'INR', '9fa00000-0000-4000-8000-000000000001', pg_temp.cat('expense'), pg_temp.today() - 5, gen_random_uuid()),
  ('9f000000-0000-4000-8000-00000000000a', 'expense', 70000, 'INR', '9fa00000-0000-4000-8000-000000000001', pg_temp.cat('expense'), pg_temp.today() - 25, gen_random_uuid());

-- One entry for p_entries.
create function pg_temp.entry(p_key text, p_type text, p_amount bigint, p_days_ago integer, p_account text, p_counter text default null)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'key', ('9fe00000-0000-4000-8000-' || lpad(p_key, 12, '0'))::uuid,
    'type', p_type, 'amount_minor', p_amount, 'occurred_on', pg_temp.today() - p_days_ago,
    'account_id', ('9fa00000-0000-4000-8000-' || lpad(p_account, 12, '0'))::uuid,
    'counter_account_id', case when p_counter is null then null else ('9fa00000-0000-4000-8000-' || lpad(p_counter, 12, '0'))::uuid end,
    'category_id', case p_type when 'expense' then pg_temp.cat('expense') when 'income' then pg_temp.cat('income') end,
    'note', 'Test payee')
$$;

-- a1's balances from the old opening date to today, before the move (as A).
create table public.t_before (as_of date, balance_minor bigint);
grant select, insert on table public.t_before to authenticated;
create table public.t_move (name text primary key, id uuid);
grant select, insert on table public.t_move to authenticated;
create function pg_temp.a1_balances() returns table (as_of date, balance_minor bigint) language sql stable as $$
  select b.as_of, b.balance_minor
  from public.account_balances_at(array(select pg_temp.today() - g from generate_series(0, 20) as g)) as b
  where b.account_id = '9fa00000-0000-4000-8000-000000000001' $$;

-- ------------------------------------------------------------ the function (1-6)
select has_function('public', 'move_account_opening', array['uuid', 'uuid', 'jsonb'], 'move_account_opening(uuid, uuid, jsonb) exists');
select is((select p.prosecdef from pg_catalog.pg_proc as p where p.oid = 'public.account_balance_check(uuid, date)'::regprocedure), false, 'account_balance_check is security invoker');
select is((select p.prosecdef from pg_catalog.pg_proc as p where p.oid = 'public.move_account_opening(uuid, uuid, jsonb)'::regprocedure), false, 'security invoker');
select is((select p.proconfig from pg_catalog.pg_proc as p where p.oid = 'public.move_account_opening(uuid, uuid, jsonb)'::regprocedure), array['search_path=""'], 'search_path is empty');
select ok(not has_function_privilege('anon', 'public.move_account_opening(uuid, uuid, jsonb)', 'EXECUTE'), 'anon cannot execute it');
select ok(has_function_privilege('authenticated', 'public.move_account_opening(uuid, uuid, jsonb)', 'EXECUTE'), 'signed-in users can execute it');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.account_opening_moves'::regclass), true, 'account_opening_moves has RLS');

-- ------------------------------------------------------------ a bank account moves (7-16)
select pg_temp.as_user('9f000000-0000-4000-8000-00000000000a');
set local role authenticated;
insert into public.t_before select * from pg_temp.a1_balances();

-- 300.00 out 30 days ago, 1,000.00 in 28 days ago, 150.00 out 22 days ago. With the 700.00 left
-- out before, the net from 30 days ago to the old opening is 1,000 - 300 - 150 - 700 = -150.00.
insert into public.t_move
select 'a1', (public.move_account_opening(
  '9fd00000-0000-4000-8000-000000000001', '9fa00000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.entry('1', 'expense', 30000, 30, '1'), pg_temp.entry('2', 'income', 100000, 28, '1'), pg_temp.entry('3', 'expense', 15000, 22, '1'))
)).id;

select is((select new_opening_date from public.account_opening_moves where id = (select id from public.t_move where name = 'a1')), pg_temp.today() - 30, 'the new opening date is the earliest payment');
select is((select old_opening_date from public.account_opening_moves where id = (select id from public.t_move where name = 'a1')), pg_temp.today() - 20, 'the trace keeps the old date');
select is((select (old_opening_minor, new_opening_minor) from public.account_opening_moves where id = (select id from public.t_move where name = 'a1')),
  (1000000::bigint, 1015000::bigint), 'old and new opening amounts: 10,000.00 less the net of -150.00');
select is((select (entries_added, entries_counted) from public.account_opening_moves where id = (select id from public.t_move where name = 'a1')),
  (3, 4), '3 entries added; 4 counted (with the one the old date left out)');
select is((select (opening_balance_date, opening_balance_minor) from public.accounts where id = '9fa00000-0000-4000-8000-000000000001'),
  (pg_temp.today() - 30, 1015000::bigint), 'the account has the new opening');
select set_eq(
  $$ select * from pg_temp.a1_balances() $$,
  $$ select * from public.t_before $$,
  'the balance today and on every date from the old opening date is identical'
);
select is((select balance_minor from public.account_balances_at(array[pg_temp.today() - 30]) where account_id = '9fa00000-0000-4000-8000-000000000001'),
  985000::bigint, 'an earlier day now has a balance: the opening less 300.00');
select is((select balance_minor from public.account_balances_at(array[pg_temp.today() - 31]) where account_id = '9fa00000-0000-4000-8000-000000000001'),
  null, '... and the day before the new opening has none');

-- The request key: a retry returns the same move and adds nothing.
select is((public.move_account_opening(
  '9fd00000-0000-4000-8000-000000000001', '9fa00000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.entry('1', 'expense', 30000, 30, '1'))
)).id, (select id from public.t_move where name = 'a1'), 'a retry with the same request key returns the same move');
select is((select count(*)::int from public.transactions where account_id = '9fa00000-0000-4000-8000-000000000001'), 6, '... and adds no entry');

-- ------------------------------------------------------------ refusals (17-27)
select throws_ok(
  $$ select public.move_account_opening('9fd00000-0000-4000-8000-000000000001', '9fa00000-0000-4000-8000-000000000002', jsonb_build_array(pg_temp.entry('9', 'expense', 100, 25, '2'))) $$,
  'FC007', null, 'the same request key for another account is refused'
);
select throws_ok(
  $$ select public.move_account_opening(gen_random_uuid(), '9fa00000-0000-4000-8000-000000000002', jsonb_build_array(pg_temp.entry('10', 'expense', 100, 20, '2'))) $$,
  '22023', null, 'an entry on or after the opening date is refused'
);
select throws_ok(
  $$ select public.move_account_opening(gen_random_uuid(), '9fa00000-0000-4000-8000-000000000002', jsonb_build_array(pg_temp.entry('11', 'expense', 100, 25, '1'))) $$,
  '22023', null, 'an entry on another account is refused'
);
select throws_ok(
  $$ select public.move_account_opening(gen_random_uuid(), '9fa00000-0000-4000-8000-000000000002', '[]'::jsonb) $$,
  '22023', null, 'no entries is refused'
);
select throws_ok(
  $$ select public.move_account_opening(gen_random_uuid(), '9fa00000-0000-4000-8000-000000000002', jsonb_build_array(pg_temp.entry('12', 'income', 50000, 25, '2'))) $$,
  'FC064', null, 'a cash account that would open below zero is refused'
);
select is((select (opening_balance_date, opening_balance_minor) from public.accounts where id = '9fa00000-0000-4000-8000-000000000002'),
  (pg_temp.today() - 20, 10000::bigint), '... and nothing changed: the opening');
select is((select count(*)::int from public.transactions where idempotency_key = '9fe00000-0000-4000-8000-000000000012'), 0, '... nor the entry');
select throws_ok(
  $$ select public.move_account_opening(gen_random_uuid(), '9fa00000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.entry('13', 'transfer', 1000, 40, '1', '2'))) $$,
  'FC065', null, 'a transfer whose other account opens after its date is refused'
);
select throws_ok(
  $$ select public.move_account_opening(gen_random_uuid(), '9fa00000-0000-4000-8000-000000000003', jsonb_build_array(pg_temp.entry('14', 'expense', 100, 25, '3'))) $$,
  'FC001', null, 'an archived account is refused'
);
select public.create_card('9fc00000-0000-4000-8000-000000000001', 'Example Card', 10000000, 20, 8, 0, 'Card');
select throws_ok(
  format($$ select public.move_account_opening(gen_random_uuid(), %1$L, jsonb_build_array(jsonb_build_object(
      'key', '9fe00000-0000-4000-8000-000000000015', 'type', 'expense', 'amount_minor', 100, 'occurred_on', '2000-01-01', 'account_id', %1$L))) $$,
    (select id from public.accounts where kind = 'card')),
  'FC063', null, 'a card''s opening date does not move'
);
select throws_ok(
  $$ select public.move_account_opening(gen_random_uuid(), '9fa00000-0000-4000-8000-0000000000b1', jsonb_build_array(pg_temp.entry('16', 'expense', 100, 25, 'b1'))) $$,
  'FC010', null, 'another person''s account is not found'
);

-- ------------------------------------------------------------ cash within zero; the date lock (28-30)
select isnt((public.move_account_opening(gen_random_uuid(), '9fa00000-0000-4000-8000-000000000002', jsonb_build_array(pg_temp.entry('17', 'expense', 2000, 22, '2')))).id,
  null, 'a cash account moves when it stays at or above zero');
select throws_ok(
  $$ update public.accounts set opening_balance_date = opening_balance_date - 1 where id = '9fa00000-0000-4000-8000-000000000001' $$,
  'FC011', null, 'outside the function the opening date stays locked'
);
select throws_ok(
  $$ update public.accounts set opening_balance_date = public.user_local_today('9f000000-0000-4000-8000-00000000000a') where id = '9fa00000-0000-4000-8000-000000000002' $$,
  'FC011', null, 'a cash account with entries can''t move its date to today by a plain update either'
);

-- ------------------------------------------------------------ the self-check (31-34)
-- account_balances_at with a drifted sign rule (every entry an outflow), rolled back with the test.
reset role;
create or replace function public.account_balances_at(p_dates date[])
returns table (as_of date, account_id uuid, balance_minor bigint)
language sql stable security invoker set search_path = ''
as $$
  select d.day, a.id, (a.opening_balance_minor - coalesce((
    select sum(t.amount_minor) from public.transactions as t
    where (t.account_id = a.id or t.counter_account_id = a.id) and t.voided_at is null
      and t.occurred_on >= a.opening_balance_date and t.occurred_on <= d.day), 0))::bigint
  from pg_catalog.unnest(p_dates) as d(day)
  join public.accounts as a on a.opening_balance_date <= d.day
$$;
set local role authenticated;
select throws_ok(
  $$ select public.move_account_opening(gen_random_uuid(), '9fa00000-0000-4000-8000-000000000004', jsonb_build_array(pg_temp.entry('18', 'income', 10000, 25, '4'))) $$,
  'FC067', null, 'when account_balances_at and the move disagree, the move is refused'
);
select is((select (opening_balance_date, opening_balance_minor) from public.accounts where id = '9fa00000-0000-4000-8000-000000000004'),
  (pg_temp.today() - 20, 500000::bigint), '... the opening is unchanged');
select is((select count(*)::int from public.transactions where idempotency_key = '9fe00000-0000-4000-8000-000000000018'), 0, '... and the entry is not saved');

-- ------------------------------------------------------------ the trace (35-39)
select throws_ok(
  $$ insert into public.account_opening_moves (account_id, request_key, old_opening_date, new_opening_date, old_opening_minor, new_opening_minor, entries_added, entries_counted)
     values ('9fa00000-0000-4000-8000-000000000001', gen_random_uuid(), current_date, current_date - 1, 0, 0, 0, 0) $$,
  'FC066', null, 'a trace row can''t be written directly'
);
select throws_ok(
  $$ update public.account_opening_moves set entries_added = 0 $$,
  '42501', null, 'a trace row can''t be changed'
);
select throws_ok(
  $$ delete from public.account_opening_moves $$,
  '42501', null, 'a trace row can''t be deleted'
);
select is((select count(*)::int from public.account_opening_moves), 2, 'A sees A''s two moves');
select pg_temp.as_user('9f000000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.account_opening_moves), 0, 'B sees none of them');
reset role;

select * from finish();
rollback;
