-- pgTAP tests for the one-cash-account rule and set_cash_on_hand (migration 20261022190000).
-- Run with `supabase test db` (CI). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

-- Users A and B (fictional); sign-up triggers create profiles and default sources.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bala@example.test');

-- Fixtures as owner: A has a cash account (as of 10 days ago) and a bank; B has cash.
insert into public.accounts (id, user_id, kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'cash', null, 'Cash in hand', 'INR', 500000, current_date - 10),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'bank', 'savings', 'HDFC Bank', 'INR', 0, current_date - 10),
  ('b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'cash', null, 'Cash in hand', 'INR', 100, current_date - 10);

select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

-- ------------------------------------------------------------ one active cash account (1-6)
select throws_ok(
  $$ insert into public.accounts (kind, name, currency, opening_balance_date) values ('cash', 'Cash in hand', 'INR', current_date - 1) $$,
  'FC012', null, 'a second active cash account is rejected'
);
select lives_ok(
  $$ insert into public.accounts (kind, bank_type, name, currency, opening_balance_date) values ('bank', 'current', 'ICICI Bank', 'INR', current_date - 1) $$,
  'several bank accounts are still fine'
);
select lives_ok(
  $$ update public.accounts set archived_at = now() where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'the cash account can be archived'
);
select lives_ok(
  $$ insert into public.accounts (kind, name, currency, opening_balance_date) values ('cash', 'Cash in hand', 'INR', current_date - 1) $$,
  'with the old one archived, a new cash account can be added'
);
select throws_ok(
  $$ update public.accounts set archived_at = null where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'FC012', null, 'restoring an archived cash account while another is active is rejected'
);
-- Back to the original cash account for the rest of the tests.
update public.accounts set archived_at = now() where kind = 'cash' and archived_at is null;
update public.accounts set archived_at = null where id = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select archived_at is null from public.accounts where id = 'a0000000-0000-4000-8000-000000000001'),
  true, 'archiving the new one allows restoring the original'
);

-- ------------------------------------------------------------ set_cash_on_hand (7-16)
-- Income into cash: 2,000.00 eight days ago and 300.00 today.
select public.record_income('a0000000-0000-4000-8000-000000000001',
  (select id from public.categories where name = 'Other income'), 200000, current_date - 8,
  'e0000000-0000-4000-8000-000000000001');
select public.record_income('a0000000-0000-4000-8000-000000000001',
  (select id from public.categories where name = 'Other income'), 30000,
  public.user_local_today('11111111-1111-4111-8111-111111111111'), 'e0000000-0000-4000-8000-000000000002');
select is(
  (select count(*) from public.transactions where account_id = 'a0000000-0000-4000-8000-000000000001'),
  2::bigint, 'income recorded into cash (one entry 8 days ago, one today)'
);
select throws_ok(
  $$ update public.accounts set opening_balance_date = current_date - 1 where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'FC011', null, 'a direct as-of date change is still locked once entries exist'
);
select results_eq(
  $$ select opening_balance_minor, opening_balance_date from public.set_cash_on_hand('a0000000-0000-4000-8000-000000000001', 1000000) $$,
  $$ values (970000::bigint, public.user_local_today('11111111-1111-4111-8111-111111111111')) $$,
  'set_cash_on_hand: as-of today, opening = amount minus today''s entries'
);
select is(
  (select opening_balance_minor + inflow_minor - outflow_minor
   from public.accounts join public.account_balances on account_id = id
   where id = 'a0000000-0000-4000-8000-000000000001'),
  1000000::bigint, 'the cash balance now equals the amount the person holds'
);
select is(
  (select count(*) from public.transactions where account_id = 'a0000000-0000-4000-8000-000000000001' and voided_at is null),
  2::bigint, 'income entries are kept unchanged'
);
select throws_ok(
  $$ select public.set_cash_on_hand('a0000000-0000-4000-8000-000000000001', 10000) $$,
  '23514', null, 'less than today''s cash income would need a negative opening and is rejected'
);
select throws_ok(
  $$ select public.set_cash_on_hand('a0000000-0000-4000-8000-000000000002', 10000) $$,
  'FC013', null, 'only a cash account can be updated this way'
);
select throws_ok(
  $$ select public.set_cash_on_hand('b0000000-0000-4000-8000-000000000001', 10000) $$,
  'FC010', null, 'user A cannot update user B''s cash'
);
select is(
  current_setting('fin_creador.cash_on_hand', true), '',
  'the bypass marker is cleared after the update'
);
select throws_ok(
  $$ update public.accounts set opening_balance_date = current_date - 1 where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'FC011', null, 'the as-of date lock is back in force after set_cash_on_hand'
);

-- ------------------------------------------------------------ privileges (17-18)
reset role;
select ok(
  has_function_privilege('authenticated', 'public.set_cash_on_hand(uuid, bigint)', 'execute')
  and not has_function_privilege('anon', 'public.set_cash_on_hand(uuid, bigint)', 'execute'),
  'signed-in users can call set_cash_on_hand; anon cannot'
);
select is(
  (select opening_balance_minor from public.accounts where id = 'b0000000-0000-4000-8000-000000000001'),
  100::bigint, 'user B''s cash is unchanged'
);

select * from finish();
rollback;
