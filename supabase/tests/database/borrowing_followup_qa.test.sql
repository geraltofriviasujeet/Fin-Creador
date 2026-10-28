-- QA pgTAP tests for the Sprint 8b follow-up (migration 20261028210000), added on top of
-- borrowing_followup.test.sql: Total available through plans and repayments, first-in first-out
-- status and borrowing_due_progress (part-paid, prepaid, principal cleared, void, edit), RLS
-- isolation and anon, digits in any script (database), double submits and void / edit of
-- repayments. Expected values are worked out by hand in the comments (paise). Rolled back.
-- No fixed plan(): the count is not checked against a number (the file is run in CI only).
begin;
create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('55555555-5555-4555-8555-555555555555', 'qa8-asha@example.test'),
  ('66666666-6666-4666-8666-666666666666', 'qa8-bala@example.test');

-- Helpers (SECURITY INVOKER: RLS applies to whoever calls them).
create function public.t_today() returns date language sql stable set search_path = ''
  as $$ select public.user_local_today((select auth.uid())) $$;
create function public.t_acct(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select a.id from public.accounts as a where a.name = p_name and a.kind in ('bank', 'cash', 'other') $$;
create function public.t_borrow(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select b.id from public.borrowings as b where b.idempotency_key = p_key $$;
create function public.t_bal(p_account uuid) returns bigint language sql stable set search_path = ''
  as $$ select a.opening_balance_minor + b.inflow_minor - b.outflow_minor
        from public.accounts as a join public.account_balances as b on b.account_id = a.id where a.id = p_account $$;
create function public.t_lp(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select p.id from public.liability_payments as p where p.idempotency_key = p_key $$;
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
-- The borrowing's due items as 'seq:status:amount:interest' in seq order.
create function public.t_items(p_key uuid) returns text language sql stable set search_path = ''
  as $$ select coalesce(string_agg(d.seq || ':' || d.status || ':' || d.amount_due_minor || ':' || d.interest_minor, ' ' order by d.seq), '')
        from public.due_items as d where d.borrowing_id = public.t_borrow(p_key) $$;
-- What is left of each item as 'seq:remaining:interest:principal' in seq order.
create function public.t_left(p_key uuid) returns text language sql stable set search_path = ''
  as $$ select coalesce(string_agg(p.seq || ':' || p.remaining_minor || ':' || p.remaining_interest_minor || ':' || p.remaining_principal_minor, ' ' order by p.seq), '')
        from public.borrowing_due_progress as p where p.borrowing_id = public.t_borrow(p_key) $$;
-- Entries (transactions) of a repayment, active (p_voided false) or voided (true).
create function public.t_ents(p_payment uuid, p_voided boolean) returns integer language sql stable set search_path = ''
  as $$ select count(*)::int from public.transactions as t
        where t.liability_payment_id = p_payment and (t.voided_at is not null) = p_voided $$;
-- One digit per script: full-width, Devanagari, Arabic-Indic, mathematical, superscript, subscript, ASCII.
create function public.t_digits() returns table (d text) language sql immutable set search_path = ''
  as $$ values (chr(65297)), (chr(2407)), (chr(1633)), (chr(120782)), (chr(178)), (chr(8324)), ('7') $$;
-- True when the statement is refused by a CHECK constraint (nothing is saved then).
create function public.t_refused(p_sql text) returns boolean language plpgsql set search_path = '' as $$
begin
  execute p_sql;
  return false;
exception when check_violation then
  return true;
end $$;
-- Row count of a query; -1 when the role has no privilege on it (also fine for "no access").
create function public.t_rows(p_sql text) returns integer language plpgsql set search_path = '' as $$
declare
  v_n integer;
begin
  execute p_sql into v_n;
  return v_n;
exception when insufficient_privilege then
  return -1;
end $$;
grant execute on function public.t_today(), public.t_acct(text), public.t_borrow(uuid), public.t_bal(uuid), public.t_lp(uuid),
  public.t_total(), public.t_sum_all(), public.t_items(uuid), public.t_left(uuid), public.t_ents(uuid, boolean),
  public.t_refused(text), public.t_rows(text), public.t_digits() to authenticated;
grant execute on function public.t_rows(text) to anon;

-- ============================================================ as A: accounts
select set_config('request.jwt.claims', '{"sub": "55555555-5555-4555-8555-555555555555", "role": "authenticated"}', true);
set local role authenticated;

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('bank', 'savings', 'Qa Bank', 'INR', 10000000, public.t_today() - 30);
insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date) values
  ('cash', 'Qa Cash', 'INR', 500000, public.t_today() - 30),
  ('other', 'Qa Spare', 'INR', 0, public.t_today() - 30);

-- ============================================================ 2: Total available
-- Baseline: 10,000,000 + 500,000 + 0 = 10,500,000.
select is(public.t_total(), 10500000::bigint, 'baseline: Total available is bank + cash + spare');

-- Tara lends 600.00 into cash (+60,000); 700.00 to return in 2 instalments from the bank.
select lives_ok(
  $$ select public.create_borrowing('d1000000-0000-4000-8000-000000000003', 'Tara', 60000, 'friends', null, 70000,
       public.t_acct('Qa Cash'), public.t_today() - 2, public.t_today() + 5, 'instalments', 2, public.t_acct('Qa Bank')) $$,
  'A borrows 600.00 from Tara into cash, 700.00 to return in 2 instalments');
select is(public.t_total(), 10560000::bigint, 'Total available rose by exactly the 600.00 received (10,500,000 + 60,000)');
-- 70,000 / 2 = 35,000 each; extra 10,000: floor(10,000 x 35,000 / 70,000) = 5,000 each.
select is(public.t_items('d1000000-0000-4000-8000-000000000003'), '1:pending:35000:5000 2:pending:35000:5000', 'two instalments of 350.00 with 50.00 interest');

select lives_ok($$ select public.set_borrowing_return_plan(public.t_borrow('d1000000-0000-4000-8000-000000000003'), 65000,
                     public.t_today() + 8, 'once', null, public.t_acct('Qa Cash')) $$, 'the plan becomes one payment of 650.00 from cash');
select is(public.t_total(), 10560000::bigint, '... Total available is unchanged');
select is(public.t_items('d1000000-0000-4000-8000-000000000003'), '0:pending:65000:5000', '... one item, 50.00 interest');

-- 65,000 / 3 = 21,666 (last 21,668); extra 5,000: through 1 = floor(5,000 x 21,666 / 65,000) = 1,666;
-- through 2 = floor(5,000 x 43,332 / 65,000) = 3,333; through 3 = 5,000.
select lives_ok($$ select public.set_borrowing_return_plan(public.t_borrow('d1000000-0000-4000-8000-000000000003'), 65000,
                     public.t_today() + 8, 'instalments', 3, public.t_acct('Qa Bank')) $$, 'the plan becomes 3 instalments');
select is(public.t_total(), 10560000::bigint, '... Total available is unchanged');
select is(public.t_items('d1000000-0000-4000-8000-000000000003'), '1:pending:21666:1666 2:pending:21666:1667 3:pending:21668:1667', '... 216.66, 216.66, 216.68');

select lives_ok($$ update public.due_items set planned_on = public.t_today() + 3, planned_account_id = public.t_acct('Qa Spare')
                   where borrowing_id = public.t_borrow('d1000000-0000-4000-8000-000000000003') and seq = 2 $$, 'Will pay later on the second instalment');
select is(public.t_total(), 10560000::bigint, '... Total available is unchanged');
select lives_ok($$ select public.update_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000003'), 'Tara M', 'family', 'Trip') $$, 'the details are edited');
select is(public.t_total(), 10560000::bigint, '... Total available is unchanged');

-- Repay 200.00 principal + 10.00 interest from the bank: Total available falls by 21,000.
select lives_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000003'), 'd2000000-0000-4000-8000-000000000003',
                     public.t_acct('Qa Bank'), public.t_today(), 20000, 1000) $$, 'A repays 200.00 and 10.00 interest from the bank');
select is(public.t_total(), 10539000::bigint, '... Total available fell by exactly 210.00 (10,560,000 - 21,000)');
select lives_ok($$ select public.void_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000003'), 'd3000000-0000-4000-8000-000000000003') $$, 'the repayment is voided');
select is(public.t_total(), 10560000::bigint, '... Total available is back');
select lives_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000003'), 'd2000000-0000-4000-8000-000000000004',
                     public.t_acct('Qa Bank'), public.t_today(), 20000, 1000) $$, 'repaid again');
