-- pgTAP tests for accounts, categories (income sources), transactions (income), the
-- account_balances view, record_income / void_income and the default income sources.
-- Run with `supabase test db` (CI). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(105);

-- Fixed test users (fictional). The sign-up triggers create their profiles and default
-- income sources.
--   A: Asha   11111111-1111-4111-8111-111111111111  (Asia/Kolkata)
--   B: Bala   22222222-2222-4222-8222-222222222222  (Pacific/Pago_Pago, UTC-11)
--   C: Chitra 33333333-3333-4333-8333-333333333333  (backfill)
--   D: Dev    44444444-4444-4444-8444-444444444444  (seeding fails at sign-up)
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test', '{"display_name": "Asha"}'),
  ('22222222-2222-4222-8222-222222222222', 'bala@example.test', '{"display_name": "Bala"}');
update public.profiles set time_zone = 'Pacific/Pago_Pago' where id = '22222222-2222-4222-8222-222222222222';

-- Fixtures created as the owner (fixed ids so cross-user tests can reference them).
--   A bank (INR, opening 1,000.00 as of 30 days ago)        a0000000-0000-4000-8000-000000000001
--   A cash (INR, 50.00)                                      a0000000-0000-4000-8000-000000000002
--   A bank, archived                                         a0000000-0000-4000-8000-000000000003
--   A other account in USD                                   a0000000-0000-4000-8000-000000000004
--   B bank                                                   b0000000-0000-4000-8000-000000000001
--   A source "Consulting" (freelance)                        c0000000-0000-4000-8000-000000000001
--   A source "Old job" (salary), archived                    c0000000-0000-4000-8000-000000000002
--   B source "Tutoring" (freelance)                          c0000000-0000-4000-8000-000000000003
insert into public.accounts (id, user_id, kind, bank_type, name, last4, currency, opening_balance_minor, opening_balance_date) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'bank', 'savings', 'HDFC Bank', '4821', 'INR', 100000, current_date - 30),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'cash', null, 'Cash in hand', null, 'INR', 5000, current_date - 30),
  ('a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'bank', 'current', 'Old Bank', null, 'INR', 0, current_date - 30),
  ('a0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'other', null, 'US wallet', null, 'USD', 0, current_date - 30),
  ('b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'bank', 'savings', 'SBI', '6618', 'INR', 0, current_date - 30);
update public.accounts set archived_at = now() where id = 'a0000000-0000-4000-8000-000000000003';

insert into public.categories (id, user_id, kind, name, source_type) values
  ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'income', 'Consulting', 'freelance'),
  ('c0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'income', 'Old job', 'salary'),
  ('c0000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'income', 'Tutoring', 'freelance');
update public.categories set archived_at = now() where id = 'c0000000-0000-4000-8000-000000000002';

-- ------------------------------------------------------------ schema (1-10)
select has_table('public', 'accounts', 'accounts table exists');
select has_table('public', 'categories', 'categories table exists');
select has_table('public', 'transactions', 'transactions table exists');
select has_view('public', 'account_balances', 'account_balances view exists');
select ok(
  (select bool_and(relrowsecurity) from pg_catalog.pg_class
   where oid in ('public.accounts'::regclass, 'public.categories'::regclass, 'public.transactions'::regclass)),
  'RLS is enabled on accounts, categories and transactions'
);
select policies_are('public', 'accounts', array['accounts_select_own', 'accounts_insert_own', 'accounts_update_own'],
  'accounts has only select/insert/update-own policies (no delete)');
select policies_are('public', 'categories', array['categories_select_own', 'categories_insert_own', 'categories_update_own'],
  'categories has only select/insert/update-own policies (no delete)');
select policies_are('public', 'transactions', array['transactions_select_own', 'transactions_insert_own', 'transactions_update_own'],
  'transactions has only select/insert/update-own policies (no delete)');
select ok(
  (select reloptions @> array['security_invoker=true'] from pg_catalog.pg_class
   where oid = 'public.account_balances'::regclass),
  'account_balances is a security_invoker view (caller''s RLS applies)'
);
select col_type_is('public', 'transactions', 'amount_minor', 'bigint', 'amounts are bigint minor units');

-- ------------------------------------------------------------ privileges (11-19)
select table_privs_are('public', 'accounts', 'anon', array[]::text[], 'anon has no privileges on accounts');
select table_privs_are('public', 'categories', 'anon', array[]::text[], 'anon has no privileges on categories');
select table_privs_are('public', 'transactions', 'anon', array[]::text[], 'anon has no privileges on transactions');
select table_privs_are('public', 'account_balances', 'anon', array[]::text[], 'anon has no privileges on account_balances');
select table_privs_are('public', 'transactions', 'authenticated', array['SELECT'],
  'authenticated has only SELECT on transactions at table level (insert/void are column grants)');
select ok(
  not has_column_privilege('authenticated', 'public.transactions', 'amount_minor', 'UPDATE')
  and has_column_privilege('authenticated', 'public.transactions', 'voided_at', 'UPDATE'),
  'ledger columns are not updatable; only the void columns are'
);
select ok(
  not has_column_privilege('authenticated', 'public.accounts', 'user_id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.categories', 'is_default', 'INSERT'),
  'clients cannot set user_id or is_default'
);
select ok(
  not has_function_privilege('anon', 'public.record_income(uuid, uuid, bigint, date, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.void_income(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.ensure_my_income_sources()', 'execute'),
  'anon cannot call record_income, void_income or ensure_my_income_sources'
);
select ok(
  not has_function_privilege('authenticated', 'public.ensure_default_income_sources(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.backfill_default_income_sources()', 'execute')
  and not has_function_privilege('authenticated', 'public.seed_income_sources_on_signup()', 'execute')
  and not has_function_privilege('anon', 'public.user_local_today(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.user_local_today(uuid)', 'execute'),
  'internal functions are locked; user_local_today is callable by signed-in users (the triggers need it) but not anon'
);

-- ------------------------------------------------- default sources at sign-up (20-21)
select results_eq(
  $$ select name, source_type, is_default from public.categories
     where user_id = '11111111-1111-4111-8111-111111111111' and is_default order by name $$,
  $$ values ('Business'::text, 'business'::text, true), ('Freelance', 'freelance', true),
            ('Interest & dividends', 'interest', true), ('Other income', 'other', true),
            ('Rental income', 'rent', true), ('Salary', 'salary', true) $$,
  'sign-up creates the six default income sources'
);
select is(
  (select count(*) from public.categories where user_id = '22222222-2222-4222-8222-222222222222' and is_default),
  6::bigint, 'every new user gets the defaults'
);

-- ------------------------------------------------------------ as user A (22-75)
select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

select results_eq(
  $$ select count(*) from public.accounts $$, $$ values (4::bigint) $$,
  'user A sees their four accounts (including archived, for history)'
);

-- Accounts: create and constraints
select is(
  public.user_local_today('11111111-1111-4111-8111-111111111111'),
  (now() at time zone 'Asia/Kolkata')::date,
  'a signed-in user can compute their own local date (the validation triggers call this)'
);
select is(
  public.user_local_today('22222222-2222-4222-8222-222222222222'),
  public.user_local_today('00000000-0000-4000-8000-000000000000'),
  'another user''s time zone is not revealed (falls back to UTC, like an unknown id)'
);
select lives_ok(
  $$ insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
     values ('bank', 'current', 'Overdraft Bank', 'INR', -250000, current_date - 1) $$,
  'a signed-in user''s insert passes the validation trigger; a bank account may open overdrawn'
);
select is(
  (select user_id from public.accounts where name = 'Overdraft Bank'),
  '11111111-1111-4111-8111-111111111111'::uuid, 'user_id defaults to the signed-in user'
);
-- As user B, who has no cash account: user A already has one, and the one-cash rule
-- (FC012, migration 20261022190000) would reject the insert before this check runs.
select set_config('request.jwt.claims',
  '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date)
     values ('cash', 'Wallet', 'INR', -1, current_date) $$,
  '23514', null, 'cash cannot open below zero'
);
select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date)
     values ('other', 'Paytm', 'INR', -1, current_date) $$,
  '23514', null, 'other accounts cannot open below zero'
);
select throws_ok(
  $$ insert into public.accounts (kind, name, currency, opening_balance_date)
     values ('bank', 'No type', 'INR', current_date) $$,
  '23514', null, 'a bank account needs savings or current'
);
-- As user B, who has no cash account: user A already has one, and the one-cash rule
-- (FC012, migration 20261022190000) would reject the insert before this check runs.
select set_config('request.jwt.claims',
  '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into public.accounts (kind, bank_type, name, currency, opening_balance_date)
     values ('cash', 'savings', 'Cash', 'INR', current_date) $$,
  '23514', null, 'only bank accounts have a bank type'
);
select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into public.accounts (kind, bank_type, name, last4, currency, opening_balance_date)
     values ('bank', 'savings', 'Bad digits', '12a4', 'INR', current_date) $$,
  '23514', null, 'last 4 digits must be four digits'
);
select throws_ok(
  $$ insert into public.accounts (kind, name, currency, opening_balance_date)
     values ('cash', 'Future', 'INR', date '2999-01-01') $$,
  'FC003', null, 'opening balance date cannot be in the future'
);
select throws_ok(
  $$ insert into public.accounts (user_id, kind, name, currency, opening_balance_date)
     values ('22222222-2222-4222-8222-222222222222', 'cash', 'Planted', 'INR', current_date) $$,
  '42501', null, 'user A cannot create an account for user B'
);

-- Income: record, idempotency, validation
select is(
  (select amount_minor from public.record_income(
     'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
     250000, current_date - 1, 'e0000000-0000-4000-8000-000000000001', '  March invoice  ')),
  250000::bigint, 'record_income stores the amount in minor units'
);
select results_eq(
  $$ select currency, note, type from public.transactions
     where idempotency_key = 'e0000000-0000-4000-8000-000000000001' $$,
  $$ values ('INR'::text, 'March invoice'::text, 'income'::text) $$,
  'currency comes from the account and the note is trimmed'
);
select is(
  (select id from public.record_income(
     'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
     250000, current_date - 1, 'e0000000-0000-4000-8000-000000000001', 'March invoice')),
  (select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000001'),
  'replaying the same request returns the original entry'
);
select is(
  (select count(*) from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000001'),
  1::bigint, 'a double submit is recorded once'
);
select throws_ok(
  $$ select public.record_income('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
       999, current_date - 1, 'e0000000-0000-4000-8000-000000000001') $$,
  'FC007', null, 'reusing a request key for different details is rejected'
);
select lives_ok(
  $$ select public.record_income('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
       7000, current_date - 35, 'e0000000-0000-4000-8000-000000000002') $$,
  'income dated before the opening-balance date is allowed (it still counts as income)'
);
select lives_ok(
  $$ select public.record_income('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
       40000, current_date - 2, 'e0000000-0000-4000-8000-000000000003') $$,
  'a second income into the same account'
);
select throws_ok(
  $$ select public.record_income('a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001',
       1000, current_date - 1, 'e0000000-0000-4000-8000-000000000004') $$,
  'FC001', null, 'income cannot go into an archived account'
);
select throws_ok(
  $$ select public.record_income('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
       1000, current_date - 1, 'e0000000-0000-4000-8000-000000000005') $$,
  'FC006', null, 'an archived source cannot be used'
);
select throws_ok(
  $$ select public.record_income('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
       1000, date '2999-01-01', 'e0000000-0000-4000-8000-000000000006') $$,
  'FC003', null, 'income cannot be dated in the future'
);
select throws_ok(
  $$ select public.record_income('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
       0, current_date - 1, 'e0000000-0000-4000-8000-000000000007') $$,
  '23514', null, 'amount must be positive'
);
select throws_ok(
  $$ select public.record_income('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
       10000000000001, current_date - 1, 'e0000000-0000-4000-8000-000000000008') $$,
  '23514', null, 'amount above the cap is rejected'
);
select throws_ok(
  $$ select public.record_income('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
       1000, current_date - 1, 'e0000000-0000-4000-8000-000000000009') $$,
  'FC010', null, 'user A cannot record income into user B''s account'
);
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key)
     values ('income', 1000, 'INR', 'b0000000-0000-4000-8000-000000000001',
             'c0000000-0000-4000-8000-000000000001', current_date - 1, 'e0000000-0000-4000-8000-000000000010') $$,
  '23503', null, 'a direct insert cannot reference user B''s account (composite key)'
);
select throws_ok(
  $$ select public.record_income('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003',
       1000, current_date - 1, 'e0000000-0000-4000-8000-000000000011') $$,
  '23503', null, 'user A cannot use user B''s income source'
);
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key)
     values ('expense', 1000, 'INR', 'a0000000-0000-4000-8000-000000000001',
             'c0000000-0000-4000-8000-000000000001', current_date - 1, 'e0000000-0000-4000-8000-000000000012') $$,
  'FC006', null, 'an income source cannot be used for an expense'
);
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key)
     values ('income', 1000, 'USD', 'a0000000-0000-4000-8000-000000000001',
             'c0000000-0000-4000-8000-000000000001', current_date - 1, 'e0000000-0000-4000-8000-000000000013') $$,
  'FC002', null, 'entry currency must match the account'
);

