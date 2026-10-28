-- pgTAP tests for the Sprint 8b follow-up (migration 20261028210000): has_digit in every
-- script, card products and account names, borrowing details, return plans (once or
-- instalments) as due items, first-in first-out status and progress, rebuilding a plan, the
-- paying account set null on delete, archive, RLS and grants. Amounts in paise. Rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(107);

insert into auth.users (id, email) values
  ('33333333-3333-4333-8333-333333333333', 'fu-asha@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'fu-bala@example.test');

-- Helpers (SECURITY INVOKER: RLS applies to whoever calls them).
create function public.t_today() returns date language sql stable set search_path = ''
  as $$ select public.user_local_today((select auth.uid())) $$;
create function public.t_acct(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select a.id from public.accounts as a where a.name = p_name and a.kind in ('bank', 'cash', 'other') $$;
create function public.t_card(p_key uuid) returns public.credit_cards language sql stable set search_path = ''
  as $$ select c.* from public.credit_cards as c where c.idempotency_key = p_key $$;
create function public.t_card_name(p_key uuid) returns text language sql stable set search_path = ''
  as $$ select a.name from public.credit_cards as c join public.accounts as a on a.id = c.account_id where c.idempotency_key = p_key $$;
create function public.t_borrow(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select b.id from public.borrowings as b where b.idempotency_key = p_key $$;
create function public.t_bal(p_account uuid) returns bigint language sql stable set search_path = ''
  as $$ select a.opening_balance_minor + b.inflow_minor - b.outflow_minor
        from public.accounts as a join public.account_balances as b on b.account_id = a.id where a.id = p_account $$;
create function public.t_lp(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select p.id from public.liability_payments as p where p.idempotency_key = p_key $$;
-- The borrowing's due items as 'seq:status:amount:interest' in seq order.
create function public.t_items(p_key uuid) returns text language sql stable set search_path = ''
  as $$ select coalesce(string_agg(d.seq || ':' || d.status || ':' || d.amount_due_minor || ':' || d.interest_minor, ' ' order by d.seq), '')
        from public.due_items as d where d.borrowing_id = public.t_borrow(p_key) $$;
-- What is left of each item as 'seq:remaining:interest:principal' in seq order.
create function public.t_left(p_key uuid) returns text language sql stable set search_path = ''
  as $$ select coalesce(string_agg(p.seq || ':' || p.remaining_minor || ':' || p.remaining_interest_minor || ':' || p.remaining_principal_minor, ' ' order by p.seq), '')
        from public.borrowing_due_progress as p where p.borrowing_id = public.t_borrow(p_key) $$;
-- True when the statement is refused by a CHECK constraint (nothing is saved then).
create function public.t_refused(p_sql text) returns boolean language plpgsql set search_path = '' as $$
begin
  execute p_sql;
  return false;
exception when check_violation then
  return true;
end $$;
grant execute on function public.t_today(), public.t_acct(text), public.t_card(uuid), public.t_card_name(uuid), public.t_borrow(uuid),
  public.t_bal(uuid), public.t_lp(uuid), public.t_items(uuid), public.t_left(uuid), public.t_refused(text) to authenticated;

-- ============================================================ has_digit
select ok(public.has_digit('Bank 1') and not public.has_digit('Bank'), 'ASCII digits are digits; letters are not');
select ok(public.has_digit('Bank ' || chr(65297)), 'a full-width digit (U+FF11)');
select ok(public.has_digit('Ravi ' || chr(2410)), 'a Devanagari digit (U+096A)');
select ok(public.has_digit('Ravi ' || chr(1635)) and public.has_digit('Ravi ' || chr(1781)), 'Arabic-Indic and extended Arabic-Indic digits (U+0663, U+06F5)');
select ok(public.has_digit('x' || chr(120782)) and public.has_digit('x' || chr(120831)), 'mathematical digits at both ends of U+1D7CE-1D7FF');
select ok(public.has_digit('x' || chr(178)) and public.has_digit('x' || chr(185)) and public.has_digit('x' || chr(8308)) and public.has_digit('x' || chr(8324)),
  'superscript and subscript digits (U+00B2, U+00B9, U+2074, U+2084)');
select ok(public.has_digit('1' || chr(2407) || chr(65299) || chr(1636), 4), 'a run of 4 across ASCII, Devanagari, full-width and Arabic-Indic is one run');
select ok(not public.has_digit('12 ' || chr(2407) || chr(65299), 3), 'two runs of 2 are not a run of 3');
select ok(not public.has_digit('6E Rewards XL', 3) and public.has_digit('Card 123', 3), 'a run of 3 is found; a single digit is not one');
select ok(not public.has_digit(chr(8555) || chr(9323)), 'Roman numerals and circled numbers are not decimal digits');

-- ============================================================ loans: new and edited rows only
select results_eq(
  $$ select conname::text, convalidated, pg_get_constraintdef(oid) like '%has_digit(lender, 4)%' or pg_get_constraintdef(oid) like '%has_digit(nickname, 4)%'
     from pg_constraint where conrelid = 'public.loans'::regclass and conname in ('loans_lender', 'loans_nickname') order by conname $$,
  $$ values ('loans_lender'::text, false, true), ('loans_nickname'::text, false, true) $$,
  'loan lender and nickname refuse a run of 4 digits in any script (NOT VALID: earlier rows are not re-checked)');

-- ============================================================ as A: accounts
select set_config('request.jwt.claims', '{"sub": "33333333-3333-4333-8333-333333333333", "role": "authenticated"}', true);
set local role authenticated;

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('bank', 'savings', 'Fu Bank', 'INR', 10000000, public.t_today() - 30);
insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date) values
  ('cash', 'Fu Cash', 'INR', 500000, public.t_today() - 30),
  ('other', 'Fu Spare', 'INR', 0, public.t_today() - 30),
  ('other', 'Fu Old', 'INR', 0, public.t_today() - 30);
update public.accounts set archived_at = now() where name = 'Fu Old';

-- ============================================================ cards: product and account name
select lives_ok($$ select public.create_card('f5000000-0000-4000-8000-000000000001', 'HDFC Bank', 5000000, 20, 8, 0, null, 'HDFC Regalia Gold') $$,
  'a card from the product list');
select results_eq($$ select (public.t_card('f5000000-0000-4000-8000-000000000001')).product, (public.t_card('f5000000-0000-4000-8000-000000000001')).product_other,
                            public.t_card_name('f5000000-0000-4000-8000-000000000001') $$,
  $$ values ('HDFC Regalia Gold'::text, false, 'HDFC Regalia Gold'::text) $$, '... its account is named after the product');
select lives_ok($$ select public.create_card('f5000000-0000-4000-8000-000000000002', 'Axis Bank', 5000000, 5, 25, 0, null, ' Travel   Edge ', true) $$,
  'a card typed under Other');
select is(public.t_card_name('f5000000-0000-4000-8000-000000000002'), 'Axis Bank Travel Edge', '... is named "<issuer> <typed name>" (spaces collapsed)');
select lives_ok($$ select public.create_card('f5000000-0000-4000-8000-000000000003', 'SBI Card', 5000000, 5, 25, 0, 'Daily', 'SBI Card ELITE') $$,
  'a card with a label');
select is(public.t_card_name('f5000000-0000-4000-8000-000000000003'), 'Daily', '... is named after the label');
select lives_ok($$ select public.create_card('f5000000-0000-4000-8000-000000000004', 'Kotak Bank', 5000000, 5, 25, 0, null, null, true) $$,
  'Other with no typed name');
select results_eq($$ select (public.t_card('f5000000-0000-4000-8000-000000000004')).product_other, public.t_card_name('f5000000-0000-4000-8000-000000000004') $$,
  $$ values (false, 'Kotak Bank'::text) $$, '... is not Other; the account takes the issuer''s name');
select lives_ok($$ select public.create_card(gen_random_uuid(), 'IndiGo Bank', 5000000, 5, 25, 0, null, '6E Rewards XL') $$, 'a product with one digit is allowed');
select ok(public.t_refused($$ select public.create_card(gen_random_uuid(), 'HDFC Bank', 5000000, 5, 25, 0, null, 'Card 123') $$),
  'a product with a run of 3 digits is refused');
select ok(public.t_refused(format('select public.create_card(gen_random_uuid(), %L, 5000000, 5, 25, 0, null, %L)', 'HDFC Bank', 'Card 1' || chr(2407) || chr(65299))),
  '... in any mix of scripts');
select throws_ok($$ select public.create_card('f5000000-0000-4000-8000-000000000001', 'HDFC Bank', 5000000, 20, 8, 0, null, 'HDFC Millennia') $$,
  'FC007', null, 'the same request key with another product is refused');
select lives_ok($$ select public.update_card((public.t_card('f5000000-0000-4000-8000-000000000001')).id, 'HDFC Bank', 5000000, 20, 8, null, 'My Card', true) $$,
  'a card is changed to a typed product');
select is(public.t_card_name('f5000000-0000-4000-8000-000000000001'), 'HDFC Bank My Card', '... and its account is renamed');
select throws_ok($$ update public.credit_cards set product = 'X' where idempotency_key = 'f5000000-0000-4000-8000-000000000001' $$,
  'FC032', null, 'a product cannot be changed directly');

-- ============================================================ borrowing details: refusals
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, null) $$, '22023', null, 'who it is from is required');
select ok(public.t_refused($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, 'colleague') $$), 'only family, friends or others');
select ok(public.t_refused($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, 'friends', 'Rent 2027') $$), 'a reason with 4 digits in a row is refused');
select ok(public.t_refused(format('select public.create_borrowing(gen_random_uuid(), %L, 100, %L, %L)', 'Ravi', 'friends', 'Rent ' || chr(2408) || '0' || chr(65298) || '7')),
  '... in any mix of scripts');
