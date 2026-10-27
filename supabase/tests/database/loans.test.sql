-- pgTAP tests for loans, due items and payments (migration 20261028120000). Run with
-- `supabase test db` (CI). Everything is rolled back. Dates parity: loan_dates_parity.test.sql.
begin;
create extension if not exists pgtap with schema extensions;

select plan(127);

-- Users A (Asia/Kolkata, the default) and B (UTC-11), fictional.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bala@example.test');
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
create function public.t_caps(p_key uuid) returns bigint language sql stable set search_path = ''
  as $$ select count(*) from public.transactions as t
        where t.account_id = public.t_loan_account(p_key) and t.type = 'expense' and t.voided_at is null $$;
grant execute on function public.t_today(), public.t_month_start(), public.t_loan(uuid), public.t_loan_account(uuid),
  public.t_due(uuid, integer, text), public.t_acct(text), public.t_pay(uuid), public.t_bal(uuid), public.t_parts(uuid),
  public.t_caps(uuid) to authenticated;

-- A loan as create_loan takes it (figures as the domain would send them).
create function public.t_create(
  p_key uuid, p_lender text, p_nickname text, p_start_mode text, p_outstanding bigint, p_months integer,
  p_first date, p_before date, p_moratorium integer default 0, p_mor_interest text default null,
  p_capitalised bigint default 0, p_mor_monthly bigint default 0, p_emi bigint default 44424, p_type text default 'home'
) returns public.loans language sql set search_path = ''
  as $$ select * from public.create_loan(p_key, p_type, p_lender, 2000000, 1000000, 1200, 'floating', 24,
        p_start_mode, p_outstanding, p_months, p_first, p_emi, p_emi,
        p_nickname => p_nickname, p_before_tracking_on => p_before, p_moratorium_months => p_moratorium,
        p_moratorium_interest => p_mor_interest, p_capitalised_minor => p_capitalised, p_moratorium_interest_minor => p_mor_monthly) $$;
grant execute on function public.t_create(uuid, text, text, text, bigint, integer, date, date, integer, text, bigint, bigint, bigint, text) to authenticated;

-- ------------------------------------------------------------ privileges
select ok(not has_function_privilege('anon', 'public.create_loan(uuid, text, text, bigint, bigint, integer, text, integer, text, bigint, integer, date, bigint, bigint, text, text, date, integer, text, bigint, bigint)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.pay_due_item(uuid, uuid, uuid, date, bigint, bigint, bigint, boolean, uuid)', 'EXECUTE'),
  'anon cannot call the loan functions');
select ok(not has_function_privilege('authenticated', 'public.due_items_guard()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.transactions_liability_guard()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.loans_validate()', 'EXECUTE'),
  'clients cannot call the guard functions');
select ok(not has_column_privilege('authenticated', 'public.loans', 'user_id', 'INSERT')
          and not has_column_privilege('authenticated', 'public.due_payments', 'user_id', 'INSERT')
          and not has_column_privilege('authenticated', 'public.categories', 'system_key', 'UPDATE'),
  'clients cannot choose an owner or a system category key');

-- ------------------------------------------------------------ as A: accounts
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('bank', 'savings', 'HDFC Bank', 'INR', 10000000, public.t_today() - 30),
  ('bank', 'savings', 'Old bank', 'INR', 10000000, public.t_today() - 30),
  ('bank', 'savings', 'Spare', 'INR', 0, public.t_today() - 30),
  ('bank', 'savings', 'Late', 'INR', 10000000, public.t_today() - 1);
insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date) values
  ('cash', 'Cash in hand', 'INR', 5000, public.t_today() - 30),
  ('other', 'Wallet', 'INR', 3000, public.t_today() - 30);
update public.accounts set archived_at = now() where name = 'Old bank';
-- An archived expense category with the fees category's name (adopted on first use).
insert into public.categories (kind, name, icon) values ('expense', 'Loan fees & charges', 'bills');
update public.categories set archived_at = now() where name = 'Loan fees & charges';

-- ------------------------------------------------------------ create_loan
-- L1: ongoing, this month's EMI still due (dated the 1st, possibly already past).
select lives_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000001', 'HDFC Bank', null, 'ongoing', 500000, 12, public.t_month_start(), null) $$,
  'A adds an ongoing loan whose EMI this month is still due');
select results_eq(
  $$ select a.kind, a.name, a.institution, a.opening_balance_minor, a.opening_balance_date = public.t_today(), a.last4 is null
     from public.accounts as a where a.id = public.t_loan_account('1a000000-0000-4000-8000-000000000001') $$,
  $$ values ('loan'::text, 'HDFC Bank'::text, 'HDFC Bank'::text, -500000::bigint, true, true) $$,
  'its liability account holds minus what is owed, from today, with no number');
