-- pgTAP tests for statutory and legal dues (migration 20261028230000): create, part payments,
-- FC052 / FC053 / FC054, edit and void, interest on a tax due, archive / restore / delete,
-- system categories (adoption, never null), Total available and budgets, digits in any script,
-- the paying account set null on delete, loans and card bills still one active payment, direct
-- writes, RLS, anon and the user cascade. Amounts in paise. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(101);

insert into auth.users (id, email) values
  ('66666666-6666-4666-8666-666666666666', 'sd-asha@example.test'),
  ('77777777-7777-4777-8777-777777777777', 'sd-bala@example.test');

-- Helpers (SECURITY INVOKER: RLS applies to whoever calls them).
create function public.t_today() returns date language sql stable set search_path = ''
  as $$ select public.user_local_today((select auth.uid())) $$;
create function public.t_acct(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select a.id from public.accounts as a where a.name = p_name $$;
create function public.t_due(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select s.id from public.statutory_dues as s where s.idempotency_key = p_key $$;
create function public.t_item(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select d.id from public.due_items as d join public.statutory_dues as s on s.id = d.statutory_due_id where s.idempotency_key = p_key $$;
create function public.t_status(p_key uuid) returns text language sql stable set search_path = ''
  as $$ select d.status from public.due_items as d where d.id = public.t_item(p_key) $$;
create function public.t_left(p_key uuid) returns bigint language sql stable set search_path = ''
  as $$ select p.left_minor from public.statutory_due_progress as p where p.due_item_id = public.t_item(p_key) $$;
create function public.t_dp(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select p.id from public.due_payments as p where p.idempotency_key = p_key $$;
create function public.t_cat(p_key text) returns uuid language sql stable set search_path = ''
  as $$ select c.id from public.categories as c where c.system_key = p_key $$;
create function public.t_total() returns bigint language sql stable set search_path = ''
  as $$ select coalesce(sum(a.opening_balance_minor + b.inflow_minor - b.outflow_minor), 0)::bigint
        from public.accounts as a join public.account_balances as b on b.account_id = a.id
        where a.archived_at is null and a.kind in ('bank', 'cash', 'other') $$;
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
-- Pays a statutory due item (amount and interest) from an account today.
create function public.t_pay(p_due uuid, p_key uuid, p_account text, p_amount bigint, p_interest bigint default 0)
  returns public.due_payments language sql set search_path = ''
  as $$ select * from public.pay_due_item(public.t_item(p_due), p_key, public.t_acct(p_account), public.t_today(), p_amount, p_interest, 0) $$;
grant execute on function public.t_today(), public.t_acct(text), public.t_due(uuid), public.t_item(uuid), public.t_status(uuid),
  public.t_left(uuid), public.t_dp(uuid), public.t_cat(text), public.t_total(), public.t_state(text), public.t_refused(text),
  public.t_pay(uuid, uuid, text, bigint, bigint) to authenticated;

-- ------------------------------------------------------------ privileges
select ok(not has_function_privilege('anon', 'public.create_statutory_due(uuid, text, bigint, date, text, text, text, text, uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.update_statutory_due(uuid, bigint, date, text, text, text, text, uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.set_statutory_due_archived(uuid, boolean)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.delete_statutory_due(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.statutory_dues_validate()', 'EXECUTE'),
  'anon cannot call the statutory functions; nobody calls the guard');
select ok(not has_column_privilege('authenticated', 'public.due_payments', 'allows_parts', 'INSERT')
          and not has_column_privilege('authenticated', 'public.statutory_dues', 'amount_minor', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.statutory_dues', 'DELETE'),
  'clients cannot set allows_parts, change an amount directly or delete a due');
select ok((select indexdef from pg_indexes where indexname = 'due_payments_one_active_idx') like '%NOT allows_parts%',
  'one active payment per item, except where allows_parts');

-- ------------------------------------------------------------ as A
select set_config('request.jwt.claims', '{"sub": "66666666-6666-4666-8666-666666666666", "role": "authenticated"}', true);
set local role authenticated;

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('bank', 'savings', 'Sd Bank', 'INR', 10000000, public.t_today() - 30);
insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date) values
  ('cash', 'Sd Cash', 'INR', 50000, public.t_today() - 30),
  ('other', 'Sd Spare', 'INR', 0, public.t_today() - 30),
  ('other', 'Sd Old', 'INR', 0, public.t_today() - 30);
update public.accounts set archived_at = now() where name = 'Sd Old';
-- An active "TAXES" (another case) and an archived "Fines & penalties": both adopted.
insert into public.categories (kind, name, icon) values ('expense', 'TAXES', 'bills'), ('expense', 'Fines & penalties', 'bills');
update public.categories set archived_at = now() where name = 'Fines & penalties';
select set_config('t.cat_taxes', (select id from public.categories where name = 'TAXES')::text, true);
select set_config('t.cat_fines', (select id from public.categories where name = 'Fines & penalties')::text, true);

-- ============================================================ create
select lives_ok(
  $$ select public.create_statutory_due('e1000000-0000-4000-8000-000000000001', 'income_tax', 5000000, public.t_today() + 10,
       '  Advance   tax ', p_pay_from_account_id => public.t_acct('Sd Bank')) $$,
  'A adds income tax payable of 50,000, to pay from the bank');
select results_eq(
  $$ select s.description, d.kind, d.seq, d.status, d.amount_due_minor, d.due_date = public.t_today() + 10,
            d.pay_from_account_id = public.t_acct('Sd Bank'), d.planned_on
     from public.statutory_dues as s join public.due_items as d on d.statutory_due_id = s.id
     where s.idempotency_key = 'e1000000-0000-4000-8000-000000000001' $$,
  $$ values ('Advance tax'::text, 'statutory_due'::text, 0, 'pending'::text, 5000000::bigint, true, true, null::date) $$,
  'one pending due item with the amount, date and paying account; description spaces collapsed');
select is(public.t_total(), 10050000::bigint, 'nothing is posted: Total available is unchanged');
select is((select count(*)::int from public.transactions), 0, '... and no entry exists');

select lives_ok(
  $$ select public.create_statutory_due('e1000000-0000-4000-8000-000000000002', 'fine', 100000, public.t_today() - 3, null,
       'two_wheeler', ' Karnataka ', 'Bengaluru') $$,
  'A adds a traffic fine already overdue (a past due date is allowed), with vehicle kind, state and city');
select is((select (public.create_statutory_due('e1000000-0000-4000-8000-000000000002', 'fine', 100000, public.t_today() - 3, null,
             'two_wheeler', 'Karnataka', 'Bengaluru')).id),
  public.t_due('e1000000-0000-4000-8000-000000000002'), 'a retry with the same key returns the same due');
select throws_ok(
  $$ select public.create_statutory_due('e1000000-0000-4000-8000-000000000002', 'fine', 100000, public.t_today() - 3, null,
       'two_wheeler', 'Karnataka', 'Mysuru') $$,
  'FC007', null, 'the same key with another city is refused');
select throws_ok(
  $$ select public.create_statutory_due('e1000000-0000-4000-8000-000000000002', 'fine', 100000, public.t_today() - 3, null,
       'four_wheeler', 'Karnataka', 'Bengaluru') $$,
  'FC007', null, '... and with another vehicle kind');
select is((select count(*)::int from public.due_items where kind = 'statutory_due'), 2, 'retries added no due items');

-- ============================================================ refusals
select ok(public.t_refused($$ select public.create_statutory_due(gen_random_uuid(), 'fine', 100, public.t_today(), 'Challan 1234') $$),
  'a description with 4 digits in a row is refused (no challan numbers)');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), %L)',
            'fine', 'Challan 1' || chr(2408) || chr(65299) || chr(1636))),
  '... in any mix of scripts');