select lives_ok($$ select public.edit_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000004'), 'd4000000-0000-4000-8000-000000000001',
                     public.t_acct('Qa Bank'), public.t_today(), 15000, 0) $$, 'the repayment is edited to 150.00 and no interest');
select is(public.t_total(), 10545000::bigint, '... Total available is 10,560,000 - 15,000');
-- Owed 60,000 - 15,000 = 45,000 sits in the borrowing account (-45,000): not in Total available.
select is(public.t_sum_all(), 10500000::bigint, 'all accounts together: 10,545,000 - 45,000 owed; Total available leaves the borrowing out');

-- ============================================================ 1: first in, first out
-- Ravi: 900.00 borrowed into the bank, 1,000.00 to return in 4 instalments of 250.00 with 25.00 interest.
select lives_ok(
  $$ select public.create_borrowing('d1000000-0000-4000-8000-000000000001', 'Ravi Fifo', 90000, 'friends', null, 100000,
       public.t_acct('Qa Bank'), public.t_today() - 5, public.t_today() + 10, 'instalments', 4, public.t_acct('Qa Bank')) $$,
  'A borrows 900.00 from Ravi, 1,000.00 to return in 4 instalments');
select is(public.t_items('d1000000-0000-4000-8000-000000000001'), '1:pending:25000:2500 2:pending:25000:2500 3:pending:25000:2500 4:pending:25000:2500',
  '4 pending instalments of 250.00 (25.00 interest each)');