select results_eq(
  $$ select count(*)::int, min(seq), max(seq), bool_and(status = 'pending'), bool_and(amount_due_minor = 44424),
            bool_and(due_date = public.loan_due_date(public.t_month_start(), seq))
     from public.due_items where loan_id = public.t_loan('1a000000-0000-4000-8000-000000000001') $$,
  $$ values (12, 1, 12, true, true, true) $$,
  '12 pending EMIs at the EMI, monthly from the first date');
select is((select tracking_started_on from public.loans where id = public.t_loan('1a000000-0000-4000-8000-000000000001')), public.t_today(),
  'tracking starts today (server time, the person''s time zone)');
select is((select (public.t_create('1a000000-0000-4000-8000-000000000001', 'HDFC Bank', null, 'ongoing', 500000, 12, public.t_month_start(), null)).id),
  public.t_loan('1a000000-0000-4000-8000-000000000001'),
  'a retry with the same request key returns the same loan');
select is((select count(*)::int from public.loans), 1, '... and adds nothing');
select throws_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000001', 'HDFC Bank', null, 'ongoing', 400000, 12, public.t_month_start(), null) $$,
  'FC007', null, 'the same key for a different loan is refused');

-- L2: same lender, no nickname; this month's EMI already paid (EMI 0 before tracking).
select lives_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000002', ' HDFC   Bank ', null, 'ongoing', 300000, 6, public.t_today() + 10,
       public.loan_due_date(public.t_today() + 10, 0)) $$,
  'a second loan from the same lender, without a nickname');
select is((select count(*)::int from public.accounts where name = 'HDFC Bank'), 3,
  'account names need not be unique: a bank and two loan accounts share the lender''s name');
select results_eq(
  $$ select status, due_date from public.due_items where id = public.t_due('1a000000-0000-4000-8000-000000000002', 0) $$,
  $$ values ('before_tracking'::text, public.loan_due_date(public.t_today() + 10, 0)) $$,
  'this month''s EMI, already paid, is recorded as before tracking one month before the next');
select is((select count(*)::int from public.due_items where loan_id = public.t_loan('1a000000-0000-4000-8000-000000000002') and status = 'pending'), 6,
  'the 6 EMIs left are pending');
select throws_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000009', 'HDFC Bank', null, 'ongoing', 300000, 6, public.t_today(),
       public.loan_due_date(public.t_today(), 0)) $$,
  'FC043', null, 'with this month''s EMI paid, the next one must be after today');
select throws_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000009', 'HDFC Bank', null, 'ongoing', 300000, 6, public.t_month_start() - 1, null) $$,
  'FC043', null, 'a still-due EMI must be this month''s');
select throws_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000009', 'HDFC Bank', null, 'ongoing', 300000, 6, public.t_today() + 10,
       public.t_today()) $$,
  'FC043', null, 'the before-tracking date must be one month before the next EMI');
select throws_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000009', 'Avanse', null, 'starts_later', 1000000, 24, public.t_today(), null) $$,
  'FC043', null, 'a loan that starts later has its first EMI after today');

-- L3: starts later, moratorium interest capitalised.
select lives_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000003', 'Avanse Financial Services', 'Study loan', 'starts_later', 1000000, 24,
       public.t_today() + 60, null, 6, 'capitalise', 30000) $$,
  'a loan that starts later, with interest added when EMIs start');
select is((select name from public.accounts where id = public.t_loan_account('1a000000-0000-4000-8000-000000000003')), 'Study loan',
  'the nickname names the loan account');

-- L4: starts later, moratorium interest paid monthly (months already past are before tracking).
select lives_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000004', 'Credila Financial Services', null, 'starts_later', 1000000, 24,
       public.t_today() + 45, null, 4, 'pay_monthly', 0, 10000) $$,
  'a loan that starts later, with interest paid monthly');
select results_eq(
  $$ select count(*)::int, bool_and((due_date < public.t_today()) = (status = 'before_tracking')), bool_and(amount_due_minor = 10000),
            bool_and(due_date = public.loan_due_date(public.t_today() + 45, seq - 4))
     from public.due_items where loan_id = public.t_loan('1a000000-0000-4000-8000-000000000004') and kind = 'loan_interest' $$,
  $$ values (4, true, true, true) $$,
  'four interest-only months before the first EMI; past ones before tracking');
select throws_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000009', 'Credila', null, 'starts_later', 1000000, 24,
       public.t_today() + 45, null, 4, 'pay_monthly', 0, 0) $$,
  '22023', null, 'interest paid monthly needs its amount');
select throws_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000009', 'HDFC 12345', null, 'ongoing', 300000, 6, public.t_month_start(), null) $$,
  '23514', null, 'four digits in a row in the lender are refused (no card or loan numbers)');
select throws_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000009', 'HDFC Bank', 'Regalia 4111', 'ongoing', 300000, 6, public.t_month_start(), null, p_type => 'credit_card_emi') $$,
  '23514', null, '... and in the nickname');