select lives_ok($$ select public.create_statutory_due('e1000000-0000-4000-8000-000000000009', 'income_tax', 100, public.t_today(), 'Q4 of 202') $$,
  'three digits in a row are allowed');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), null, null, %L)',
            'fine', 'Karnataka ' || chr(120783))),
  'a digit in the state (a mathematical digit) is refused');
select ok(public.t_refused(format('select public.create_statutory_due(gen_random_uuid(), %L, 100, public.t_today(), null, null, null, %L)',
            'fine', 'Bengaluru ' || chr(65297))),
  'a digit in the city (full-width) is refused');
select ok(public.t_refused($$ select public.create_statutory_due(gen_random_uuid(), 'other_statutory', 100, public.t_today()) $$),
  'an other statutory due needs a description');
select ok(public.t_refused($$ select public.create_statutory_due(gen_random_uuid(), 'income_tax', 100, public.t_today(), null, 'two_wheeler') $$),
  'fine details only on a fine');
select ok(public.t_refused($$ select public.create_statutory_due(gen_random_uuid(), 'fine', 100, public.t_today(), null, 'truck') $$),
  'vehicle kind is two wheeler, four wheeler or other');
select ok(public.t_refused($$ select public.create_statutory_due(gen_random_uuid(), 'parking', 100, public.t_today()) $$), 'an unknown type is refused');
select ok(public.t_refused($$ select public.create_statutory_due(gen_random_uuid(), 'fine', 0, public.t_today()) $$), 'the amount is above zero');
select throws_ok($$ select public.create_statutory_due(gen_random_uuid(), 'fine', 100, null) $$, '22023', null, 'the due date is required');
select throws_ok($$ select public.create_statutory_due(gen_random_uuid(), 'fine', 100, public.t_today(), p_pay_from_account_id => public.t_acct('Sd Old')) $$,
  'FC001', null, 'an archived paying account is refused');

