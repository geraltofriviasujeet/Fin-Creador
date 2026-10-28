-- QA pgTAP tests for statutory dues (migration 20261028230000), beyond statutory_dues.test.sql:
-- Total available is moved only by confirmed payments, part-payment status under voids and
-- edits, digits in any script, cross-user isolation, double submits, archived dues.
-- Expected values are computed by hand in the comments. Amounts in paise. Rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(156);

insert into auth.users (id, email) values
  ('88888888-8888-4888-8888-888888888888', 'sq-asha@example.test'),
  ('99999999-9999-4999-8999-999999999999', 'sq-bala@example.test');

create function public.t_today() returns date language sql stable set search_path = ''
  as $$ select public.user_local_today((select auth.uid())) $$;
create function public.t_acct(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select a.id from public.accounts as a where a.name = p_name $$;
create function public.t_bal(p_name text) returns bigint language sql stable set search_path = ''
  as $$ select (a.opening_balance_minor + b.inflow_minor - b.outflow_minor)::bigint
        from public.accounts as a join public.account_balances as b on b.account_id = a.id where a.name = p_name $$;
create function public.t_total() returns bigint language sql stable set search_path = ''
  as $$ select coalesce(sum(a.opening_balance_minor + b.inflow_minor - b.outflow_minor), 0)::bigint
        from public.accounts as a join public.account_balances as b on b.account_id = a.id
        where a.archived_at is null and a.kind in ('bank', 'cash', 'other') $$;
create function public.t_due(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select s.id from public.statutory_dues as s where s.idempotency_key = p_key $$;
create function public.t_item(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select d.id from public.due_items as d join public.statutory_dues as s on s.id = d.statutory_due_id where s.idempotency_key = p_key $$;
create function public.t_status(p_key uuid) returns text language sql stable set search_path = ''
  as $$ select d.status from public.due_items as d where d.id = public.t_item(p_key) $$;
create function public.t_left(p_key uuid) returns bigint language sql stable set search_path = ''
  as $$ select p.left_minor from public.statutory_due_progress as p where p.due_item_id = public.t_item(p_key) $$;
create function public.t_paid(p_key uuid) returns bigint language sql stable set search_path = ''
  as $$ select p.paid_minor from public.statutory_due_progress as p where p.due_item_id = public.t_item(p_key) $$;
create function public.t_dp(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select p.id from public.due_payments as p where p.idempotency_key = p_key $$;
create function public.t_state(p_sql text) returns text language plpgsql set search_path = '' as $$
declare v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlstate || ':' || coalesce(v_detail, '');
end $$;
create function public.t_refused(p_sql text) returns boolean language plpgsql set search_path = '' as $$
begin
  execute p_sql;
  return false;
exception when check_violation then
  return true;
end $$;
create function public.t_pay(p_due uuid, p_key uuid, p_account text, p_amount bigint, p_interest bigint default 0)
  returns public.due_payments language sql set search_path = ''
  as $$ select * from public.pay_due_item(public.t_item(p_due), p_key, public.t_acct(p_account), public.t_today(), p_amount, p_interest, 0) $$;
create function public.t_edit(p_pay uuid, p_key uuid, p_account text, p_amount bigint, p_interest bigint default 0)
  returns public.due_payments language sql set search_path = ''
  as $$ select * from public.edit_due_payment(public.t_dp(p_pay), p_key, public.t_acct(p_account), public.t_today(), p_amount, p_interest, 0) $$;
grant execute on function public.t_today(), public.t_acct(text), public.t_bal(text), public.t_total(), public.t_due(uuid),
  public.t_item(uuid), public.t_status(uuid), public.t_left(uuid), public.t_paid(uuid), public.t_dp(uuid), public.t_state(text),
  public.t_refused(text), public.t_pay(uuid, uuid, text, bigint, bigint),
  public.t_edit(uuid, uuid, text, bigint, bigint) to authenticated;

-- ------------------------------------------------------------ as A
select set_config('request.jwt.claims', '{"sub": "88888888-8888-4888-8888-888888888888", "role": "authenticated"}', true);
set local role authenticated;

-- Bank 1,00,00,000 (100,000,000 paise), Cash 5,000 (500,000), Spare 0, archived account (not counted).
insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('bank', 'savings', 'Sq Bank', 'INR', 100000000, public.t_today() - 30);
insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date) values
  ('cash', 'Sq Cash', 'INR', 500000, public.t_today() - 30),
  ('other', 'Sq Spare', 'INR', 0, public.t_today() - 30),
  ('other', 'Sq Old', 'INR', 7777, public.t_today() - 30);
update public.accounts set archived_at = now() where name = 'Sq Old';

-- ============================================================ 1. Total available
-- Start: 100,000,000 + 500,000 + 0 = 100,500,000 (the archived account is left out).
select is(public.t_total(), 100500000::bigint, 'start: Total available is bank + cash + spare, without the archived account');
select lives_ok($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000001', 'income_tax', 6000000, public.t_today() + 10,
  'Advance tax', p_pay_from_account_id => public.t_acct('Sq Bank')) $$, 'A adds income tax of 60,000');
select is(public.t_total(), 100500000::bigint, 'create: Total available unchanged');
select lives_ok($$ select public.update_statutory_due(public.t_due('b1000000-0000-4000-8000-000000000001'), 5000000, public.t_today() + 20,
  'Advance tax', p_pay_from_account_id => public.t_acct('Sq Cash')) $$, 'the amount is edited to 50,000, paying from cash');
select is(public.t_total(), 100500000::bigint, 'edit: Total available unchanged');
update public.due_items set planned_on = public.t_today() + 1, planned_account_id = public.t_acct('Sq Bank')
  where id = public.t_item('b1000000-0000-4000-8000-000000000001');
select is(public.t_total(), 100500000::bigint, 'Will pay later: Total available unchanged');
select lives_ok($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000002', 'fine', 100000, public.t_today()) $$, 'A adds a fine');
select lives_ok($$ select public.delete_statutory_due(public.t_due('b1000000-0000-4000-8000-000000000002')) $$, 'and deletes it');
select is(public.t_total(), 100500000::bigint, 'delete: Total available unchanged');
select is((select count(*)::int from public.transactions), 0, 'no entry exists after create, edit, plan and delete');

-- Pay 10,000 + 250 interest from the bank: 100,500,000 - 1,025,000 = 99,475,000.
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Sq Bank', 1000000, 25000) $$,
  'A pays 10,000 with 250 interest');
select results_eq($$ select public.t_total(), public.t_bal('Sq Bank'), public.t_bal('Sq Cash') $$,
  $$ values (99475000::bigint, 98975000::bigint, 500000::bigint) $$,
  'Total available fell by principal + interest (1,025,000); only the bank moved');
select lives_ok($$ select public.void_due_payment(public.t_dp('b2000000-0000-4000-8000-000000000001'), 'b2000000-0000-4000-8000-0000000000a1') $$, 'the payment is voided');
select results_eq($$ select public.t_total(), public.t_bal('Sq Bank'), public.t_status('b1000000-0000-4000-8000-000000000001') $$,
  $$ values (100500000::bigint, 100000000::bigint, 'pending'::text) $$, 'void restores Total available and the bank balance');
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002', 'Sq Bank', 1000000, 25000) $$, 'paid again');
-- Edit to cash, 4,000 principal, no interest: cash 500,000-400,000 = 100,000; bank back to 100,000,000; total 100,100,000.
select lives_ok($$ select public.t_edit('b2000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000003', 'Sq Cash', 400000, 0) $$,
  'the payment is edited to 4,000 from cash, without interest');
select results_eq($$ select public.t_total(), public.t_bal('Sq Bank'), public.t_bal('Sq Cash') $$,
  $$ values (100100000::bigint, 100000000::bigint, 100000::bigint) $$,
  'an edit to another account moves the money: bank restored, cash down by 4,000, total down by 4,000 only');
-- Pay the rest (5,000,000 - 400,000 = 4,600,000) from the bank: 100,100,000 - 4,600,000 = 95,500,000.
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000004', 'Sq Bank', 4600000) $$, 'the rest is paid');
select results_eq($$ select public.t_total(), public.t_status('b1000000-0000-4000-8000-000000000001') $$,
  $$ values (95500000::bigint, 'paid'::text) $$, 'Total available fell by the rest only');
select lives_ok($$ select public.set_statutory_due_archived(public.t_due('b1000000-0000-4000-8000-000000000001'), true) $$, 'archive the paid due');
select is(public.t_total(), 95500000::bigint, 'archive: Total available unchanged');
select lives_ok($$ select public.set_statutory_due_archived(public.t_due('b1000000-0000-4000-8000-000000000001'), false) $$, 'restore it');
select is(public.t_total(), 95500000::bigint, 'restore: Total available unchanged');
select is((select sum(t.amount_minor)::bigint from public.transactions as t where t.voided_at is null and t.type = 'expense'), 5000000::bigint,
  'active expenses = 400,000 + 4,600,000: the voided and replaced entries do not count');

-- ============================================================ 2. Part-payment status
-- E: 10,000 (1,000,000 paise).
select lives_ok($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000010', 'income_tax', 1000000, public.t_today() + 3) $$, 'E: income tax of 10,000');
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000010', 'b2000000-0000-4000-8000-000000000010', 'Sq Bank', 300000) $$, 'part 1: 3,000');
select results_eq($$ select public.t_status('b1000000-0000-4000-8000-000000000010'), public.t_paid('b1000000-0000-4000-8000-000000000010'), public.t_left('b1000000-0000-4000-8000-000000000010') $$,
  $$ values ('pending'::text, 300000::bigint, 700000::bigint) $$, 'pending, 3,000 paid, 7,000 left');
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000010', 'b2000000-0000-4000-8000-000000000011', 'Sq Bank', 0, 50000) $$, 'an interest-only payment of 500');
select results_eq($$ select public.t_status('b1000000-0000-4000-8000-000000000010'), public.t_paid('b1000000-0000-4000-8000-000000000010'), public.t_left('b1000000-0000-4000-8000-000000000010') $$,
  $$ values ('pending'::text, 300000::bigint, 700000::bigint) $$, 'interest does not count towards the amount');
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000010', 'b2000000-0000-4000-8000-000000000012', 'Sq Bank', 300000) $$, 'part 2: 3,000');
select is(public.t_left('b1000000-0000-4000-8000-000000000010'), 400000::bigint, 'two parts: 4,000 left');
select is(public.t_state($$ select public.t_pay('b1000000-0000-4000-8000-000000000010', gen_random_uuid(), 'Sq Bank', 400001) $$), 'FC052:400000',
  'one paisa over what is left: FC052, detail 400,000');
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000010', 'b2000000-0000-4000-8000-000000000013', 'Sq Bank', 400000) $$, 'part 3: exactly what is left');
select results_eq($$ select public.t_status('b1000000-0000-4000-8000-000000000010'), public.t_left('b1000000-0000-4000-8000-000000000010') $$,
  $$ values ('paid'::text, 0::bigint) $$, 'prepaid exactly: paid, nothing left');
-- Void the middle part (3,000): active principal = 3,000 + 4,000 = 7,000, left 3,000.
select lives_ok($$ select public.void_due_payment(public.t_dp('b2000000-0000-4000-8000-000000000012'), gen_random_uuid()) $$, 'void part 2');
select results_eq($$ select public.t_status('b1000000-0000-4000-8000-000000000010'), public.t_paid('b1000000-0000-4000-8000-000000000010'), public.t_left('b1000000-0000-4000-8000-000000000010') $$,
  $$ values ('pending'::text, 700000::bigint, 300000::bigint) $$, 'voiding any part reopens the due by that part');
select lives_ok($$ select public.void_due_payment(public.t_dp('b2000000-0000-4000-8000-000000000011'), gen_random_uuid()) $$, 'void the interest-only payment');
select results_eq($$ select public.t_status('b1000000-0000-4000-8000-000000000010'), public.t_paid('b1000000-0000-4000-8000-000000000010') $$,
  $$ values ('pending'::text, 700000::bigint) $$, 'voiding interest changes nothing about what is paid');
-- Edit part 1 from 3,000 down to 1,000: active 1,000 + 4,000 = 5,000, left 5,000.
select lives_ok($$ select public.t_edit('b2000000-0000-4000-8000-000000000010', 'b2000000-0000-4000-8000-000000000014', 'Sq Bank', 100000) $$, 'part 1 edited down to 1,000');
select results_eq($$ select public.t_status('b1000000-0000-4000-8000-000000000010'), public.t_left('b1000000-0000-4000-8000-000000000010') $$,
  $$ values ('pending'::text, 500000::bigint) $$, 'lowering a part leaves 5,000 due');
-- Raising it: with it voided, 4,000 is paid, 6,000 may be paid.
select is(public.t_state($$ select public.t_edit('b2000000-0000-4000-8000-000000000014', gen_random_uuid(), 'Sq Bank', 600001) $$), 'FC052:600000',
  'raising a part past what is left once voided: FC052, detail 6,000');
select is(public.t_left('b1000000-0000-4000-8000-000000000010'), 500000::bigint, '... and the part stays as it was');
select lives_ok($$ select public.t_edit('b2000000-0000-4000-8000-000000000014', 'b2000000-0000-4000-8000-000000000015', 'Sq Bank', 600000) $$, 'part 1 raised to exactly 6,000');
select results_eq($$ select public.t_status('b1000000-0000-4000-8000-000000000010'), public.t_left('b1000000-0000-4000-8000-000000000010'),
  (select count(*)::int from public.due_payments where voided_at is null and due_item_id = public.t_item('b1000000-0000-4000-8000-000000000010')) $$,
  $$ values ('paid'::text, 0::bigint, 2) $$, 'raising a part to cover it: paid, two active payments');
-- Amount edits follow the status: paid 10,000.
select lives_ok($$ select public.update_statutory_due(public.t_due('b1000000-0000-4000-8000-000000000010'), 1500000, public.t_today() + 3) $$, 'amount raised to 15,000');
select results_eq($$ select public.t_status('b1000000-0000-4000-8000-000000000010'), public.t_left('b1000000-0000-4000-8000-000000000010') $$,
  $$ values ('pending'::text, 500000::bigint) $$, 'a paid due raised above what is paid is pending, 5,000 left');
select lives_ok($$ select public.update_statutory_due(public.t_due('b1000000-0000-4000-8000-000000000010'), 1000000, public.t_today() + 3) $$, 'amount lowered to 10,000');
select is(public.t_status('b1000000-0000-4000-8000-000000000010'), 'paid', 'lowered to what is paid: paid');
select is(public.t_state($$ select public.update_statutory_due(public.t_due('b1000000-0000-4000-8000-000000000010'), 999999, public.t_today() + 3) $$), 'FC054:1000000',
  'one paisa below what is paid: FC054, detail 10,000');

-- Prepaid over: F is 2,500.
select lives_ok($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000011', 'fine', 250000, public.t_today()) $$, 'F: a fine of 2,500');
select is(public.t_state($$ select public.t_pay('b1000000-0000-4000-8000-000000000011', gen_random_uuid(), 'Sq Bank', 250001) $$), 'FC052:250000',
  'one payment above the amount: FC052, detail 2,500');
select is((select count(*)::int from public.due_payments where due_item_id = public.t_item('b1000000-0000-4000-8000-000000000011')), 0, '... and nothing was saved');
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000011', 'b2000000-0000-4000-8000-000000000020', 'Sq Bank', 250000) $$, 'paid exactly');
select is(public.t_state($$ select public.t_edit('b2000000-0000-4000-8000-000000000020', gen_random_uuid(), 'Sq Bank', 250001) $$), 'FC052:250000',
  'editing the only payment above the amount: FC052, detail 2,500');
select is(public.t_status('b1000000-0000-4000-8000-000000000011'), 'paid', '... and the due stays paid');

-- Two payments with different keys cannot exceed the amount: G is 1,000.
select lives_ok($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000012', 'fine', 100000, public.t_today()) $$, 'G: a fine of 1,000');
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000012', 'b2000000-0000-4000-8000-000000000030', 'Sq Bank', 60000) $$, 'first request: 600');
select is(public.t_state($$ select public.t_pay('b1000000-0000-4000-8000-000000000012', 'b2000000-0000-4000-8000-000000000031', 'Sq Bank', 60000) $$), 'FC052:40000',
  'second request, another key, 600: FC052, only 400 is left');
select is(public.t_paid('b1000000-0000-4000-8000-000000000012'), 60000::bigint, '... paid stays 600, never above the amount');
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000012', 'b2000000-0000-4000-8000-000000000032', 'Sq Bank', 40000) $$, 'the remaining 400 is accepted');
select is(public.t_state($$ select public.t_pay('b1000000-0000-4000-8000-000000000012', gen_random_uuid(), 'Sq Bank', 40000) $$), 'FC034:',
  'a further request on the paid due: FC034');
select is((select sum(principal_minor)::bigint from public.due_payments where voided_at is null and due_item_id = public.t_item('b1000000-0000-4000-8000-000000000012')),
  100000::bigint, 'active principal equals the amount exactly');

-- ============================================================ 3. Digits, at the database
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), %L)', 'fine', 'Challan ' || chr(1633) || chr(1634) || chr(1635) || chr(1636))),
  'description: 4 Arabic-Indic digits refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), %L)', 'fine', chr(3047) || chr(3048) || chr(3049) || chr(3050) || ' ref')),
  'description: 4 Tamil digits refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), %L)', 'fine', 'Ref ' || chr(65297) || chr(65298) || chr(65299) || chr(65300))),
  'description: 4 full-width digits refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), %L)', 'fine', 'Ref ' || chr(120783) || chr(120784) || chr(120785) || chr(120786))),
  'description: 4 mathematical digits (outside the BMP) refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), %L)', 'fine', 'Ref ' || chr(178) || chr(179) || chr(185) || chr(8308))),
  'description: 4 superscript digits refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), %L)', 'fine', 'Ref 1' || chr(2408) || chr(3049) || '4')),
  'description: a run of 4 across ASCII, Devanagari and Tamil refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), %L)', 'income_tax', '9999')),
  'description: 4 digits alone refused on a tax');