select lives_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000005', 'HDFC Bank', 'HDFC Regalia', 'ongoing', 60000, 6, public.t_month_start(), null,
       p_emi => 10000, p_type => 'credit_card_emi') $$,
  'a credit card EMI is a loan (no-cost: EMI = amount / months)');

-- ------------------------------------------------------------ pay, from bank, cash and other
select lives_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 1), '1b000000-0000-4000-8000-000000000001',
       public.t_acct('HDFC Bank'), public.t_today(), 39424, 5000, 0) $$,
  'A pays EMI 1 from a bank account');
select results_eq(
  $$ select t.type, t.account_id = public.t_acct('HDFC Bank'), t.counter_account_id is not distinct from public.t_loan_account('1a000000-0000-4000-8000-000000000001'),
            t.amount_minor, c.system_key
     from public.transactions as t left join public.categories as c on c.id = t.category_id
     where t.due_payment_id = public.t_pay('1b000000-0000-4000-8000-000000000001') order by t.type desc $$,
  $$ values ('transfer'::text, true, true, 39424::bigint, null::text), ('expense', true, false, 5000, 'loan_interest') $$,
  'principal is a transfer to the loan account; interest is an expense in "Loan interest"');
select results_eq(
  $$ select public.t_bal(public.t_acct('HDFC Bank')), public.t_bal(public.t_loan_account('1a000000-0000-4000-8000-000000000001')),
            (select status from public.due_items where id = public.t_due('1a000000-0000-4000-8000-000000000001', 1)) $$,
  $$ values (9955576::bigint, -460576::bigint, 'paid'::text) $$,
  'the bank pays the whole EMI; what is owed falls by the principal only; the EMI is paid');
select is((select (public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 1), '1b000000-0000-4000-8000-000000000001',
             public.t_acct('HDFC Bank'), public.t_today(), 39424, 5000, 0)).id),
  public.t_pay('1b000000-0000-4000-8000-000000000001'), 'a double submit returns the same payment');
select is(public.t_parts(public.t_pay('1b000000-0000-4000-8000-000000000001')), 2::bigint, '... and posts nothing more');
select throws_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 1), '1b000000-0000-4000-8000-000000000001',
       public.t_acct('HDFC Bank'), public.t_today(), 39000, 5424, 0) $$,
  'FC007', null, 'the same key with a different split is refused');
select throws_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 1), '1b000000-0000-4000-8000-0000000000ff',
       public.t_acct('HDFC Bank'), public.t_today(), 39424, 5000, 0) $$,
  'FC034', null, 'a paid EMI cannot be paid again');

select throws_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 2), '1b000000-0000-4000-8000-000000000002',
       public.t_acct('Cash in hand'), public.t_today(), 39424, 5000, 0) $$,
  'FC035', null, 'cash that can''t cover the EMI: refused without "Pay anyway"');
select lives_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 2), '1b000000-0000-4000-8000-000000000002',
       public.t_acct('Cash in hand'), public.t_today(), 39424, 5000, 0, p_allow_shortfall => true) $$,
  '... and allowed with it, under the same request key');
select is(public.t_bal(public.t_acct('Cash in hand')), -39424::bigint, 'cash went below zero, as the person chose');

select lives_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 3), '1b000000-0000-4000-8000-000000000003',
       public.t_acct('Wallet'), public.t_today(), 0, 1000, 500) $$,
  'an other account pays interest and fees only');
select results_eq(
  $$ select c.system_key, t.amount_minor from public.transactions as t join public.categories as c on c.id = t.category_id
     where t.due_payment_id = public.t_pay('1b000000-0000-4000-8000-000000000003') order by t.amount_minor desc $$,
  $$ values ('loan_interest'::text, 1000::bigint), ('loan_fees', 500) $$,
  'interest and fees are separate expenses');
select results_eq(
  $$ select count(*)::int, bool_and(archived_at is null), bool_and(system_key = 'loan_fees')
     from public.categories where name = 'Loan fees & charges' $$,
  $$ values (1, true, true) $$,
  'the archived category with the fees name was adopted and restored, not duplicated');
select is(public.t_bal(public.t_acct('Wallet')), 1500::bigint, 'the other account paid 1,500 paise');

select throws_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 4), '1b000000-0000-4000-8000-000000000004',
       public.t_acct('HDFC Bank'), public.t_today(), 999999999, 0, 0, true) $$,
  'FC037', null, 'principal above what is owed is refused');
select throws_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 4), '1b000000-0000-4000-8000-000000000004',
       public.t_acct('HDFC Bank'), public.t_today() - 1, 39424, 5000, 0) $$,
  'FC036', null, 'a payment dated before the loan was added is refused');