-- ============================================================ part payments
select lives_ok($$ select public.t_pay('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Sd Bank', 2000000) $$,
  'A pays 20,000 of the tax');
select results_eq(
  $$ select public.t_status('e1000000-0000-4000-8000-000000000001'), public.t_left('e1000000-0000-4000-8000-000000000001'),
            (select p.allows_parts from public.due_payments as p where p.id = public.t_dp('e2000000-0000-4000-8000-000000000001')),
            (select t.type from public.transactions as t where t.due_payment_id = public.t_dp('e2000000-0000-4000-8000-000000000001')),
            (select t.category_id = public.t_cat('taxes') from public.transactions as t where t.due_payment_id = public.t_dp('e2000000-0000-4000-8000-000000000001')) $$,
  $$ values ('pending'::text, 3000000::bigint, true, 'expense'::text, true) $$,
  'part-paid: pending with 30,000 left; an expense in Taxes; the payment allows parts');
select results_eq(
  $$ select public.t_cat('taxes')::text = current_setting('t.cat_taxes'), (select name from public.categories where id = public.t_cat('taxes')) $$,
  $$ values (true, 'TAXES'::text) $$,
  'the active same-name category was adopted as Taxes');
select is(public.t_total(), 8050000::bigint, 'Total available fell by what was paid, only now');
select is(public.t_state($$ select public.t_pay('e1000000-0000-4000-8000-000000000001', gen_random_uuid(), 'Sd Bank', 3000001) $$), 'FC052:3000000',
  'more than is still due is FC052, detail = what is left');
select lives_ok($$ select public.t_pay('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002', 'Sd Bank', 0, 50000) $$,
  'A pays 500 interest on the tax, nothing towards the amount');