select lives_ok(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), %L)', 'fine', 'Ref ' || chr(2407) || chr(2408) || chr(2409)),
  'description: 3 Devanagari digits allowed');
select lives_ok(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), %L)', 'fine', 'FY 12 34 a' || chr(1633) || chr(1634) || 'b' || chr(1635) || chr(1636)),
  'description: digits split by spaces or letters allowed (no run of 4)');
select lives_ok(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), %L)', 'fine', repeat('a', 120)),
  'description: 120 characters allowed');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), %L)', 'fine', repeat('a', 121))),
  'description: 121 characters refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), null, null, %L)', 'fine', 'Karnataka1')),
  'state: one ASCII digit refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), null, null, %L)', 'fine', chr(2407) || 'Karnataka')),
  'state: one Devanagari digit refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), null, null, %L)', 'fine', 'Kerala' || chr(8322))),
  'state: a subscript digit refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), null, null, null, %L)', 'fine', 'Pune' || chr(185))),
  'city: a superscript digit refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), null, null, null, %L)', 'fine', 'Delhi ' || chr(1633))),
  'city: one Arabic-Indic digit refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), null, null, null, %L)', 'fine', 'Chennai 7')),
  'city: one ASCII digit refused');
-- The same rules on an edit.
select lives_ok($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000020', 'fine', 100, public.t_today(), null, 'two_wheeler', 'Karnataka', 'Bengaluru') $$, 'a fine to edit');
select ok(public.t_refused(format('select public.update_statutory_due(%L, 100, public.t_today(), %L)', public.t_due('b1000000-0000-4000-8000-000000000020'), 'Ref 12' || chr(2408) || '4')),
  'edit: 4 digits in the description refused');
select ok(public.t_refused(format('select public.update_statutory_due(%L, 100, public.t_today(), null, null, %L)', public.t_due('b1000000-0000-4000-8000-000000000020'), 'Goa 1')),
  'edit: a digit in the state refused');
select ok(public.t_refused(format('select public.update_statutory_due(%L, 100, public.t_today(), null, null, null, %L)', public.t_due('b1000000-0000-4000-8000-000000000020'), 'Surat' || chr(65301))),
  'edit: a digit in the city refused');
select is((select issued_state || '/' || issued_city from public.statutory_dues where idempotency_key = 'b1000000-0000-4000-8000-000000000020'), 'Karnataka/Bengaluru',
  '... and the saved values stay as they were');

-- ============================================================ 5. Double submit
select lives_ok($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000030', 'fine', 120000, public.t_today() - 2, 'Speeding',
  'four_wheeler', 'Karnataka', 'Bengaluru', public.t_acct('Sq Bank')) $$, 'create: first submit');