select throws_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 4), '1b000000-0000-4000-8000-000000000004',
       public.t_acct('HDFC Bank'), public.t_today() + 1, 39424, 5000, 0) $$,
  'FC003', null, 'a payment dated in the future is refused');
select throws_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 4), '1b000000-0000-4000-8000-000000000004',
       public.t_loan_account('1a000000-0000-4000-8000-000000000002'), public.t_today(), 39424, 5000, 0) $$,
  'FC038', null, 'a loan account cannot pay');
select throws_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 4), '1b000000-0000-4000-8000-000000000004',
       public.t_acct('Old bank'), public.t_today(), 39424, 5000, 0) $$,
  'FC001', null, 'an archived account cannot pay');
select throws_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 4), '1b000000-0000-4000-8000-000000000004',
       public.t_acct('HDFC Bank'), public.t_today(), 0, 0, 0) $$,
  '23514', null, 'a payment of nothing is refused');
select throws_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000002', 0), '1b000000-0000-4000-8000-000000000004',
       public.t_acct('HDFC Bank'), public.t_today(), 1000, 0, 0) $$,
  'FC034', null, 'an EMI paid before tracking never posts');

-- FC039: the loan was added before the paying account's opening date (the test owner
-- moves tracking back; the trigger refuses that to everyone else).
reset role;
alter table public.loans disable trigger loans_validate;
update public.loans set tracking_started_on = tracking_started_on - 20 where id = public.t_loan('1a000000-0000-4000-8000-000000000002');
alter table public.loans enable trigger loans_validate;
set local role authenticated;
select throws_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000002', 1), '1b000000-0000-4000-8000-000000000005',
       public.t_acct('Late'), public.t_today() - 5, 1000, 0, 0) $$,
  'FC039', null, 'a payment dated before the paying account''s opening balance is refused');

-- ------------------------------------------------------------ void and edit move all parts
select lives_ok(
  $$ select public.void_due_payment(public.t_pay('1b000000-0000-4000-8000-000000000001'), '1c000000-0000-4000-8000-000000000001', 'Wrong account') $$,
  'A voids the payment of EMI 1');
select results_eq(
  $$ select public.t_parts(public.t_pay('1b000000-0000-4000-8000-000000000001')),
            (select status from public.due_items where id = public.t_due('1a000000-0000-4000-8000-000000000001', 1)),
            public.t_bal(public.t_acct('HDFC Bank')), public.t_bal(public.t_loan_account('1a000000-0000-4000-8000-000000000001')) $$,
  $$ values (0::bigint, 'pending'::text, 10000000::bigint, -500000::bigint) $$,
  'every part is voided: the EMI is pending, the bank and the loan are back');
select lives_ok(
  $$ select public.void_due_payment(public.t_pay('1b000000-0000-4000-8000-000000000001'), '1c000000-0000-4000-8000-000000000001') $$,
  'a retried void returns the voided payment');
select throws_ok(
  $$ select public.void_due_payment(public.t_pay('1b000000-0000-4000-8000-000000000001'), '1c000000-0000-4000-8000-0000000000ff') $$,
  'FC005', null, 'voiding it again with another key is refused');

select lives_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000001', 1), '1b000000-0000-4000-8000-000000000011',
       public.t_acct('HDFC Bank'), public.t_today(), 39424, 5000, 0) $$,
  'EMI 1 is paid again');
select lives_ok(
  $$ select public.edit_due_payment(public.t_pay('1b000000-0000-4000-8000-000000000011'), '1d000000-0000-4000-8000-000000000001',
       public.t_acct('HDFC Bank'), public.t_today(), 30000, 5000, 1000) $$,
  'A edits the payment''s split');
select results_eq(
  $$ select public.t_parts(public.t_pay('1b000000-0000-4000-8000-000000000011')), public.t_parts(public.t_pay('1d000000-0000-4000-8000-000000000001')),
            (select replaces_id from public.due_payments where id = public.t_pay('1d000000-0000-4000-8000-000000000001')) = public.t_pay('1b000000-0000-4000-8000-000000000011'),
            public.t_bal(public.t_acct('HDFC Bank')), public.t_bal(public.t_loan_account('1a000000-0000-4000-8000-000000000001')) $$,
  $$ values (0::bigint, 3::bigint, true, 9964000::bigint, -470000::bigint) $$,
  'the old parts are all voided and the new three posted, linked to the old payment');
select is((select (public.edit_due_payment(public.t_pay('1b000000-0000-4000-8000-000000000011'), '1d000000-0000-4000-8000-000000000001',
             public.t_acct('HDFC Bank'), public.t_today(), 30000, 5000, 1000)).id),
  public.t_pay('1d000000-0000-4000-8000-000000000001'), 'a retried edit returns the saved payment');