select results_eq(
  $$ select public.t_status('e1000000-0000-4000-8000-000000000001'), public.t_left('e1000000-0000-4000-8000-000000000001'),
            (select t.category_id = public.t_cat('fines_penalties') from public.transactions as t where t.due_payment_id = public.t_dp('e2000000-0000-4000-8000-000000000002')),
            public.t_cat('fines_penalties')::text = current_setting('t.cat_fines'),
            (select archived_at from public.categories where id = public.t_cat('fines_penalties')) $$,
  $$ values ('pending'::text, 3000000::bigint, true, true, null::timestamptz) $$,
  'interest is an expense in Fines & penalties (the archived same-name category, restored) and leaves the amount due as it was');
select lives_ok($$ select public.t_pay('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000003', 'Sd Bank', 3000000) $$,
  'A pays the remaining 30,000');
select results_eq(
  $$ select public.t_status('e1000000-0000-4000-8000-000000000001'), public.t_left('e1000000-0000-4000-8000-000000000001'),
            (select count(*)::int from public.due_payments where voided_at is null and due_item_id = public.t_item('e1000000-0000-4000-8000-000000000001')) $$,
  $$ values ('paid'::text, 0::bigint, 3) $$,
  'two parts cover it: paid, with three active payments');
select throws_ok($$ select public.t_pay('e1000000-0000-4000-8000-000000000001', gen_random_uuid(), 'Sd Bank', 1) $$,
  'FC034', null, 'a paid due takes no further payment');
select lives_ok($$ select public.void_due_payment(public.t_dp('e2000000-0000-4000-8000-000000000003'), 'e2000000-0000-4000-8000-0000000000a1') $$,
  'the 30,000 part is voided');
select results_eq(
  $$ select public.t_status('e1000000-0000-4000-8000-000000000001'), public.t_left('e1000000-0000-4000-8000-000000000001'),
            (select count(*)::int from public.transactions where due_payment_id = public.t_dp('e2000000-0000-4000-8000-000000000003') and voided_at is not null) $$,
  $$ values ('pending'::text, 3000000::bigint, 1) $$,
  'voiding one of the parts makes it pending again, with its entry voided');

-- Edit the first part (20,000 -> 15,000): void and pay again, the other part still counts.
select lives_ok(
  $$ select public.edit_due_payment(public.t_dp('e2000000-0000-4000-8000-000000000001'), 'e2000000-0000-4000-8000-000000000004',
       public.t_acct('Sd Bank'), public.t_today(), 1500000, 0, 0) $$,
  'the first part is edited to 15,000');
select results_eq(
  $$ select public.t_left('e1000000-0000-4000-8000-000000000001'),
            (select replaces_id = public.t_dp('e2000000-0000-4000-8000-000000000001') from public.due_payments where id = public.t_dp('e2000000-0000-4000-8000-000000000004')),
            (select voided_at is not null from public.due_payments where id = public.t_dp('e2000000-0000-4000-8000-000000000001')) $$,
  $$ values (3500000::bigint, true, true) $$,
  '... 35,000 is left; the new payment replaces the old one, which is voided');
select is(
  public.t_state($$ select public.edit_due_payment(public.t_dp('e2000000-0000-4000-8000-000000000004'), gen_random_uuid(),
                      public.t_acct('Sd Bank'), public.t_today(), 5000001, 0, 0) $$),
  'FC052:5000000', 'an edit above what is left once it is voided is FC052 (detail 50,000)');
select is((select voided_at from public.due_payments where id = public.t_dp('e2000000-0000-4000-8000-000000000004')), null,
  '... and the payment stays as it was');
select lives_ok($$ select public.t_pay('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000005', 'Sd Bank', 3500000) $$,
  'A pays the 35,000 left');
select is(public.t_status('e1000000-0000-4000-8000-000000000001'), 'paid', 'paid again');
select lives_ok(
  $$ select public.edit_due_payment(public.t_dp('e2000000-0000-4000-8000-000000000005'), 'e2000000-0000-4000-8000-000000000006',
       public.t_acct('Sd Cash'), public.t_today(), 3500000, 0, 0, true) $$,
  'an edit of a payment on a paid due (another account, Pay anyway) is allowed');