select is(public.t_left('d1000000-0000-4000-8000-000000000001'), '1:25000:2500:22500 2:25000:2500:22500 3:25000:2500:22500 4:25000:2500:22500', 'nothing repaid: all left');

-- (a) 200.00 repaid before any due date: the first instalment is part-paid and stays pending.
select lives_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000001'), 'd2000000-0000-4000-8000-000000000011',
                     public.t_acct('Qa Bank'), public.t_today(), 20000) $$, 'A repays 200.00 principal, ahead of the first due date');
select is(public.t_items('d1000000-0000-4000-8000-000000000001'), '1:pending:25000:2500 2:pending:25000:2500 3:pending:25000:2500 4:pending:25000:2500',
  'a part-paid first instalment is still pending');
-- item 1: 25,000 - 20,000 = 5,000 left, interest (2,500) already covered; items 2-4 whole.
select is(public.t_left('d1000000-0000-4000-8000-000000000001'), '1:5000:0:5000 2:25000:2500:22500 3:25000:2500:22500 4:25000:2500:22500',
  '... 50.00 left of it, all principal (interest first)');

-- (b) 400.00 principal + 50.00 interest more: 650.00 repaid in all covers items 1 and 2 (cumulative 250 and 500), 150.00 into item 3.
select lives_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000001'), 'd2000000-0000-4000-8000-000000000012',
                     public.t_acct('Qa Bank'), public.t_today(), 40000, 5000) $$, 'A pays 450.00 more, more than the first instalment');
select is(public.t_items('d1000000-0000-4000-8000-000000000001'), '1:paid:25000:2500 2:paid:25000:2500 3:pending:25000:2500 4:pending:25000:2500',
  'the first two instalments are paid, in order');
-- owed = 900 - 600 = 300.00. Item 3: cumulative 750 - 650 = 100.00 left, interest covered. Item 4 whole.
select is(public.t_left('d1000000-0000-4000-8000-000000000001'), '1:0:0:0 2:0:0:0 3:10000:0:10000 4:25000:2500:22500', '... 100.00 left of the third');

-- (c) void the first payment (200.00): repaid 450.00 covers item 1 only (cumulative 250), 200.00 into item 2.
select lives_ok($$ select public.void_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000011'), 'd3000000-0000-4000-8000-000000000011') $$,
  'the 200.00 repayment is voided');
select is(public.t_items('d1000000-0000-4000-8000-000000000001'), '1:paid:25000:2500 2:pending:25000:2500 3:pending:25000:2500 4:pending:25000:2500',
  'the second instalment is pending again');
-- owed = 900 - 400 = 500.00. Item 2: cumulative 500 - 450 = 50.00 left (interest covered).
select is(public.t_left('d1000000-0000-4000-8000-000000000001'), '1:0:0:0 2:5000:0:5000 3:25000:2500:22500 4:25000:2500:22500', '... 50.00 left of it');

-- (d) edit the 450.00 payment to 400.00 principal and no interest: repaid 400.00, item 1 only.
select lives_ok($$ select public.edit_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000012'), 'd4000000-0000-4000-8000-000000000011',
                     public.t_acct('Qa Bank'), public.t_today(), 40000, 0) $$, 'the 450.00 repayment is edited to 400.00, no interest');
select is(public.t_items('d1000000-0000-4000-8000-000000000001'), '1:paid:25000:2500 2:pending:25000:2500 3:pending:25000:2500 4:pending:25000:2500',
  'first paid, the rest pending');
-- owed 500.00. Item 2: 500 - 400 = 100.00 left, interest (25.00) covered by the 150.00 that went into it.
select is(public.t_left('d1000000-0000-4000-8000-000000000001'), '1:0:0:0 2:10000:0:10000 3:25000:2500:22500 4:25000:2500:22500', '... 100.00 left of the second');
-- edit up: 400.00 + 100.00 interest = 500.00 repaid, items 1 and 2 paid. Owed stays 500.00.
select lives_ok($$ select public.edit_liability_payment(public.t_lp('d4000000-0000-4000-8000-000000000011'), 'd4000000-0000-4000-8000-000000000012',
                     public.t_acct('Qa Bank'), public.t_today(), 40000, 10000) $$, 'edited again, to 400.00 principal and 100.00 interest');
select is(public.t_items('d1000000-0000-4000-8000-000000000001'), '1:paid:25000:2500 2:paid:25000:2500 3:pending:25000:2500 4:pending:25000:2500',
  'the first two are paid');
select is(public.t_left('d1000000-0000-4000-8000-000000000001'), '1:0:0:0 2:0:0:0 3:25000:2500:22500 4:25000:2500:22500', '... the third is whole');
select lives_ok($$ select public.void_liability_payment(public.t_lp('d4000000-0000-4000-8000-000000000012'), 'd3000000-0000-4000-8000-000000000012') $$,
  'the last repayment is voided');
select is(public.t_items('d1000000-0000-4000-8000-000000000001'), '1:pending:25000:2500 2:pending:25000:2500 3:pending:25000:2500 4:pending:25000:2500',
  'everything pending again');
