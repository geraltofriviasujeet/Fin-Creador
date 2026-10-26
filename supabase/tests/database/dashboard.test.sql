-- pgTAP tests for dashboard_breakdown (migration 20261026120000). Run with `supabase test db`
-- (CI). Everything is rolled back. Entries use fixed past dates for the month, year and leap
-- day edges, and each user's local "today" for the time-zone edges.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- Users (fictional): A (Asia/Kolkata), B (Pacific/Pago_Pago, UTC-11), C (Pacific/Kiritimati, UTC+14).
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bala@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'chitra@example.test');
update public.profiles set time_zone = 'Pacific/Pago_Pago' where id = '22222222-2222-4222-8222-222222222222';
update public.profiles set time_zone = 'Pacific/Kiritimati' where id = '33333333-3333-4333-8333-333333333333';

insert into public.accounts (id, user_id, kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'bank', 'savings', 'HDFC Bank', 'INR', 100000, '2023-01-01'),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'cash', null, 'Cash in hand', 'INR', 0, '2023-01-01'),
  ('a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'other', null, 'Travel wallet', 'USD', 0, '2023-01-01'),
  ('b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'bank', 'savings', 'SBI', 'INR', 0, current_date - 30),
  ('c0000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'bank', 'savings', 'Axis Bank', 'INR', 0, current_date - 30);
insert into public.categories (id, user_id, kind, name, icon) values
  ('c0000000-0000-4000-8000-000000000a01', '11111111-1111-4111-8111-111111111111', 'expense', 'Pets', 'other');

-- ------------------------------------------------------------ schema (1-3)
select is((select prosecdef from pg_proc where oid = 'public.dashboard_breakdown(date, date)'::regprocedure), false,
  'dashboard_breakdown is security invoker');
select is((select provolatile from pg_proc where oid = 'public.dashboard_breakdown(date, date)'::regprocedure), 's'::"char",
  'dashboard_breakdown is stable (read-only)');
select ok(not has_function_privilege('anon', 'public.dashboard_breakdown(date, date)', 'execute'),
  'signed-out callers cannot run it');

-- ------------------------------------------------------------ A's entries
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
create temporary table ids (name text primary key, id uuid) on commit drop;

select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000001', 1000, '2023-12-31', 'a0000000-0000-4000-8000-000000000001',
  (select id from public.categories where kind = 'expense' and name = 'Groceries'));
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000002', 2000, '2024-01-01', 'a0000000-0000-4000-8000-000000000001',
  (select id from public.categories where kind = 'expense' and name = 'Groceries'));
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000003', 150, '2024-01-05', 'a0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000a01');
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000004', 300, '2024-01-10', 'a0000000-0000-4000-8000-000000000003',
  (select id from public.categories where kind = 'expense' and name = 'Groceries'));
insert into ids select 'voided', id from public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000005', 9999, '2024-01-15',
  'a0000000-0000-4000-8000-000000000001', (select id from public.categories where kind = 'expense' and name = 'Shopping'));
select public.void_transaction((select id from ids where name = 'voided'), 'e0000000-0000-4000-8000-000000000006');
insert into ids select 'edited', id from public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000007', 300, '2024-01-20',
  'a0000000-0000-4000-8000-000000000001', (select id from public.categories where kind = 'expense' and name = 'Groceries'));
select public.edit_transaction((select id from ids where name = 'edited'), 'e0000000-0000-4000-8000-000000000008', 400, '2024-01-20',
  'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'));
select public.record_transaction('transfer', 'e0000000-0000-4000-8000-000000000009', 5000, '2024-01-31', 'a0000000-0000-4000-8000-000000000001',
  p_counter_account_id => 'a0000000-0000-4000-8000-000000000002');
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000010', 700, '2024-02-29', 'a0000000-0000-4000-8000-000000000001',
  (select id from public.categories where kind = 'expense' and name = 'Transport'));