select is(public.t_status('e1000000-0000-4000-8000-000000000001'), 'paid', '... and it stays paid');

-- A fine: one amount, no interest.
select throws_ok($$ select public.t_pay('e1000000-0000-4000-8000-000000000002', gen_random_uuid(), 'Sd Bank', 100000, 100) $$,
  '22023', null, 'interest on a fine is refused');
select throws_ok(
  $$ select public.pay_due_item(public.t_item('e1000000-0000-4000-8000-000000000002'), gen_random_uuid(), public.t_acct('Sd Bank'), public.t_today(), 100000, 0, 5) $$,
  '22023', null, 'fees on a due are refused');
select throws_ok($$ select public.t_pay('e1000000-0000-4000-8000-000000000002', gen_random_uuid(), 'Sd Cash', 100000) $$,
  'FC035', null, 'an account that cannot cover it needs "Pay anyway"');
select lives_ok($$ select public.t_pay('e1000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000011', 'Sd Bank', 100000) $$, 'the fine is paid');
select results_eq(
  $$ select public.t_status('e1000000-0000-4000-8000-000000000002'),
            (select t.category_id = public.t_cat('fines_penalties') from public.transactions as t where t.due_payment_id = public.t_dp('e2000000-0000-4000-8000-000000000011')) $$,
  $$ values ('paid'::text, true) $$, '... in Fines & penalties');
select is((select (public.t_pay('e1000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000011', 'Sd Bank', 100000)).id),
  public.t_dp('e2000000-0000-4000-8000-000000000011'), 'a double submit returns the same payment');
select is((select count(*)::int from public.transactions where due_payment_id = public.t_dp('e2000000-0000-4000-8000-000000000011')), 1, '... with one entry');

-- ============================================================ amount edits, archive, restore
select lives_ok(
  $$ select public.create_statutory_due('e1000000-0000-4000-8000-000000000003', 'other_statutory', 300000, public.t_today() + 5, 'Property tax',
       p_pay_from_account_id => public.t_acct('Sd Bank')) $$,
  'A adds a property tax of 3,000');
select lives_ok($$ select public.t_pay('e1000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000021', 'Sd Bank', 200000) $$, '2,000 of it is paid');
select is(public.t_state(format('select public.update_statutory_due(%L, 199999, public.t_today() + 5, %L)', public.t_due('e1000000-0000-4000-8000-000000000003'), 'Property tax')),
  'FC054:200000', 'the amount cannot go below what is paid (FC054, detail = paid)');
select lives_ok(format('select public.update_statutory_due(%L, 200000, public.t_today() + 5, %L)', public.t_due('e1000000-0000-4000-8000-000000000003'), 'Property tax'),
  'the amount is lowered to exactly what is paid');
select results_eq(
  $$ select public.t_status('e1000000-0000-4000-8000-000000000003'), d.amount_due_minor, d.pay_from_account_id
     from public.due_items as d where d.id = public.t_item('e1000000-0000-4000-8000-000000000003') $$,
  $$ values ('paid'::text, 200000::bigint, null::uuid) $$,
  '... so it is paid; the item follows the amount and the cleared paying account');
select lives_ok(format('select public.update_statutory_due(%L, 300000, public.t_today() + 6, %L, p_pay_from_account_id => %L)',
                  public.t_due('e1000000-0000-4000-8000-000000000003'), 'Property tax', public.t_acct('Sd Cash')),
  'raised back to 3,000, one day later, from cash');
select results_eq(
  $$ select public.t_status('e1000000-0000-4000-8000-000000000003'), d.due_date = public.t_today() + 6, d.pay_from_account_id = public.t_acct('Sd Cash')
     from public.due_items as d where d.id = public.t_item('e1000000-0000-4000-8000-000000000003') $$,
  $$ values ('pending'::text, true, true) $$,
  '... pending again, with the new date and account');