select is(public.t_left('d1000000-0000-4000-8000-000000000001'), '1:25000:2500:22500 2:25000:2500:22500 3:25000:2500:22500 4:25000:2500:22500', '... nothing repaid');

-- (e) paying all the principal (900.00) closes every instalment although interest (100.00) is short.
select lives_ok(
  $$ select public.create_borrowing('d1000000-0000-4000-8000-000000000002', 'Ravi Two', 90000, 'friends', null, 100000,
       public.t_acct('Qa Bank'), public.t_today() - 5, public.t_today() + 10, 'instalments', 4, public.t_acct('Qa Bank')) $$, 'a second borrowing, same terms');
select lives_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000002'), 'd2000000-0000-4000-8000-000000000021',
                     public.t_acct('Qa Bank'), public.t_today(), 90000) $$, 'A repays the whole 900.00 principal');
select is(public.t_items('d1000000-0000-4000-8000-000000000002'), '1:paid:25000:2500 2:paid:25000:2500 3:paid:25000:2500 4:paid:25000:2500',
  'all four paid (the last by "nothing owed": 900.00 < 1,000.00 cumulative)');
select is(public.t_left('d1000000-0000-4000-8000-000000000002'), '1:0:0:0 2:0:0:0 3:0:0:0 4:0:0:0', '... nothing left');
select lives_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000002'), 'd2000000-0000-4000-8000-000000000022',
                     public.t_acct('Qa Bank'), public.t_today(), 0, 10000) $$, 'the 100.00 interest is paid later');
select is(public.t_items('d1000000-0000-4000-8000-000000000002'), '1:paid:25000:2500 2:paid:25000:2500 3:paid:25000:2500 4:paid:25000:2500', '... still all paid');
-- Void the principal: owed 900.00 again; the 100.00 interest alone covers 100.00 of item 1 (cumulative 250.00 not reached).
select lives_ok($$ select public.void_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000021'), 'd3000000-0000-4000-8000-000000000021') $$,
  'the principal repayment is voided');
select is(public.t_items('d1000000-0000-4000-8000-000000000002'), '1:pending:25000:2500 2:pending:25000:2500 3:pending:25000:2500 4:pending:25000:2500',
  'every instalment is pending again');
-- repaid 100.00: item 1 has 150.00 left; its 25.00 interest is covered (interest first); items 2-4 whole.
select is(public.t_left('d1000000-0000-4000-8000-000000000002'), '1:15000:0:15000 2:25000:2500:22500 3:25000:2500:22500 4:25000:2500:22500',
  'repaid interest counts first in first out');

-- ============================================================ 5 + 6: double submits, void, edit
-- Dev: 800.00 into the bank 3 days ago, same to return, 2 instalments of 400.00 (no interest).
select set_config('t.bank0', public.t_bal(public.t_acct('Qa Bank'))::text, true);
select lives_ok(
  $$ select public.create_borrowing('d1000000-0000-4000-8000-000000000004', 'Dev', 80000, 'friends', 'Shop', null,
       public.t_acct('Qa Bank'), public.t_today() - 3, public.t_today() + 20, 'instalments', 2, public.t_acct('Qa Bank')) $$, 'A borrows 800.00 from Dev');
select is(
  (select (public.create_borrowing('d1000000-0000-4000-8000-000000000004', 'Dev', 80000, 'friends', 'Shop', null,
     public.t_acct('Qa Bank'), public.t_today() - 3, public.t_today() + 20, 'instalments', 2, public.t_acct('Qa Bank'))).id),
  public.t_borrow('d1000000-0000-4000-8000-000000000004'), 'the same request again returns the same borrowing');
select results_eq(
  $$ select (select count(*)::int from public.borrowings where lender = 'Dev'),
            (select count(*)::int from public.due_items where borrowing_id = public.t_borrow('d1000000-0000-4000-8000-000000000004')),
            (select count(*)::int from public.accounts where kind = 'borrowing' and name = 'Dev'),
            (select count(*)::int from public.transactions where note = 'Borrowed · Dev'),
            public.t_bal(public.t_acct('Qa Bank')) - current_setting('t.bank0')::bigint $$,
  $$ values (1, 2, 1, 1, 80000::bigint) $$, '... one borrowing, 2 due items, 1 account, 1 receipt; the bank rose once by 800.00');
select is(public.t_items('d1000000-0000-4000-8000-000000000004'), '1:pending:40000:0 2:pending:40000:0', 'two instalments of 400.00');
select throws_ok($$ select public.create_borrowing('d1000000-0000-4000-8000-000000000004', 'Dev', 80000, 'friends', 'Shop', 90000,
                      public.t_acct('Qa Bank'), public.t_today() - 3, public.t_today() + 20, 'instalments', 2, public.t_acct('Qa Bank')) $$,
  'FC007', null, 'the same key with another amount to return is FC007');
select throws_ok($$ select public.create_borrowing('d1000000-0000-4000-8000-000000000004', 'Dev', 80000, 'friends', 'Shop', null,
                      public.t_acct('Qa Bank'), public.t_today() - 3, public.t_today() + 20, 'instalments', 4, public.t_acct('Qa Bank')) $$,
  'FC007', null, '... another number of instalments is FC007');
