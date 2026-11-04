-- Upgrade check for migration 20261104120000 (CI job "Migration upgrade check"), step 1: run on a
-- database migrated up to 20261029180000, before the new migration. Seeds one fictional user with
-- NO refunds (income, expenses, a transfer, a voided and an edited entry, a card with purchases
-- and a payment), then records what the reads return: balances, balances at past dates, the
-- dashboard (day and month buckets), the transaction summary, what the card owes, the statement
-- difference a statement would post (probed and rolled back), and the function grants.
-- 20261104120000_assert.sql checks that every one of them is the same after the migration.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('9c000000-0000-4000-8000-000000000001', 'upgrade-norefund@example.test');

select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
  values ('bank', 'savings', 'Upg Bank', 'INR', 1000000, public.user_local_today(auth.uid()) - 40);
insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date)
  values ('cash', 'Upg Cash', 'INR', 50000, public.user_local_today(auth.uid()) - 40),
         ('other', 'Upg Wallet', 'INR', 0, public.user_local_today(auth.uid()) - 40);

select public.record_transaction('income', '9c100000-0000-4000-8000-000000000001', 500000, public.user_local_today(auth.uid()) - 35,
  (select id from public.accounts where name = 'Upg Bank'), (select id from public.categories where kind = 'income' and name = 'Salary'));
select public.record_transaction('expense', '9c100000-0000-4000-8000-000000000002', 120000, public.user_local_today(auth.uid()) - 30,
  (select id from public.accounts where name = 'Upg Bank'), (select id from public.categories where kind = 'expense' and name = 'Groceries'),
  p_payment_mode => 'upi');
select public.record_transaction('transfer', '9c100000-0000-4000-8000-000000000003', 200000, public.user_local_today(auth.uid()) - 20,
  (select id from public.accounts where name = 'Upg Bank'), p_counter_account_id => (select id from public.accounts where name = 'Upg Wallet'));
select public.record_transaction('expense', '9c100000-0000-4000-8000-000000000004', 30000, public.user_local_today(auth.uid()) - 3,
  (select id from public.accounts where name = 'Upg Wallet'), (select id from public.categories where kind = 'expense' and name = 'Shopping'));
select public.record_transaction('expense', '9c100000-0000-4000-8000-000000000005', 40000, public.user_local_today(auth.uid()) - 5,
  (select id from public.accounts where name = 'Upg Cash'), (select id from public.categories where kind = 'expense' and name = 'Food & dining'));
-- Voided, and edited (the old version is voided, the new one counts).
select public.record_transaction('expense', '9c100000-0000-4000-8000-000000000006', 9999, public.user_local_today(auth.uid()) - 10,
  (select id from public.accounts where name = 'Upg Bank'), (select id from public.categories where kind = 'expense' and name = 'Shopping'));
select public.void_transaction((select id from public.transactions where idempotency_key = '9c100000-0000-4000-8000-000000000006'),
  '9c100000-0000-4000-8000-000000000007');
select public.record_transaction('expense', '9c100000-0000-4000-8000-000000000008', 70000, public.user_local_today(auth.uid()) - 8,
  (select id from public.accounts where name = 'Upg Bank'), (select id from public.categories where kind = 'expense' and name = 'Transport'));
select public.edit_transaction((select id from public.transactions where idempotency_key = '9c100000-0000-4000-8000-000000000008'),
  '9c100000-0000-4000-8000-000000000009', 65000, public.user_local_today(auth.uid()) - 8,
  (select id from public.accounts where name = 'Upg Bank'), (select id from public.categories where kind = 'expense' and name = 'Transport'));

-- A card owing 3,000 when added (today), two purchases, a 1,000 payment from the bank.
select public.create_card('9c200000-0000-4000-8000-000000000001', 'Upg Issuer', 10000000, 20, 8, 300000, 'Upg card');
select public.record_transaction('expense', '9c200000-0000-4000-8000-000000000002', 150000, public.user_local_today(auth.uid()),
  (select account_id from public.credit_cards where idempotency_key = '9c200000-0000-4000-8000-000000000001'),
  (select id from public.categories where kind = 'expense' and name = 'Travel'));