select set_config('t.n_dues', (select count(*) from public.statutory_dues)::text, true);
select set_config('t.n_items', (select count(*) from public.due_items)::text, true);
select is((select (public.create_statutory_due('b1000000-0000-4000-8000-000000000030', 'fine', 120000, public.t_today() - 2, ' Speeding ',
  'four_wheeler', 'Karnataka', 'Bengaluru', public.t_acct('Sq Bank'))).id), public.t_due('b1000000-0000-4000-8000-000000000030'),
  'create: a second submit (spaces aside) returns the same row');
select results_eq($$ select (select count(*) from public.statutory_dues)::text, (select count(*) from public.due_items)::text $$,
  $$ select current_setting('t.n_dues'), current_setting('t.n_items') $$, '... and adds no due and no due item');
select is(public.t_state($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000030', 'income_tax', 120000, public.t_today() - 2, 'Speeding',
  'four_wheeler', 'Karnataka', 'Bengaluru', public.t_acct('Sq Bank')) $$), 'FC007:', 'same key, another type: FC007');
select is(public.t_state($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000030', 'fine', 120001, public.t_today() - 2, 'Speeding',
  'four_wheeler', 'Karnataka', 'Bengaluru', public.t_acct('Sq Bank')) $$), 'FC007:', 'same key, another amount: FC007');