select throws_ok(
  $$ select public.edit_due_payment(public.t_pay('1d000000-0000-4000-8000-000000000001'), '1d000000-0000-4000-8000-000000000002',
       public.t_acct('HDFC Bank'), public.t_today(), 30000, 5000, 1000) $$,
  'FC017', null, 'an edit that changes nothing is refused');
select throws_ok(
  $$ select public.edit_due_payment(public.t_pay('1b000000-0000-4000-8000-000000000011'), '1d000000-0000-4000-8000-000000000003',
       public.t_acct('HDFC Bank'), public.t_today(), 1, 0, 0) $$,
  'FC014', null, 'editing a replaced payment is stale');
select throws_ok(
  $$ select public.void_due_payment(public.t_pay('1b000000-0000-4000-8000-000000000011'), '1c000000-0000-4000-8000-000000000002') $$,
  'FC014', null, 'voiding a replaced payment is stale');
select throws_ok(
  $$ select public.edit_due_payment(public.t_pay('1d000000-0000-4000-8000-000000000001'), '1d000000-0000-4000-8000-000000000004',
       public.t_acct('Cash in hand'), public.t_today(), 30000, 5000, 1000) $$,
  'FC035', null, 'an edit onto an account that can''t cover it needs "Pay anyway"');
select lives_ok(
  $$ select public.edit_due_payment(public.t_pay('1d000000-0000-4000-8000-000000000001'), '1d000000-0000-4000-8000-000000000004',
       public.t_acct('HDFC Bank'), public.t_today(), 30000, 4000, 2000, p_allow_shortfall => false) $$,
  'an edit within the balance goes through');

-- The ledger functions can't split a payment, and nothing reaches a loan account directly.
select throws_ok(
  $$ select public.void_transaction((select id from public.transactions where due_payment_id = public.t_pay('1d000000-0000-4000-8000-000000000004') and type = 'transfer'),
       '1e000000-0000-4000-8000-000000000001') $$,
  'FC032', null, 'void_transaction cannot void one part of a payment');
select throws_ok(
  $$ select public.edit_transaction((select id from public.transactions where due_payment_id = public.t_pay('1d000000-0000-4000-8000-000000000004') and type = 'expense' limit 1),
       '1e000000-0000-4000-8000-000000000002', 1, public.t_today(), public.t_acct('HDFC Bank'),
       (select id from public.categories where system_key = 'loan_interest')) $$,
  'FC032', null, 'edit_transaction cannot change one part of a payment');
select throws_ok(
  $$ select public.record_transaction('transfer', '1e000000-0000-4000-8000-000000000003', 100, public.t_today(), public.t_acct('HDFC Bank'),
       p_counter_account_id => public.t_loan_account('1a000000-0000-4000-8000-000000000001')) $$,
  'FC032', null, 'a transfer into a loan account is recorded only by paying an EMI');
select throws_ok(
  $$ select public.record_transaction('expense', '1e000000-0000-4000-8000-000000000004', 100, public.t_today(),
       public.t_loan_account('1a000000-0000-4000-8000-000000000001'), (select id from public.categories where system_key = 'loan_interest')) $$,
  'FC032', null, 'an expense on a loan account is refused');
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key, due_payment_id)
     values ('expense', 1, 'INR', public.t_acct('HDFC Bank'), (select id from public.categories where system_key = 'loan_interest'), public.t_today(),
             '1e000000-0000-4000-8000-000000000005', public.t_pay('1d000000-0000-4000-8000-000000000004')) $$,
  'FC032', null, 'an entry cannot join a payment directly');
select throws_ok(
  $$ insert into public.recurring_rules (type, amount_minor, currency, account_id, counter_account_id, frequency, start_date, idempotency_key)
     values ('transfer', 100, 'INR', public.t_acct('HDFC Bank'), public.t_loan_account('1a000000-0000-4000-8000-000000000001'), 'monthly',
             public.t_today(), '1e000000-0000-4000-8000-000000000006') $$,
  'FC032', null, 'a recurring item cannot use a loan account');

-- ------------------------------------------------------------ capitalised interest
select lives_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000003', 1), '1f000000-0000-4000-8000-000000000001',
       public.t_acct('HDFC Bank'), public.t_today(), 10000, 1000, 0) $$,
  'the first EMI of a capitalised loan is paid');
select results_eq(
  $$ select public.t_caps('1a000000-0000-4000-8000-000000000003'),
            (select capitalised_minor from public.due_payments where id = public.t_pay('1f000000-0000-4000-8000-000000000001')),
            public.t_bal(public.t_loan_account('1a000000-0000-4000-8000-000000000003')) $$,
  $$ values (1::bigint, 30000::bigint, -1020000::bigint) $$,
  'the moratorium interest is added to the loan once, with it');
select lives_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000003', 2), '1f000000-0000-4000-8000-000000000002',
       public.t_acct('HDFC Bank'), public.t_today(), 10000, 1000, 0) $$,
  'the second EMI is paid');
