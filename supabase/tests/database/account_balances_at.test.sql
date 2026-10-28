-- pgTAP tests for account_balances_at (Sprint 8c): balances as of past local dates for the
-- Reports net worth trend. Same posting rule as the account_balances view; voided entries never
-- count; an account counts from its opening-balance date until its archive date (a local date
-- in the profile time zone); own rows only; signed-in users only; input limits.
-- Run with `supabase test db` (CI). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

-- Fictional users: A (Asha, Asia/Kolkata) and B (Bala).
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'asha-8c@example.test', '{"display_name": "Asha"}'),
  ('22222222-2222-4222-8222-222222222222', 'bala-8c@example.test', '{"display_name": "Bala"}');
update public.profiles set time_zone = 'Asia/Kolkata', currency = 'INR' where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');

-- Dates: A's today, and d = the last day of the previous month (a month-end in the past).
create function pg_temp.today() returns date language sql stable as $$ select public.user_local_today('11111111-1111-4111-8111-111111111111') $$;
create function pg_temp.d() returns date language sql stable as $$ select (pg_catalog.date_trunc('month', pg_temp.today()::timestamp) - interval '1 day')::date $$;
create function pg_temp.bal(p_day date, p_account uuid) returns bigint language sql stable as $$
  select b.balance_minor from public.account_balances_at(array[p_day]) as b where b.account_id = p_account $$;