select public.record_transaction('income', 'e0000000-0000-4000-8000-000000000011', 50000, '2024-03-01', 'a0000000-0000-4000-8000-000000000001',
  (select id from public.categories where kind = 'income' and name = 'Salary'));
-- The Pets category is archived after use; its spending stays in the history.
update public.categories set archived_at = now() where id = 'c0000000-0000-4000-8000-000000000a01';

-- ------------------------------------------------------------ day buckets and edges (4-10)
select results_eq(
  $$ select kind, currency, bucket_start, income_minor, expense_minor, entry_count
     from public.dashboard_breakdown('2024-02-28', '2024-03-01') where kind <> 'category' $$,
  $$ values ('day'::text, 'INR'::text, '2024-02-29'::date, 0::bigint, 700::bigint, 1),
            ('day', 'INR', '2024-03-01', 50000, 0, 1) $$,
  'day buckets across the leap day and a month end, empty days left out'
);
select results_eq(
  $$ select bucket_start, expense_minor from public.dashboard_breakdown('2023-12-31', '2024-01-01') where kind = 'day' $$,
  $$ values ('2023-12-31'::date, 1000::bigint), ('2024-01-01', 2000) $$,
  'day buckets across a year end'
);
select is((select count(*)::int from public.dashboard_breakdown('2024-01-01', '2024-01-31') where bucket_start = '2024-01-31'), 0,
  'a transfer is never income or expense');
select is((select count(*)::int from public.dashboard_breakdown('2024-01-01', '2024-01-31') where bucket_start = '2024-01-15'), 0,
  'a voided entry never counts');
select results_eq(
  $$ select expense_minor, entry_count from public.dashboard_breakdown('2024-01-01', '2024-01-31')
     where kind = 'day' and bucket_start = '2024-01-20' $$,
  $$ values (400::bigint, 1) $$,
  'an edited entry counts once, as its latest version'
);
select is(array(select distinct kind from public.dashboard_breakdown('2024-01-01', '2024-03-02') where kind <> 'category'),
  array['day'], '62 days (leap February included) are split by day');
select is(array(select distinct kind from public.dashboard_breakdown('2024-01-01', '2024-03-03') where kind <> 'category'),
  array['month'], '63 days are split by month');

-- ------------------------------------------------------------ month buckets and currencies (11-12)
select results_eq(
  $$ select currency, bucket_start, income_minor, expense_minor, entry_count
     from public.dashboard_breakdown('2023-12-15', '2024-03-31') where kind = 'month' $$,
  $$ values ('INR'::text, '2023-12-01'::date, 0::bigint, 1000::bigint, 1),
            ('INR', '2024-01-01', 0, 2550, 3),
            ('INR', '2024-02-01', 0, 700, 1),
            ('INR', '2024-03-01', 50000, 0, 1),
            ('USD', '2024-01-01', 0, 300, 1) $$,
  'month buckets start on the 1st, across a year end, per currency'
);
select is((select sum(expense_minor)::bigint from public.dashboard_breakdown('2024-01-01', '2024-01-31') where kind = 'day' and currency = 'INR'),
  2550::bigint, 'currencies are never added together');

-- ------------------------------------------------------------ categories (13-14)
select results_eq(
  $$ select b.currency, c.name, b.income_minor, b.expense_minor, b.entry_count
     from public.dashboard_breakdown('2024-01-01', '2024-01-31') as b
     join public.categories as c on c.id = b.category_id
     where b.kind = 'category' order by b.currency, c.name $$,
  $$ values ('INR'::text, 'Groceries'::text, 0::bigint, 2400::bigint, 2),
            ('INR', 'Pets', 0, 150, 1),
            ('USD', 'Groceries', 0, 300, 1) $$,
  'expenses per category, archived categories kept, voided and replaced left out'
);
select is((select count(*)::int from public.dashboard_breakdown('2024-03-01', '2024-03-01') where kind = 'category'), 0,
  'income has no category rows');