select throws_ok($$ select public.create_borrowing('d1000000-0000-4000-8000-000000000004', 'Dev', 80000, 'friends', 'Shop', null,
                      public.t_acct('Qa Bank'), public.t_today() - 3, public.t_today() + 21, 'instalments', 2, public.t_acct('Qa Bank')) $$,
  'FC007', null, '... another return date is FC007');
select throws_ok($$ select public.create_borrowing('d1000000-0000-4000-8000-000000000004', 'Dev', 80000, 'family', 'Shop', null,
                      public.t_acct('Qa Bank'), public.t_today() - 3, public.t_today() + 20, 'instalments', 2, public.t_acct('Qa Bank')) $$,
  'FC007', null, '... another relationship is FC007');
select throws_ok($$ select public.create_borrowing('d1000000-0000-4000-8000-000000000004', 'Dev', 80000, 'friends', 'Rent', null,
                      public.t_acct('Qa Bank'), public.t_today() - 3, public.t_today() + 20, 'instalments', 2, public.t_acct('Qa Bank')) $$,
  'FC007', null, '... another reason is FC007');
select throws_ok($$ select public.create_borrowing('d1000000-0000-4000-8000-000000000004', 'Dev', 80001, 'friends', 'Shop', null,
                      public.t_acct('Qa Bank'), public.t_today() - 3, public.t_today() + 20, 'instalments', 2, public.t_acct('Qa Bank')) $$,
  'FC007', null, '... another amount borrowed is FC007');
select results_eq(
  $$ select (select count(*)::int from public.due_items where borrowing_id = public.t_borrow('d1000000-0000-4000-8000-000000000004')),
            (select count(*)::int from public.borrowings where lender = 'Dev'),
            public.t_bal(public.t_acct('Qa Bank')) - current_setting('t.bank0')::bigint $$,
  $$ values (2, 1, 80000::bigint) $$, 'the refused retries added nothing');

-- repay_borrowing twice with one key.
select lives_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000004'), 'd2000000-0000-4000-8000-000000000031',
                     public.t_acct('Qa Bank'), public.t_today(), 30000, 0) $$, 'A repays 300.00');
select is((select (public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000004'), 'd2000000-0000-4000-8000-000000000031',
            public.t_acct('Qa Bank'), public.t_today(), 30000, 0)).id),
  public.t_lp('d2000000-0000-4000-8000-000000000031'), 'the same repayment again returns the same row');
select results_eq(
  $$ select (select count(*)::int from public.liability_payments where liability_account_id = (select account_id from public.borrowings where lender = 'Dev')),
            public.t_ents(public.t_lp('d2000000-0000-4000-8000-000000000031'), false),
            public.t_bal(public.t_acct('Qa Bank')) - current_setting('t.bank0')::bigint $$,
  $$ values (1, 1, 50000::bigint) $$, '... one repayment, one entry; the bank is 800.00 - 300.00 above the start');
select throws_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000004'), 'd2000000-0000-4000-8000-000000000031',
                      public.t_acct('Qa Bank'), public.t_today(), 30001, 0) $$, 'FC007', null, 'the same key with another principal is FC007');
select throws_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000004'), 'd2000000-0000-4000-8000-000000000031',
                      public.t_acct('Qa Cash'), public.t_today(), 30000, 0) $$, 'FC007', null, '... another paying account is FC007');
select throws_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000004'), 'd2000000-0000-4000-8000-000000000031',
                      public.t_acct('Qa Bank'), public.t_today() - 1, 30000, 0) $$, 'FC007', null, '... another date is FC007');
select throws_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000004'), 'd2000000-0000-4000-8000-000000000031',
                      public.t_acct('Qa Bank'), public.t_today(), 30000, 100) $$, 'FC007', null, '... added interest is FC007');
select is(public.t_items('d1000000-0000-4000-8000-000000000004'), '1:pending:40000:0 2:pending:40000:0', '300.00 of 400.00: still pending');

-- Void: both retries with one key give one row; another key is FC005; entries and balance move together.
select lives_ok($$ select public.void_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000031'), 'd3000000-0000-4000-8000-000000000031', 'oops') $$,
  'the 300.00 repayment is voided');
select is((select (public.void_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000031'), 'd3000000-0000-4000-8000-000000000031', 'oops')).void_idempotency_key),
  'd3000000-0000-4000-8000-000000000031'::uuid, 'the same void again returns the voided row');
select throws_ok($$ select public.void_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000031'), 'd3000000-0000-4000-8000-0000000000ff') $$,
  'FC005', null, 'another key on a voided payment is FC005');
select results_eq(
  $$ select public.t_ents(public.t_lp('d2000000-0000-4000-8000-000000000031'), false), public.t_ents(public.t_lp('d2000000-0000-4000-8000-000000000031'), true),
            public.t_bal(public.t_acct('Qa Bank')) - current_setting('t.bank0')::bigint $$,
  $$ values (0, 1, 80000::bigint) $$, 'no active entry, one voided; the bank is back to the 800.00 received');

-- Edit: 500.00 repaid, then edited to 600.00 (one transaction: void + new, linked).
select lives_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000004'), 'd2000000-0000-4000-8000-000000000032',
                     public.t_acct('Qa Bank'), public.t_today(), 50000, 0) $$, 'A repays 500.00');