select is(public.t_caps('1a000000-0000-4000-8000-000000000003'), 1::bigint, '... without adding the interest again');
select lives_ok(
  $$ select public.void_due_payment(public.t_pay('1f000000-0000-4000-8000-000000000001'), '1f000000-0000-4000-8000-0000000000a1') $$,
  'the first EMI''s payment is voided');
select is(public.t_caps('1a000000-0000-4000-8000-000000000003'), 0::bigint, '... and the added interest with it');
select lives_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000003', 3), '1f000000-0000-4000-8000-000000000003',
       public.t_acct('HDFC Bank'), public.t_today(), 10000, 1000, 0) $$,
  'another EMI is paid');
select results_eq(
  $$ select public.t_caps('1a000000-0000-4000-8000-000000000003'),
            (select capitalised_minor from public.due_payments where id = public.t_pay('1f000000-0000-4000-8000-000000000003')) $$,
  $$ values (1::bigint, 30000::bigint) $$,
  'the interest is added again, once, with the next EMI paid');
select throws_ok(
  $$ select public.pay_due_item(public.t_due('1a000000-0000-4000-8000-000000000003', 4), '1f000000-0000-4000-8000-000000000004',
       public.t_acct('HDFC Bank'), public.t_today(), 1010001, 0, 0) $$,
  'FC037', null, 'what is owed includes the added interest, no more');

-- ------------------------------------------------------------ will pay later
select lives_ok(
  $$ update public.due_items set planned_on = public.t_today() + 1, planned_account_id = public.t_acct('HDFC Bank')
     where id = public.t_due('1a000000-0000-4000-8000-000000000001', 5) $$,
  'A plans to pay EMI 5 tomorrow from the bank');
select is((select status from public.due_items where id = public.t_due('1a000000-0000-4000-8000-000000000001', 5)), 'pending',
  'a planned EMI stays pending');
select throws_ok(
  $$ update public.due_items set planned_on = public.t_today() - 1, planned_account_id = public.t_acct('HDFC Bank')
     where id = public.t_due('1a000000-0000-4000-8000-000000000001', 6) $$,
  'FC041', null, 'a planned date in the past is refused');
select throws_ok(
  $$ update public.due_items set planned_on = public.t_today(), planned_account_id = public.t_loan_account('1a000000-0000-4000-8000-000000000002')
     where id = public.t_due('1a000000-0000-4000-8000-000000000001', 6) $$,
  'FC038', null, 'a loan account cannot be the planned account');
select throws_ok(
  $$ update public.due_items set planned_on = public.t_today(), planned_account_id = public.t_acct('HDFC Bank')
     where id = public.t_due('1a000000-0000-4000-8000-000000000001', 1) $$,
  'FC034', null, 'a paid EMI cannot be planned');
select throws_ok(
  $$ update public.due_items set planned_on = public.t_today() where id = public.t_due('1a000000-0000-4000-8000-000000000001', 6) $$,
  '23514', null, 'a planned date needs an account');

-- ------------------------------------------------------------ direct writes are refused
select throws_ok(
  $$ update public.due_items set status = 'paid' where id = public.t_due('1a000000-0000-4000-8000-000000000001', 6) $$,
  'FC032', null, 'a due item''s status changes only by paying');
select throws_ok(
  $$ update public.due_items set amount_due_minor = 1 where id = public.t_due('1a000000-0000-4000-8000-000000000001', 6) $$,
  'FC032', null, '... and its amount only through the loan');
select throws_ok(
  $$ update public.due_items set due_date = due_date + 1 where id = public.t_due('1a000000-0000-4000-8000-000000000001', 6) $$,
  '42501', null, 'its due date cannot change (no grant)');
select throws_ok(
  $$ insert into public.due_items (kind, loan_id, seq, due_date, amount_due_minor, currency)
     values ('loan_emi', public.t_loan('1a000000-0000-4000-8000-000000000001'), 99, public.t_today(), 1, 'INR') $$,
  'FC032', null, 'due items cannot be added directly');
select throws_ok(
  $$ insert into public.loans (account_id, loan_type, lender, currency, sanctioned_minor, disbursed_minor, rate_bps, tenure_months, start_mode,
       opening_outstanding_minor, instalment_months, first_due_date, emi_estimate_minor, emi_minor, tracking_started_on, idempotency_key)
     values (public.t_acct('HDFC Bank'), 'home', 'X', 'INR', 1, 1, 0, 1, 'ongoing', 1, 1, public.t_today(), 1, 1, public.t_today(), gen_random_uuid()) $$,
  'FC032', null, 'loans cannot be added directly');
select throws_ok(
  $$ update public.loans set nickname = 'Mine' where id = public.t_loan('1a000000-0000-4000-8000-000000000001') $$,
  'FC032', null, 'loans cannot be changed directly');