select lives_ok($$ select public.create_borrowing('f1000000-0000-4000-8000-000000000009', 'Kiran', 100, 'others', 'A 3 day trip') $$, 'a reason with fewer digits is allowed');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, 'friends', p_amount_to_return_minor => 99) $$,
  '22023', null, 'how much to return cannot be less than the amount borrowed');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, 'friends', p_return_plan => 'once', p_pay_from_account_id => public.t_acct('Fu Bank')) $$,
  '22023', null, 'no return plan without a return date');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, 'friends', p_return_on => public.t_today() + 5, p_return_plan => 'once') $$,
  '22023', null, 'a return plan needs the account it will come from');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, 'friends', p_return_on => public.t_today() + 5) $$,
  '22023', null, 'a return date needs "How will you return it?"');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, 'friends', p_return_on => public.t_today() + 5, p_return_plan => 'once',
                      p_instalment_count => 2, p_pay_from_account_id => public.t_acct('Fu Bank')) $$,
  '22023', null, 'a one-time return has no instalments');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, 'friends', p_return_on => public.t_today() + 5, p_return_plan => 'instalments',
                      p_instalment_count => 1, p_pay_from_account_id => public.t_acct('Fu Bank')) $$,
  '22023', null, 'one instalment is refused');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 1000, 'friends', p_return_on => public.t_today() + 5, p_return_plan => 'instalments',
                      p_instalment_count => 61, p_pay_from_account_id => public.t_acct('Fu Bank')) $$,
  '22023', null, '61 instalments are refused');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, 'friends', p_return_on => public.t_today() + 5, p_return_plan => 'once',
                      p_pay_from_account_id => (select account_id from public.credit_cards where idempotency_key = 'f5000000-0000-4000-8000-000000000002')) $$,
  'FC038', null, 'a card cannot be the account it is returned from');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, 'friends', p_return_on => public.t_today() + 5, p_return_plan => 'once',
                      p_pay_from_account_id => (select id from public.accounts where name = 'Fu Old')) $$,
  'FC001', null, 'nor an archived account');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, 'friends', p_received_account_id => public.t_acct('Fu Bank'),
                      p_received_on => public.t_today() - 5, p_return_on => public.t_today() - 6, p_return_plan => 'once',
                      p_pay_from_account_id => public.t_acct('Fu Bank')) $$,
  'FC051', null, 'a return date before the money came is refused');