select is(public.t_items('d1000000-0000-4000-8000-000000000004'), '1:paid:40000:0 2:pending:40000:0', '... the first instalment (400.00) is paid, 100.00 into the second');
select lives_ok($$ select public.edit_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000032'), 'd4000000-0000-4000-8000-000000000031',
                     public.t_acct('Qa Bank'), public.t_today(), 60000, 0) $$, 'the repayment is edited to 600.00');
select results_eq(
  $$ select n.replaces_id = o.id, o.voided_at is not null, n.voided_at is null, n.principal_minor,
            public.t_ents(o.id, true), public.t_ents(o.id, false), public.t_ents(n.id, false),
            public.t_bal(public.t_acct('Qa Bank')) - current_setting('t.bank0')::bigint
     from public.liability_payments as o, public.liability_payments as n
     where o.idempotency_key = 'd2000000-0000-4000-8000-000000000032' and n.idempotency_key = 'd4000000-0000-4000-8000-000000000031' $$,
  $$ values (true, true, true, 60000::bigint, 1, 0, 1, 20000::bigint) $$, '... old voided with its entry, new linked and active; bank = 800.00 - 600.00');
select is(public.t_items('d1000000-0000-4000-8000-000000000004'), '1:paid:40000:0 2:pending:40000:0', 'first paid, second has 200.00 left');
select is(public.t_left('d1000000-0000-4000-8000-000000000004'), '1:0:0:0 2:20000:0:20000', '... 200.00 principal');
select is((select (public.edit_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000032'), 'd4000000-0000-4000-8000-000000000031',
            public.t_acct('Qa Bank'), public.t_today(), 60000, 0)).id),
  public.t_lp('d4000000-0000-4000-8000-000000000031'), 'the same edit again returns the new payment');
select throws_ok($$ select public.edit_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000032'), 'd4000000-0000-4000-8000-000000000031',
                      public.t_acct('Qa Bank'), public.t_today(), 60001, 0) $$, 'FC007', null, 'the same edit key with another amount is FC007');
select throws_ok($$ select public.void_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000032'), 'd3000000-0000-4000-8000-0000000000fe') $$,
  'FC014', null, 'the replaced payment cannot be voided: it was changed elsewhere');
select throws_ok($$ select public.edit_liability_payment(public.t_lp('d2000000-0000-4000-8000-000000000032'), 'd4000000-0000-4000-8000-0000000000fd',
                      public.t_acct('Qa Bank'), public.t_today(), 100, 0) $$, 'FC014', null, '... nor edited again');
select throws_ok($$ select public.edit_liability_payment(public.t_lp('d4000000-0000-4000-8000-000000000031'), 'd4000000-0000-4000-8000-0000000000fc',
                      public.t_acct('Qa Bank'), public.t_today(), 60000, 0) $$, 'FC017', null, 'an edit that changes nothing is FC017');
-- Owed 800 - 600 = 200.00; editing to 900.00 after the void leaves 800.00 owed: refused, and the payment stays.
select throws_ok($$ select public.edit_liability_payment(public.t_lp('d4000000-0000-4000-8000-000000000031'), 'd4000000-0000-4000-8000-0000000000fb',
                      public.t_acct('Qa Bank'), public.t_today(), 90000, 0) $$, 'FC037', null, 'an edit above what is owed is FC037');
select results_eq(
  $$ select p.voided_at is null, public.t_ents(p.id, false), public.t_bal(public.t_acct('Qa Bank')) - current_setting('t.bank0')::bigint
     from public.liability_payments as p where p.idempotency_key = 'd4000000-0000-4000-8000-000000000031' $$,
  $$ values (true, 1, 20000::bigint) $$, '... the refused edit left the 600.00 payment, its entry and the balance as they were');
select is((select count(*)::int from public.liability_payments where liability_account_id = (select account_id from public.borrowings where lender = 'Dev')), 3,
  'three payment rows in all: 300.00 voided, 500.00 replaced, 600.00 active (nothing else saved)');

-- ============================================================ 4: digits in any script (database)
-- One digit per script: full-width, Devanagari, Arabic-Indic, mathematical, superscript, subscript, ASCII.

select is((select count(*)::int from public.t_digits() as v where not public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 5, 25)', 'Bank ' || d))),
  0, 'card issuer: a single digit of any script is refused');
select is((select count(*)::int from public.t_digits() as v where not public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 5, 25, 0, %L)', 'HDFC Bank', 'Mine ' || d))),
  0, 'card nickname: a single digit of any script is refused');
select is((select count(*)::int from public.t_digits() as v where not public.t_refused(format('select public.create_borrowing(gen_random_uuid(), %L, 100, %L)', 'Ravi ' || d, 'friends'))),
  0, 'who you owe: a single digit of any script is refused');
