-- QA pgTAP tests for loans (migration 20261028120000), added on top of loans.test.sql: where
-- an EMI's money goes, Total available, shortfall details, void/edit moving every entry,
-- month-end due dates, capitalised interest, direct writes, cross-user writes and anon.
-- Expected values are worked out by hand in the comments (paise). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(84);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'qa-asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'qa-bala@example.test');
update public.profiles set time_zone = 'Pacific/Pago_Pago' where id = '22222222-2222-4222-8222-222222222222';

-- Helpers (SECURITY INVOKER: RLS applies to whoever calls them).
create function public.t_today() returns date language sql stable set search_path = ''
  as $$ select public.user_local_today((select auth.uid())) $$;
create function public.t_month_start() returns date language sql stable set search_path = ''
  as $$ select pg_catalog.make_date(extract(year from public.t_today())::integer, extract(month from public.t_today())::integer, 1) $$;
create function public.t_loan(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select l.id from public.loans as l where l.idempotency_key = p_key $$;
create function public.t_loan_account(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select l.account_id from public.loans as l where l.idempotency_key = p_key $$;
create function public.t_due(p_key uuid, p_seq integer, p_kind text default 'loan_emi') returns uuid language sql stable set search_path = ''
  as $$ select d.id from public.due_items as d join public.loans as l on l.id = d.loan_id
        where l.idempotency_key = p_key and d.seq = p_seq and d.kind = p_kind $$;
create function public.t_acct(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select a.id from public.accounts as a where a.name = p_name and a.kind <> 'loan' $$;
create function public.t_pay(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select p.id from public.due_payments as p where p.idempotency_key = p_key $$;
create function public.t_bal(p_account uuid) returns bigint language sql stable set search_path = ''
  as $$ select a.opening_balance_minor + b.inflow_minor - b.outflow_minor
        from public.accounts as a join public.account_balances as b on b.account_id = a.id where a.id = p_account $$;
create function public.t_parts(p_payment uuid) returns bigint language sql stable set search_path = ''
  as $$ select count(*) from public.transactions as t where t.due_payment_id = p_payment and t.voided_at is null $$;
-- Total available as CLAUDE.md defines it: active bank, cash and other accounts only.
create function public.t_total() returns bigint language sql stable set search_path = ''
  as $$ select coalesce(sum(a.opening_balance_minor + b.inflow_minor - b.outflow_minor), 0)::bigint
        from public.accounts as a join public.account_balances as b on b.account_id = a.id
        where a.archived_at is null and a.kind in ('bank', 'cash', 'other') $$;
-- Moratorium interest added to a loan (expense entries on its own account that are not voided).
create function public.t_cap(p_key uuid) returns bigint language sql stable set search_path = ''
  as $$ select coalesce(sum(t.amount_minor), 0)::bigint from public.transactions as t
        where t.account_id = public.t_loan_account(p_key) and t.type = 'expense' and t.voided_at is null $$;
-- Entries whose voided state differs from their payment's: there must be none.
create function public.t_orphans() returns bigint language sql stable set search_path = ''
  as $$ select count(*) from public.transactions as t join public.due_payments as p on p.id = t.due_payment_id
        where (p.voided_at is null) <> (t.voided_at is null) $$;
-- Pay / edit, answering 'ok' or 'SQLSTATE:detail' (the detail of FC035 is the shortfall).
create function public.t_try_pay(p_due uuid, p_key uuid, p_acct uuid, p_prin bigint, p_int bigint, p_fee bigint, p_allow boolean default false)
returns text language plpgsql set search_path = '' as $$
declare v_detail text;
begin
  perform public.pay_due_item(p_due, p_key, p_acct, public.t_today(), p_prin, p_int, p_fee, p_allow);
  return 'ok';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlstate || ':' || coalesce(v_detail, '');
end $$;
create function public.t_try_edit(p_pay uuid, p_key uuid, p_acct uuid, p_prin bigint, p_int bigint, p_fee bigint, p_allow boolean default false)
returns text language plpgsql set search_path = '' as $$
declare v_detail text;
begin
  perform public.edit_due_payment(p_pay, p_key, p_acct, public.t_today(), p_prin, p_int, p_fee, p_allow);
  return 'ok';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlstate || ':' || coalesce(v_detail, '');
end $$;
create function public.t_create(
  p_key uuid, p_lender text, p_nickname text, p_start_mode text, p_outstanding bigint, p_months integer,
  p_first date, p_before date, p_moratorium integer default 0, p_mor_interest text default null,
  p_capitalised bigint default 0, p_mor_monthly bigint default 0, p_emi bigint default 44424, p_type text default 'home'
) returns public.loans language sql set search_path = ''
  as $$ select * from public.create_loan(p_key, p_type, p_lender, 2000000, 1000000, 1200, 'floating', 24,
        p_start_mode, p_outstanding, p_months, p_first, p_emi, p_emi,
        p_nickname => p_nickname, p_before_tracking_on => p_before, p_moratorium_months => p_moratorium,
        p_moratorium_interest => p_mor_interest, p_capitalised_minor => p_capitalised, p_moratorium_interest_minor => p_mor_monthly) $$;
grant execute on function public.t_today(), public.t_month_start(), public.t_loan(uuid), public.t_loan_account(uuid),
  public.t_due(uuid, integer, text), public.t_acct(text), public.t_pay(uuid), public.t_bal(uuid), public.t_parts(uuid),
  public.t_total(), public.t_cap(uuid), public.t_orphans(),
  public.t_try_pay(uuid, uuid, uuid, bigint, bigint, bigint, boolean),
  public.t_try_edit(uuid, uuid, uuid, bigint, bigint, bigint, boolean),
  public.t_create(uuid, text, text, text, bigint, integer, date, date, integer, text, bigint, bigint, bigint, text) to authenticated;

-- ------------------------------------------------------------ as A: accounts
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('bank', 'savings', 'QA Bank', 'INR', 1000000, public.t_today() - 30),
  ('bank', 'savings', 'QA Old', 'INR', 777, public.t_today() - 30);
insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date) values
  ('cash', 'QA Cash', 'INR', 5000, public.t_today() - 30),
  ('other', 'QA Wallet', 'INR', 3000, public.t_today() - 30);
update public.accounts set archived_at = now() where name = 'QA Old';

-- L1: ongoing, 12 EMIs of 44,424; owes 500,000.
select lives_ok(
  $$ select public.t_create('a1000000-0000-4000-8000-000000000001', 'QA Lender', null, 'ongoing', 500000, 12, public.t_month_start(), null) $$,
  'A adds L1');
-- Total available: 1,000,000 + 5,000 + 3,000 = 1,008,000 (the archived 777 and the loan's -500,000 are out).
select is(public.t_total(), 1008000::bigint, 'a new loan (and an archived account) change nothing in Total available');

-- ------------------------------------------------------------ 1 + 2: where an EMI''s money goes
-- EMI 1 from the bank: principal 39,424 + interest 4,000 + fees 1,000 = 44,424.
select lives_ok(
  $$ select public.pay_due_item(public.t_due('a1000000-0000-4000-8000-000000000001', 1), 'a1b00000-0000-4000-8000-000000000001',
       public.t_acct('QA Bank'), public.t_today(), 39424, 4000, 1000) $$,
  'A pays L1 EMI 1: principal, interest and fees');
select results_eq(
  $$ select t.type, t.account_id = public.t_acct('QA Bank'), t.counter_account_id is not distinct from public.t_loan_account('a1000000-0000-4000-8000-000000000001'),
            t.amount_minor, c.system_key
     from public.transactions as t left join public.categories as c on c.id = t.category_id
     where t.due_payment_id = public.t_pay('a1b00000-0000-4000-8000-000000000001') order by t.amount_minor desc $$,
  $$ values ('transfer'::text, true, true, 39424::bigint, null::text), ('expense', true, false, 4000, 'loan_interest'), ('expense', true, false, 1000, 'loan_fees') $$,
  'principal is a transfer into the loan account; interest and fees are expenses in the system categories; all from the bank');
select results_eq(
  $$ select coalesce(sum(amount_minor) filter (where type = 'expense'), 0)::bigint, coalesce(sum(amount_minor) filter (where type = 'income'), 0)::bigint,
            coalesce(sum(amount_minor) filter (where type = 'transfer'), 0)::bigint
     from public.transactions where voided_at is null $$,
  $$ values (5000::bigint, 0::bigint, 39424::bigint) $$,
  'period expenses are interest + fees only (5,000); nothing is income; the principal is a transfer');
-- Bank 1,000,000 - 44,424 = 955,576; loan -500,000 + 39,424 = -460,576; Total 1,008,000 - 44,424 = 963,576.
select results_eq(
  $$ select public.t_bal(public.t_acct('QA Bank')), public.t_bal(public.t_loan_account('a1000000-0000-4000-8000-000000000001')), public.t_total() $$,
  $$ values (955576::bigint, -460576::bigint, 963576::bigint) $$,
  'Total available falls by the whole 44,424 and not by the loan''s balance');

-- ------------------------------------------------------------ 9: shortfall to the paisa
-- Wallet holds 3,000: paying 3,001 is short by exactly 1; paying 3,000 is allowed.
select is(public.t_try_pay(public.t_due('a1000000-0000-4000-8000-000000000001', 2), 'a1b00000-0000-4000-8000-000000000002',
            public.t_acct('QA Wallet'), 0, 2000, 1001), 'FC035:1', 'a shortfall of 1 paisa: FC035 with detail 1');
select is(public.t_try_pay(public.t_due('a1000000-0000-4000-8000-000000000001', 2), 'a1b00000-0000-4000-8000-000000000002',
            public.t_acct('QA Wallet'), 0, 2000, 1000), 'ok', 'an exact balance pays without "Pay anyway"');
-- Wallet 0; Total 963,576 - 3,000 = 960,576.
select results_eq(
  $$ select public.t_bal(public.t_acct('QA Wallet')), public.t_total() $$,
  $$ values (0::bigint, 960576::bigint) $$,
  'the wallet is empty and Total available fell by 3,000');

-- Cash holds 5,000; EMI total 44,424: short by 39,424.
select is(public.t_try_pay(public.t_due('a1000000-0000-4000-8000-000000000001', 3), 'a1b00000-0000-4000-8000-000000000003',
            public.t_acct('QA Cash'), 39424, 5000, 0), 'FC035:39424', 'FC035 detail is the shortfall in minor units');
select is(public.t_total(), 960576::bigint, 'a refused payment changes nothing');
select is(public.t_try_pay(public.t_due('a1000000-0000-4000-8000-000000000001', 3), 'a1b00000-0000-4000-8000-000000000003',
            public.t_acct('QA Cash'), 39424, 5000, 0, true), 'ok', 'with "Pay anyway" the same request key succeeds');
-- Cash 5,000 - 44,424 = -39,424; loan -460,576 + 39,424 = -421,152; Total 960,576 - 44,424 = 916,152.
select results_eq(
  $$ select public.t_bal(public.t_acct('QA Cash')), public.t_bal(public.t_loan_account('a1000000-0000-4000-8000-000000000001')), public.t_total() $$,
  $$ values (-39424::bigint, -421152::bigint, 916152::bigint) $$,
  'cash went below zero as chosen; Total available fell by the total paid');

-- edit_due_payment: move EMI 1's payment (bank) to the empty wallet: short by the whole 44,424.
select is(public.t_try_edit(public.t_pay('a1b00000-0000-4000-8000-000000000001'), 'a1d00000-0000-4000-8000-000000000001',
            public.t_acct('QA Wallet'), 39424, 4000, 1000), 'FC035:44424', 'an edit onto an account that is short: FC035 with the shortfall');
select results_eq(
  $$ select public.t_parts(public.t_pay('a1b00000-0000-4000-8000-000000000001')), public.t_total(),
            (select status from public.due_items where id = public.t_due('a1000000-0000-4000-8000-000000000001', 1)) $$,
  $$ values (3::bigint, 916152::bigint, 'paid'::text) $$,
  'a refused edit leaves the old payment, its three entries and the totals as they were');
select is(public.t_try_edit(public.t_pay('a1b00000-0000-4000-8000-000000000001'), 'a1d00000-0000-4000-8000-000000000001',
            public.t_acct('QA Wallet'), 39424, 4000, 1000, true), 'ok', 'the edit succeeds with "Pay anyway" under the same request key');
-- Old parts voided, 3 new ones; wallet -44,424; bank back to 1,000,000; loan unchanged; Total unchanged 916,152.
select results_eq(
  $$ select public.t_parts(public.t_pay('a1b00000-0000-4000-8000-000000000001')), public.t_parts(public.t_pay('a1d00000-0000-4000-8000-000000000001')),
            public.t_bal(public.t_acct('QA Wallet')), public.t_bal(public.t_acct('QA Bank')),
            public.t_bal(public.t_loan_account('a1000000-0000-4000-8000-000000000001')), public.t_total() $$,
  $$ values (0::bigint, 3::bigint, -44424::bigint, 1000000::bigint, -421152::bigint, 916152::bigint) $$,
  'the edit moved all three entries together: balances follow, Total available is unchanged');
select is(public.t_orphans(), 0::bigint, 'after the edit no entry disagrees with its payment');

-- ------------------------------------------------------------ 6: void moves everything
select lives_ok(
  $$ select public.void_due_payment(public.t_pay('a1d00000-0000-4000-8000-000000000001'), 'a1c00000-0000-4000-8000-000000000001', 'QA') $$,
  'A voids the edited payment');
-- Wallet back to 0; loan -421,152 - 39,424 = -460,576; bank 1,000,000; cash -39,424; Total 960,576.
select results_eq(
  $$ select public.t_parts(public.t_pay('a1d00000-0000-4000-8000-000000000001')),
            (select status from public.due_items where id = public.t_due('a1000000-0000-4000-8000-000000000001', 1)),
            public.t_bal(public.t_acct('QA Wallet')), public.t_bal(public.t_loan_account('a1000000-0000-4000-8000-000000000001')), public.t_total() $$,
  $$ values (0::bigint, 'pending'::text, 0::bigint, -460576::bigint, 960576::bigint) $$,
  'all entries voided, the EMI pending, the balances restored');
select lives_ok(
  $$ select public.void_due_payment(public.t_pay('a1d00000-0000-4000-8000-000000000001'), 'a1c00000-0000-4000-8000-000000000001', 'QA') $$,
  'a retried void (same request key) succeeds');
select is(public.t_total(), 960576::bigint, '... and restores nothing twice');
select is(public.t_orphans(), 0::bigint, 'after the void no entry disagrees with its payment');

-- ------------------------------------------------------------ 8: starts later, moratorium, month-end
-- L2: capitalised interest. First EMI on 31 Jan 2030, 4 EMIs of 100,000; 30,000 added with the first EMI paid.
select lives_ok(
  $$ select public.t_create('a1000000-0000-4000-8000-000000000002', 'QA Study', 'QA Study loan', 'starts_later', 1000000, 4,
       date '2030-01-31', null, 2, 'capitalise', 30000, 0, p_emi => 100000) $$,
  'A adds L2: starts later, interest added when EMIs start');
select results_eq(
  $$ select seq, due_date from public.due_items where loan_id = public.t_loan('a1000000-0000-4000-8000-000000000002') and kind = 'loan_emi' order by seq $$,
  $$ values (1, date '2030-01-31'), (2, date '2030-02-28'), (3, date '2030-03-31'), (4, date '2030-04-30') $$,
  'EMI dates clamp to the month end but count from the first date (31 Jan, 28 Feb, 31 Mar, 30 Apr)');
select is((select count(*)::int from public.due_items where loan_id = public.t_loan('a1000000-0000-4000-8000-000000000002') and kind = 'loan_interest'), 0,
  'capitalised interest has no monthly items');
-- L3: interest paid monthly for 2 months before the first EMI.
select lives_ok(
  $$ select public.t_create('a1000000-0000-4000-8000-000000000003', 'QA Study', 'QA Monthly', 'starts_later', 1000000, 4,
       date '2030-01-31', null, 2, 'pay_monthly', 0, 10000, p_emi => 100000) $$,
  'A adds L3: starts later, interest paid monthly');
select results_eq(
  $$ select seq, due_date, amount_due_minor, status from public.due_items
     where loan_id = public.t_loan('a1000000-0000-4000-8000-000000000003') and kind = 'loan_interest' order by seq $$,
  $$ values (1, date '2029-11-30', 10000::bigint, 'pending'::text), (2, date '2029-12-31', 10000::bigint, 'pending'::text) $$,
  'the two interest-only months are one and two months before the first EMI (30 Nov, 31 Dec 2029)');
-- L4: a leap year: 31 Jan, 29 Feb, 31 Mar 2032.
select lives_ok(
  $$ select public.t_create('a1000000-0000-4000-8000-000000000004', 'QA Leap', null, 'starts_later', 300000, 3, date '2032-01-31', null) $$,
  'A adds L4 whose second EMI falls in a leap February');
select results_eq(
  $$ select due_date from public.due_items where loan_id = public.t_loan('a1000000-0000-4000-8000-000000000004') order by seq $$,
  $$ values (date '2032-01-31'), (date '2032-02-29'), (date '2032-03-31') $$,
  'the second EMI is 29 Feb 2032');
select is(public.t_total(), 960576::bigint, 'three more loans change nothing in Total available');

-- L2 EMI 1: principal 90,000 + interest 10,000 from the bank; the 30,000 is added to the loan.
select lives_ok(
  $$ select public.pay_due_item(public.t_due('a1000000-0000-4000-8000-000000000002', 1), 'a1b00000-0000-4000-8000-0000000000c1',
       public.t_acct('QA Bank'), public.t_today(), 90000, 10000, 0) $$,
  'A pays L2 EMI 1');
-- Bank 900,000; loan -1,000,000 + 90,000 - 30,000 = -940,000; Total 960,576 - 100,000 = 860,576; the added interest 30,000.
select results_eq(
  $$ select public.t_bal(public.t_acct('QA Bank')), public.t_bal(public.t_loan_account('a1000000-0000-4000-8000-000000000002')),
            public.t_total(), public.t_cap('a1000000-0000-4000-8000-000000000002'), public.t_parts(public.t_pay('a1b00000-0000-4000-8000-0000000000c1')) $$,
  $$ values (900000::bigint, -940000::bigint, 860576::bigint, 30000::bigint, 3::bigint) $$,
  'the 30,000 raises what is owed but is not money paid: Total available falls by 100,000 only');
-- L3 interest-only item 1 from the bank: 10,000.
select lives_ok(
  $$ select public.pay_due_item(public.t_due('a1000000-0000-4000-8000-000000000003', 1, 'loan_interest'), 'a1b00000-0000-4000-8000-0000000000c3',
       public.t_acct('QA Bank'), public.t_today(), 0, 10000, 0) $$,
  'A pays a monthly moratorium interest item');
select results_eq(
  $$ select public.t_bal(public.t_loan_account('a1000000-0000-4000-8000-000000000003')), public.t_total(),
            (select count(*)::int from public.transactions where due_payment_id = public.t_pay('a1b00000-0000-4000-8000-0000000000c3') and type = 'transfer'),
            (select status from public.due_items where id = public.t_due('a1000000-0000-4000-8000-000000000003', 1, 'loan_interest')),
            (select status from public.due_items where id = public.t_due('a1000000-0000-4000-8000-000000000003', 1)) $$,
  $$ values (-1000000::bigint, 850576::bigint, 0, 'paid'::text, 'pending'::text) $$,
  'interest-only: an expense, no principal moved, the loan''s balance unchanged, the first EMI still pending');

-- Void L2's payment: the added interest goes with it.
select lives_ok(
  $$ select public.void_due_payment(public.t_pay('a1b00000-0000-4000-8000-0000000000c1'), 'a1c00000-0000-4000-8000-0000000000c1') $$,
  'A voids L2 EMI 1''s payment');
select results_eq(
  $$ select public.t_bal(public.t_acct('QA Bank')), public.t_bal(public.t_loan_account('a1000000-0000-4000-8000-000000000002')),
            public.t_cap('a1000000-0000-4000-8000-000000000002'), public.t_total() $$,
  $$ values (990000::bigint, -1000000::bigint, 0::bigint, 950576::bigint) $$,
  'bank, loan and the added interest are all back');
-- 5: a stale retry of the paid request after the void posts nothing.
select is((select (public.pay_due_item(public.t_due('a1000000-0000-4000-8000-000000000002', 1), 'a1b00000-0000-4000-8000-0000000000c1',
             public.t_acct('QA Bank'), public.t_today(), 90000, 10000, 0)).id),
  public.t_pay('a1b00000-0000-4000-8000-0000000000c1'), 'a retry of the voided payment''s request returns it');
select results_eq(
  $$ select public.t_parts(public.t_pay('a1b00000-0000-4000-8000-0000000000c1')), public.t_total(), public.t_cap('a1000000-0000-4000-8000-000000000002') $$,
  $$ values (0::bigint, 950576::bigint, 0::bigint) $$,
  '... and posts nothing again');
select lives_ok(
  $$ select public.pay_due_item(public.t_due('a1000000-0000-4000-8000-000000000002', 1), 'a1b00000-0000-4000-8000-0000000000c2',
       public.t_acct('QA Bank'), public.t_today(), 90000, 10000, 0) $$,
  'EMI 1 is paid again under a new request key');
select results_eq(
  $$ select public.t_cap('a1000000-0000-4000-8000-000000000002'), public.t_bal(public.t_loan_account('a1000000-0000-4000-8000-000000000002')), public.t_total(),
            (select capitalised_minor from public.due_payments where id = public.t_pay('a1b00000-0000-4000-8000-0000000000c2')) $$,
  $$ values (30000::bigint, -940000::bigint, 850576::bigint, 30000::bigint) $$,
  'the 30,000 is added again, once, with the new payment');
select is(public.t_orphans(), 0::bigint, 'no entry disagrees with its payment');

-- ------------------------------------------------------------ 3: direct writes are refused
select throws_ok($$ delete from public.loans $$, '42501', null, 'loans cannot be deleted by a client');
select throws_ok($$ delete from public.due_items $$, '42501', null, 'due items cannot be deleted by a client');
select throws_ok($$ delete from public.due_payments $$, '42501', null, 'payments cannot be deleted by a client');
select throws_ok($$ delete from public.accounts where kind = 'loan' $$, '42501', null, 'loan accounts cannot be deleted by a client');
select throws_ok($$ delete from public.transactions where due_payment_id is not null $$, '42501', null, 'payment entries cannot be deleted by a client');
select throws_ok($$ update public.transactions set amount_minor = 1 where due_payment_id is not null $$, '42501', null,
  'the amount of a payment''s entry cannot be changed');
select throws_ok($$ update public.transactions set voided_at = now() where due_payment_id is not null and voided_at is null $$, 'FC032', null,
  'a payment''s entry cannot be voided on its own');
select throws_ok($$ update public.accounts set archived_at = now() where kind = 'loan' $$, 'FC032', null, 'a loan account cannot be archived directly');
select throws_ok($$ update public.loans set archived_at = now() $$, 'FC032', null, 'a loan cannot be archived directly');
select throws_ok($$ update public.loans set emi_minor = 1 $$, 'FC032', null, 'a loan''s EMI cannot be changed directly');
select throws_ok($$ update public.loans set tracking_started_on = tracking_started_on - 5 $$, '42501', null, 'tracking cannot be moved back');
select throws_ok($$ update public.due_payments set paid_on = paid_on - 1 $$, '42501', null, 'a payment''s date cannot be changed directly');
select throws_ok(
  $$ select public.record_transaction('transfer', 'a1e00000-0000-4000-8000-000000000001', 100, public.t_today(),
       public.t_loan_account('a1000000-0000-4000-8000-000000000001'), p_counter_account_id => public.t_acct('QA Bank')) $$,
  'FC032', null, 'money cannot be moved out of a loan account either');

-- ------------------------------------------------------------ 7 + 6: archive, void, delete
-- L5: one payment, then voided.
select lives_ok(
  $$ select public.t_create('a1000000-0000-4000-8000-000000000005', 'QA Small', null, 'ongoing', 100000, 3, public.t_month_start(), null, p_emi => 34000) $$,
  'A adds L5');
select lives_ok(
  $$ select public.pay_due_item(public.t_due('a1000000-0000-4000-8000-000000000005', 1), 'a1b00000-0000-4000-8000-0000000000e1',
       public.t_acct('QA Bank'), public.t_today(), 30000, 4000, 0) $$,
  'A pays L5 EMI 1');
select lives_ok(
  $$ select public.void_due_payment(public.t_pay('a1b00000-0000-4000-8000-0000000000e1'), 'a1c00000-0000-4000-8000-0000000000e1') $$,
  '... and voids it');
select lives_ok($$ select public.set_loan_archived(public.t_loan('a1000000-0000-4000-8000-000000000005'), true) $$, 'A archives L5');
select throws_ok($$ select public.delete_loan(public.t_loan('a1000000-0000-4000-8000-000000000005')) $$, 'FC040', null,
  'an archived loan whose only payment is voided is not deleted (the history stays)');
select results_eq(
  $$ select (select count(*)::int from public.loans where idempotency_key = 'a1000000-0000-4000-8000-000000000005'),
            (select count(*)::int from public.due_items where loan_id = public.t_loan('a1000000-0000-4000-8000-000000000005')),
            (select count(*)::int from public.transactions where due_payment_id = public.t_pay('a1b00000-0000-4000-8000-0000000000e1')) $$,
  $$ values (1, 3, 2) $$,
  'the refused delete removed nothing: the loan, 3 EMIs and the 2 voided entries remain');
select throws_ok($$ select public.delete_loan(gen_random_uuid()) $$, 'FC008', null, 'deleting a loan that does not exist is refused');
-- Voiding on an archived loan.
select lives_ok($$ select public.set_loan_archived(public.t_loan('a1000000-0000-4000-8000-000000000002'), true) $$, 'A archives L2');
select throws_ok(
  $$ select public.void_due_payment(public.t_pay('a1b00000-0000-4000-8000-0000000000c2'), 'a1c00000-0000-4000-8000-0000000000c2') $$,
  'FC033', null, 'a payment of an archived loan cannot be voided');
select throws_ok(
  $$ select public.edit_due_payment(public.t_pay('a1b00000-0000-4000-8000-0000000000c2'), 'a1d00000-0000-4000-8000-0000000000c2',
       public.t_acct('QA Bank'), public.t_today(), 80000, 20000, 0) $$,
  'FC033', null, '... or edited');
select lives_ok($$ select public.set_loan_archived(public.t_loan('a1000000-0000-4000-8000-000000000002'), false) $$, 'A restores L2');
select is(public.t_orphans(), 0::bigint, 'no entry disagrees with its payment at the end');

-- ------------------------------------------------------------ 4: as B
reset role;
create temporary table t_ids on commit drop as
  select (select id from public.loans where idempotency_key = 'a1000000-0000-4000-8000-000000000001') as loan_id,
         (select account_id from public.loans where idempotency_key = 'a1000000-0000-4000-8000-000000000001') as loan_account_id,
         (select id from public.due_payments where idempotency_key = 'a1b00000-0000-4000-8000-0000000000c2') as pay_id,
         (select id from public.due_items where kind = 'loan_emi' and seq = 5
            and loan_id = (select id from public.loans where idempotency_key = 'a1000000-0000-4000-8000-000000000001')) as due_id;
grant select on t_ids to authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
set local role authenticated;

select results_eq(
  $$ select (select count(*)::int from public.loans), (select count(*)::int from public.due_items), (select count(*)::int from public.due_payments),
            (select count(*)::int from public.accounts), (select count(*)::int from public.transactions), (select count(*)::int from public.account_balances) $$,
  $$ values (0, 0, 0, 0, 0, 0) $$,
  'B reads none of A''s loans, instalments, payments, accounts, entries or balances');
select throws_ok(
  $$ select public.edit_due_payment((select pay_id from t_ids), gen_random_uuid(), gen_random_uuid(), current_date, 1, 0, 0) $$,
  'FC008', null, 'B cannot edit A''s payment');
select lives_ok(
  $$ update public.loans set nickname = 'hacked';
     update public.due_items set planned_on = null, planned_account_id = null;
     update public.due_payments set void_reason = 'hacked';
     update public.transactions set void_reason = 'hacked';
     update public.accounts set name = 'hacked' $$,
  'B''s direct updates run against no rows (RLS hides A''s)');

-- B's own loan, paid under a request key A also used: keys are per user.
insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
  values ('bank', 'savings', 'QA B Bank', 'INR', 100000, public.t_today() - 30);
select lives_ok(
  $$ select public.t_create('a1000000-0000-4000-8000-000000000001', 'QA B Lender', null, 'ongoing', 100000, 3, public.t_month_start(), null, p_emi => 34000) $$,
  'B adds a loan under a request key A used');
select lives_ok(
  $$ select public.pay_due_item(public.t_due('a1000000-0000-4000-8000-000000000001', 1), 'a1b00000-0000-4000-8000-000000000001',
       public.t_acct('QA B Bank'), public.t_today(), 30000, 4000, 0) $$,
  'B pays its EMI under a payment key A used');
-- Bank 100,000 - 34,000 = 66,000; loan -100,000 + 30,000 = -70,000. Total available is B's alone.
select results_eq(
  $$ select public.t_bal(public.t_acct('QA B Bank')), public.t_total(), (select count(*)::int from public.due_payments) $$,
  $$ values (66000::bigint, 66000::bigint, 1) $$,
  'B''s totals and payments are B''s own');

reset role;
select results_eq(
  $$ select (select count(*)::int from public.loans where nickname = 'hacked' or lender = 'hacked'),
            (select count(*)::int from public.due_payments where void_reason = 'hacked'),
            (select count(*)::int from public.transactions where void_reason = 'hacked'),
            (select count(*)::int from public.accounts where name = 'hacked'),
            (select count(*)::int from public.due_payments where idempotency_key = 'a1b00000-0000-4000-8000-000000000001') $$,
  $$ values (0, 0, 0, 0, 2) $$,
  'nothing of A''s was changed by B; each user has one payment under the shared key');

-- ------------------------------------------------------------ anon
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select count(*) from public.due_payments $$, '42501', null, 'anon cannot read payments');
select throws_ok($$ select count(*) from public.transactions $$, '42501', null, 'anon cannot read entries');
select throws_ok($$ select count(*) from public.accounts $$, '42501', null, 'anon cannot read accounts');
select throws_ok($$ select public.pay_due_item(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), current_date, 1, 0, 0) $$,
  '42501', null, 'anon cannot pay an EMI');
select throws_ok($$ select public.void_due_payment(gen_random_uuid(), gen_random_uuid()) $$, '42501', null, 'anon cannot void a payment');
select throws_ok($$ select public.edit_due_payment(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), current_date, 1, 0, 0) $$,
  '42501', null, 'anon cannot edit a payment');
select throws_ok($$ select public.delete_loan(gen_random_uuid()) $$, '42501', null, 'anon cannot delete a loan');
select throws_ok($$ select public.set_loan_archived(gen_random_uuid(), true) $$, '42501', null, 'anon cannot archive a loan');
select throws_ok($$ select public.update_loan(gen_random_uuid(), 'home', 'X', 1, 0, 'fixed', 1) $$, '42501', null, 'anon cannot edit a loan');
select throws_ok($$ insert into public.due_payments (due_item_id, account_id, paid_on, principal_minor, idempotency_key)
                    values (gen_random_uuid(), gen_random_uuid(), current_date, 1, gen_random_uuid()) $$,
  '42501', null, 'anon cannot add a payment');

reset role;
select * from finish();
rollback;