select throws_ok(
  $$ insert into public.due_payments (due_item_id, account_id, paid_on, principal_minor, idempotency_key)
     values (public.t_due('1a000000-0000-4000-8000-000000000001', 6), public.t_acct('HDFC Bank'), public.t_today(), 1, gen_random_uuid()) $$,
  'FC032', null, 'payments cannot be added directly');
select throws_ok(
  $$ update public.due_payments set voided_at = now(), void_idempotency_key = gen_random_uuid()
     where id = public.t_pay('1b000000-0000-4000-8000-000000000003') $$,
  'FC032', null, 'payments cannot be voided directly');
select throws_ok(
  $$ insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date) values ('loan', 'Mine', 'INR', -1, public.t_today()) $$,
  'FC032', null, 'loan accounts cannot be added directly');
select throws_ok(
  $$ update public.accounts set opening_balance_minor = 0 where id = public.t_loan_account('1a000000-0000-4000-8000-000000000001') $$,
  'FC032', null, 'a loan account cannot be changed directly');

-- ------------------------------------------------------------ update_loan and the loan categories
select lives_ok(
  $$ select public.update_loan(public.t_loan('1a000000-0000-4000-8000-000000000001'), 'home', 'HDFC Bank', 2000000, 1150, 'floating', 50000, p_nickname => 'Flat') $$,
  'A changes the nickname, rate and EMI');
select results_eq(
  $$ select bool_and(amount_due_minor = 50000) filter (where status = 'pending'), bool_and(amount_due_minor = 44424) filter (where status = 'paid')
     from public.due_items where loan_id = public.t_loan('1a000000-0000-4000-8000-000000000001') $$,
  $$ values (true, true) $$,
  'pending EMIs follow the new EMI; paid ones keep theirs');
select is((select name from public.accounts where id = public.t_loan_account('1a000000-0000-4000-8000-000000000001')), 'Flat',
  'the loan account takes the nickname');
select throws_ok(
  $$ select public.update_loan(public.t_loan('1a000000-0000-4000-8000-000000000001'), 'home', 'HDFC Bank', 2000000, 1150, 'floating', 50000, p_nickname => 'Card 1234') $$,
  '23514', null, 'four digits in a row are refused on edit too');
select throws_ok(
  $$ update public.categories set archived_at = now() where system_key = 'loan_interest' $$,
  'FC042', null, 'the loan categories cannot be archived');
select is(public.loan_category_id('loan_interest'), (select id from public.categories where system_key = 'loan_interest'),
  'loan_category_id returns the existing category');
select throws_ok($$ select public.loan_category_id('rent') $$, '22023', null, 'an unknown key is refused');

-- ------------------------------------------------------------ archive and delete
select lives_ok($$ select public.set_loan_archived(public.t_loan('1a000000-0000-4000-8000-000000000004'), true) $$, 'A archives L4');
select results_eq(
  $$ select l.archived_at is not null, a.archived_at is not null from public.loans as l join public.accounts as a on a.id = l.account_id
     where l.id = public.t_loan('1a000000-0000-4000-8000-000000000004') $$,
  $$ values (true, true) $$,
  'the loan and its account are archived together');
select throws_ok(
  $$ select public.pay_due_item((select id from public.due_items where loan_id = public.t_loan('1a000000-0000-4000-8000-000000000004') and status = 'pending' limit 1),
       '1b000000-0000-4000-8000-000000000041', public.t_acct('HDFC Bank'), public.t_today(), 0, 10000, 0) $$,
  'FC033', null, 'an archived loan cannot be paid (its reminders are hidden)');
select throws_ok(
  $$ update public.due_items set planned_on = public.t_today(), planned_account_id = public.t_acct('HDFC Bank')
     where id = (select id from public.due_items where loan_id = public.t_loan('1a000000-0000-4000-8000-000000000004') and status = 'pending' limit 1) $$,
  'FC033', null, '... or planned');
select throws_ok(
  $$ select public.update_loan(public.t_loan('1a000000-0000-4000-8000-000000000004'), 'education', 'Credila', 2000000, 1200, 'fixed', 44424) $$,
  'FC033', null, '... or edited');
select throws_ok($$ select public.delete_loan(public.t_loan('1a000000-0000-4000-8000-000000000001')) $$, 'FC044', null, 'an active loan cannot be deleted');
select lives_ok($$ select public.delete_loan(public.t_loan('1a000000-0000-4000-8000-000000000004')) $$, 'an archived loan never paid is deleted');
select results_eq(
  $$ select (select count(*)::int from public.loans where idempotency_key = '1a000000-0000-4000-8000-000000000004'),
            (select count(*)::int from public.accounts where name = 'Credila Financial Services') $$,
  $$ values (0, 0) $$,
  'with its account and instalments');