select is((select count(*)::int from public.borrowings where lender = 'Ravi'), 0, 'nothing was saved by the refused borrowings');

-- ============================================================ instalments
-- Ravi lends 900.00 into the bank 5 days ago; 1,000.00 to return in 3 monthly instalments
-- from the bank, the first 10 days from now: 333.33, 333.33, 333.34 with 33.33, 33.33, 33.34 interest.
select lives_ok(
  $$ select public.create_borrowing('f1000000-0000-4000-8000-000000000001', ' Ravi  Kumar ', 90000, 'friends', '  Bike   repair ', 100000,
       public.t_acct('Fu Bank'), public.t_today() - 5, public.t_today() + 10, 'instalments', 3, public.t_acct('Fu Bank')) $$,
  'A borrows 900.00 from Ravi, 1,000.00 to return in 3 instalments');
select results_eq(
  $$ select b.lender, b.relationship, b.reason, b.borrowed_minor, b.amount_to_return_minor, b.return_on = public.t_today() + 10, b.return_plan,
            b.instalment_count, b.repay_from_account_id = public.t_acct('Fu Bank')
     from public.borrowings as b where b.idempotency_key = 'f1000000-0000-4000-8000-000000000001' $$,
  $$ values ('Ravi Kumar'::text, 'friends'::text, 'Bike repair'::text, 90000::bigint, 100000::bigint, true, 'instalments'::text, 3, true) $$,
  'the details are saved (spaces collapsed)');