-- ------------------------------------------------------------ reconciliation with transaction_summary (15-17)
select results_eq(
  $$ select currency, sum(income_minor)::bigint, sum(expense_minor)::bigint
     from public.dashboard_breakdown('2023-01-01', current_date) where kind = 'month' group by currency order by currency $$,
  $$ select currency, income_minor, expense_minor from public.transaction_summary('2023-01-01', current_date) $$,
  'month buckets add up to transaction_summary'
);
select results_eq(
  $$ select currency, sum(income_minor)::bigint, sum(expense_minor)::bigint, sum(entry_count)::int
     from public.dashboard_breakdown('2024-01-01', '2024-02-29') where kind = 'day' group by currency order by currency $$,
  $$ select currency, income_minor, expense_minor, income_count + expense_count
     from public.transaction_summary('2024-01-01', '2024-02-29') $$,
  'day buckets add up to transaction_summary, counts included'
);
select results_eq(
  $$ select currency, sum(expense_minor)::bigint
     from public.dashboard_breakdown('2023-01-01', current_date) where kind = 'category' group by currency order by currency $$,
  $$ select currency, expense_minor from public.transaction_summary('2023-01-01', current_date) $$,
  'category rows add up to the period''s expenses'
);

-- ------------------------------------------------------------ bad ranges (18-19)
select throws_ok($$ select * from public.dashboard_breakdown('2024-01-02', '2024-01-01') $$, '22023', null,
  'a reversed date range is rejected');
select throws_ok($$ select * from public.dashboard_breakdown(null, '2024-01-01') $$, '22023', null,
  'a missing date is rejected');

-- ------------------------------------------------------------ time zones and other users (20-24)
-- B (UTC-11) and C (UTC+14) record on their own local today, which can differ from the UTC date.
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
select is((select count(*)::int from public.dashboard_breakdown('2023-01-01', current_date + 1)), 0,
  'B sees none of A''s entries');
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000b01', 250,
  public.user_local_today('22222222-2222-4222-8222-222222222222'), 'b0000000-0000-4000-8000-000000000001',
  (select id from public.categories where kind = 'expense' and name = 'Groceries'));
select results_eq(
  $$ select bucket_start, expense_minor from public.dashboard_breakdown(
       public.user_local_today('22222222-2222-4222-8222-222222222222') - 6,
       public.user_local_today('22222222-2222-4222-8222-222222222222')) where kind = 'day' $$,
  $$ select public.user_local_today('22222222-2222-4222-8222-222222222222'), 250::bigint $$,
  'an entry on B''s local today (UTC-11) is in B''s week, on that day'
);

select set_config('request.jwt.claims', '{"sub": "33333333-3333-4333-8333-333333333333", "role": "authenticated"}', true);
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000c01', 125,
  public.user_local_today('33333333-3333-4333-8333-333333333333'), 'c0000000-0000-4000-8000-000000000001',
  (select id from public.categories where kind = 'expense' and name = 'Groceries'));
select results_eq(
  $$ select bucket_start, expense_minor from public.dashboard_breakdown(
       public.user_local_today('33333333-3333-4333-8333-333333333333') - 6,
       public.user_local_today('33333333-3333-4333-8333-333333333333')) where kind = 'day' $$,
  $$ select public.user_local_today('33333333-3333-4333-8333-333333333333'), 125::bigint $$,
  'an entry on C''s local today (UTC+14, often the UTC tomorrow) is in C''s week, on that day'
);
select is((select sum(expense_minor)::bigint from public.dashboard_breakdown('2023-01-01', current_date + 1) where kind = 'category'), 125::bigint,
  'C sees only C''s own spending');

select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
select is((select sum(expense_minor)::bigint from public.dashboard_breakdown('2023-01-01', current_date + 1) where kind = 'category'),
  (select sum(expense_minor)::bigint from public.transaction_summary('2023-01-01', current_date + 1)),
  'A''s totals include none of B''s or C''s entries');

select * from finish();
rollback;