select lives_ok(
  $$ update public.due_items set planned_on = public.t_today() + 1, planned_account_id = public.t_acct('Sd Bank')
     where id = public.t_item('e1000000-0000-4000-8000-000000000003') $$,
  'Will pay later works on a due');
select is(public.t_state(format('select public.set_statutory_due_archived(%L, true)', public.t_due('e1000000-0000-4000-8000-000000000003'))),
  'FC045:100000', 'a due is archived only once fully paid (FC045, detail = what is still due)');
select lives_ok($$ select public.t_pay('e1000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000022', 'Sd Bank', 100000) $$, 'the rest is paid');
select is((select planned_on from public.due_items where id = public.t_item('e1000000-0000-4000-8000-000000000003')), null, 'a paid due loses its plan');
select lives_ok(format('select public.set_statutory_due_archived(%L, true)', public.t_due('e1000000-0000-4000-8000-000000000003')), 'the paid due is archived');
select throws_ok($$ select public.t_pay('e1000000-0000-4000-8000-000000000003', gen_random_uuid(), 'Sd Bank', 1) $$, 'FC053', null, 'an archived due takes no payment');
select throws_ok($$ select public.void_due_payment(public.t_dp('e2000000-0000-4000-8000-000000000022'), gen_random_uuid()) $$, 'FC053', null, '... nor a void');
select throws_ok(
  $$ update public.due_items set planned_on = public.t_today() + 2, planned_account_id = public.t_acct('Sd Bank')
     where id = public.t_item('e1000000-0000-4000-8000-000000000003') $$,
  'FC053', null, '... nor Will pay later');
select throws_ok(format('select public.update_statutory_due(%L, 300000, public.t_today() + 6, %L)', public.t_due('e1000000-0000-4000-8000-000000000003'), 'Property tax'),
  'FC053', null, '... nor an edit');
select lives_ok(format('select public.set_statutory_due_archived(%L, false)', public.t_due('e1000000-0000-4000-8000-000000000003')), 'it is restored');
select is((select archived_at from public.statutory_dues where id = public.t_due('e1000000-0000-4000-8000-000000000003')), null, '... and active again');

-- ============================================================ delete
select lives_ok($$ select public.create_statutory_due('e1000000-0000-4000-8000-000000000004', 'fine', 50000, public.t_today()) $$, 'a fine to delete later');
select lives_ok($$ select public.t_pay('e1000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000031', 'Sd Bank', 50000) $$, 'it is paid');
select lives_ok($$ select public.void_due_payment(public.t_dp('e2000000-0000-4000-8000-000000000031'), gen_random_uuid()) $$, 'and the payment voided');
select throws_ok(format('select public.delete_statutory_due(%L)', public.t_due('e1000000-0000-4000-8000-000000000004')),
  'FC050', null, 'a due with any payment, voided ones too, cannot be deleted');
select lives_ok(format('select public.delete_statutory_due(%L)', public.t_due('e1000000-0000-4000-8000-000000000009')), 'a due never paid is deleted');
select is((select count(*)::int from public.due_items where statutory_due_id is not null and id = public.t_item('e1000000-0000-4000-8000-000000000009')), 0, '... with its due item');

-- ============================================================ direct writes
select throws_ok($$ update public.statutory_dues set archived_at = now() where idempotency_key = 'e1000000-0000-4000-8000-000000000002' $$,
  'FC032', null, 'a due cannot be changed directly');
select throws_ok($$ insert into public.statutory_dues (due_type, currency, amount_minor, due_date, idempotency_key) values ('fine', 'INR', 1, current_date, gen_random_uuid()) $$,
  'FC032', null, 'nor added directly');
select throws_ok($$ update public.due_items set amount_due_minor = 1 where id = public.t_item('e1000000-0000-4000-8000-000000000002') $$,
  'FC032', null, 'its due item cannot be changed directly');