select is(public.t_state($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000030', 'fine', 120000, public.t_today() - 1, 'Speeding',
  'four_wheeler', 'Karnataka', 'Bengaluru', public.t_acct('Sq Bank')) $$), 'FC007:', 'same key, another due date: FC007');
select is(public.t_state($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000030', 'fine', 120000, public.t_today() - 2, 'Speeding up',
  'four_wheeler', 'Karnataka', 'Bengaluru', public.t_acct('Sq Bank')) $$), 'FC007:', 'same key, another description: FC007');
select is(public.t_state($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000030', 'fine', 120000, public.t_today() - 2, null,
  'four_wheeler', 'Karnataka', 'Bengaluru', public.t_acct('Sq Bank')) $$), 'FC007:', 'same key, no description: FC007');
select is(public.t_state($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000030', 'fine', 120000, public.t_today() - 2, 'Speeding',
  'two_wheeler', 'Karnataka', 'Bengaluru', public.t_acct('Sq Bank')) $$), 'FC007:', 'same key, another vehicle kind: FC007');
select is(public.t_state($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000030', 'fine', 120000, public.t_today() - 2, 'Speeding',
  'four_wheeler', 'Kerala', 'Bengaluru', public.t_acct('Sq Bank')) $$), 'FC007:', 'same key, another state: FC007');
