-- QA pgTAP tests for credit cards and informal borrowing (migration 20261028180000), added on
-- top of cards_borrowing.test.sql: Total available, no digits stored, RLS isolation (tables and
-- every function), double submits, void / edit moving every entry together, and boundaries.
-- Expected values are worked out by hand in the comments (paise). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(182);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'qa-asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'qa-bala@example.test');

-- Helpers (SECURITY INVOKER: RLS applies to whoever calls them).
create function public.t_today() returns date language sql stable set search_path = ''
  as $$ select public.user_local_today((select auth.uid())) $$;
create function public.t_acct(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select a.id from public.accounts as a where a.name = p_name and a.kind in ('bank', 'cash', 'other') $$;
create function public.t_card(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select c.id from public.credit_cards as c where c.idempotency_key = p_key $$;
create function public.t_card_acct(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select c.account_id from public.credit_cards as c where c.idempotency_key = p_key $$;
create function public.t_bill(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select d.id from public.due_items as d join public.card_statements as s on s.id = d.card_statement_id where s.idempotency_key = p_key $$;
create function public.t_bill_status(p_key uuid) returns text language sql stable set search_path = ''
  as $$ select d.status from public.due_items as d join public.card_statements as s on s.id = d.card_statement_id where s.idempotency_key = p_key $$;
create function public.t_paid(p_key uuid) returns bigint language sql stable set search_path = ''
  as $$ select p.paid_minor from public.card_bill_progress as p where p.due_item_id = public.t_bill(p_key) $$;
create function public.t_borrow(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select b.id from public.borrowings as b where b.idempotency_key = p_key $$;
create function public.t_borrow_acct(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select b.account_id from public.borrowings as b where b.idempotency_key = p_key $$;
create function public.t_borrow_due(p_key uuid) returns text language sql stable set search_path = ''
  as $$ select d.status from public.due_items as d join public.borrowings as b on b.id = d.borrowing_id where b.idempotency_key = p_key $$;
create function public.t_lp(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select p.id from public.liability_payments as p where p.idempotency_key = p_key $$;
create function public.t_dp(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select p.id from public.due_payments as p where p.idempotency_key = p_key $$;
create function public.t_tx(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select t.id from public.transactions as t where t.idempotency_key = p_key $$;
create function public.t_bal(p_account uuid) returns bigint language sql stable set search_path = ''
  as $$ select a.opening_balance_minor + b.inflow_minor - b.outflow_minor
        from public.accounts as a join public.account_balances as b on b.account_id = a.id where a.id = p_account $$;
create function public.t_misc() returns uuid language sql stable set search_path = ''
  as $$ select c.id from public.categories as c where c.kind = 'expense' and c.name = 'Qa misc' $$;
-- Total available as CLAUDE.md defines it: active bank, cash and other accounts only.
create function public.t_total() returns bigint language sql stable set search_path = ''
  as $$ select coalesce(sum(a.opening_balance_minor + b.inflow_minor - b.outflow_minor), 0)::bigint
        from public.accounts as a join public.account_balances as b on b.account_id = a.id
        where a.archived_at is null and a.kind in ('bank', 'cash', 'other') $$;
-- Every active account whatever its kind: what Total available must NOT be.
create function public.t_sum_all() returns bigint language sql stable set search_path = ''
  as $$ select coalesce(sum(a.opening_balance_minor + b.inflow_minor - b.outflow_minor), 0)::bigint
        from public.accounts as a join public.account_balances as b on b.account_id = a.id
        where a.archived_at is null $$;
-- Entries of a card payment / repayment (liability_payment_id) or of a bill payment (due_payment_id),
-- active (p_voided false) or voided (true).
create function public.t_ents(p_payment uuid, p_voided boolean) returns integer language sql stable set search_path = ''
  as $$ select count(*)::int from public.transactions as t
        where t.liability_payment_id = p_payment and (t.voided_at is not null) = p_voided $$;
create function public.t_dents(p_payment uuid, p_voided boolean) returns integer language sql stable set search_path = ''
  as $$ select count(*)::int from public.transactions as t
        where t.due_payment_id = p_payment and (t.voided_at is not null) = p_voided $$;
-- Runs a statement, answering 'ok' or 'SQLSTATE:detail'.
create function public.t_state(p_sql text) returns text language plpgsql set search_path = '' as $$
declare v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlstate || ':' || coalesce(v_detail, '');
end $$;
-- True when the statement is refused by a CHECK constraint (nothing is saved then).
create function public.t_refused(p_sql text) returns boolean language plpgsql set search_path = '' as $$
begin
  execute p_sql;
  return false;
exception when check_violation then
  return true;
end $$;
grant execute on function public.t_today(), public.t_acct(text), public.t_card(uuid), public.t_card_acct(uuid),
  public.t_bill(uuid), public.t_bill_status(uuid), public.t_paid(uuid), public.t_borrow(uuid), public.t_borrow_acct(uuid),
  public.t_borrow_due(uuid), public.t_lp(uuid), public.t_dp(uuid), public.t_tx(uuid), public.t_bal(uuid), public.t_misc(),
  public.t_total(), public.t_sum_all(), public.t_ents(uuid, boolean), public.t_dents(uuid, boolean),
  public.t_state(text), public.t_refused(text) to authenticated;

-- ------------------------------------------------------------ as A: accounts
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('bank', 'savings', 'Qa Bank', 'INR', 10000000, public.t_today() - 30);
insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date) values
  ('cash', 'Qa Cash', 'INR', 5000, public.t_today() - 30),
  ('other', 'Qa Wallet', 'INR', 3000, public.t_today() - 30);
insert into public.categories (kind, name, icon) values ('expense', 'Qa misc', 'bills');

-- ============================================================ 1 + 4: Total available and double submits
-- Bank 100,000.00 + cash 50.00 + wallet 30.00 = 10,008,000 paise.
select is(public.t_total(), 10008000::bigint, 'baseline: Total available is bank + cash + wallet');

select lives_ok($$ select public.create_card('d0000005-0000-4000-8000-000000000001', ' Qa  Alpha ', 5000000, 20, 8, 600000, 'Daily') $$,
  'A adds card C1 that owes 6,000.00');
select is(public.t_total(), 10008000::bigint, 'a card that owes 6,000.00 leaves Total available unchanged');
select is((select (public.create_card('d0000005-0000-4000-8000-000000000001', 'Qa Alpha', 5000000, 20, 8, 600000, 'Daily')).id), public.t_card('d0000005-0000-4000-8000-000000000001'),
  'double submit of create_card returns the same card');
select results_eq(
  $$ select (select count(*)::int from public.credit_cards where idempotency_key = 'd0000005-0000-4000-8000-000000000001'),
            (select count(*)::int from public.accounts where kind = 'card') $$,
  $$ values (1, 1) $$,
  '... one card row and one card account');
select throws_ok($$ select public.create_card('d0000005-0000-4000-8000-000000000001', 'Qa Alpha', 4000000, 20, 8, 600000, 'Daily') $$,
  'FC007', null, 'the same key with a different limit is FC007');

-- Purchase 2,000.00 on the card: owed 6,000 + 2,000 = 8,000.00; no money account moves.
select lives_ok($$ select public.record_transaction('expense', 'd0000014-0000-4000-8000-000000000001', 200000, public.t_today(), public.t_card_acct('d0000005-0000-4000-8000-000000000001'), public.t_misc()) $$,
  'a purchase of 2,000.00 on C1');
select results_eq(
  $$ select public.t_bal(public.t_acct('Qa Bank')), public.t_bal(public.t_acct('Qa Cash')), public.t_bal(public.t_acct('Qa Wallet')), public.t_total() $$,
  $$ values (10000000::bigint, 5000::bigint, 3000::bigint, 10008000::bigint) $$,
  'a purchase on the card changes no money account balance and not the sum');
select results_eq(
  $$ select public.t_bal(public.t_card_acct('d0000005-0000-4000-8000-000000000001')), public.liability_owed(public.t_card_acct('d0000005-0000-4000-8000-000000000001')) $$,
  $$ values (-800000::bigint, 800000::bigint) $$,
  'the card account holds minus what is owed (6,000 + 2,000)');

-- Statement of 9,000.00 against 8,000.00 owed: the difference 1,000.00 is posted on the card.
select lives_ok($$ select public.enter_card_statement(public.t_card('d0000005-0000-4000-8000-000000000001'), 'd0000029-0000-4000-8000-000000000001', public.t_today(), 900000, 50000, p_difference_category_id => public.t_misc()) $$,
  'A enters statement S1: total 9,000.00, minimum 500.00');
select results_eq(
  $$ select s.owed_at_statement_minor, s.difference_minor, d.amount_due_minor, d.minimum_due_minor
     from public.card_statements as s join public.due_items as d on d.card_statement_id = s.id where s.idempotency_key = 'd0000029-0000-4000-8000-000000000001' $$,
  $$ values (800000::bigint, 100000::bigint, 900000::bigint, 50000::bigint) $$,
  'owed 8,000 on the date, difference 1,000, bill 9,000, minimum 500');
select results_eq(
  $$ select public.t_bal(public.t_acct('Qa Bank')), public.t_bal(public.t_acct('Qa Cash')), public.t_bal(public.t_acct('Qa Wallet')), public.t_total() $$,
  $$ values (10000000::bigint, 5000::bigint, 3000::bigint, 10008000::bigint) $$,
  'a statement and its difference expense change no money account');
select is((select (public.enter_card_statement(public.t_card('d0000005-0000-4000-8000-000000000001'), 'd0000029-0000-4000-8000-000000000001', public.t_today(), 900000, 50000, p_difference_category_id => public.t_misc())).id),
  (select id from public.card_statements where idempotency_key = 'd0000029-0000-4000-8000-000000000001'), 'double submit of enter_card_statement returns the saved statement');
select results_eq(
  $$ select (select count(*)::int from public.card_statements where idempotency_key = 'd0000029-0000-4000-8000-000000000001'),
            (select count(*)::int from public.transactions where note like 'Statement difference%'),
            (select count(*)::int from public.due_items where kind = 'card_bill'),
            public.liability_owed(public.t_card_acct('d0000005-0000-4000-8000-000000000001')) $$,
  $$ values (1, 1, 1, 900000::bigint) $$,
  '... one statement, one difference expense, one bill, owed 9,000.00 once');
select throws_ok($$ select public.enter_card_statement(public.t_card('d0000005-0000-4000-8000-000000000001'), 'd0000029-0000-4000-8000-000000000001', public.t_today(), 900001, 50000) $$,
  'FC007', null, 'the same key with a different total is FC007');

-- Pay 3,000.00 from the bank: the only thing that moves a money account.
select lives_ok($$ select public.pay_card(public.t_card('d0000005-0000-4000-8000-000000000001'), 'd0000022-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 300000) $$,
  'A pays 3,000.00 to C1 from the bank');
select results_eq(
  $$ select public.t_bal(public.t_acct('Qa Bank')), public.t_bal(public.t_acct('Qa Cash')), public.t_bal(public.t_acct('Qa Wallet')), public.t_total(),
            public.t_bal(public.t_card_acct('d0000005-0000-4000-8000-000000000001')) $$,
  $$ values (9700000::bigint, 5000::bigint, 3000::bigint, 9708000::bigint, -600000::bigint) $$,
  'Total available falls by exactly the 3,000.00 transfer; the card is at minus 6,000.00');
select results_eq(
  $$ select t.type, t.amount_minor, t.account_id = public.t_acct('Qa Bank'), t.counter_account_id = public.t_card_acct('d0000005-0000-4000-8000-000000000001')
     from public.transactions as t where t.liability_payment_id = public.t_lp('d0000022-0000-4000-8000-000000000001') $$,
  $$ values ('transfer'::text, 300000::bigint, true, true) $$,
  'the payment is one transfer bank to card');
select is((select (public.pay_card(public.t_card('d0000005-0000-4000-8000-000000000001'), 'd0000022-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 300000)).id), public.t_lp('d0000022-0000-4000-8000-000000000001'),
  'double submit of pay_card returns the same payment');
select results_eq(
  $$ select (select count(*)::int from public.liability_payments where idempotency_key = 'd0000022-0000-4000-8000-000000000001'),
            public.t_ents(public.t_lp('d0000022-0000-4000-8000-000000000001'), false), public.t_bal(public.t_acct('Qa Bank')) $$,
  $$ values (1, 1, 9700000::bigint) $$,
  '... one payment, one entry, the bank charged once');
select throws_ok($$ select public.pay_card(public.t_card('d0000005-0000-4000-8000-000000000001'), 'd0000022-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 300001) $$,
  'FC007', null, 'the same key with a different amount is FC007');

-- Borrowing 1,000.00 from Ravi, received into the wallet two days ago, due in 30 days.
select lives_ok($$ select public.create_borrowing('d0000001-0000-4000-8000-000000000001', 'Ravi Kumar', 100000, public.t_acct('Qa Wallet'), public.t_today() - 2, public.t_today() + 30) $$,
  'A borrows 1,000.00 into the wallet');
select results_eq(
  $$ select public.t_bal(public.t_acct('Qa Wallet')), public.t_total(), public.t_bal(public.t_borrow_acct('d0000001-0000-4000-8000-000000000001')),
            public.liability_owed(public.t_borrow_acct('d0000001-0000-4000-8000-000000000001')), public.t_borrow_due('d0000001-0000-4000-8000-000000000001') $$,
  $$ values (103000::bigint, 9808000::bigint, -100000::bigint, 100000::bigint, 'pending'::text) $$,
  'the wallet rises by 1,000 (Total too); the borrowing account holds minus 1,000; its due date is pending');
select is((select (public.create_borrowing('d0000001-0000-4000-8000-000000000001', 'Ravi Kumar', 100000, public.t_acct('Qa Wallet'), public.t_today() - 2, public.t_today() + 30)).id),
  public.t_borrow('d0000001-0000-4000-8000-000000000001'), 'double submit of create_borrowing returns the same borrowing');
select results_eq(
  $$ select (select count(*)::int from public.borrowings where idempotency_key = 'd0000001-0000-4000-8000-000000000001'),
            (select count(*)::int from public.accounts where kind = 'borrowing'),
            (select count(*)::int from public.transactions where note like 'Borrowed%'),
            public.t_bal(public.t_acct('Qa Wallet')) $$,
  $$ values (1, 1, 1, 103000::bigint) $$,
  '... one borrowing, one account, one receipt, the wallet credited once');
select throws_ok($$ select public.create_borrowing('d0000001-0000-4000-8000-000000000001', 'Ravi Kumar', 100001, public.t_acct('Qa Wallet'), public.t_today() - 2, public.t_today() + 30) $$,
  'FC007', null, 'the same key with a different amount is FC007');

-- Repay 400.00 + 50.00 interest from the bank.
select lives_ok($$ select public.repay_borrowing(public.t_borrow('d0000001-0000-4000-8000-000000000001'), 'd0000027-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 40000, 5000) $$,
  'A repays 400.00 and 50.00 interest from the bank');
select results_eq(
  $$ select t.type, t.amount_minor, c.system_key
     from public.transactions as t left join public.categories as c on c.id = t.category_id
     where t.liability_payment_id = public.t_lp('d0000027-0000-4000-8000-000000000001') order by t.amount_minor desc $$,
  $$ values ('transfer'::text, 40000::bigint, null::text), ('expense', 5000, 'loan_interest') $$,
  'principal is a transfer into the borrowing; interest is an expense in Loan interest');
select results_eq(
  $$ select public.t_bal(public.t_acct('Qa Bank')), public.t_bal(public.t_acct('Qa Cash')), public.t_bal(public.t_acct('Qa Wallet')), public.t_total(),
            public.t_bal(public.t_borrow_acct('d0000001-0000-4000-8000-000000000001')) $$,
  $$ values (9655000::bigint, 5000::bigint, 103000::bigint, 9763000::bigint, -60000::bigint) $$,
  'bank 9,700,000 - 45,000; Total 9,763,000; the borrowing is at minus 600.00');
select is((select (public.repay_borrowing(public.t_borrow('d0000001-0000-4000-8000-000000000001'), 'd0000027-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 40000, 5000)).id),
  public.t_lp('d0000027-0000-4000-8000-000000000001'), 'double submit of repay_borrowing returns the same repayment');
select results_eq(
  $$ select (select count(*)::int from public.liability_payments where idempotency_key = 'd0000027-0000-4000-8000-000000000001'),
            public.t_ents(public.t_lp('d0000027-0000-4000-8000-000000000001'), false), public.t_bal(public.t_acct('Qa Bank')) $$,
  $$ values (1, 2, 9655000::bigint) $$,
  '... one repayment with its two entries, the bank charged once');
select throws_ok($$ select public.repay_borrowing(public.t_borrow('d0000001-0000-4000-8000-000000000001'), 'd0000027-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 40001, 5000) $$,
  'FC007', null, 'the same key with a different principal is FC007');

-- What Total available is and is not: 9,655,000 + 5,000 + 103,000 = 9,763,000; with the card (-600,000)
-- and the borrowing (-60,000) the sum of every account would be 9,103,000.
select results_eq(
  $$ select public.t_total(), public.t_sum_all(),
            public.t_bal(public.t_card_acct('d0000005-0000-4000-8000-000000000001')) + public.t_bal(public.t_borrow_acct('d0000001-0000-4000-8000-000000000001')) $$,
  $$ values (9763000::bigint, 9103000::bigint, -660000::bigint) $$,
  'Total available leaves out the card and the borrowing balances (9,763,000, not 9,103,000)');
select results_eq(
  $$ select (select count(*)::int from public.credit_cards as c join public.accounts as a on a.id = c.account_id where a.kind <> 'card'),
            (select count(*)::int from public.borrowings as b join public.accounts as a on a.id = b.account_id where a.kind <> 'borrowing'),
            (select count(*)::int from public.accounts as a
              where a.kind in ('bank', 'cash', 'other')
                and a.id in (select account_id from public.credit_cards union select account_id from public.borrowings)) $$,
  $$ values (0, 0, 0) $$,
  'card and borrowing accounts are never of a money kind');
-- Expenses: purchase 200,000 + difference 100,000 + interest 5,000. Transfers: 300,000 + 100,000 receipt + 40,000. No income.
select results_eq(
  $$ select coalesce(sum(amount_minor) filter (where type = 'expense'), 0)::bigint, coalesce(sum(amount_minor) filter (where type = 'income'), 0)::bigint,
            coalesce(sum(amount_minor) filter (where type = 'transfer'), 0)::bigint
     from public.transactions where voided_at is null $$,
  $$ values (305000::bigint, 0::bigint, 440000::bigint) $$,
  'payments, the receipt and repayment principal are transfers: not income, not expenses');

-- ============================================================ 5: a card payment, void and edit
-- Pay the remaining 6,000.00 freely: the bill is covered by free payments alone (3,000 + 6,000 = 9,000).
select lives_ok($$ select public.pay_card(public.t_card('d0000005-0000-4000-8000-000000000001'), 'd0000023-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 600000) $$,
  'A pays the remaining 6,000.00 with a free payment');
select results_eq(
  $$ select public.liability_owed(public.t_card_acct('d0000005-0000-4000-8000-000000000001')), public.t_bill_status('d0000029-0000-4000-8000-000000000001'), public.t_paid('d0000029-0000-4000-8000-000000000001'),
            (select count(*)::int from public.due_payments), public.t_bal(public.t_acct('Qa Bank')) $$,
  $$ values (0::bigint, 'paid'::text, 900000::bigint, 0, 9055000::bigint) $$,
  'the bill is paid by transfers alone (no Pay-bill payment); nothing is owed');
select lives_ok($$ select public.void_liability_payment(public.t_lp('d0000023-0000-4000-8000-000000000001'), 'd0000036-0000-4000-8000-000000000001', 'wrong card') $$,
  'A voids that free payment');
select results_eq(
  $$ select public.t_bill_status('d0000029-0000-4000-8000-000000000001'), public.liability_owed(public.t_card_acct('d0000005-0000-4000-8000-000000000001')), public.t_ents(public.t_lp('d0000023-0000-4000-8000-000000000001'), false),
            public.t_ents(public.t_lp('d0000023-0000-4000-8000-000000000001'), true), public.t_bal(public.t_acct('Qa Bank')), public.t_paid('d0000029-0000-4000-8000-000000000001') $$,
  $$ values ('pending'::text, 600000::bigint, 0, 1, 9655000::bigint, 300000::bigint) $$,
  'the void returns the money, voids its entry and the bill is pending again (3,000 of 9,000 paid)');
select is((select (public.void_liability_payment(public.t_lp('d0000023-0000-4000-8000-000000000001'), 'd0000036-0000-4000-8000-000000000001')).id), public.t_lp('d0000023-0000-4000-8000-000000000001'),
  'double submit of void_liability_payment returns the same payment');
select results_eq(
  $$ select public.t_ents(public.t_lp('d0000023-0000-4000-8000-000000000001'), true), public.t_bal(public.t_acct('Qa Bank')) $$,
  $$ values (1, 9655000::bigint) $$,
  '... voided once, the bank refunded once');
select throws_ok($$ select public.void_liability_payment(public.t_lp('d0000023-0000-4000-8000-000000000001'), gen_random_uuid()) $$,
  'FC005', null, 'a second void under another key is FC005 (already voided)');

-- Edit the first payment from 3,000 to 9,000: the old transfer is voided, the new one covers the bill.
select lives_ok($$ select public.edit_liability_payment(public.t_lp('d0000022-0000-4000-8000-000000000001'), 'd0000026-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 900000) $$,
  'A edits the 3,000.00 payment to 9,000.00');
select results_eq(
  $$ select public.t_ents(public.t_lp('d0000022-0000-4000-8000-000000000001'), false), public.t_ents(public.t_lp('d0000022-0000-4000-8000-000000000001'), true),
            public.t_ents(public.t_lp('d0000026-0000-4000-8000-000000000001'), false),
            (select sum(t.amount_minor)::bigint from public.transactions as t where t.liability_payment_id = public.t_lp('d0000026-0000-4000-8000-000000000001') and t.voided_at is null),
            (select p.replaces_id = public.t_lp('d0000022-0000-4000-8000-000000000001') from public.liability_payments as p where p.id = public.t_lp('d0000026-0000-4000-8000-000000000001')),
            public.t_bill_status('d0000029-0000-4000-8000-000000000001'), public.liability_owed(public.t_card_acct('d0000005-0000-4000-8000-000000000001')), public.t_paid('d0000029-0000-4000-8000-000000000001'),
            public.t_bal(public.t_acct('Qa Bank')) $$,
  $$ values (0, 1, 1, 900000::bigint, true, 'paid'::text, 0::bigint, 900000::bigint, 9055000::bigint) $$,
  'the old transfer is voided, one new 9,000 transfer replaces it, the bill is paid (bank 9,655,000 + 300,000 - 900,000)');
select is((select (public.edit_liability_payment(public.t_lp('d0000022-0000-4000-8000-000000000001'), 'd0000026-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 900000)).id),
  public.t_lp('d0000026-0000-4000-8000-000000000001'), 'double submit of edit_liability_payment returns the saved payment');
select results_eq(
  $$ select (select count(*)::int from public.liability_payments where replaces_id = public.t_lp('d0000022-0000-4000-8000-000000000001')), public.t_bal(public.t_acct('Qa Bank')) $$,
  $$ values (1, 9055000::bigint) $$,
  '... one replacement, the bank charged once');
select throws_ok($$ select public.edit_liability_payment(public.t_lp('d0000022-0000-4000-8000-000000000001'), 'd0000026-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 899999) $$,
  'FC007', null, 'the same edit key with a different amount is FC007');
select throws_ok($$ select public.edit_liability_payment(public.t_lp('d0000022-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('Qa Bank'), public.t_today(), 1) $$,
  'FC014', null, 'editing the payment that was already replaced is FC014');

-- ============================================================ 5: a borrowing repayment with interest, void and edit
-- Edit 400.00 + 50.00 (bank) to 300.00 + 20.00 paid from the wallet.
select lives_ok($$ select public.edit_liability_payment(public.t_lp('d0000027-0000-4000-8000-000000000001'), 'd0000028-0000-4000-8000-000000000001', public.t_acct('Qa Wallet'), public.t_today(), 30000, 2000) $$,
  'A edits the repayment to 300.00 + 20.00 from the wallet');
-- Bank 9,055,000 + 45,000 = 9,100,000; wallet 103,000 - 32,000 = 71,000; Total 9,100,000 + 5,000 + 71,000 = 9,176,000.
select results_eq(
  $$ select public.t_ents(public.t_lp('d0000027-0000-4000-8000-000000000001'), false), public.t_ents(public.t_lp('d0000027-0000-4000-8000-000000000001'), true),
            public.t_ents(public.t_lp('d0000028-0000-4000-8000-000000000001'), false), public.t_ents(public.t_lp('d0000028-0000-4000-8000-000000000001'), true),
            (select p.replaces_id = public.t_lp('d0000027-0000-4000-8000-000000000001') from public.liability_payments as p where p.id = public.t_lp('d0000028-0000-4000-8000-000000000001')),
            public.t_borrow_due('d0000001-0000-4000-8000-000000000001'), public.liability_owed(public.t_borrow_acct('d0000001-0000-4000-8000-000000000001')),
            public.t_bal(public.t_acct('Qa Wallet')), public.t_bal(public.t_acct('Qa Bank')), public.t_total() $$,
  $$ values (0, 2, 2, 0, true, 'pending'::text, 70000::bigint, 71000::bigint, 9100000::bigint, 9176000::bigint) $$,
  'both old entries (transfer and interest) are voided, both new ones are active; owed 700.00; due date pending');
select results_eq(
  $$ select t.type, t.amount_minor, c.system_key
     from public.transactions as t left join public.categories as c on c.id = t.category_id
     where t.liability_payment_id = public.t_lp('d0000028-0000-4000-8000-000000000001') and t.voided_at is null order by t.amount_minor desc $$,
  $$ values ('transfer'::text, 30000::bigint, null::text), ('expense', 2000, 'loan_interest') $$,
  'the new entries are a 300.00 transfer and 20.00 of Loan interest');
select is((select (public.edit_liability_payment(public.t_lp('d0000027-0000-4000-8000-000000000001'), 'd0000028-0000-4000-8000-000000000001', public.t_acct('Qa Wallet'), public.t_today(), 30000, 2000)).id),
  public.t_lp('d0000028-0000-4000-8000-000000000001'), 'double submit of the repayment edit returns the saved payment');
select results_eq(
  $$ select (select count(*)::int from public.liability_payments where replaces_id = public.t_lp('d0000027-0000-4000-8000-000000000001')), public.t_ents(public.t_lp('d0000028-0000-4000-8000-000000000001'), false),
            public.t_bal(public.t_acct('Qa Wallet')) $$,
  $$ values (1, 2, 71000::bigint) $$,
  '... one replacement, two entries, the wallet charged once');
select throws_ok($$ select public.edit_liability_payment(public.t_lp('d0000027-0000-4000-8000-000000000001'), 'd0000028-0000-4000-8000-000000000001', public.t_acct('Qa Wallet'), public.t_today(), 30001, 2000) $$,
  'FC007', null, 'the same edit key with a different principal is FC007');

-- Repay the rest (700.00) in full, then void it: the due date follows (paid, pending).
select lives_ok($$ select public.repay_borrowing(public.t_borrow('d0000001-0000-4000-8000-000000000001'), 'd0000012-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 70000) $$,
  'A repays the remaining 700.00');
select results_eq(
  $$ select public.t_borrow_due('d0000001-0000-4000-8000-000000000001'), public.liability_owed(public.t_borrow_acct('d0000001-0000-4000-8000-000000000001')), public.t_bal(public.t_acct('Qa Bank')), public.t_total() $$,
  $$ values ('paid'::text, 0::bigint, 9030000::bigint, 9106000::bigint) $$,
  'nothing owed: the due date is paid; bank 9,030,000; Total 9,106,000');
select is((select (public.repay_borrowing(public.t_borrow('d0000001-0000-4000-8000-000000000001'), 'd0000012-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 70000)).id), public.t_lp('d0000012-0000-4000-8000-000000000001'),
  'double submit of the full repayment returns the same payment');
select results_eq(
  $$ select (select count(*)::int from public.liability_payments where idempotency_key = 'd0000012-0000-4000-8000-000000000001'), public.t_ents(public.t_lp('d0000012-0000-4000-8000-000000000001'), false), public.t_bal(public.t_acct('Qa Bank')) $$,
  $$ values (1, 1, 9030000::bigint) $$,
  '... one payment, one entry, the bank charged once');
select lives_ok($$ select public.void_liability_payment(public.t_lp('d0000012-0000-4000-8000-000000000001'), 'd0000037-0000-4000-8000-000000000001') $$, 'A voids the full repayment');
select results_eq(
  $$ select public.t_borrow_due('d0000001-0000-4000-8000-000000000001'), public.liability_owed(public.t_borrow_acct('d0000001-0000-4000-8000-000000000001')), public.t_bal(public.t_acct('Qa Bank')),
            public.t_ents(public.t_lp('d0000012-0000-4000-8000-000000000001'), true), public.t_total() $$,
  $$ values ('pending'::text, 70000::bigint, 9100000::bigint, 1, 9176000::bigint) $$,
  'the due date is pending again; 700.00 owed; the bank refunded');
select is((select (public.void_liability_payment(public.t_lp('d0000012-0000-4000-8000-000000000001'), 'd0000037-0000-4000-8000-000000000001')).id), public.t_lp('d0000012-0000-4000-8000-000000000001'), 'double submit of the void returns the same payment');
select is(public.t_ents(public.t_lp('d0000012-0000-4000-8000-000000000001'), true), 1, '... its entry is voided once');
select is(public.t_state(format('select public.set_borrowing_archived(%L, true)', public.t_borrow('d0000001-0000-4000-8000-000000000001'))), 'FC045:70000',
  'a borrowing that owes 700.00 cannot be archived (FC045, detail = owed)');

-- Void the edited repayment (with interest): both entries go together.
select lives_ok($$ select public.void_liability_payment(public.t_lp('d0000028-0000-4000-8000-000000000001'), 'd0000038-0000-4000-8000-000000000001', 'wrong lender') $$, 'A voids the 300.00 + 20.00 repayment');
select results_eq(
  $$ select public.t_ents(public.t_lp('d0000028-0000-4000-8000-000000000001'), false), public.t_ents(public.t_lp('d0000028-0000-4000-8000-000000000001'), true), public.t_borrow_due('d0000001-0000-4000-8000-000000000001'),
            public.liability_owed(public.t_borrow_acct('d0000001-0000-4000-8000-000000000001')), public.t_bal(public.t_acct('Qa Wallet')), public.t_bal(public.t_acct('Qa Bank')), public.t_total() $$,
  $$ values (0, 2, 'pending'::text, 100000::bigint, 103000::bigint, 9100000::bigint, 9208000::bigint) $$,
  'transfer and interest are both voided; 1,000.00 owed again; wallet 103,000; Total 9,208,000');
select throws_ok($$ select public.edit_liability_payment(public.t_lp('d0000028-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('Qa Bank'), public.t_today(), 1) $$,
  'FC005', null, 'editing a voided repayment is FC005');
select throws_ok($$ select public.edit_liability_payment(public.t_lp('d0000027-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('Qa Bank'), public.t_today(), 1) $$,
  'FC014', null, 'editing the repayment that was already replaced is FC014');

-- Repay everything (1,000.00), then archive at zero.
select lives_ok($$ select public.repay_borrowing(public.t_borrow('d0000001-0000-4000-8000-000000000001'), 'd0000013-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 100000) $$,
  'A repays the full 1,000.00');
select results_eq(
  $$ select public.t_borrow_due('d0000001-0000-4000-8000-000000000001'), public.liability_owed(public.t_borrow_acct('d0000001-0000-4000-8000-000000000001')), public.t_bal(public.t_acct('Qa Bank')), public.t_total() $$,
  $$ values ('paid'::text, 0::bigint, 9000000::bigint, 9108000::bigint) $$,
  'paid; bank 9,000,000; Total 9,108,000');
select lives_ok($$ select public.set_borrowing_archived(public.t_borrow('d0000001-0000-4000-8000-000000000001'), true) $$, 'a borrowing at zero is archived');
select results_eq(
  $$ select b.archived_at is not null, a.archived_at is not null from public.borrowings as b join public.accounts as a on a.id = b.account_id where b.idempotency_key = 'd0000001-0000-4000-8000-000000000001' $$,
  $$ values (true, true) $$, '... with its account');
select throws_ok($$ select public.repay_borrowing(public.t_borrow('d0000001-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('Qa Bank'), public.t_today(), 1) $$,
  'FC048', null, 'an archived borrowing takes no repayment');

-- ============================================================ 5: a bill covered by free payments can still have its Pay-bill payment edited
select lives_ok($$ select public.create_card('d0000007-0000-4000-8000-000000000001', 'Qa Gamma', 5000000, 10, 25) $$, 'A adds card C3 (nothing owed)');
select lives_ok($$ select public.record_transaction('expense', 'd0000017-0000-4000-8000-000000000001', 900000, public.t_today(), public.t_card_acct('d0000007-0000-4000-8000-000000000001'), public.t_misc()) $$, 'a purchase of 9,000.00 on C3');
select lives_ok($$ select public.enter_card_statement(public.t_card('d0000007-0000-4000-8000-000000000001'), 'd0000030-0000-4000-8000-000000000001', public.t_today(), 900000, 90000) $$, 'statement of 9,000.00 on C3');
select results_eq(
  $$ select s.owed_at_statement_minor, s.difference_minor, d.amount_due_minor, d.minimum_due_minor, d.status, public.liability_owed(public.t_card_acct('d0000007-0000-4000-8000-000000000001'))
     from public.card_statements as s join public.due_items as d on d.card_statement_id = s.id where s.idempotency_key = 'd0000030-0000-4000-8000-000000000001' $$,
  $$ values (900000::bigint, 0::bigint, 900000::bigint, 90000::bigint, 'pending'::text, 900000::bigint) $$,
  'owed equals the bill: no difference; the bill is pending');
-- Pay bill: 1,000.00 (a part-paid bill is closed).
select lives_ok($$ select public.pay_due_item(public.t_bill('d0000030-0000-4000-8000-000000000001'), 'd0000003-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 100000, 0, 0) $$,
  'A pays 1,000.00 of the bill with Pay bill');
select results_eq(
  $$ select public.t_bill_status('d0000030-0000-4000-8000-000000000001'), public.liability_owed(public.t_card_acct('d0000007-0000-4000-8000-000000000001')), public.t_bal(public.t_acct('Qa Bank')), public.t_paid('d0000030-0000-4000-8000-000000000001') $$,
  $$ values ('paid'::text, 800000::bigint, 8900000::bigint, 100000::bigint) $$,
  'the part-paid bill is closed (paid); 8,000.00 stays owed on the card');
select is((select (public.pay_due_item(public.t_bill('d0000030-0000-4000-8000-000000000001'), 'd0000003-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 100000, 0, 0)).id), public.t_dp('d0000003-0000-4000-8000-000000000001'),
  'double submit of pay_due_item on a card bill returns the same payment');
select results_eq(
  $$ select (select count(*)::int from public.due_payments where due_item_id = public.t_bill('d0000030-0000-4000-8000-000000000001')), public.t_dents(public.t_dp('d0000003-0000-4000-8000-000000000001'), false),
            public.t_bal(public.t_acct('Qa Bank')) $$,
  $$ values (1, 1, 8900000::bigint) $$,
  '... one payment, one transfer, the bank charged once');
select throws_ok($$ select public.pay_due_item(public.t_bill('d0000030-0000-4000-8000-000000000001'), 'd0000003-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 100001, 0, 0) $$,
  'FC007', null, 'the same key with a different principal is FC007');
-- A purchase of 3,000.00 and a free payment of 9,000.00: owed 8,000 + 3,000 - 9,000 = 2,000.00.
select lives_ok($$ select public.record_transaction('expense', 'd0000018-0000-4000-8000-000000000001', 300000, public.t_today(), public.t_card_acct('d0000007-0000-4000-8000-000000000001'), public.t_misc()) $$, 'a purchase of 3,000.00 on C3');
select lives_ok($$ select public.pay_card(public.t_card('d0000007-0000-4000-8000-000000000001'), 'd0000024-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 900000) $$, 'a free payment of 9,000.00 on C3');
select results_eq(
  $$ select public.liability_owed(public.t_card_acct('d0000007-0000-4000-8000-000000000001')), public.t_bill_status('d0000030-0000-4000-8000-000000000001'), public.t_paid('d0000030-0000-4000-8000-000000000001'), public.t_bal(public.t_acct('Qa Bank')) $$,
  $$ values (200000::bigint, 'paid'::text, 1000000::bigint, 8000000::bigint) $$,
  'transfers into the card total 10,000 (1,000 + 9,000) against a 9,000 bill');
select throws_ok($$ select public.pay_due_item(public.t_bill('d0000030-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('Qa Bank'), public.t_today(), 1000, 0, 0) $$,
  'FC034', null, 'a new payment on a paid bill is refused (FC034)');
-- Edit the Pay-bill payment 1,000 to 1,500: the void leaves the bill covered (9,000 by the free payment alone).
select lives_ok($$ select public.edit_due_payment(public.t_dp('d0000003-0000-4000-8000-000000000001'), 'd0000004-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 150000, 0, 0) $$,
  'A edits the Pay-bill payment although the bill is covered by free payments');
-- Owed 2,000 + 1,000 (undone) - 1,500 = 1,500.00; paid 9,000 + 1,500 = 10,500; bank 8,000,000 + 100,000 - 150,000 = 7,950,000.
select results_eq(
  $$ select public.t_dents(public.t_dp('d0000003-0000-4000-8000-000000000001'), false), public.t_dents(public.t_dp('d0000003-0000-4000-8000-000000000001'), true), public.t_dents(public.t_dp('d0000004-0000-4000-8000-000000000001'), false),
            (select t.amount_minor from public.transactions as t where t.due_payment_id = public.t_dp('d0000004-0000-4000-8000-000000000001') and t.voided_at is null),
            (select p.replaces_id = public.t_dp('d0000003-0000-4000-8000-000000000001') from public.due_payments as p where p.id = public.t_dp('d0000004-0000-4000-8000-000000000001')),
            public.t_bill_status('d0000030-0000-4000-8000-000000000001'), public.liability_owed(public.t_card_acct('d0000007-0000-4000-8000-000000000001')), public.t_paid('d0000030-0000-4000-8000-000000000001'), public.t_bal(public.t_acct('Qa Bank')) $$,
  $$ values (0, 1, 1, 150000::bigint, true, 'paid'::text, 150000::bigint, 1050000::bigint, 7950000::bigint) $$,
  'the old transfer is voided, one new 1,500 transfer replaces it, the bill stays paid');
select is((select (public.edit_due_payment(public.t_dp('d0000003-0000-4000-8000-000000000001'), 'd0000004-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 150000, 0, 0)).id), public.t_dp('d0000004-0000-4000-8000-000000000001'),
  'double submit of the Pay-bill edit returns the saved payment');
select results_eq(
  $$ select (select count(*)::int from public.due_payments where due_item_id = public.t_bill('d0000030-0000-4000-8000-000000000001')),
            (select count(*)::int from public.due_payments where due_item_id = public.t_bill('d0000030-0000-4000-8000-000000000001') and voided_at is null),
            public.t_bal(public.t_acct('Qa Bank')) $$,
  $$ values (2, 1, 7950000::bigint) $$,
  '... two payment rows (the voided one and its replacement), one active');
-- Void the new Pay-bill payment: still covered by the free payment (9,000 >= 9,000).
select lives_ok($$ select public.void_due_payment(public.t_dp('d0000004-0000-4000-8000-000000000001'), 'd0000039-0000-4000-8000-000000000001') $$, 'A voids the Pay-bill payment');
select results_eq(
  $$ select public.t_bill_status('d0000030-0000-4000-8000-000000000001'), public.liability_owed(public.t_card_acct('d0000007-0000-4000-8000-000000000001')), public.t_dents(public.t_dp('d0000004-0000-4000-8000-000000000001'), true),
            public.t_dents(public.t_dp('d0000004-0000-4000-8000-000000000001'), false), public.t_bal(public.t_acct('Qa Bank')) $$,
  $$ values ('paid'::text, 300000::bigint, 1, 0, 8100000::bigint) $$,
  'the free payment still covers the bill (paid); owed 3,000.00; the transfer is voided');
-- Void the free payment as well: nothing covers the bill any more.
select lives_ok($$ select public.void_liability_payment(public.t_lp('d0000024-0000-4000-8000-000000000001'), 'd0000040-0000-4000-8000-000000000001') $$, 'A voids the free payment');
select results_eq(
  $$ select public.t_bill_status('d0000030-0000-4000-8000-000000000001'), public.liability_owed(public.t_card_acct('d0000007-0000-4000-8000-000000000001')), public.t_paid('d0000030-0000-4000-8000-000000000001'), public.t_bal(public.t_acct('Qa Bank')), public.t_total() $$,
  $$ values ('pending'::text, 1200000::bigint, 0::bigint, 9000000::bigint, 9108000::bigint) $$,
  'the bill is pending; 12,000.00 owed; the bank and Total are back to 9,000,000 and 9,108,000');

-- ============================================================ boundaries: credit balance, archive
select lives_ok($$ select public.create_card('d0000006-0000-4000-8000-000000000001', 'Qa Beta', 5000000, 12, 2) $$, 'A adds card C2 (nothing owed)');
select lives_ok($$ select public.record_transaction('expense', 'd0000015-0000-4000-8000-000000000001', 50000, public.t_today(), public.t_card_acct('d0000006-0000-4000-8000-000000000001'), public.t_misc()) $$, 'a purchase of 500.00 on C2');
select lives_ok($$ select public.pay_card(public.t_card('d0000006-0000-4000-8000-000000000001'), 'd0000025-0000-4000-8000-000000000001', public.t_acct('Qa Bank'), public.t_today(), 50000) $$, 'A pays the 500.00');
select lives_ok($$ select public.void_transaction(public.t_tx('d0000015-0000-4000-8000-000000000001'), 'd0000041-0000-4000-8000-000000000001') $$, 'the purchase is refunded (voided) after it was paid');
select results_eq(
  $$ select public.liability_owed(public.t_card_acct('d0000006-0000-4000-8000-000000000001')), public.t_bal(public.t_card_acct('d0000006-0000-4000-8000-000000000001')) $$,
  $$ values (-50000::bigint, 50000::bigint) $$,
  'the card is 500.00 in credit: owed is negative');
select is(public.t_state(format('select public.set_card_archived(%L, true)', public.t_card('d0000006-0000-4000-8000-000000000001'))), 'FC045:-50000',
  'a card in credit cannot be archived (FC045, detail = minus 500.00)');
select lives_ok($$ select public.record_transaction('expense', 'd0000016-0000-4000-8000-000000000001', 50000, public.t_today(), public.t_card_acct('d0000006-0000-4000-8000-000000000001'), public.t_misc()) $$, 'a purchase of 500.00 brings it to zero');
select lives_ok($$ select public.set_card_archived(public.t_card('d0000006-0000-4000-8000-000000000001'), true) $$, 'a card at exactly zero is archived');
select results_eq(
  $$ select c.archived_at is not null, a.archived_at is not null, public.t_total() from public.credit_cards as c join public.accounts as a on a.id = c.account_id where c.idempotency_key = 'd0000006-0000-4000-8000-000000000001' $$,
  $$ values (true, true, 9058000::bigint) $$,
  '... with its account; Total 9,000,000 - 50,000 + 5,000 + 103,000 = 9,058,000');

-- ============================================================ boundaries: statement date and difference
-- C5: added today, statement dated today (the same day): owed is measured (1,000 purchase), difference 300.
select lives_ok($$ select public.create_card('d0000008-0000-4000-8000-000000000001', 'Qa Epsilon', 5000000, 15, 5) $$, 'A adds C5');
select lives_ok($$ select public.record_transaction('expense', 'd0000019-0000-4000-8000-000000000001', 100000, public.t_today(), public.t_card_acct('d0000008-0000-4000-8000-000000000001'), public.t_misc()) $$, 'a purchase of 1,000.00 on C5');
select lives_ok($$ select public.enter_card_statement(public.t_card('d0000008-0000-4000-8000-000000000001'), 'd0000031-0000-4000-8000-000000000001', public.t_today(), 130000, p_difference_category_id => public.t_misc()) $$,
  'a statement of 1,300.00 dated the day the card was added');
select results_eq(
  $$ select s.owed_at_statement_minor, s.difference_minor, t.amount_minor, t.type, t.occurred_on = s.statement_date, d.amount_due_minor, public.liability_owed(public.t_card_acct('d0000008-0000-4000-8000-000000000001'))
     from public.card_statements as s join public.transactions as t on t.id = s.difference_transaction_id
     join public.due_items as d on d.card_statement_id = s.id where s.idempotency_key = 'd0000031-0000-4000-8000-000000000001' $$,
  $$ values (100000::bigint, 30000::bigint, 30000::bigint, 'expense'::text, true, 130000::bigint, 130000::bigint) $$,
  'on the added date the purchase counts: owed 1,000, difference 300 posted on the statement date, owed 1,300');

-- C6: added owing 1,000.00; a statement dated the day before it was added measures nothing.
select lives_ok($$ select public.create_card('d0000009-0000-4000-8000-000000000001', 'Qa Zeta', 5000000, 15, 5, 100000) $$, 'A adds C6 owing 1,000.00');
select lives_ok($$ select public.enter_card_statement(public.t_card('d0000009-0000-4000-8000-000000000001'), 'd0000032-0000-4000-8000-000000000001', public.t_today() - 1, 130000, p_difference_category_id => public.t_misc()) $$,
  'a statement of 1,300.00 dated the day before the card was added, with a difference category');
select results_eq(
  $$ select s.owed_at_statement_minor, s.difference_minor, s.difference_transaction_id, d.amount_due_minor, public.liability_owed(public.t_card_acct('d0000009-0000-4000-8000-000000000001')),
            (select count(*)::int from public.transactions as t where t.account_id = public.t_card_acct('d0000009-0000-4000-8000-000000000001'))
     from public.card_statements as s join public.due_items as d on d.card_statement_id = s.id where s.idempotency_key = 'd0000032-0000-4000-8000-000000000001' $$,
  $$ values (null::bigint, 0::bigint, null::uuid, 130000::bigint, 100000::bigint, 0) $$,
  'nothing measured, no difference posted (even with a category); the bill is 1,300 while 1,000 is owed');
select is(public.t_state(format('select public.pay_due_item(%L, gen_random_uuid(), %L, %L, 130000, 0, 0)', public.t_bill('d0000032-0000-4000-8000-000000000001'), public.t_acct('Qa Bank'), public.t_today())),
  'FC047:100000', 'paying the whole 1,300 bill is refused: more than the 1,000 owed (FC047, detail = owed)');

-- C7: difference exactly 0, minimum equal to the bill, and a zero bill.
select lives_ok($$ select public.create_card('d0000010-0000-4000-8000-000000000001', 'Qa Eta', 5000000, 15, 5) $$, 'A adds C7');
select lives_ok($$ select public.record_transaction('expense', 'd0000020-0000-4000-8000-000000000001', 100000, public.t_today(), public.t_card_acct('d0000010-0000-4000-8000-000000000001'), public.t_misc()) $$, 'a purchase of 1,000.00 on C7');
select lives_ok($$ select public.enter_card_statement(public.t_card('d0000010-0000-4000-8000-000000000001'), 'd0000033-0000-4000-8000-000000000001', public.t_today(), 100000, 100000, p_difference_category_id => public.t_misc()) $$,
  'a statement that equals what is owed, minimum equal to the bill');
select results_eq(
  $$ select s.difference_minor, s.difference_transaction_id, d.amount_due_minor, d.minimum_due_minor, (select count(*)::int from public.transactions as t where t.account_id = public.t_card_acct('d0000010-0000-4000-8000-000000000001'))
     from public.card_statements as s join public.due_items as d on d.card_statement_id = s.id where s.idempotency_key = 'd0000033-0000-4000-8000-000000000001' $$,
  $$ values (0::bigint, null::uuid, 100000::bigint, 100000::bigint, 1) $$,
  'difference exactly 0 posts nothing; the minimum equals the bill (1,000); only the purchase is on the card');
select lives_ok($$ select public.enter_card_statement(public.t_card('d0000010-0000-4000-8000-000000000001'), 'd0000034-0000-4000-8000-000000000001', public.t_today() - 1, 40000, p_emi_included_minor => 40000) $$,
  'a statement made up only of card EMIs');
select results_eq(
  $$ select s.difference_minor, (select count(*)::int from public.due_items as d where d.card_statement_id = s.id) from public.card_statements as s where s.idempotency_key = 'd0000034-0000-4000-8000-000000000001' $$,
  $$ values (0::bigint, 0) $$, 'a bill of zero creates no due item');

-- C8: a bill below what is owed (EMIs), and a minimum larger than the bill.
select lives_ok($$ select public.create_card('d0000011-0000-4000-8000-000000000001', 'Qa Theta', 5000000, 15, 5) $$, 'A adds C8');
select lives_ok($$ select public.record_transaction('expense', 'd0000021-0000-4000-8000-000000000001', 100000, public.t_today(), public.t_card_acct('d0000011-0000-4000-8000-000000000001'), public.t_misc()) $$, 'a purchase of 1,000.00 on C8');
select lives_ok($$ select public.enter_card_statement(public.t_card('d0000011-0000-4000-8000-000000000001'), 'd0000035-0000-4000-8000-000000000001', public.t_today(), 100000, 90000, p_emi_included_minor => 40000, p_difference_category_id => public.t_misc()) $$,
  'a statement of 1,000.00 with 400.00 of card EMIs and a 900.00 minimum');
select results_eq(
  $$ select s.owed_at_statement_minor, s.difference_minor, d.amount_due_minor, d.minimum_due_minor, public.liability_owed(public.t_card_acct('d0000011-0000-4000-8000-000000000001'))
     from public.card_statements as s join public.due_items as d on d.card_statement_id = s.id where s.idempotency_key = 'd0000035-0000-4000-8000-000000000001' $$,
  $$ values (100000::bigint, 0::bigint, 60000::bigint, 60000::bigint, 100000::bigint) $$,
  'bill 600 = total - EMIs; a bill below what is owed gives no difference; the minimum is capped at the bill');

-- Day 31 and February (pure functions, hand-worked): the 31st clamps to the 28th / 29th and the next month's 31st.
select results_eq(
  $$ select public.card_cycle_date(31, date '2027-02-10'), public.card_cycle_date(31, date '2028-02-10'), public.card_cycle_date(30, date '2027-02-10'),
            public.card_cycle_date(29, date '2027-02-10'), public.card_cycle_date(29, date '2028-02-10'),
            public.card_due_date(date '2027-01-31', 31), public.card_due_date(date '2027-02-28', 31), public.card_due_date(date '2028-02-29', 31),
            public.card_due_date(date '2026-12-31', 5), public.card_due_date(date '2027-01-31', 30) $$,
  $$ values (date '2027-02-28', date '2028-02-29', date '2027-02-28', date '2027-02-28', date '2028-02-29',
             date '2027-02-28', date '2027-03-31', date '2028-03-31', date '2027-01-05', date '2027-02-28') $$,
  'day 29 / 30 / 31 clamp in February (28 and leap 29); the due date is the first due-day date after the statement');

-- ============================================================ 2: nothing digit-like is stored
-- C1's nickname is dropped: the account takes the issuer's name.
select lives_ok($$ select public.update_card(public.t_card('d0000005-0000-4000-8000-000000000001'), 'Qa  Alpha', 5000000, 20, 8) $$, 'A removes the nickname of C1');
select results_eq(
  $$ select a.name, a.institution, c.nickname is null from public.credit_cards as c join public.accounts as a on a.id = c.account_id where c.idempotency_key = 'd0000005-0000-4000-8000-000000000001' $$,
  $$ values ('Qa Alpha'::text, 'Qa Alpha'::text, true) $$,
  'the account name and institution come from the issuer (spaces collapsed)');
select lives_ok($$ select public.create_borrowing('d0000002-0000-4000-8000-000000000001', 'Meera Devi', 100000) $$, 'A records 1,000.00 owed to Meera, received earlier');
select is(public.t_state(format('select public.update_borrowing(%L, %L)', public.t_borrow('d0000002-0000-4000-8000-000000000001'), 'Meera  Devi Rao')), 'ok', 'a lender can be renamed');
select results_eq(
  $$ select a.name, b.lender from public.borrowings as b join public.accounts as a on a.id = b.account_id where b.idempotency_key = 'd0000002-0000-4000-8000-000000000001' $$,
  $$ values ('Meera Devi Rao'::text, 'Meera Devi Rao'::text) $$, '... and the account follows the lender (spaces collapsed)');

select is((select bool_and(public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 1, 1)', 'Ba' || d::text || 'nk'))) from generate_series(0, 9) as d), true,
  'create_card refuses each digit 0 to 9 in the issuer');
select is((select bool_and(public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 1, 1, 0, %L)', 'Bank', 'Ca' || d::text || 'rd'))) from generate_series(0, 9) as d), true,
  'create_card refuses each digit 0 to 9 in the nickname');
select is((select bool_and(public.t_refused(format('select public.create_borrowing(gen_random_uuid(), %L, 1000)', 'Ra' || d::text || 'vi'))) from generate_series(0, 9) as d), true,
  'create_borrowing refuses each digit 0 to 9 in the lender');
select is((select bool_and(public.t_refused(format('select public.update_card(%L, %L, 5000000, 20, 8)', public.t_card('d0000005-0000-4000-8000-000000000001'), 'Ba' || d::text || 'nk'))) from generate_series(0, 9) as d), true,
  'update_card refuses each digit 0 to 9 in the issuer');
select is((select bool_and(public.t_refused(format('select public.update_card(%L, %L, 5000000, 20, 8, %L)', public.t_card('d0000005-0000-4000-8000-000000000001'), 'Qa Alpha', 'Ca' || d::text || 'rd'))) from generate_series(0, 9) as d), true,
  'update_card refuses each digit 0 to 9 in the nickname');
select is((select bool_and(public.t_refused(format('select public.update_borrowing(%L, %L)', public.t_borrow('d0000002-0000-4000-8000-000000000001'), 'Ra' || d::text || 'vi'))) from generate_series(0, 9) as d), true,
  'update_borrowing refuses each digit 0 to 9 in the lender');
select results_eq(
  $$ select c.issuer, a.name, (select b.lender from public.borrowings as b where b.idempotency_key = 'd0000002-0000-4000-8000-000000000001')
     from public.credit_cards as c join public.accounts as a on a.id = c.account_id where c.idempotency_key = 'd0000005-0000-4000-8000-000000000001' $$,
  $$ values ('Qa Alpha'::text, 'Qa Alpha'::text, 'Meera Devi Rao'::text) $$,
  'the refused updates changed nothing');
select results_eq(
  $$ select (select count(*)::int from public.accounts where public.is_liability_kind(kind) and last4 is not null),
            (select count(*)::int from public.accounts where public.is_liability_kind(kind) and (name ~ '[0-9]' or coalesce(institution, '') ~ '[0-9]')),
            (select count(*)::int from public.credit_cards where issuer ~ '[0-9]' or coalesce(nickname, '') ~ '[0-9]'),
            (select count(*)::int from public.borrowings where lender ~ '[0-9]') $$,
  $$ values (0, 0, 0, 0) $$,
  'no liability account has a last4 or a digit in its name or institution; no card or lender name has a digit');
select throws_ok($$ update public.accounts set last4 = '1234' where id = public.t_card_acct('d0000005-0000-4000-8000-000000000001') $$,
  'FC032', null, 'a client cannot give a card account a number');
select throws_ok($$ insert into public.accounts (kind, name, last4, currency, opening_balance_minor, opening_balance_date) values ('borrowing', 'Sneaky', '1234', 'INR', 0, public.t_today()) $$,
  'FC032', null, 'nor create a borrowing account with one');

-- Unicode digits (full-width, Arabic-Indic, Devanagari) are digits to a person but not to [0-9].
-- FINDING (application): credit_cards_issuer / credit_cards_nickname / borrowings_lender and the
-- zod HAS_DIGIT (/\d/, no u flag) test ASCII digits only. Marked TODO so CI stays green; they pass once fixed.
select todo_start('FINDING: non-ASCII digits get past the no-digits rule ([0-9] and /\d/ are ASCII only)');
select ok(public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 1, 1)', 'Bank ' || chr(65297) || chr(65298))), 'a full-width digit in the issuer is refused');
select ok(public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 1, 1)', 'Bank ' || chr(1635))), 'an Arabic-Indic digit in the issuer is refused');
select ok(public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 1, 1)', 'Bank ' || chr(2410))), 'a Devanagari digit in the issuer is refused');
select ok(public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 1, 1, 0, %L)', 'Bank', 'Card ' || chr(65297))), 'a full-width digit in the nickname is refused');
select ok(public.t_refused(format('select public.create_borrowing(gen_random_uuid(), %L, 1000)', 'Ravi ' || chr(2410))), 'a Devanagari digit in the lender is refused');
select todo_end();

-- ============================================================ 3: RLS isolation (as B, with A's ids)
reset role;
-- A's card account carries a last4? The CHECK holds even for a writer that passes the guard.
select throws_ok($$ select set_config('fin_creador.loan_write', 'on', true); update public.accounts set last4 = '1234' where id = public.t_card_acct('d0000005-0000-4000-8000-000000000001') $$,
  '23514', null, 'even with the write mark, the database refuses a number on a liability account (accounts_liability_no_number)');
create temporary table t_ids on commit drop as
  select (select id from public.credit_cards where idempotency_key = 'd0000005-0000-4000-8000-000000000001') as card_id,
         (select account_id from public.credit_cards where idempotency_key = 'd0000005-0000-4000-8000-000000000001') as card_acct,
         (select id from public.card_statements where idempotency_key = 'd0000029-0000-4000-8000-000000000001') as stmt_id,
         (select d.id from public.due_items as d join public.card_statements as s on s.id = d.card_statement_id where s.idempotency_key = 'd0000029-0000-4000-8000-000000000001') as bill_id,
         (select id from public.borrowings where idempotency_key = 'd0000001-0000-4000-8000-000000000001') as borrow_id,
         (select account_id from public.borrowings where idempotency_key = 'd0000001-0000-4000-8000-000000000001') as borrow_acct,
         (select id from public.liability_payments where idempotency_key = 'd0000026-0000-4000-8000-000000000001') as pay_id,
         (select id from public.liability_payments where idempotency_key = 'd0000013-0000-4000-8000-000000000001') as bpay_id,
         (select id from public.accounts where name = 'Qa Bank') as bank_id;
grant select on t_ids to authenticated;
-- A's bill and the borrowing's due date are really paid; make both stored statuses stale ('pending') so that a
-- sync that ran with A's rights would flip them back to 'paid'.
select results_eq(
  $$ select (select status from public.due_items where id = (select bill_id from t_ids)),
            (select status from public.due_items where borrowing_id = (select borrow_id from t_ids)) $$,
  $$ values ('paid'::text, 'paid'::text) $$, 'A''s card bill and borrowing due date are paid before B acts');
select set_config('fin_creador.loan_write', 'on', true);
update public.due_items set status = 'pending' where id = (select bill_id from t_ids) or borrowing_id = (select borrow_id from t_ids);
select set_config('fin_creador.loan_write', '', true);

select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
set local role authenticated;

select results_eq(
  $$ select (select count(*)::int from public.credit_cards), (select count(*)::int from public.card_statements), (select count(*)::int from public.borrowings),
            (select count(*)::int from public.liability_payments), (select count(*)::int from public.card_bill_progress), (select count(*)::int from public.due_items),
            (select count(*)::int from public.accounts), (select count(*)::int from public.account_balances), (select count(*)::int from public.transactions) $$,
  $$ values (0, 0, 0, 0, 0, 0, 0, 0, 0) $$,
  'B reads none of A''s cards, statements, borrowings, payments, bill progress, due items, accounts, balances or entries');
select lives_ok(
  $$ update public.credit_cards set issuer = 'Hacked';
     update public.borrowings set lender = 'Hacked';
     update public.liability_payments set void_reason = 'Hacked';
     update public.accounts set name = 'Hacked';
     update public.due_items set planned_on = null, planned_account_id = null $$,
  'B''s direct updates run against no rows (RLS hides A''s)');
select throws_ok($$ delete from public.credit_cards $$, '42501', null, 'B cannot delete cards');
select throws_ok($$ delete from public.liability_payments $$, '42501', null, 'B cannot delete payments');
select throws_ok($$ insert into public.credit_cards (user_id, account_id, issuer, currency, limit_minor, statement_day, due_day, opening_owed_minor, tracking_started_on, idempotency_key)
                    values ('11111111-1111-4111-8111-111111111111', (select card_acct from t_ids), 'X', 'INR', 1, 1, 1, 0, current_date, gen_random_uuid()) $$,
  '42501', null, 'B cannot choose A as the owner of a card');
select throws_ok($$ insert into public.credit_cards (account_id, issuer, currency, limit_minor, statement_day, due_day, opening_owed_minor, tracking_started_on, idempotency_key)
                    values ((select card_acct from t_ids), 'X', 'INR', 1, 1, 1, 0, current_date, gen_random_uuid()) $$,
  'FC032', null, 'nor add a card row directly on A''s account');

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
  values ('bank', 'savings', 'Qb Bank', 'INR', 1000000, public.t_today() - 30);

select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Mallory', 100, (select bank_id from t_ids), public.t_today() - 1) $$,
  'FC010', null, 'B cannot receive a borrowing into A''s account');
select throws_ok($$ select public.post_liability_payment((select card_acct from t_ids), gen_random_uuid(), public.t_acct('Qb Bank'), public.t_today(), 1) $$,
  'FC010', null, 'post_liability_payment on A''s card account finds nothing');
select throws_ok($$ select public.pay_card((select card_id from t_ids), gen_random_uuid(), public.t_acct('Qb Bank'), public.t_today(), 1) $$,
  'FC008', null, 'B cannot pay A''s card');
select throws_ok($$ select public.repay_borrowing((select borrow_id from t_ids), gen_random_uuid(), public.t_acct('Qb Bank'), public.t_today(), 1) $$,
  'FC008', null, 'B cannot repay A''s borrowing');
select throws_ok($$ select public.void_liability_payment((select pay_id from t_ids), gen_random_uuid()) $$,
  'FC008', null, 'B cannot void A''s card payment');
select throws_ok($$ select public.edit_liability_payment((select pay_id from t_ids), gen_random_uuid(), public.t_acct('Qb Bank'), public.t_today(), 1) $$,
  'FC008', null, 'B cannot edit A''s card payment');
select throws_ok($$ select public.pay_due_item((select bill_id from t_ids), gen_random_uuid(), public.t_acct('Qb Bank'), public.t_today(), 1, 0, 0) $$,
  'FC008', null, 'B cannot pay A''s card bill');
select throws_ok($$ select public.enter_card_statement((select card_id from t_ids), gen_random_uuid(), public.t_today(), 1) $$,
  'FC008', null, 'B cannot enter a statement on A''s card');
select throws_ok($$ select public.update_card((select card_id from t_ids), 'Hacked', 1000, 1, 1) $$, 'FC008', null, 'B cannot edit A''s card');
select throws_ok($$ select public.update_borrowing((select borrow_id from t_ids), 'Hacked') $$, 'FC008', null, 'B cannot edit A''s borrowing');
select throws_ok($$ select public.set_card_archived((select card_id from t_ids), true) $$, 'FC008', null, 'B cannot archive A''s card');
select throws_ok($$ select public.set_borrowing_archived((select borrow_id from t_ids), false) $$, 'FC008', null, 'B cannot restore A''s borrowing');
select throws_ok($$ select public.delete_card((select card_id from t_ids)) $$, 'FC008', null, 'B cannot delete A''s card');
select throws_ok($$ select public.delete_borrowing((select borrow_id from t_ids)) $$, 'FC008', null, 'B cannot delete A''s borrowing');
select throws_ok($$ select public.delete_card_statement((select stmt_id from t_ids)) $$, 'FC008', null, 'B cannot delete A''s statement');
select throws_ok($$ select public.set_borrowing_due_date((select borrow_id from t_ids), public.t_today() + 5) $$, 'FC008', null, 'B cannot move A''s borrowing due date');

select lives_ok($$ select public.card_sync_due((select card_id from t_ids)); select public.borrowing_sync_due((select borrow_id from t_ids)) $$,
  'card_sync_due and borrowing_sync_due with A''s ids run against nothing');
select results_eq(
  $$ select public.card_bill_paid((select bill_id from t_ids)), public.liability_owed((select card_acct from t_ids)) is null,
            public.liability_owed((select borrow_acct from t_ids)) is null, public.t_bal((select card_acct from t_ids)) is null $$,
  $$ values (0::bigint, true, true, true) $$,
  'card_bill_paid gives 0 and liability_owed / balances give nothing for A''s ids');

-- B's own cards and payments, under request keys A also used: keys are per user.
select lives_ok($$ select public.create_card('d0000005-0000-4000-8000-000000000001', 'Qb Issuer', 1000000, 5, 25, 600000) $$, 'B adds a card under a request key A used');
select lives_ok($$ select public.pay_card(public.t_card('d0000005-0000-4000-8000-000000000001'), 'd0000022-0000-4000-8000-000000000001', public.t_acct('Qb Bank'), public.t_today(), 50000) $$, 'B pays it under a payment key A used');
-- Bank 1,000,000 - 50,000 = 950,000: B's Total is B's alone.
select results_eq(
  $$ select public.t_total(), (select count(*)::int from public.credit_cards), (select count(*)::int from public.liability_payments), public.liability_owed(public.t_card_acct('d0000005-0000-4000-8000-000000000001')) $$,
  $$ values (950000::bigint, 1, 1, 550000::bigint) $$,
  'B''s totals, card and payment are B''s own (owed 6,000 - 500 = 5,500)');

reset role;
select results_eq(
  $$ select (select count(*)::int from public.credit_cards where issuer = 'Hacked'), (select count(*)::int from public.borrowings where lender = 'Hacked'),
            (select count(*)::int from public.liability_payments where void_reason = 'Hacked'), (select count(*)::int from public.accounts where name = 'Hacked'),
            (select count(*)::int from public.liability_payments where idempotency_key = 'd0000022-0000-4000-8000-000000000001'),
            (select status from public.due_items where id = (select bill_id from t_ids)),
            (select status from public.due_items where borrowing_id = (select borrow_id from t_ids)),
            (select archived_at is not null from public.credit_cards where id = (select card_id from t_ids)) $$,
  $$ values (0, 0, 0, 0, 2, 'pending'::text, 'pending'::text, false) $$,
  'nothing of A''s changed: B''s syncs left the stale statuses alone; each user has one payment under the shared key');

-- ============================================================ 3: anon
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select count(*) from public.credit_cards $$, '42501', null, 'anon cannot read cards');
select throws_ok($$ select count(*) from public.card_statements $$, '42501', null, 'anon cannot read statements');
select throws_ok($$ select count(*) from public.borrowings $$, '42501', null, 'anon cannot read borrowings');
select throws_ok($$ select count(*) from public.liability_payments $$, '42501', null, 'anon cannot read card and borrowing payments');
select throws_ok($$ select count(*) from public.card_bill_progress $$, '42501', null, 'anon cannot read bill progress');
select throws_ok($$ insert into public.credit_cards (account_id, issuer, currency, limit_minor, statement_day, due_day, opening_owed_minor, tracking_started_on, idempotency_key)
                    values (gen_random_uuid(), 'X', 'INR', 1, 1, 1, 0, current_date, gen_random_uuid()) $$,
  '42501', null, 'anon cannot add a card');
select throws_ok($$ select public.create_card(gen_random_uuid(), 'X', 1, 1, 1) $$, '42501', null, 'anon cannot call create_card');
select throws_ok($$ select public.post_liability_payment(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), current_date, 1) $$, '42501', null, 'anon cannot call post_liability_payment');
select throws_ok($$ select public.card_sync_due(gen_random_uuid()) $$, '42501', null, 'anon cannot call card_sync_due');
select throws_ok($$ select public.liability_owed(gen_random_uuid()) $$, '42501', null, 'anon cannot call liability_owed');
select is((select count(*)::int from (values
    ('public.liability_owed(uuid, date)'), ('public.card_cycle_date(integer, date)'), ('public.card_due_date(date, integer)'),
    ('public.create_card(uuid, text, bigint, integer, integer, bigint, text)'), ('public.update_card(uuid, text, bigint, integer, integer, text)'),
    ('public.set_card_archived(uuid, boolean)'), ('public.delete_card(uuid)'), ('public.link_card_emi(uuid, uuid)'),
    ('public.enter_card_statement(uuid, uuid, date, bigint, bigint, date, bigint, uuid)'), ('public.delete_card_statement(uuid)'),
    ('public.borrowing_sync_due(uuid)'), ('public.card_bill_paid(uuid)'), ('public.card_sync_due(uuid)'),
    ('public.create_borrowing(uuid, text, bigint, uuid, date, date)'), ('public.update_borrowing(uuid, text)'),
    ('public.set_borrowing_due_date(uuid, date)'), ('public.set_borrowing_archived(uuid, boolean)'), ('public.delete_borrowing(uuid)'),
    ('public.post_liability_payment(uuid, uuid, uuid, date, bigint, bigint, boolean, uuid)'), ('public.pay_card(uuid, uuid, uuid, date, bigint, boolean)'),
    ('public.repay_borrowing(uuid, uuid, uuid, date, bigint, bigint, boolean)'), ('public.void_liability_payment(uuid, uuid, text)'),
    ('public.edit_liability_payment(uuid, uuid, uuid, date, bigint, bigint, boolean)')
  ) as f(sig) where has_function_privilege('anon', f.sig, 'EXECUTE')), 0, 'anon can execute none of the 23 card and borrowing functions');

reset role;
select * from finish();
rollback;