select public.record_transaction('expense', '9c200000-0000-4000-8000-000000000003', 25000, public.user_local_today(auth.uid()),
  (select account_id from public.credit_cards where idempotency_key = '9c200000-0000-4000-8000-000000000001'),
  (select id from public.categories where kind = 'expense' and name = 'Shopping'));
select public.pay_card((select id from public.credit_cards where idempotency_key = '9c200000-0000-4000-8000-000000000001'),
  '9c200000-0000-4000-8000-000000000004', (select id from public.accounts where name = 'Upg Bank'), public.user_local_today(auth.uid()), 100000);
reset role;

-- The reads before the migration (as the owner, with the user's claims, so auth.uid() is the user).
create table public.upgrade_9c_days as
  select public.user_local_today('9c000000-0000-4000-8000-000000000001') as today,
         (select account_id from public.credit_cards where idempotency_key = '9c200000-0000-4000-8000-000000000001') as card_account_id,
         (select id from public.credit_cards where idempotency_key = '9c200000-0000-4000-8000-000000000001') as card_id,
         (select id from public.categories where user_id = '9c000000-0000-4000-8000-000000000001' and kind = 'expense' and name = 'Other expenses') as difference_category_id;

create table public.upgrade_9c_balances as
  select b.account_id, b.inflow_minor, b.outflow_minor
  from public.account_balances as b where b.user_id = '9c000000-0000-4000-8000-000000000001';
create table public.upgrade_9c_balances_at as
  select * from public.account_balances_at((select array[today - 30, today - 10, today - 1, today] from public.upgrade_9c_days));
create table public.upgrade_9c_dashboard as
  select 'day'::text as span, d.* from public.dashboard_breakdown((select today - 40 from public.upgrade_9c_days), (select today from public.upgrade_9c_days)) as d
  union all
  select 'month', d.* from public.dashboard_breakdown((select today - 400 from public.upgrade_9c_days), (select today from public.upgrade_9c_days)) as d;
create table public.upgrade_9c_summary as
  select s.currency, s.income_minor, s.expense_minor, s.income_count, s.expense_count, s.transfer_count
  from public.transaction_summary((select today - 40 from public.upgrade_9c_days), (select today from public.upgrade_9c_days)) as s;
create table public.upgrade_9c_owed as
  select public.liability_owed(card_account_id) as owed_now, public.liability_owed(card_account_id, today) as owed_today
  from public.upgrade_9c_days;

-- The statement a 5,000 bill dated today would enter (difference and owed on that date), rolled back.
create table public.upgrade_9c_statement (difference_minor bigint, owed_at_statement_minor bigint);
do $$
declare
  v_days public.upgrade_9c_days;
  v_result text;
begin
  select * into v_days from public.upgrade_9c_days;
  begin
    select s.difference_minor || ',' || s.owed_at_statement_minor into v_result
    from public.enter_card_statement(v_days.card_id, '9c300000-0000-4000-8000-000000000001', v_days.today, 500000,
                                     0, null, 0, v_days.difference_category_id) as s;
    raise exception using errcode = 'UC901', message = v_result;
  exception when sqlstate 'UC901' then
    v_result := sqlerrm;
  end;
  insert into public.upgrade_9c_statement
    values (split_part(v_result, ',', 1)::bigint, split_part(v_result, ',', 2)::bigint);
end;
$$;

-- Function grants by role, for the two functions the migration drops and re-creates.
create table public.upgrade_9c_grants as
  select f.name, r.role, has_function_privilege(r.role, f.sig, 'EXECUTE') as can_execute
  from (values ('record_transaction', 'public.record_transaction(text, uuid, bigint, date, uuid, uuid, uuid, text, text)'),
               ('transaction_summary', 'public.transaction_summary(date, date, uuid, uuid, text, bigint)')) as f(name, sig)
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);
commit;