select is(public.t_state($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000030', 'fine', 120000, public.t_today() - 2, 'Speeding',
  'four_wheeler', 'Karnataka', 'Mysuru', public.t_acct('Sq Bank')) $$), 'FC007:', 'same key, another city: FC007');
select is(public.t_state($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000030', 'fine', 120000, public.t_today() - 2, 'Speeding',
  'four_wheeler', 'Karnataka', 'Bengaluru', public.t_acct('Sq Cash')) $$), 'FC007:', 'same key, another paying account: FC007');
select is(public.t_state($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000030', 'fine', 120000, public.t_today() - 2, 'Speeding',
  'four_wheeler', 'Karnataka', 'Bengaluru') $$), 'FC007:', 'same key, no paying account: FC007');

-- pay_due_item: a 1,200 fine paid 700 from the bank.
select lives_ok($$ select public.pay_due_item(public.t_item('b1000000-0000-4000-8000-000000000030'), 'b2000000-0000-4000-8000-000000000040',
  public.t_acct('Sq Bank'), public.t_today(), 70000, 0, 0) $$, 'pay: first submit (700)');
select set_config('t.n_pay', (select count(*) from public.due_payments)::text, true);
select set_config('t.n_tx', (select count(*) from public.transactions)::text, true);
select set_config('t.bank_bal', public.t_bal('Sq Bank')::text, true);
select is((select (public.pay_due_item(public.t_item('b1000000-0000-4000-8000-000000000030'), 'b2000000-0000-4000-8000-000000000040',
  public.t_acct('Sq Bank'), public.t_today(), 70000, 0, 0)).id), public.t_dp('b2000000-0000-4000-8000-000000000040'), 'pay: a second submit returns the same payment');