select throws_ok(
  $$ insert into public.due_payments (due_item_id, account_id, paid_on, principal_minor, idempotency_key, allows_parts)
     values (public.t_item('e1000000-0000-4000-8000-000000000003'), public.t_acct('Sd Bank'), current_date, 1, gen_random_uuid(), true) $$,
  '42501', null, 'the caller cannot set allows_parts');
select throws_ok(
  $$ insert into public.due_payments (due_item_id, account_id, paid_on, principal_minor, idempotency_key)
     values (public.t_item('e1000000-0000-4000-8000-000000000003'), public.t_acct('Sd Bank'), current_date, 1, gen_random_uuid()) $$,
  'FC032', null, 'nor add a payment directly');

-- ============================================================ budgets and Total available
select is(
  (select sum(b.expense_minor)::bigint from public.dashboard_breakdown(public.t_today(), public.t_today()) as b
   where b.kind = 'category' and b.category_id = public.t_cat('taxes')),
  (select sum(t.amount_minor)::bigint from public.transactions as t where t.category_id = public.t_cat('taxes') and t.voided_at is null),
  'payments count as expenses in their category (what budgets and the Overview read)');
select is(public.t_total(),
  10050000 - (select sum(p.principal_minor + p.interest_minor) from public.due_payments as p where p.voided_at is null)::bigint,
  'Total available fell by exactly the active payments');

-- The paying account is deleted: the due and its item keep no account.
select lives_ok(
  $$ select public.create_statutory_due('e1000000-0000-4000-8000-000000000005', 'income_tax', 1000, public.t_today() + 30,
       p_pay_from_account_id => public.t_acct('Sd Spare')) $$,
  'a due to pay from the spare account');
select set_config('t.spare_due', public.t_due('e1000000-0000-4000-8000-000000000005')::text, true);
select set_config('t.tax_due', public.t_due('e1000000-0000-4000-8000-000000000001')::text, true);
select set_config('t.tax_item', public.t_item('e1000000-0000-4000-8000-000000000001')::text, true);
select set_config('t.bank', public.t_acct('Sd Bank')::text, true);

reset role;
delete from public.accounts where name = 'Sd Spare';
select results_eq(
  $$ select s.pay_from_account_id, d.pay_from_account_id, d.status from public.statutory_dues as s join public.due_items as d on d.statutory_due_id = s.id
     where s.id = current_setting('t.spare_due')::uuid $$,
  $$ values (null::uuid, null::uuid, 'pending'::text) $$,
  'deleting the paying account clears it on the due and its item (the Pay form asks for another)');

-- Loans and card bills keep one active payment per item.
select set_config('request.jwt.claims', '{"sub": "66666666-6666-4666-8666-666666666666", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.create_loan('e3000000-0000-4000-8000-000000000001', 'home', 'Sd Lender', 2000000, 1000000, 1200, 'floating', 24,
       'ongoing', 500000, 12, date_trunc('month', public.t_today())::date, 44424, 44424) $$,
  'A adds a loan');
select lives_ok($$ select public.create_card('e3000000-0000-4000-8000-000000000002', 'Sd Issuer', 1000000, 5, 25, 100000) $$, 'and a card');
select lives_ok(
  $$ select public.enter_card_statement((select id from public.credit_cards where idempotency_key = 'e3000000-0000-4000-8000-000000000002'),
       'e3000000-0000-4000-8000-000000000003', public.t_today(), 100000) $$,
  'with a bill');
select set_config('t.loan_item', (select d.id from public.due_items as d join public.loans as l on l.id = d.loan_id
  where l.idempotency_key = 'e3000000-0000-4000-8000-000000000001' and d.status = 'pending' order by d.seq limit 1)::text, true);
select set_config('t.bill_item', (select d.id from public.due_items as d where d.kind = 'card_bill' limit 1)::text, true);
reset role;
select set_config('fin_creador.loan_write', 'on', true);
insert into public.due_payments (user_id, due_item_id, account_id, paid_on, principal_minor, idempotency_key)
  values ('66666666-6666-4666-8666-666666666666', current_setting('t.loan_item')::uuid, current_setting('t.bank')::uuid, current_date, 1, gen_random_uuid()),
         ('66666666-6666-4666-8666-666666666666', current_setting('t.bill_item')::uuid, current_setting('t.bank')::uuid, current_date, 1, gen_random_uuid());