-- Money accounts (as the owner, fixed ids), opened 100 days ago.
--   a1 bank 1,000.00 · a2 cash 50.00 · a3 bank archived 23:30 IST on d · a4 bank archived 20:00 UTC on d (d + 1 in India) · b1 B's bank
insert into public.accounts (id, user_id, kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('a8c00000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'bank', 'savings', 'Bank', 'INR', 100000, pg_temp.today() - 100),
  ('a8c00000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'cash', null, 'Cash in hand', 'INR', 5000, pg_temp.today() - 100),
  ('a8c00000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'bank', 'savings', 'Late IST', 'INR', 0, pg_temp.today() - 100),
  ('a8c00000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'bank', 'savings', 'Late UTC', 'INR', 0, pg_temp.today() - 100),
  ('b8c00000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'bank', 'savings', 'B bank', 'INR', 77700, pg_temp.today() - 100);

-- As A: a card (6,000 owed when added), money borrowed (5,000, not received into an account),
-- a personal loan (1,200), and entries.
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;
select public.create_card('c8c00000-0000-4000-8000-000000000001', 'HDFC Bank', 10000000, 20, 8, 600000, 'Travel');
select public.create_borrowing('c8c00000-0000-4000-8000-000000000002', 'Ravi', 500000, 'friends');
select public.create_loan('c8c00000-0000-4000-8000-000000000003', 'personal', 'Axis Bank', 120000, 120000, 0, 'fixed', 6, 'ongoing', 120000, 6,
  pg_catalog.date_trunc('month', pg_temp.today()::timestamp)::date, 20000, 20000);

create function pg_temp.expense_category() returns uuid language sql stable as $$
  select c.id from public.categories as c where c.kind = 'expense' and c.archived_at is null order by c.name limit 1 $$;
create function pg_temp.income_category() returns uuid language sql stable as $$
  select c.id from public.categories as c where c.kind = 'income' and c.archived_at is null order by c.name limit 1 $$;
create function pg_temp.card_account() returns uuid language sql stable as $$ select a.id from public.accounts as a where a.kind = 'card' $$;
create function pg_temp.borrowing_account() returns uuid language sql stable as $$ select a.id from public.accounts as a where a.kind = 'borrowing' $$;
create function pg_temp.loan_account() returns uuid language sql stable as $$ select a.id from public.accounts as a where a.kind = 'loan' $$;

insert into public.transactions (id, type, amount_minor, currency, account_id, counter_account_id, category_id, occurred_on, idempotency_key) values
  ('e8c00000-0000-4000-8000-000000000001', 'income',   20000, 'INR', 'a8c00000-0000-4000-8000-000000000001', null, pg_temp.income_category(),  pg_temp.today() - 50, gen_random_uuid()),
  ('e8c00000-0000-4000-8000-000000000002', 'expense',   3000, 'INR', 'a8c00000-0000-4000-8000-000000000001', null, pg_temp.expense_category(), pg_temp.today() - 40, gen_random_uuid()),
  ('e8c00000-0000-4000-8000-000000000003', 'expense',   1000, 'INR', 'a8c00000-0000-4000-8000-000000000001', null, pg_temp.expense_category(), pg_temp.today() - 120, gen_random_uuid()),
  ('e8c00000-0000-4000-8000-000000000004', 'transfer',  2500, 'INR', 'a8c00000-0000-4000-8000-000000000001', 'a8c00000-0000-4000-8000-000000000002', null, pg_temp.today() - 30, gen_random_uuid()),
  ('e8c00000-0000-4000-8000-000000000005', 'expense',    700, 'INR', 'a8c00000-0000-4000-8000-000000000001', null, pg_temp.expense_category(), pg_temp.today() - 20, gen_random_uuid()),
  ('e8c00000-0000-4000-8000-000000000006', 'expense',   4000, 'INR', pg_temp.card_account(), null, pg_temp.expense_category(), pg_temp.today(), gen_random_uuid()),
  ('e8c00000-0000-4000-8000-000000000007', 'income',    1000, 'INR', 'a8c00000-0000-4000-8000-000000000003', null, pg_temp.income_category(),  pg_temp.today() - 60, gen_random_uuid()),
  ('e8c00000-0000-4000-8000-000000000008', 'income',    1000, 'INR', 'a8c00000-0000-4000-8000-000000000004', null, pg_temp.income_category(),  pg_temp.today() - 60, gen_random_uuid());

select public.void_transaction('e8c00000-0000-4000-8000-000000000005', gen_random_uuid());

-- As the owner, with row triggers off (they stamp now()): archive a3 / a4 at exact instants.
reset role;
set local session_replication_role = replica;
update public.accounts set archived_at = (pg_temp.d() + time '23:30') at time zone 'Asia/Kolkata' where id = 'a8c00000-0000-4000-8000-000000000003';
update public.accounts set archived_at = (pg_temp.d() + time '20:00') at time zone 'UTC' where id = 'a8c00000-0000-4000-8000-000000000004';
set local session_replication_role = origin;

-- ------------------------------------------------------------ the function (1-4)
select has_function('public', 'account_balances_at', array['date[]'], 'account_balances_at(date[]) exists');
select is((select p.prosecdef from pg_catalog.pg_proc as p where p.oid = 'public.account_balances_at(date[])'::regprocedure), false, 'security invoker');
select ok(not has_function_privilege('anon', 'public.account_balances_at(date[])', 'EXECUTE'), 'anon cannot execute it');
select ok(has_function_privilege('authenticated', 'public.account_balances_at(date[])', 'EXECUTE'), 'signed-in users can execute it');

-- ------------------------------------------------------------ as A (5-21)
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

select set_eq(
  $$ select b.account_id, b.balance_minor from public.account_balances_at(array[pg_temp.today()]) as b $$,
  $$ select a.id, a.opening_balance_minor + v.inflow_minor - v.outflow_minor
     from public.accounts as a join public.account_balances as v on v.account_id = a.id where a.archived_at is null $$,
  'as of today: the same balance as the account_balances view for every active account');
select is((select count(distinct a.kind)::int from public.account_balances_at(array[pg_temp.today()]) as b join public.accounts as a on a.id = b.account_id),
  5, 'every kind is returned: bank, cash, card, borrowing, loan');
select is(pg_temp.bal(pg_temp.today(), 'a8c00000-0000-4000-8000-000000000001'), 114500::bigint,
  'bank today: opening + income − expense − transfer out; the voided entry and the one before opening never count');
select is(pg_temp.bal(pg_temp.today() - 45, 'a8c00000-0000-4000-8000-000000000001'), 120000::bigint, 'bank 45 days ago: entries after that day do not count');
select is(pg_temp.bal(pg_temp.today() - 25, 'a8c00000-0000-4000-8000-000000000001'), 114500::bigint, 'bank 25 days ago: the voided entry (20 days ago) never counts');
select is(pg_temp.bal(pg_temp.today(), 'a8c00000-0000-4000-8000-000000000002'), 7500::bigint, 'cash today: opening + transfer in');
select results_eq(
  $$ select pg_temp.bal(pg_temp.today(), pg_temp.card_account()), pg_temp.bal(pg_temp.today(), pg_temp.borrowing_account()), pg_temp.bal(pg_temp.today(), pg_temp.loan_account()) $$,
  $$ values (-604000::bigint, -500000::bigint, -120000::bigint) $$,
  'liability accounts are negative: card owed + purchase, money borrowed, loan outstanding');
select is(pg_temp.bal(pg_temp.today() - 101, 'a8c00000-0000-4000-8000-000000000001'), null, 'an account is not listed before its opening-balance date');
select is(pg_temp.bal(pg_temp.today() - 1, pg_temp.card_account()), null, 'a card added today is not listed yesterday');
select is(pg_temp.bal(pg_temp.d(), 'a8c00000-0000-4000-8000-000000000003'), null, 'archived at 23:30 IST on the last day of the month: left out that day');
select is(pg_temp.bal(pg_temp.d() - 1, 'a8c00000-0000-4000-8000-000000000003'), 1000::bigint, '... and counted the day before');
select is(pg_temp.bal(pg_temp.d(), 'a8c00000-0000-4000-8000-000000000004'), 1000::bigint,
  'archived at 20:00 UTC on the last day (the next day in India): still counted on that month-end');
select is((select count(*)::int from public.account_balances_at(array[pg_temp.today(), pg_temp.today(), pg_temp.today() - 45])),
  (select count(*)::int from public.account_balances_at(array[pg_temp.today(), pg_temp.today() - 45])), 'duplicate dates are merged');
select lives_ok($$ select * from public.account_balances_at(array[pg_temp.today() + 1]) $$, 'tomorrow is accepted (time zones around midnight)');
select throws_ok($$ select * from public.account_balances_at(array[pg_temp.today() + 2]) $$, '22023', null, 'a future date is refused');
select throws_ok($$ select * from public.account_balances_at(array[date '1899-12-31']) $$, '22023', null, 'a date before 1900 is refused');
select throws_ok($$ select * from public.account_balances_at(array[]::date[]) $$, '22023', null, 'an empty array is refused');
select throws_ok($$ select * from public.account_balances_at(array[pg_temp.today(), null]) $$, '22023', null, 'a null date is refused');
select throws_ok($$ select * from public.account_balances_at(null) $$, '22023', null, 'a null array is refused');
select throws_ok($$ select * from public.account_balances_at((select array_agg(pg_temp.today() - g) from generate_series(1, 121) as g)) $$,
  '22023', null, '121 dates are refused');

-- ------------------------------------------------------------ as B (22-23)
reset role;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
set local role authenticated;
select results_eq($$ select b.account_id, b.balance_minor from public.account_balances_at(array[pg_temp.today()]) as b $$,
  $$ values ('b8c00000-0000-4000-8000-000000000001'::uuid, 77700::bigint) $$, 'B sees only their own account');
select is((select count(*)::int from public.account_balances_at(array[pg_temp.today(), pg_temp.d()]) as b where b.account_id::text like 'a8c%'), 0,
  'none of A''s accounts ever appear for B');

-- ------------------------------------------------------------ signed out (24-25)
reset role;
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$ select * from public.account_balances_at(array[current_date]) $$, '42501', null, 'signed in without a user: refused');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select * from public.account_balances_at(array[current_date]) $$, '42501', null, 'anon: permission denied');

-- ------------------------------------------------------------ timing (26-27)
reset role;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;
insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key)
select 'income', 100, 'INR', case when g % 2 = 0 then 'a8c00000-0000-4000-8000-000000000001'::uuid else 'a8c00000-0000-4000-8000-000000000002'::uuid end,
       pg_temp.income_category(), pg_temp.today() - (g % 100), gen_random_uuid()
from generate_series(1, 3000) as g;
select set_config('t.started', pg_catalog.clock_timestamp()::text, true);
create function pg_temp.month_ends() returns date[] language sql stable as $$
  select array_agg((pg_catalog.date_trunc('month', pg_temp.today()::timestamp) - (g || ' months')::interval - interval '1 day')::date)
  from generate_series(0, 119) as g $$;
select is((select count(distinct b.as_of)::int from public.account_balances_at(pg_temp.month_ends()) as b),
  (select count(*)::int from pg_catalog.unnest(pg_temp.month_ends()) as d(day) where d.day >= pg_temp.today() - 100),
  '120 month-ends: rows only for the month-ends the accounts were open');
select ok(pg_catalog.clock_timestamp() - current_setting('t.started')::timestamptz < interval '3 seconds',
  '3,000 entries and 120 dates answer in under 3 seconds');

reset role;
select * from finish();
rollback;