select results_eq($$ select (select count(*) from public.due_payments)::text, (select count(*) from public.transactions)::text, public.t_bal('Sq Bank')::text $$,
  $$ select current_setting('t.n_pay'), current_setting('t.n_tx'), current_setting('t.bank_bal') $$, '... and adds no payment, no entry and no debit');
select is(public.t_state($$ select public.pay_due_item(public.t_item('b1000000-0000-4000-8000-000000000012'), 'b2000000-0000-4000-8000-000000000040',
  public.t_acct('Sq Bank'), public.t_today(), 70000, 0, 0) $$), 'FC007:', 'same key, another due item: FC007');
select is(public.t_state($$ select public.pay_due_item(public.t_item('b1000000-0000-4000-8000-000000000030'), 'b2000000-0000-4000-8000-000000000040',
  public.t_acct('Sq Cash'), public.t_today(), 70000, 0, 0) $$), 'FC007:', 'same key, another account: FC007');
select is(public.t_state($$ select public.pay_due_item(public.t_item('b1000000-0000-4000-8000-000000000030'), 'b2000000-0000-4000-8000-000000000040',
  public.t_acct('Sq Bank'), public.t_today() - 1, 70000, 0, 0) $$), 'FC007:', 'same key, another date: FC007');
select is(public.t_state($$ select public.pay_due_item(public.t_item('b1000000-0000-4000-8000-000000000030'), 'b2000000-0000-4000-8000-000000000040',
  public.t_acct('Sq Bank'), public.t_today(), 70001, 0, 0) $$), 'FC007:', 'same key, another amount: FC007');
select is(public.t_state($$ select public.pay_due_item(public.t_item('b1000000-0000-4000-8000-000000000030'), 'b2000000-0000-4000-8000-000000000040',
  public.t_acct('Sq Bank'), public.t_today(), 70000, 1, 0) $$), 'FC007:', 'same key, with interest: FC007');
select is(public.t_state($$ select public.pay_due_item(public.t_item('b1000000-0000-4000-8000-000000000030'), 'b2000000-0000-4000-8000-000000000040',
  public.t_acct('Sq Bank'), public.t_today(), 70000, 0, 5) $$), 'FC007:', 'same key, with fees: FC007');
select is(public.t_state($$ select public.pay_due_item(public.t_item('b1000000-0000-4000-8000-000000000030'), 'b2000000-0000-4000-8000-000000000040',
  public.t_acct('Sq Bank'), public.t_today(), 70000, 0, 0, false, gen_random_uuid()) $$), 'FC007:', 'same key, replacing a payment: FC007');
select is((select (public.void_due_payment(public.t_dp('b2000000-0000-4000-8000-000000000040'), 'b2000000-0000-4000-8000-0000000000b1')).voided_at is not null), true, 'void: first submit');
select is((select (public.void_due_payment(public.t_dp('b2000000-0000-4000-8000-000000000040'), 'b2000000-0000-4000-8000-0000000000b1')).void_idempotency_key),
  'b2000000-0000-4000-8000-0000000000b1'::uuid, 'void: a second submit with the same key returns the voided payment');
select is(public.t_state($$ select public.void_due_payment(public.t_dp('b2000000-0000-4000-8000-000000000040'), gen_random_uuid()) $$), 'FC005:',
  'void: another key on a voided payment: FC005');
select is(public.t_bal('Sq Bank'), current_setting('t.bank_bal')::bigint + 70000, 'void: the bank balance came back once (700)');