select is(public.t_items('f1000000-0000-4000-8000-000000000001'), '1:pending:33333:3333 2:pending:33333:3333 3:pending:33334:3334',
  'three pending instalments: the last takes the remainder; interest adds up to the extra');
select is_empty(
  $$ select d.seq from public.due_items as d
     full join public.borrowing_schedule(100000, 10000, public.t_today() + 10, 'instalments', 3) as s on s.seq = d.seq
     where d.borrowing_id = public.t_borrow('f1000000-0000-4000-8000-000000000001')
       and (d.due_date, d.amount_due_minor, d.interest_minor) is distinct from (s.due_date, s.amount_minor, s.interest_minor) $$,
  'the due items are borrowing_schedule''s');
select ok((select bool_and(d.pay_from_account_id = public.t_acct('Fu Bank') and d.planned_on is null and d.kind = 'borrowing_due')
           from public.due_items as d where d.borrowing_id = public.t_borrow('f1000000-0000-4000-8000-000000000001')),
  'each instalment is paid from the bank; nothing is planned or deducted');
select is(public.t_bal(public.t_acct('Fu Bank')), 10090000::bigint, 'only the money received moved (100,000 + 900)');
select is((select (public.create_borrowing('f1000000-0000-4000-8000-000000000001', 'Ravi Kumar', 90000, 'friends', 'Bike repair', 100000,
             public.t_acct('Fu Bank'), public.t_today() - 5, public.t_today() + 10, 'instalments', 3, public.t_acct('Fu Bank'))).id),
  public.t_borrow('f1000000-0000-4000-8000-000000000001'), 'a retry with the same request key returns the same borrowing');
select throws_ok(
  $$ select public.create_borrowing('f1000000-0000-4000-8000-000000000001', 'Ravi Kumar', 90000, 'friends', 'Bike repair', 100000,
       public.t_acct('Fu Bank'), public.t_today() - 5, public.t_today() + 10, 'instalments', 3, public.t_acct('Fu Cash')) $$,
  'FC007', null, 'the same key with another paying account is refused');
select is((select count(*)::int from public.due_items where borrowing_id = public.t_borrow('f1000000-0000-4000-8000-000000000001')), 3, '... and adds no due items');

-- ============================================================ first in, first out
select lives_ok(
  $$ select public.repay_borrowing(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 'f2000000-0000-4000-8000-000000000001',
       public.t_acct('Fu Bank'), public.t_today(), 30000, 3333) $$,
  'A pays the first instalment: 300.00 principal and 33.33 interest');
select is(public.t_items('f1000000-0000-4000-8000-000000000001'), '1:paid:33333:3333 2:pending:33333:3333 3:pending:33334:3334',
  'the first instalment is paid');
select is(public.t_left('f1000000-0000-4000-8000-000000000001'), '1:0:0:0 2:33333:3333:30000 3:33334:3334:30000', 'what is left of each');
select lives_ok(
  $$ select public.repay_borrowing(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 'f2000000-0000-4000-8000-000000000002',
       public.t_acct('Fu Bank'), public.t_today(), 10000) $$,
  'A pays 100.00 more');
select is(public.t_items('f1000000-0000-4000-8000-000000000001'), '1:paid:33333:3333 2:pending:33333:3333 3:pending:33334:3334',
  'a part-paid instalment stays pending');