select ok(public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 5, 25)', 'Bank ' || '1' || chr(2407))), 'card issuer: two digits of mixed scripts are refused');
-- Card product: a run of 3 (also mixed) is refused; one or two digits are allowed.
select is((select count(*)::int from public.t_digits() as v where not public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 5, 25, 0, null, %L)', 'HDFC Bank', 'Card ' || repeat(d, 3)))),
  0, 'card product: a run of 3 of one script is refused');
select ok(public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 5, 25, 0, null, %L)', 'HDFC Bank', 'Card 1' || chr(2407) || chr(1635))),
  'card product: a run of 3 across ASCII, Devanagari and Arabic-Indic is refused');
select is((select count(*)::int from public.t_digits() as v where public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 5, 25, 0, null, %L)', 'HDFC Bank', 'Card ' || d || d))),
  0, 'card product: a run of 2 in any script is allowed');
-- Borrowing reason: a run of 4 (also mixed) is refused; up to 3 are allowed.
select is((select count(*)::int from public.t_digits() as v where not public.t_refused(format('select public.create_borrowing(gen_random_uuid(), %L, 100, %L, %L)', 'Ravi', 'friends', 'Rent ' || repeat(d, 4)))),
  0, 'borrowing reason: a run of 4 of one script is refused');
select ok(public.t_refused(format('select public.create_borrowing(gen_random_uuid(), %L, 100, %L, %L)', 'Ravi', 'friends', 'Rent 1' || chr(65298) || chr(2409) || chr(1636))),
  'borrowing reason: a run of 4 across four scripts is refused');
select is((select count(*)::int from public.t_digits() as v where public.t_refused(format('select public.create_borrowing(gen_random_uuid(), %L, 100, %L, %L)', 'Ravi', 'friends', 'Trip ' || repeat(d, 3)))),
  0, 'borrowing reason: a run of 3 in any script is allowed');
select ok(not public.t_refused(format('select public.create_borrowing(gen_random_uuid(), %L, 100, %L, %L)', 'Ravi', 'friends', 'A' || chr(2407) || ' B' || chr(65298) || ' C3 D4')),
  'borrowing reason: single digits split by letters are allowed');
-- Loans: lender and nickname refuse a run of 4 (new rows).
select lives_ok($$ select public.create_loan('d5000000-0000-4000-8000-000000000001', 'home', 'Leap Bank 123', 2000000, 300000, 1200, 'floating', 3,
                      'starts_later', 300000, 3, date '2032-01-31', 44424, 44424, p_nickname => 'Plan 123') $$,
  'a loan with 3 digits in a row in the lender and nickname is allowed');
select is((select count(*)::int from public.t_digits() as v where not public.t_refused(format(
    'select public.create_loan(gen_random_uuid(), %L, %L, 2000000, 300000, 1200, %L, 3, %L, 300000, 3, date %L, 44424, 44424)',
    'home', 'Leap ' || repeat(d, 4), 'floating', 'starts_later', '2032-01-31'))),
  0, 'loan lender: a run of 4 in any script is refused');
select is((select count(*)::int from public.t_digits() as v where not public.t_refused(format(
    'select public.create_loan(gen_random_uuid(), %L, %L, 2000000, 300000, 1200, %L, 3, %L, 300000, 3, date %L, 44424, 44424, p_nickname => %L)',
    'home', 'Leap Bank', 'floating', 'starts_later', '2032-01-31', 'Plan ' || repeat(d, 4)))),
  0, 'loan nickname: a run of 4 in any script is refused');
select ok(public.t_refused(format(
    'select public.create_loan(gen_random_uuid(), %L, %L, 2000000, 300000, 1200, %L, 3, %L, 300000, 3, date %L, 44424, 44424)',
    'home', 'Leap 1' || chr(65298) || chr(2409) || chr(1636), 'floating', 'starts_later', '2032-01-31')),
  'loan lender: a mixed-script run of 4 is refused');

-- ============================================================ 3: RLS isolation (as B)
select set_config('t.r1', public.t_borrow('d1000000-0000-4000-8000-000000000001')::text, true);
select set_config('t.r4', public.t_borrow('d1000000-0000-4000-8000-000000000004')::text, true);
select set_config('t.pay', public.t_lp('d4000000-0000-4000-8000-000000000031')::text, true);
select set_config('t.abank', public.t_acct('Qa Bank')::text, true);
select set_config('request.jwt.claims', '{"sub": "66666666-6666-4666-8666-666666666666", "role": "authenticated"}', true);
-- (the claims are set; the role is already authenticated)

select results_eq(
  $$ select (select count(*)::int from public.due_items), (select count(*)::int from public.borrowing_due_progress),
            (select count(*)::int from public.borrowings), (select count(*)::int from public.liability_payments) $$,
  $$ values (0, 0, 0, 0) $$, 'B sees none of A''s due items, progress, borrowings or repayments');
select is((select count(*)::int from public.borrowing_due_progress where borrowing_id = current_setting('t.r1')::uuid), 0, 'B reads no progress by A''s borrowing id');

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
  values ('bank', 'savings', 'Qb Bank', 'INR', 1000000, public.t_today() - 30);