select lives_ok($$ select public.set_loan_archived(public.t_loan('1a000000-0000-4000-8000-000000000001'), true) $$, 'A archives L1');
select throws_ok($$ select public.delete_loan(public.t_loan('1a000000-0000-4000-8000-000000000001')) $$, 'FC040', null, 'a loan with payments cannot be deleted');
select lives_ok($$ select public.set_loan_archived(public.t_loan('1a000000-0000-4000-8000-000000000001'), false) $$, 'A restores L1');
select is((select archived_at from public.accounts where id = public.t_loan_account('1a000000-0000-4000-8000-000000000001')), null,
  'its account is restored too');

-- ------------------------------------------------------------ as B
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);

select results_eq(
  $$ select (select count(*)::int from public.loans), (select count(*)::int from public.due_items), (select count(*)::int from public.due_payments),
            (select count(*)::int from public.accounts) $$,
  $$ values (0, 0, 0, 0) $$,
  'B sees none of A''s loans, due items, payments or loan accounts');
select throws_ok(
  $$ select public.pay_due_item('00000000-0000-4000-8000-000000000000'::uuid, gen_random_uuid(), gen_random_uuid(), current_date, 1, 0, 0) $$,
  'FC008', null, 'B cannot pay an instalment B can''t see');
reset role;
create temporary table t_ids on commit drop as
  select (select id from public.due_items where kind = 'loan_emi' and seq = 6
            and loan_id = (select id from public.loans where idempotency_key = '1a000000-0000-4000-8000-000000000001')) as due_id,
         (select id from public.due_payments where idempotency_key = '1b000000-0000-4000-8000-000000000003') as pay_id,
         (select id from public.loans where idempotency_key = '1a000000-0000-4000-8000-000000000002') as loan_id;
grant select on t_ids to authenticated;
set local role authenticated;
select throws_ok(
  $$ select public.pay_due_item((select due_id from t_ids), gen_random_uuid(), gen_random_uuid(), current_date, 1, 0, 0) $$,
  'FC008', null, 'B cannot pay A''s instalment');
select throws_ok($$ select public.void_due_payment((select pay_id from t_ids), gen_random_uuid()) $$, 'FC008', null, 'B cannot void A''s payment');
select throws_ok($$ select public.delete_loan((select loan_id from t_ids)) $$, 'FC008', null, 'B cannot delete A''s loan');
select throws_ok($$ select public.set_loan_archived((select loan_id from t_ids), true) $$, 'FC008', null, 'B cannot archive A''s loan');
select throws_ok(
  $$ select public.update_loan((select loan_id from t_ids), 'home', 'X', 2000000, 0, 'fixed', 1) $$,
  'FC008', null, 'B cannot edit A''s loan');
update public.due_items set planned_on = null, planned_account_id = null;
select lives_ok(
  $$ select public.t_create('1a000000-0000-4000-8000-000000000001', 'SBI', null, 'ongoing', 100000, 3, public.t_month_start(), null) $$,
  'B adds a loan (request keys are per user)');
select is((select count(*)::int from public.loans), 1, 'B sees only B''s loan');

-- ------------------------------------------------------------ anon
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select count(*) from public.loans $$, '42501', null, 'anon cannot read loans');
select throws_ok($$ select count(*) from public.due_items $$, '42501', null, 'anon cannot read due items');
select throws_ok(
  $$ select public.create_loan(gen_random_uuid(), 'home', 'X', 1, 1, 0, 'fixed', 1, 'ongoing', 1, 1, current_date, 1, 1) $$,
  '42501', null, 'anon cannot add a loan');

-- ------------------------------------------------------------ test owner: deletes
reset role;
select results_eq(
  $$ select planned_on is not null from public.due_items where kind = 'loan_emi' and seq = 5
       and loan_id = (select id from public.loans where idempotency_key = '1a000000-0000-4000-8000-000000000001'
                        and user_id = '11111111-1111-4111-8111-111111111111') $$,
  $$ values (true) $$,
  'B''s update left A''s plan in place');
update public.due_items set planned_on = (now() at time zone 'Asia/Kolkata')::date + 2,
       planned_account_id = (select id from public.accounts where name = 'Spare')
  where id = (select due_id from t_ids);
delete from public.accounts where name = 'Spare';
select results_eq(
  $$ select planned_on, planned_account_id from public.due_items where id = (select due_id from t_ids) $$,
  $$ values (null::date, null::uuid) $$,
  'deleting the planned account clears the whole plan (date and account)');
select lives_ok(
  $$ delete from auth.users where id = '11111111-1111-4111-8111-111111111111' $$,
  'deleting a user with loans, payments and a pending planned EMI works');
select is((select count(*)::int from public.loans where user_id = '11111111-1111-4111-8111-111111111111'), 0, '... and removes all of it');

select * from finish();
rollback;