-- ============================================================ 6. Archived dues
-- H: 2,000 paid in two parts of 1,000, then archived.
select lives_ok($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000040', 'other_statutory', 200000, public.t_today() + 1, 'Property tax') $$, 'H: property tax of 2,000');
select is(public.t_state($$ select public.set_statutory_due_archived(public.t_due('b1000000-0000-4000-8000-000000000040'), true) $$), 'FC045:200000',
  'archive refused, nothing paid: FC045, detail 2,000');
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000040', 'b2000000-0000-4000-8000-000000000050', 'Sq Bank', 100000) $$, 'part 1: 1,000');
select is(public.t_state($$ select public.set_statutory_due_archived(public.t_due('b1000000-0000-4000-8000-000000000040'), true) $$), 'FC045:100000',
  'archive refused, half paid: FC045, detail 1,000');
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000040', 'b2000000-0000-4000-8000-000000000051', 'Sq Bank', 100000) $$, 'part 2: 1,000');
select lives_ok($$ select public.set_statutory_due_archived(public.t_due('b1000000-0000-4000-8000-000000000040'), true) $$, 'archived once fully paid');
select is(public.t_state($$ select public.t_pay('b1000000-0000-4000-8000-000000000040', gen_random_uuid(), 'Sq Bank', 1) $$), 'FC053:', 'archived: pay refused (FC053)');
select is(public.t_state($$ select public.t_pay('b1000000-0000-4000-8000-000000000040', gen_random_uuid(), 'Sq Bank', 0, 100) $$), 'FC053:', 'archived: interest-only pay refused (FC053)');
select is(public.t_state($$ select public.void_due_payment(public.t_dp('b2000000-0000-4000-8000-000000000050'), gen_random_uuid()) $$), 'FC053:', 'archived: void refused (FC053)');
select is(public.t_state($$ select public.t_edit('b2000000-0000-4000-8000-000000000050', gen_random_uuid(), 'Sq Bank', 90000) $$), 'FC053:', 'archived: edit payment refused (FC053)');
select is(public.t_state($$ update public.due_items set planned_on = public.t_today() + 2, planned_account_id = public.t_acct('Sq Bank')
  where id = public.t_item('b1000000-0000-4000-8000-000000000040') $$), 'FC053:', 'archived: Will pay later refused (FC053)');
select is(public.t_state($$ select public.update_statutory_due(public.t_due('b1000000-0000-4000-8000-000000000040'), 300000, public.t_today() + 1, 'Property tax') $$), 'FC053:',
  'archived: update refused (FC053)');
select results_eq($$ select (select count(*)::int from public.due_payments where due_item_id = public.t_item('b1000000-0000-4000-8000-000000000040') and voided_at is null),
  public.t_left('b1000000-0000-4000-8000-000000000040'), public.t_status('b1000000-0000-4000-8000-000000000040') $$,
  $$ values (2, 0::bigint, 'paid'::text) $$, 'archived: every refusal left the payments and status as they were');
-- Restore re-enables everything.
select lives_ok($$ select public.set_statutory_due_archived(public.t_due('b1000000-0000-4000-8000-000000000040'), false) $$, 'restored');
select lives_ok($$ select public.update_statutory_due(public.t_due('b1000000-0000-4000-8000-000000000040'), 300000, public.t_today() + 1, 'Property tax') $$, 'restored: update works (3,000)');
select lives_ok($$ update public.due_items set planned_on = public.t_today() + 2, planned_account_id = public.t_acct('Sq Bank')
  where id = public.t_item('b1000000-0000-4000-8000-000000000040') $$, 'restored: Will pay later works');
select lives_ok($$ select public.t_pay('b1000000-0000-4000-8000-000000000040', 'b2000000-0000-4000-8000-000000000052', 'Sq Bank', 100000) $$, 'restored: pay works (the last 1,000)');
select lives_ok($$ select public.void_due_payment(public.t_dp('b2000000-0000-4000-8000-000000000052'), gen_random_uuid()) $$, 'restored: void works');
select lives_ok($$ select public.t_edit('b2000000-0000-4000-8000-000000000050', 'b2000000-0000-4000-8000-000000000053', 'Sq Bank', 90000) $$, 'restored: edit payment works');

-- ============================================================ 4. RLS isolation (B)
update public.due_items set planned_on = public.t_today() + 4, planned_account_id = public.t_acct('Sq Bank')
  where id = public.t_item('b1000000-0000-4000-8000-000000000040');
select set_config('t.a_due', public.t_due('b1000000-0000-4000-8000-000000000010')::text, true);
select set_config('t.a_item', public.t_item('b1000000-0000-4000-8000-000000000040')::text, true);
select set_config('t.a_item_plan', public.t_item('b1000000-0000-4000-8000-000000000040')::text, true);
select set_config('t.a_pay', public.t_dp('b2000000-0000-4000-8000-000000000051')::text, true);
select set_config('t.a_bank', public.t_acct('Sq Bank')::text, true);
select set_config('t.a_planned', (select planned_on::text from public.due_items where id = public.t_item('b1000000-0000-4000-8000-000000000040')), true);
select set_config('t.a_amount', (select amount_minor::text from public.statutory_dues where id = public.t_due('b1000000-0000-4000-8000-000000000040')), true);
select set_config('t.a_dues', (select count(*) from public.statutory_dues)::text, true);

select set_config('request.jwt.claims', '{"sub": "99999999-9999-4999-8999-999999999999", "role": "authenticated"}', true);
insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
  values ('bank', 'savings', 'Sr Bank', 'INR', 5000000, public.t_today() - 1);
select results_eq($$ select (select count(*)::int from public.statutory_dues), (select count(*)::int from public.due_items),
  (select count(*)::int from public.statutory_due_progress), (select count(*)::int from public.due_payments),
  (select count(*)::int from public.transactions), (select count(*)::int from public.accounts where name like 'Sq %') $$,
  $$ values (0, 0, 0, 0, 0, 0) $$, 'B reads none of A''s dues, items, progress, payments, entries or accounts');
select is(public.t_state($$ select public.update_statutory_due(current_setting('t.a_due')::uuid, 1, current_date) $$), 'FC008:', 'B cannot edit A''s due');
select is(public.t_state($$ select public.set_statutory_due_archived(current_setting('t.a_due')::uuid, true) $$), 'FC008:', 'B cannot archive A''s due');
select is(public.t_state($$ select public.set_statutory_due_archived(current_setting('t.a_due')::uuid, false) $$), 'FC008:', 'B cannot restore A''s due');
select is(public.t_state($$ select public.delete_statutory_due(current_setting('t.a_due')::uuid) $$), 'FC008:', 'B cannot delete A''s due');
select is(public.t_state($$ select public.pay_due_item(current_setting('t.a_item')::uuid, gen_random_uuid(), public.t_acct('Sr Bank'), current_date, 1, 0, 0) $$), 'FC008:',
  'B cannot pay A''s due, even from B''s own account');
select is(public.t_state($$ select public.void_due_payment(current_setting('t.a_pay')::uuid, gen_random_uuid()) $$), 'FC008:', 'B cannot void A''s payment');
select is(public.t_state($$ select public.edit_due_payment(current_setting('t.a_pay')::uuid, gen_random_uuid(), public.t_acct('Sr Bank'), current_date, 1, 0, 0) $$), 'FC008:',
  'B cannot edit A''s payment');
update public.due_items set planned_on = current_date + 5, planned_account_id = public.t_acct('Sr Bank') where id = current_setting('t.a_item_plan')::uuid;
select lives_ok($$ select public.create_statutory_due('b1000000-0000-4000-8000-000000000090', 'fine', 5000, public.t_today()) $$, 'B adds a due of their own');
select is(public.t_state($$ select public.create_statutory_due(gen_random_uuid(), 'fine', 100, current_date, p_pay_from_account_id => current_setting('t.a_bank')::uuid) $$), 'FC010:',
  'B cannot choose A''s account to pay a new due from');
select is(public.t_state($$ select public.update_statutory_due(public.t_due('b1000000-0000-4000-8000-000000000090'), 5000, current_date, p_pay_from_account_id => current_setting('t.a_bank')::uuid) $$), 'FC010:',
  'B cannot set A''s account as the paying account on their own due');
select is(public.t_state($$ select public.pay_due_item(public.t_item('b1000000-0000-4000-8000-000000000090'), gen_random_uuid(), current_setting('t.a_bank')::uuid, current_date, 100, 0, 0) $$), 'FC010:',
  'B cannot pay their own due from A''s account');
select isnt(public.t_state($$ update public.due_items set planned_on = current_date + 3, planned_account_id = current_setting('t.a_bank')::uuid
  where id = public.t_item('b1000000-0000-4000-8000-000000000090') $$), 'ok', 'B cannot plan their own due on A''s account');
select is(public.t_state($$ insert into public.statutory_dues (user_id, due_type, currency, amount_minor, due_date, idempotency_key)
  values ('88888888-8888-4888-8888-888888888888', 'fine', 'INR', 1, current_date, gen_random_uuid()) $$), '42501:', 'B cannot write a due as A (no insert privilege on user_id)');
select is(public.t_state($$ update public.statutory_dues set archived_at = null where id = current_setting('t.a_due')::uuid $$), 'ok',
  'a direct update of A''s due by B is a silent no-op under RLS (checked below)');

reset role;
select results_eq($$ select (select planned_on::text from public.due_items where id = current_setting('t.a_item_plan')::uuid),
  (select amount_minor::text from public.statutory_dues where id = public.t_due('b1000000-0000-4000-8000-000000000040')),
  (select count(*)::text from public.statutory_dues where user_id = '88888888-8888-4888-8888-888888888888'),
  (select status from public.due_items where id = public.t_item('b1000000-0000-4000-8000-000000000010')),
  (select archived_at is null from public.statutory_dues where id = current_setting('t.a_due')::uuid) $$,
  $$ values (current_setting('t.a_planned'), current_setting('t.a_amount'), current_setting('t.a_dues'), 'paid'::text, true) $$,
  'nothing of A''s changed: plan, amount, number of dues, status');

-- ------------------------------------------------------------ anon
set local role anon;
select throws_ok($$ select count(*) from public.statutory_dues $$, '42501', null, 'anon cannot read dues');
select throws_ok($$ select count(*) from public.due_items $$, '42501', null, 'anon cannot read due items');
select throws_ok($$ select count(*) from public.due_payments $$, '42501', null, 'anon cannot read payments');
select throws_ok($$ select count(*) from public.statutory_due_progress $$, '42501', null, 'anon cannot read progress');
select throws_ok($$ select public.create_statutory_due(gen_random_uuid(), 'fine', 100, current_date) $$, '42501', null, 'anon cannot create a due');
select throws_ok($$ select public.pay_due_item(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), current_date, 1, 0, 0) $$, '42501', null, 'anon cannot pay');
select throws_ok($$ select public.void_due_payment(gen_random_uuid(), gen_random_uuid()) $$, '42501', null, 'anon cannot void');
select throws_ok($$ select public.update_statutory_due(gen_random_uuid(), 1, current_date) $$, '42501', null, 'anon cannot edit a due');
select throws_ok($$ select public.delete_statutory_due(gen_random_uuid()) $$, '42501', null, 'anon cannot delete a due');
select throws_ok($$ select public.set_statutory_due_archived(gen_random_uuid(), true) $$, '42501', null, 'anon cannot archive a due');

reset role;
select * from finish();
rollback;