-- Balance sums: opening 1,000.00 + 2,500.00 + 400.00; the 70.00 dated before the opening
-- date is income but already inside the opening balance.
select results_eq(
  $$ select inflow_minor, outflow_minor from public.account_balances
     where account_id = 'a0000000-0000-4000-8000-000000000001' $$,
  $$ values (290000::bigint, 0::bigint) $$,
  'balance sums count entries on or after the opening-balance date only'
);

-- Void: one-way
select is(
  (select void_reason from public.void_income(
     (select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000003'),
     '  Entered twice  ')),
  'Entered twice', 'void_income voids with a trimmed reason'
);
select is(
  (select inflow_minor from public.account_balances where account_id = 'a0000000-0000-4000-8000-000000000001'),
  250000::bigint, 'a voided entry drops out of the balance sums'
);
select is(
  (select count(*) from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000003'),
  1::bigint, 'a voided entry stays in history'
);
select is(
  (select void_reason from public.void_income(
     (select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000003'),
     'something else')),
  'Entered twice', 'voiding again returns the entry unchanged'
);
select throws_ok(
  $$ update public.transactions set voided_at = null
     where idempotency_key = 'e0000000-0000-4000-8000-000000000003' $$,
  'FC005', null, 'a void cannot be undone'
);
select throws_ok(
  $$ update public.transactions set void_reason = 'changed my mind'
     where idempotency_key = 'e0000000-0000-4000-8000-000000000003' $$,
  'FC005', null, 'the void reason cannot change after voiding'
);
select throws_ok(
  $$ update public.transactions set amount_minor = 1
     where idempotency_key = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'user A cannot edit an entry''s amount'
);
select throws_ok(
  $$ delete from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'user A cannot delete entries'
);
select throws_ok(
  $$ delete from public.accounts where id = 'a0000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'user A cannot delete accounts (archive instead)'
);

-- Account edits
select throws_ok(
  $$ update public.accounts set currency = 'USD' where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'FC004', null, 'currency is locked once the account has entries'
);
select lives_ok(
  $$ update public.accounts set currency = 'USD', name = 'Overdraft Bank (USD)' where name = 'Overdraft Bank' $$,
  'currency can change while the account has no entries'
);
select throws_ok(
  $$ update public.accounts set opening_balance_date = current_date - 40
     where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'FC011', null, 'the opening-balance date is locked once the account has entries'
);
select lives_ok(
  $$ update public.accounts set opening_balance_minor = 120000
     where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'the opening amount can still be corrected after entries exist'
);
select is(
  (select opening_balance_minor from public.accounts where id = 'a0000000-0000-4000-8000-000000000001'),
  120000::bigint, 'the corrected opening amount is saved'
);
select lives_ok(
  $$ update public.accounts set opening_balance_date = current_date - 3 where name = 'Overdraft Bank (USD)' $$,
  'the opening-balance date can change while the account has no entries'
);
select throws_ok(
  $$ update public.accounts set opening_balance_date = date '2999-01-01' where name = 'Overdraft Bank (USD)' $$,
  'FC003', null, 'a changed opening-balance date still cannot be in the future'
);
select lives_ok(
  $$ update public.accounts set archived_at = '2000-01-01' where id = 'a0000000-0000-4000-8000-000000000002' $$,
  'user A can archive an account'
);
select ok(
  (select archived_at > now() - interval '1 minute' from public.accounts where id = 'a0000000-0000-4000-8000-000000000002'),
  'archive time is set by the server, not the client'
);

-- Sources
select is(public.ensure_my_income_sources(), 0, 'the lazy fallback does nothing once sources exist');
select lives_ok(
  $$ insert into public.categories (kind, name, source_type, default_account_id)
     values ('income', 'Shop rent', 'rent', 'a0000000-0000-4000-8000-000000000001') $$,
  'user A can add a source with a default account'
);
select throws_ok(
  $$ insert into public.categories (kind, name, source_type) values ('income', '  shop RENT ', 'rent') $$,
  '23505', null, 'source names are unique per user, ignoring case and spaces'
);
select throws_ok(
  $$ insert into public.categories (kind, name) values ('expense', 'Food') $$,
  '23514', null, 'expense categories are not enabled yet'
);
select throws_ok(
  $$ insert into public.categories (kind, name) values ('income', 'No type') $$,
  '23514', null, 'an income source needs a type'
);
select throws_ok(
  $$ insert into public.categories (kind, name, source_type, default_account_id)
     values ('income', 'Sneaky', 'other', 'b0000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'a source cannot default to user B''s account'
);

-- ------------------------------------------------------------ as user B (76-84)
select set_config('request.jwt.claims',
  '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);

select results_eq(
  $$ select id from public.accounts $$,
  $$ values ('b0000000-0000-4000-8000-000000000001'::uuid) $$,
  'user B sees only their own account'
);
select is((select count(*) from public.transactions), 0::bigint, 'user B sees none of user A''s entries');
select results_eq(
  $$ select account_id from public.account_balances $$,
  $$ values ('b0000000-0000-4000-8000-000000000001'::uuid) $$,
  'through the balance view, user B sees only their own account'
);
select is(
  (select count(*) from public.categories where user_id <> '22222222-2222-4222-8222-222222222222'),
  0::bigint, 'user B sees none of user A''s sources'
);
select results_eq(
  $$ with u as (update public.accounts set name = 'hacked'
                where id = 'a0000000-0000-4000-8000-000000000001' returning id)
     select count(*) from u $$,
  $$ values (0::bigint) $$,
  'user B cannot update user A''s account (0 rows)'
);
select results_eq(
  $$ with u as (update public.transactions set voided_at = now()
                where user_id = '11111111-1111-4111-8111-111111111111' returning id)
     select count(*) from u $$,
  $$ values (0::bigint) $$,
  'user B cannot void user A''s entries directly (0 rows)'
);
select throws_ok(
  $$ select public.void_income('00000000-0000-4000-8000-000000000000') $$,
  'FC008', null, 'void_income reports an unknown or foreign entry as not found'
);
select throws_ok(
  $$ select public.record_income('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003',
       1000, current_date - 1, 'f0000000-0000-4000-8000-000000000001') $$,
  'FC010', null, 'user B cannot record income into user A''s account'
);
-- B's time zone (UTC-11) is always at least a day behind Kiritimati (UTC+14).
select throws_ok(
  $$ select public.record_income('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003',
       1000, (now() at time zone 'Pacific/Kiritimati')::date, 'f0000000-0000-4000-8000-000000000002') $$,
  'FC003', null, '"future" is judged in the user''s own time zone'
);

-- ---------------------------------------------- signed in without a user id (85)
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select is((select count(*) from public.account_balances), 0::bigint, 'no user id: the balance view shows nothing');

-- ------------------------------------------------------------ anonymous (86-88)
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;

select throws_ok($$ select * from public.accounts $$, '42501', null, 'anon cannot read accounts');
select throws_ok($$ select * from public.account_balances $$, '42501', null, 'anon cannot read the balance view');
select throws_ok(
  $$ select public.record_income('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
       1000, current_date - 1, 'f0000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'anon cannot record income'
);

-- ------------------------------------------------------------ as owner (89-105)
reset role;

select throws_ok(
  $$ update public.transactions set amount_minor = 1
     where idempotency_key = 'e0000000-0000-4000-8000-000000000001' $$,
  'FC009', null, 'ledger entries are immutable even for the database owner'
);
select throws_ok(
  $$ update public.transactions set voided_at = null
     where idempotency_key = 'e0000000-0000-4000-8000-000000000003' $$,
  'FC005', null, 'a void cannot be undone even by the database owner'
);
select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, occurred_on, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'expense', 1000, 'INR',
             'a0000000-0000-4000-8000-000000000001', current_date - 1, 'e0000000-0000-4000-8000-000000000020') $$,
  '23514', null, 'expense entries are not enabled yet (schema check)'
);
select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, counter_account_id, occurred_on, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'transfer', 1000, 'INR',
             'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
             current_date - 1, 'e0000000-0000-4000-8000-000000000021') $$,
  '23514', null, 'transfer entries are not enabled yet (schema check)'
);

-- Backfill: a user who has no sources gets the defaults once.
insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'chitra@example.test');
delete from public.categories where user_id = '33333333-3333-4333-8333-333333333333';
select is(public.backfill_default_income_sources(), 6, 'backfill creates the defaults for a user without sources');
select is(public.backfill_default_income_sources(), 0, 'backfill is idempotent');

-- Archived defaults are not re-created.
update public.categories set archived_at = now() where user_id = '33333333-3333-4333-8333-333333333333';
select is(public.ensure_default_income_sources('33333333-3333-4333-8333-333333333333'), 0,
  'defaults a user archived are not re-created');

-- Seeding failure never blocks sign-up.
alter table public.categories add constraint test_block_seeding check (false) not valid;
select lives_ok(
  $$ insert into auth.users (id, email) values ('44444444-4444-4444-8444-444444444444', 'dev@example.test') $$,
  'sign-up succeeds even when creating default sources fails'
);
select is(
  (select count(*) from public.profiles where id = '44444444-4444-4444-8444-444444444444'),
  1::bigint, 'the profile is still created'
);
select is(
  (select count(*) from public.categories where user_id = '44444444-4444-4444-8444-444444444444'),
  0::bigint, 'no sources were created while seeding was failing'
);
alter table public.categories drop constraint test_block_seeding;

-- Lazy fallback on first use creates them.
select set_config('request.jwt.claims',
  '{"sub": "44444444-4444-4444-8444-444444444444", "role": "authenticated"}', true);
set local role authenticated;
select is(public.ensure_my_income_sources(), 6, 'the lazy fallback creates the defaults on first use');
select is(public.ensure_my_income_sources(), 0, 'and only once');
reset role;
select is(
  (select count(*) from public.categories where user_id = '11111111-1111-4111-8111-111111111111'),
  9::bigint, 'the lazy fallback only touches the caller''s own sources (user A still has 6 defaults + 3 own)'
);

-- Archiving keeps working after a time-zone change makes the as-of date "future".
update public.profiles set time_zone = 'Pacific/Kiritimati' where id = '11111111-1111-4111-8111-111111111111';
insert into public.accounts (id, user_id, kind, name, currency, opening_balance_date) values
  ('a0000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'cash', 'Travel cash', 'INR',
   (now() at time zone 'Pacific/Kiritimati')::date);
update public.profiles set time_zone = 'Pacific/Pago_Pago' where id = '11111111-1111-4111-8111-111111111111';
select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$ update public.accounts set name = 'Trip cash', archived_at = now()
     where id = 'a0000000-0000-4000-8000-000000000005' $$,
  'an account can be renamed and archived after a time-zone change (unchanged as-of date is not re-checked)'
);
reset role;

-- Deleting an auth user removes all of their data.
select lives_ok(
  $$ delete from auth.users where id = '11111111-1111-4111-8111-111111111111' $$,
  'deleting a user with accounts, sources and income succeeds'
);
select results_eq(
  $$ select (select count(*) from public.accounts where user_id = '11111111-1111-4111-8111-111111111111'),
            (select count(*) from public.categories where user_id = '11111111-1111-4111-8111-111111111111'),
            (select count(*) from public.transactions where user_id = '11111111-1111-4111-8111-111111111111'),
            (select count(*) from public.profiles where id = '11111111-1111-4111-8111-111111111111') $$,
  $$ values (0::bigint, 0::bigint, 0::bigint, 0::bigint) $$,
  'no accounts, sources, entries or profile remain for the deleted user'
);
select is(
  (select count(*) from public.transactions where user_id = '22222222-2222-4222-8222-222222222222')
  + (select count(*) from public.accounts where user_id = '22222222-2222-4222-8222-222222222222'),
  1::bigint, 'other users'' data is untouched'
);

select * from finish();
rollback;
