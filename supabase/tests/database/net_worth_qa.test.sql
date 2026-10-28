-- QA pgTAP for Net worth (Sprint 8e): the loader reads accounts, account_balances, loans and
-- due_payments as the signed-in user, so each must return only that user's own rows (RLS), and
-- a signed-out caller must read none. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'nw-asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'nw-bala@example.test');

-- As A: a bank (opening 1,000.00) and a loan that adds moratorium interest later.
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;
insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
  values ('bank', 'savings', 'NW A Bank', 'INR', 100000, current_date);
select public.create_loan(
  p_idempotency_key => 'aaaaaaaa-0000-4000-8000-000000000001', p_loan_type => 'home', p_lender => 'NW Lender',
  p_sanctioned_minor => 2000000, p_disbursed_minor => 1000000, p_rate_bps => 1200, p_rate_kind => 'floating',
  p_tenure_months => 24, p_start_mode => 'starts_later', p_outstanding_minor => 1000000, p_instalment_months => 24,
  p_first_due_date => current_date + 60, p_emi_estimate_minor => 44424, p_emi_minor => 44424,
  p_moratorium_months => 6, p_moratorium_interest => 'capitalise', p_capitalised_minor => 30000);

select is((select count(*)::int from public.account_balances where account_id in (select id from public.accounts where name = 'NW A Bank')), 1, 'A reads own account_balances row');
select is((select count(*)::int from public.loans where capitalised_minor = 30000), 1, 'A reads own loan with capitalised interest');
select is((select count(*)::int from public.accounts where kind = 'loan'), 1, 'A reads own loan account');

-- As B: none of A's rows are visible to any of the four reads.
reset role;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.accounts), 0, 'B sees none of A''s accounts');
select is((select count(*)::int from public.account_balances), 0, 'B sees none of A''s account_balances');
select is((select count(*)::int from public.loans), 0, 'B sees none of A''s loans');
select is((select count(*)::int from public.due_payments), 0, 'B sees none of A''s due_payments');

-- Signed out: reads are denied.
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok('select count(*) from public.account_balances', '42501', null, 'anon cannot read account_balances');

reset role;
select * from finish();
rollback;