select is((select bool_or(allows_parts) from public.due_payments where due_item_id in (current_setting('t.loan_item')::uuid, current_setting('t.bill_item')::uuid)),
  false, 'payments on loans and card bills never allow parts');
select throws_ok(
  $$ insert into public.due_payments (user_id, due_item_id, account_id, paid_on, principal_minor, idempotency_key)
     values ('66666666-6666-4666-8666-666666666666', current_setting('t.loan_item')::uuid, current_setting('t.bank')::uuid, current_date, 1, gen_random_uuid()) $$,
  '23505', null, 'a loan EMI still refuses a second active payment');
select throws_ok(
  $$ insert into public.due_payments (user_id, due_item_id, account_id, paid_on, principal_minor, idempotency_key)
     values ('66666666-6666-4666-8666-666666666666', current_setting('t.bill_item')::uuid, current_setting('t.bank')::uuid, current_date, 1, gen_random_uuid()) $$,
  '23505', null, 'a card bill still refuses a second active payment');
select set_config('fin_creador.loan_write', '', true);

-- ============================================================ as B
select set_config('request.jwt.claims', '{"sub": "77777777-7777-4777-8777-777777777777", "role": "authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select (select count(*)::int from public.statutory_dues), (select count(*)::int from public.due_items),
            (select count(*)::int from public.statutory_due_progress), (select count(*)::int from public.due_payments) $$,
  $$ values (0, 0, 0, 0) $$,
  'B sees none of A''s dues, items, progress or payments');
select throws_ok($$ select public.update_statutory_due(current_setting('t.tax_due')::uuid, 1, current_date) $$, 'FC008', null, 'B cannot edit A''s due');
select throws_ok($$ select public.set_statutory_due_archived(current_setting('t.tax_due')::uuid, true) $$, 'FC008', null, 'B cannot archive it');
select throws_ok($$ select public.delete_statutory_due(current_setting('t.spare_due')::uuid) $$, 'FC008', null, 'B cannot delete A''s due');
select throws_ok($$ select public.pay_due_item(current_setting('t.tax_item')::uuid, gen_random_uuid(), gen_random_uuid(), current_date, 1, 0, 0) $$,
  'FC008', null, 'B cannot pay A''s due');
select throws_ok($$ select public.create_statutory_due(gen_random_uuid(), 'fine', 100, current_date, p_pay_from_account_id => current_setting('t.bank')::uuid) $$,
  'FC010', null, 'B cannot plan to pay from A''s account');
insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
  values ('bank', 'savings', 'Sb Bank', 'INR', 100000, public.t_today() - 1);
select lives_ok($$ select public.create_statutory_due('e1000000-0000-4000-8000-000000000001', 'fine', 100, public.t_today()) $$,
  'B adds a due under a request key A used: keys are per user');

reset role;
select results_eq(
  $$ select (select amount_minor from public.statutory_dues where id = current_setting('t.tax_due')::uuid),
            (select status from public.due_items where id = current_setting('t.tax_item')::uuid) $$,
  $$ values (5000000::bigint, 'paid'::text) $$,
  'nothing of A''s changed');
delete from auth.users where id = '77777777-7777-4777-8777-777777777777';
select is((select count(*)::int from public.statutory_dues where user_id = '77777777-7777-4777-8777-777777777777'), 0,
  'deleting a user deletes their dues');

-- ============================================================ anon
set local role anon;
select throws_ok($$ select count(*) from public.statutory_dues $$, '42501', null, 'anon cannot read dues');
select throws_ok($$ select count(*) from public.statutory_due_progress $$, '42501', null, 'anon cannot read progress');

reset role;
select * from finish();
rollback;