select throws_ok($$ select public.set_borrowing_return_plan(current_setting('t.r1')::uuid, 100000, public.t_today() + 30, 'once', null, public.t_acct('Qb Bank')) $$,
  'FC008', null, 'B cannot set a plan on A''s borrowing');
select throws_ok($$ select public.set_borrowing_return_plan(current_setting('t.r1')::uuid, 100000) $$, 'FC008', null, 'B cannot remove A''s plan');
select throws_ok($$ select public.update_borrowing(current_setting('t.r1')::uuid, 'Hacked', 'others') $$, 'FC008', null, 'B cannot edit A''s borrowing');
select throws_ok($$ select public.repay_borrowing(current_setting('t.r1')::uuid, gen_random_uuid(), public.t_acct('Qb Bank'), public.t_today(), 100) $$,
  'FC008', null, 'B cannot repay A''s borrowing');
select throws_ok($$ select public.void_liability_payment(current_setting('t.pay')::uuid, gen_random_uuid()) $$, 'FC008', null, 'B cannot void A''s repayment');
select throws_ok($$ select public.edit_liability_payment(current_setting('t.pay')::uuid, gen_random_uuid(), public.t_acct('Qb Bank'), public.t_today(), 100, 0) $$,
  'FC008', null, 'B cannot edit A''s repayment');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Mallory', 100, 'others', p_received_account_id => current_setting('t.abank')::uuid, p_received_on => public.t_today()) $$,
  'FC010', null, 'B cannot receive money into A''s account');

select lives_ok($$ select public.create_borrowing('d1000000-0000-4000-8000-000000000011', 'Gopal', 50000, 'others', null, null,
                     public.t_acct('Qb Bank'), public.t_today() - 2, public.t_today() + 5, 'instalments', 2, public.t_acct('Qb Bank')) $$, 'B has a borrowing of his own');
select throws_ok($$ select public.set_borrowing_return_plan(public.t_borrow('d1000000-0000-4000-8000-000000000011'), 50000, public.t_today() + 5, 'once', null, current_setting('t.abank')::uuid) $$,
  'FC010', null, 'B cannot use A''s account as the pay-from of his own plan');
select throws_ok($$ select public.repay_borrowing(public.t_borrow('d1000000-0000-4000-8000-000000000011'), gen_random_uuid(), current_setting('t.abank')::uuid, public.t_today(), 100) $$,
  'FC010', null, '... nor to repay from');
select results_eq(
  $$ select (select count(*)::int from public.borrowing_due_progress), (select count(*)::int from public.due_items), public.t_items('d1000000-0000-4000-8000-000000000011') $$,
  $$ values (2, 2, '1:pending:25000:0 2:pending:25000:0'::text) $$, 'B reads only his own two instalments');

-- No subject in the token: not signed in.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$ select public.set_borrowing_return_plan(current_setting('t.r1')::uuid, 100000) $$, '42501', null, 'a token with no user cannot set a plan');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Nobody', 100, 'others') $$, '42501', null, '... nor create a borrowing');

reset role;
select is(public.t_items('d1000000-0000-4000-8000-000000000001'), '1:pending:25000:2500 2:pending:25000:2500 3:pending:25000:2500 4:pending:25000:2500',
  'A''s Ravi plan is untouched by B');
select results_eq(
  $$ select (select count(*)::int from public.borrowings where lender in ('Hacked', 'Mallory', 'Nobody')),
            (select count(*)::int from public.liability_payments where voided_at is null and idempotency_key = 'd4000000-0000-4000-8000-000000000031') $$,
  $$ values (0, 1) $$, 'nothing of A''s changed, A''s 600.00 repayment is still active');

-- ============================================================ anon
select ok(not has_function_privilege('anon', 'public.repay_borrowing(uuid, uuid, uuid, date, bigint, bigint, boolean)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.void_liability_payment(uuid, uuid, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.edit_liability_payment(uuid, uuid, uuid, date, bigint, bigint, boolean)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.update_borrowing(uuid, text, text, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.borrowing_sync_due(uuid)', 'EXECUTE'),
  'anon cannot call repay, void, edit, update or sync');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select ok(public.t_rows('select count(*)::int from public.due_items') in (-1, 0), 'anon reads no due items');
select ok(public.t_rows('select count(*)::int from public.borrowing_due_progress') in (-1, 0), 'anon reads no progress');
select ok(public.t_rows('select count(*)::int from public.borrowings') in (-1, 0), 'anon reads no borrowings');
select ok(public.t_rows('select count(*)::int from public.liability_payments') in (-1, 0), 'anon reads no repayments');
select throws_ok($$ select public.set_borrowing_return_plan(gen_random_uuid(), 100) $$, '42501', null, 'anon cannot call set_borrowing_return_plan');
select throws_ok($$ select public.repay_borrowing(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), current_date, 100) $$, '42501', null, 'anon cannot call repay_borrowing');

reset role;
select * from finish();
rollback;