select is(public.t_left('f1000000-0000-4000-8000-000000000001'), '1:0:0:0 2:23333:0:23333 3:33334:3334:30000',
  '... with 233.33 left of it (the 100.00 covered its interest first)');
select lives_ok($$ select public.void_liability_payment(public.t_lp('f2000000-0000-4000-8000-000000000002'), 'f2000000-0000-4000-8000-0000000000a1') $$,
  'the 100.00 is voided');
select is(public.t_left('f1000000-0000-4000-8000-000000000001'), '1:0:0:0 2:33333:3333:30000 3:33334:3334:30000', '... the second instalment is whole again');
select lives_ok($$ select public.void_liability_payment(public.t_lp('f2000000-0000-4000-8000-000000000001'), 'f2000000-0000-4000-8000-0000000000a2') $$,
  'the first payment is voided');
select is(public.t_items('f1000000-0000-4000-8000-000000000001'), '1:pending:33333:3333 2:pending:33333:3333 3:pending:33334:3334',
  '... the first instalment is pending again');
select lives_ok($$ select public.repay_borrowing(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 'f2000000-0000-4000-8000-000000000003',
                     public.t_acct('Fu Bank'), public.t_today(), 30000, 3333) $$, 'A pays the first instalment again');

-- ============================================================ direct writes are refused
select throws_ok($$ update public.due_items set pay_from_account_id = public.t_acct('Fu Cash') where borrowing_id = public.t_borrow('f1000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'the paying account of a due item cannot be changed directly');
select throws_ok($$ update public.due_items set interest_minor = 0 where borrowing_id = public.t_borrow('f1000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'nor its interest');
select throws_ok($$ delete from public.due_items where borrowing_id = public.t_borrow('f1000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'nor can due items be deleted');
select throws_ok($$ update public.borrowings set relationship = 'family' where idempotency_key = 'f1000000-0000-4000-8000-000000000001' $$,
  'FC032', null, 'borrowings change only through the functions');
select throws_ok($$ select public.borrowing_insert_due(public.t_borrow('f1000000-0000-4000-8000-000000000001')) $$,
  'FC032', null, 'borrowing_insert_due without the write mark adds nothing');

-- ============================================================ change the plan
select lives_ok(
  $$ update public.due_items set planned_on = public.t_today() + 1, planned_account_id = public.t_acct('Fu Cash')
     where borrowing_id = public.t_borrow('f1000000-0000-4000-8000-000000000001') and seq = 2 $$,
  'Will pay later on the second instalment');
select throws_ok(
  $$ select public.set_borrowing_return_plan(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 100000, public.t_today() - 1, 'once', null, public.t_acct('Fu Bank')) $$,
  'FC041', null, 'a new return date in the past is refused');
select throws_ok(
  $$ select public.set_borrowing_return_plan(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 100000, public.t_today() + 10, 'instalments', 3, public.t_acct('Fu Old')) $$,
  'FC001', null, 'an archived paying account is refused');
select lives_ok(
  $$ select public.set_borrowing_return_plan(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 100000, public.t_today() + 10, 'once', null, public.t_acct('Fu Cash')) $$,
  'the plan becomes one payment from cash');
select is(public.t_items('f1000000-0000-4000-8000-000000000001'), '0:pending:100000:10000', 'one pending item for the whole amount');
select results_eq(
  $$ select d.pay_from_account_id = public.t_acct('Fu Cash'), d.planned_on, d.due_date = public.t_today() + 10,
            (select count(*)::int from public.due_items as x where x.planned_on is not null)
     from public.due_items as d where d.borrowing_id = public.t_borrow('f1000000-0000-4000-8000-000000000001') $$,
  $$ values (true, null::date, true, 0) $$,
  '... paid from cash; the Will pay later plan went with the old items');
select is(public.t_left('f1000000-0000-4000-8000-000000000001'), '0:66667:0:60000', '... with 333.33 already covered (interest first)');
select lives_ok(
  $$ select public.set_borrowing_return_plan(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 99999, public.t_today() + 10, 'instalments', 2, public.t_acct('Fu Bank')) $$,
  'two instalments, 999.99 to return');
select is(public.t_items('f1000000-0000-4000-8000-000000000001'), '1:pending:49999:4999 2:pending:50000:5000', 'rebuilt from the new plan');
select is(public.t_left('f1000000-0000-4000-8000-000000000001'), '1:16666:0:16666 2:50000:5000:45000', 'the 333.33 repaid still counts, first in first out');
select lives_ok(
  $$ select public.set_borrowing_return_plan(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 25000 + 90000, public.t_today() + 10, 'instalments', 4, public.t_acct('Fu Bank')) $$,
  'four instalments of 287.50');
select is(public.t_items('f1000000-0000-4000-8000-000000000001'), '1:paid:28750:6250 2:pending:28750:6250 3:pending:28750:6250 4:pending:28750:6250',
  'the first is already paid by the 333.33 repaid');
select lives_ok($$ select public.set_borrowing_return_plan(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 100000) $$, 'the return date is removed');
select results_eq(
  $$ select b.return_on, b.return_plan, b.instalment_count, b.repay_from_account_id, b.amount_to_return_minor,
            (select count(*)::int from public.due_items as d where d.borrowing_id = b.id)
     from public.borrowings as b where b.idempotency_key = 'f1000000-0000-4000-8000-000000000001' $$,
  $$ values (null::date, null::text, null::integer, null::uuid, 100000::bigint, 0) $$,
  '... with its plan and due items');
select throws_ok(
  $$ select public.set_borrowing_return_plan(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 100000, null, 'once', null, public.t_acct('Fu Bank')) $$,
  '22023', null, 'a plan without a return date is refused');
select lives_ok(
  $$ select public.set_borrowing_return_plan(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 100000, public.t_today() + 20, 'once', null, public.t_acct('Fu Bank')) $$,
  'a return date is set again');
-- Owed 900 - 300 = 600: paying it closes the item although the interest (66.67 of it) is short.
select lives_ok($$ select public.repay_borrowing(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 'f2000000-0000-4000-8000-000000000004',
                     public.t_acct('Fu Bank'), public.t_today(), 60000) $$, 'A repays the 600.00 principal still owed');
select is(public.t_items('f1000000-0000-4000-8000-000000000001'), '0:paid:100000:10000', 'nothing is owed: the item is paid');
select is(public.t_left('f1000000-0000-4000-8000-000000000001'), '0:0:0:0', '... with nothing left');

-- ============================================================ relationship and reason
select throws_ok($$ select public.update_borrowing(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 'Ravi Kumar', null) $$,
  '22023', null, 'the relationship stays required');
select lives_ok($$ select public.update_borrowing(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 'Ravi K', 'family', ' Bike  and  helmet ') $$,
  'who it is from, relationship and reason are changed');
select results_eq(
  $$ select b.lender, b.relationship, b.reason, a.name from public.borrowings as b join public.accounts as a on a.id = b.account_id
     where b.idempotency_key = 'f1000000-0000-4000-8000-000000000001' $$,
  $$ values ('Ravi K'::text, 'family'::text, 'Bike and helmet'::text, 'Ravi K'::text) $$, '... and the account follows the name');

-- ============================================================ archive
select lives_ok($$ select public.set_borrowing_archived(public.t_borrow('f1000000-0000-4000-8000-000000000001'), true) $$, 'the repaid borrowing is archived');
select throws_ok(
  $$ select public.set_borrowing_return_plan(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 100000, public.t_today() + 30, 'once', null, public.t_acct('Fu Bank')) $$,
  'FC048', null, 'an archived borrowing''s plan cannot change');
select throws_ok($$ select public.update_borrowing(public.t_borrow('f1000000-0000-4000-8000-000000000001'), 'Ravi', 'friends') $$,
  'FC048', null, 'nor its details');

-- ============================================================ received earlier, paid from an account later deleted
select lives_ok(
  $$ select public.create_borrowing('f1000000-0000-4000-8000-000000000002', 'Asha', 50000, 'family', null, null, null, null,
       public.t_today() + 15, 'once', null, public.t_acct('Fu Spare')) $$,
  'A records 500.00 owed to Asha, to return once from the spare account');
select is(public.t_items('f1000000-0000-4000-8000-000000000002'), '0:pending:50000:0', 'one item, no interest ("Same as borrowed")');

-- Hand ids to the later sections (transaction-local settings).
select set_config('t.ravi', public.t_borrow('f1000000-0000-4000-8000-000000000001')::text, true);
select set_config('t.asha', public.t_borrow('f1000000-0000-4000-8000-000000000002')::text, true);
select set_config('t.bank', public.t_acct('Fu Bank')::text, true);

reset role;
delete from public.accounts where id = (select id from public.accounts where name = 'Fu Spare');
select results_eq(
  $$ select b.repay_from_account_id, d.pay_from_account_id, d.status, b.return_plan
     from public.borrowings as b join public.due_items as d on d.borrowing_id = b.id where b.id = current_setting('t.asha')::uuid $$,
  $$ values (null::uuid, null::uuid, 'pending'::text, 'once'::text) $$,
  'deleting the paying account clears it on the borrowing and its item; the plan stays (the Pay form asks for another)');

-- ============================================================ as B
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-8444-444444444444", "role": "authenticated"}', true);
set local role authenticated;
select results_eq($$ select (select count(*)::int from public.borrowing_due_progress), (select count(*)::int from public.borrowings) $$,
  $$ values (0, 0) $$, 'B sees none of A''s progress or borrowings');
select throws_ok($$ select public.set_borrowing_return_plan(current_setting('t.asha')::uuid, 50000, current_date + 30, 'once', null, current_setting('t.bank')::uuid) $$,
  'FC008', null, 'B cannot change A''s plan');
select throws_ok($$ select public.update_borrowing(current_setting('t.asha')::uuid, 'Hacked', 'others') $$, 'FC008', null, 'B cannot change A''s details');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Mallory', 100, 'others', p_return_on => current_date + 5, p_return_plan => 'once',
                      p_pay_from_account_id => current_setting('t.bank')::uuid) $$,
  'FC010', null, 'B cannot plan to repay from A''s account');
insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
  values ('bank', 'savings', 'Fb Bank', 'INR', 100000, public.t_today() - 30);
select lives_ok($$ select public.create_borrowing('f1000000-0000-4000-8000-000000000001', 'Gopal', 1000, 'others', p_return_on => public.t_today() + 5,
                     p_return_plan => 'instalments', p_instalment_count => 2, p_pay_from_account_id => public.t_acct('Fb Bank')) $$,
  'B uses a request key A used: keys are per user');
select is(public.t_items('f1000000-0000-4000-8000-000000000001'), '1:pending:500:0 2:pending:500:0', 'B''s own instalments');

reset role;
select results_eq(
  $$ select b.lender, b.relationship, (select count(*)::int from public.borrowings where lender in ('Hacked', 'Mallory'))
     from public.borrowings as b where b.id = current_setting('t.asha')::uuid $$,
  $$ values ('Asha'::text, 'family'::text, 0) $$, 'nothing of A''s changed');

-- ============================================================ anon and grants
select ok(not has_function_privilege('anon', 'public.set_borrowing_return_plan(uuid, bigint, date, text, integer, uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.create_borrowing(uuid, text, bigint, text, text, bigint, uuid, date, date, text, integer, uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.borrowing_insert_due(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.borrowing_check_plan(uuid, text, bigint, bigint, date, text, integer, uuid)', 'EXECUTE'),
  'anon cannot call the new borrowing functions');
select ok(not has_table_privilege('anon', 'public.borrowing_due_progress', 'SELECT')
          and has_table_privilege('authenticated', 'public.borrowing_due_progress', 'SELECT'),
  'only signed-in users read borrowing_due_progress (their own rows, security_invoker)');
select ok(not has_column_privilege('authenticated', 'public.due_items', 'pay_from_account_id', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.due_items', 'interest_minor', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.borrowings', 'amount_to_return_minor', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.borrowings', 'return_on', 'UPDATE'),
  'the plan columns are never updated by clients directly');
select is((select count(*)::int from pg_proc where proname = 'set_borrowing_due_date' and pronamespace = 'public'::regnamespace), 0,
  'set_borrowing_due_date is gone (set_borrowing_return_plan replaces it)');
set local role anon;
select throws_ok($$ select count(*) from public.borrowing_due_progress $$, '42501', null, 'anon cannot read progress');

reset role;
select * from finish();
rollback;
