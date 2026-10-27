-- pgTAP tests for credit cards, statements, informal borrowing and their payments (migration
-- 20261028180000). Run with `supabase test db` (CI). Everything is rolled back. Dates parity:
-- card_dates_parity.test.sql.
begin;
create extension if not exists pgtap with schema extensions;

select plan(164);

-- Users A (Asia/Kolkata, the default) and B, fictional.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bala@example.test');

-- Helpers (SECURITY INVOKER: RLS applies to whoever calls them).
create function public.t_today() returns date language sql stable set search_path = ''
  as $$ select public.user_local_today((select auth.uid())) $$;
create function public.t_acct(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select a.id from public.accounts as a where a.name = p_name and a.kind in ('bank', 'cash', 'other') $$;
create function public.t_card(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select c.id from public.credit_cards as c where c.idempotency_key = p_key $$;
create function public.t_card_acct(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select c.account_id from public.credit_cards as c where c.idempotency_key = p_key $$;
create function public.t_stmt(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select s.id from public.card_statements as s where s.idempotency_key = p_key $$;
create function public.t_bill(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select d.id from public.due_items as d join public.card_statements as s on s.id = d.card_statement_id where s.idempotency_key = p_key $$;
create function public.t_bill_status(p_key uuid) returns text language sql stable set search_path = ''
  as $$ select d.status from public.due_items as d join public.card_statements as s on s.id = d.card_statement_id where s.idempotency_key = p_key $$;
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
  as $$ select c.id from public.categories as c where c.kind = 'expense' and c.name = 'Card misc' $$;
grant execute on function public.t_today(), public.t_acct(text), public.t_card(uuid), public.t_card_acct(uuid), public.t_stmt(uuid),
  public.t_bill(uuid), public.t_bill_status(uuid), public.t_borrow(uuid), public.t_borrow_acct(uuid), public.t_borrow_due(uuid),
  public.t_lp(uuid), public.t_dp(uuid), public.t_tx(uuid), public.t_bal(uuid), public.t_misc() to authenticated;

-- ------------------------------------------------------------ privileges and kinds
select ok(not has_function_privilege('anon', 'public.create_card(uuid, text, bigint, integer, integer, bigint, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.enter_card_statement(uuid, uuid, date, bigint, bigint, date, bigint, uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.pay_card(uuid, uuid, uuid, date, bigint, boolean)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.create_borrowing(uuid, text, bigint, uuid, date, date)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.repay_borrowing(uuid, uuid, uuid, date, bigint, bigint, boolean)', 'EXECUTE'),
  'anon cannot call the card and borrowing functions');
select ok(not has_function_privilege('authenticated', 'public.credit_cards_validate()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.card_statements_guard()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.borrowings_validate()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.liability_payments_guard()', 'EXECUTE'),
  'clients cannot call the guard functions');
select ok(not has_column_privilege('authenticated', 'public.credit_cards', 'user_id', 'INSERT')
          and not has_column_privilege('authenticated', 'public.liability_payments', 'user_id', 'INSERT')
          and not has_column_privilege('authenticated', 'public.borrowings', 'user_id', 'INSERT'),
  'clients cannot choose an owner');
select results_eq(
  $$ select public.is_liability_kind('loan'), public.is_liability_kind('card'), public.is_liability_kind('borrowing'),
            public.is_liability_kind('bank'), public.is_liability_kind('cash'), public.is_liability_kind('other') $$,
  $$ values (true, true, true, false, false, false) $$,
  'is_liability_kind names loan, card and borrowing only');
select results_eq(
  $$ select provolatile::text from pg_proc where proname in ('card_cycle_date', 'card_due_date', 'is_liability_kind') order by proname $$,
  $$ values ('i'), ('i'), ('i') $$,
  'the cycle-date helpers are immutable');

-- ------------------------------------------------------------ as A: accounts
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('bank', 'savings', 'HDFC Bank', 'INR', 10000000, public.t_today() - 30);
insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date) values
  ('cash', 'Cash in hand', 'INR', 5000, public.t_today() - 30);
insert into public.categories (kind, name, icon) values ('expense', 'Card misc', 'bills');

-- ------------------------------------------------------------ create_card
select lives_ok(
  $$ select public.create_card('c1000000-0000-4000-8000-000000000001', ' HDFC   Bank ', 10000000, 20, 8, 600000, 'Travel') $$,
  'A adds a card owing 6,000');
select results_eq(
  $$ select a.kind, a.name, a.institution, a.opening_balance_minor, a.opening_balance_date = public.t_today(), a.last4 is null, a.currency
     from public.accounts as a where a.id = public.t_card_acct('c1000000-0000-4000-8000-000000000001') $$,
  $$ values ('card'::text, 'Travel'::text, 'HDFC Bank'::text, -600000::bigint, true, true, 'INR'::text) $$,
  'its liability account holds minus what is owed, from today, in the profile currency, with no number');
select is((select (public.create_card('c1000000-0000-4000-8000-000000000001', 'HDFC Bank', 10000000, 20, 8, 600000, 'Travel')).id),
  public.t_card('c1000000-0000-4000-8000-000000000001'), 'a retry with the same request key returns the same card');
select throws_ok($$ select public.create_card('c1000000-0000-4000-8000-000000000001', 'HDFC Bank', 9000000, 20, 8, 600000) $$,
  'FC007', null, 'the same key for a different card is refused');
select throws_ok($$ select public.create_card(gen_random_uuid(), 'HDFC Bank', 10000000, 20, 8, 0, 'Card 1') $$,
  '23514', null, 'a digit in the nickname is refused');
select throws_ok($$ select public.create_card(gen_random_uuid(), 'Bank 9', 10000000, 20, 8) $$,
  '23514', null, 'a digit in the issuer is refused');
select throws_ok(
  $$ insert into public.credit_cards (account_id, issuer, currency, limit_minor, statement_day, due_day, opening_owed_minor, tracking_started_on, idempotency_key)
     values (public.t_acct('HDFC Bank'), 'X', 'INR', 1, 1, 1, 0, public.t_today(), gen_random_uuid()) $$,
  'FC032', null, 'cards cannot be added directly');
select throws_ok($$ update public.credit_cards set limit_minor = 1 where id = public.t_card('c1000000-0000-4000-8000-000000000001') $$,
  'FC032', null, 'cards cannot be changed directly');
select throws_ok(
  $$ insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date) values ('card', 'Mine', 'INR', 0, public.t_today()) $$,
  'FC032', null, 'card accounts cannot be added directly');

-- ------------------------------------------------------------ purchases
select lives_ok(
  $$ select public.record_transaction('expense', 'c2000000-0000-4000-8000-000000000001', 200000, public.t_today(),
       public.t_card_acct('c1000000-0000-4000-8000-000000000001'), public.t_misc()) $$,
  'a purchase is an expense on the card');
select is(public.liability_owed(public.t_card_acct('c1000000-0000-4000-8000-000000000001')), 800000::bigint, '... and raises what is owed');
select lives_ok(
  $$ select public.record_transaction('expense', 'c2000000-0000-4000-8000-000000000002', 50000, public.t_today(),
       public.t_card_acct('c1000000-0000-4000-8000-000000000001'), public.t_misc()) $$,
  'a second purchase');
select lives_ok(
  $$ select public.edit_transaction(public.t_tx('c2000000-0000-4000-8000-000000000002'), 'c2000000-0000-4000-8000-000000000003', 40000,
       public.t_today(), public.t_card_acct('c1000000-0000-4000-8000-000000000001'), public.t_misc()) $$,
  'a purchase can be edited');
select lives_ok(
  $$ select public.void_transaction(public.t_tx('c2000000-0000-4000-8000-000000000003'), 'c2000000-0000-4000-8000-000000000004') $$,
  'a refund: the purchase is voided');
select is(public.liability_owed(public.t_card_acct('c1000000-0000-4000-8000-000000000001')), 800000::bigint, '... and what is owed is back');
select throws_ok(
  $$ select public.record_transaction('income', gen_random_uuid(), 100, public.t_today(), public.t_card_acct('c1000000-0000-4000-8000-000000000001'),
       (select id from public.categories where kind = 'income' limit 1)) $$,
  'FC049', null, 'income cannot be recorded on a card');
select throws_ok(
  $$ select public.record_transaction('transfer', gen_random_uuid(), 100, public.t_today(), public.t_card_acct('c1000000-0000-4000-8000-000000000001'),
       p_counter_account_id => public.t_acct('HDFC Bank')) $$,
  'FC049', null, 'nor a transfer out of a card');
select throws_ok(
  $$ select public.record_transaction('transfer', gen_random_uuid(), 100, public.t_today(), public.t_acct('HDFC Bank'),
       p_counter_account_id => public.t_card_acct('c1000000-0000-4000-8000-000000000001')) $$,
  'FC032', null, 'a transfer into a card is recorded only by paying it');
select throws_ok(
  $$ select public.record_transaction('expense', gen_random_uuid(), 100, public.t_today() - 1,
       public.t_card_acct('c1000000-0000-4000-8000-000000000001'), public.t_misc()) $$,
  'FC036', null, 'a purchase before the card was added is in its opening amount owed');
select throws_ok(
  $$ select public.set_card_archived(public.t_card('c1000000-0000-4000-8000-000000000001'), true) $$,
  'FC045', null, 'a card that owes something cannot be archived');

-- ------------------------------------------------------------ recurring items on a card
select lives_ok(
  $$ insert into public.recurring_rules (type, amount_minor, currency, account_id, category_id, frequency, start_date, idempotency_key)
     values ('expense', 49900, 'INR', public.t_card_acct('c1000000-0000-4000-8000-000000000001'), public.t_misc(), 'monthly', public.t_today(), gen_random_uuid()) $$,
  'a recurring expense can use a card');
select throws_ok(
  $$ insert into public.recurring_rules (type, amount_minor, currency, account_id, category_id, frequency, start_date, idempotency_key)
     values ('expense', 49900, 'INR', public.t_card_acct('c1000000-0000-4000-8000-000000000001'), public.t_misc(), 'monthly', public.t_today() - 1, gen_random_uuid()) $$,
  'FC036', null, '... starting on or after the day the card was added, so no occurrence is stuck');
select throws_ok(
  $$ insert into public.recurring_rules (type, amount_minor, currency, account_id, category_id, frequency, start_date, idempotency_key)
     values ('income', 100, 'INR', public.t_card_acct('c1000000-0000-4000-8000-000000000001'), (select id from public.categories where kind = 'income' limit 1),
             'monthly', public.t_today(), gen_random_uuid()) $$,
  'FC032', null, 'recurring income cannot use a card');
select throws_ok(
  $$ insert into public.recurring_rules (type, amount_minor, currency, account_id, counter_account_id, frequency, start_date, idempotency_key)
     values ('transfer', 100, 'INR', public.t_acct('HDFC Bank'), public.t_card_acct('c1000000-0000-4000-8000-000000000001'), 'monthly', public.t_today(), gen_random_uuid()) $$,
  'FC032', null, 'a recurring transfer into a card is refused');

-- ------------------------------------------------------------ statements
-- S1: total 10,000 with a 1,000 card EMI: bill 9,000; 8,000 owed on the date: 1,000 missing.
select lives_ok(
  $$ select public.enter_card_statement(public.t_card('c1000000-0000-4000-8000-000000000001'), 'c3000000-0000-4000-8000-000000000001',
       public.t_today(), 1000000, 50000, p_emi_included_minor => 100000, p_difference_category_id => public.t_misc()) $$,
  'A enters a statement and records the difference');
select results_eq(
  $$ select s.owed_at_statement_minor, s.difference_minor, t.amount_minor, t.type, t.account_id = public.t_card_acct('c1000000-0000-4000-8000-000000000001'),
            t.category_id = public.t_misc(), t.occurred_on = s.statement_date
     from public.card_statements as s join public.transactions as t on t.id = s.difference_transaction_id
     where s.id = public.t_stmt('c3000000-0000-4000-8000-000000000001') $$,
  $$ values (800000::bigint, 100000::bigint, 100000::bigint, 'expense'::text, true, true, true) $$,
  'owed is measured on the statement date; the difference is an expense on the card, dated the statement');
select results_eq(
  $$ select d.kind, d.amount_due_minor, d.minimum_due_minor, d.status, d.due_date = public.card_due_date(public.t_today(), 8)
     from public.due_items as d where d.id = public.t_bill('c3000000-0000-4000-8000-000000000001') $$,
  $$ values ('card_bill'::text, 900000::bigint, 50000::bigint, 'pending'::text, true) $$,
  'the bill (total less card EMIs) is a pending due item at the card''s due day');
select is(public.liability_owed(public.t_card_acct('c1000000-0000-4000-8000-000000000001')), 900000::bigint, 'what is owed now matches the bill');
select is((select (public.enter_card_statement(public.t_card('c1000000-0000-4000-8000-000000000001'), 'c3000000-0000-4000-8000-000000000001',
             public.t_today(), 1000000, 50000, p_emi_included_minor => 100000, p_difference_category_id => public.t_misc())).id),
  public.t_stmt('c3000000-0000-4000-8000-000000000001'), 'a retried statement returns the saved one');
select is((select count(*)::int from public.transactions where note like 'Statement difference%'), 1, '... and posts the difference once');
select throws_ok(
  $$ select public.enter_card_statement(public.t_card('c1000000-0000-4000-8000-000000000001'), 'c3000000-0000-4000-8000-000000000001', public.t_today(), 1) $$,
  'FC007', null, 'the same key for a different statement is refused');
select throws_ok(
  $$ select public.enter_card_statement(public.t_card('c1000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_today(), 1) $$,
  'FC046', null, 'one statement per card and statement date');
select throws_ok(
  $$ select public.enter_card_statement(public.t_card('c1000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_today() + 1, 1) $$,
  'FC003', null, 'a statement date in the future is refused');
select throws_ok(
  $$ select public.enter_card_statement(public.t_card('c1000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_today() - 3, 1,
       p_due_date => public.t_today() - 4) $$,
  'FC051', null, 'a due date before the statement date is refused');
select throws_ok(
  $$ select public.void_transaction((select difference_transaction_id from public.card_statements where id = public.t_stmt('c3000000-0000-4000-8000-000000000001')),
       gen_random_uuid()) $$,
  'FC032', null, 'the difference expense cannot be voided on its own');
select throws_ok(
  $$ select public.edit_transaction((select difference_transaction_id from public.card_statements where id = public.t_stmt('c3000000-0000-4000-8000-000000000001')),
       gen_random_uuid(), 1, public.t_today(), public.t_card_acct('c1000000-0000-4000-8000-000000000001'), public.t_misc()) $$,
  'FC032', null, '... nor edited');
select throws_ok(
  $$ insert into public.card_statements (card_id, statement_date, due_date, total_minor, idempotency_key)
     values (public.t_card('c1000000-0000-4000-8000-000000000001'), public.t_today() - 9, public.t_today(), 1, gen_random_uuid()) $$,
  'FC032', null, 'statements cannot be added directly');
-- S0: dated before the card was added: nothing is measured or posted, even with a category.
select lives_ok(
  $$ select public.enter_card_statement(public.t_card('c1000000-0000-4000-8000-000000000001'), 'c3000000-0000-4000-8000-000000000000',
       public.t_today() - 1, 500000, p_difference_category_id => public.t_misc()) $$,
  'a statement from before the card was added');
select results_eq(
  $$ select owed_at_statement_minor, difference_minor, difference_transaction_id from public.card_statements where id = public.t_stmt('c3000000-0000-4000-8000-000000000000') $$,
  $$ values (null::bigint, 0::bigint, null::uuid) $$,
  '... measures nothing and posts no difference');
select lives_ok($$ select public.delete_card_statement(public.t_stmt('c3000000-0000-4000-8000-000000000000')) $$,
  'a statement entered by mistake is deleted');
select is((select count(*)::int from public.due_items where kind = 'card_bill'), 1, '... with its bill');

-- ------------------------------------------------------------ paying the bill
select throws_ok(
  $$ select public.pay_due_item(public.t_bill('c3000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('HDFC Bank'), public.t_today(), 50000, 100, 0) $$,
  '22023', null, 'a bill is paid as one amount');
select throws_ok(
  $$ select public.pay_due_item(public.t_bill('c3000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('HDFC Bank'), public.t_today(), 900001, 0, 0) $$,
  'FC047', null, 'more than the card owes: record the missing purchase first');
select throws_ok(
  $$ select public.pay_due_item(public.t_bill('c3000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('Cash in hand'), public.t_today(), 50000, 0, 0) $$,
  'FC035', null, 'an account that cannot cover it needs "Pay anyway"');
select lives_ok(
  $$ select public.pay_due_item(public.t_bill('c3000000-0000-4000-8000-000000000001'), 'c4000000-0000-4000-8000-000000000001', public.t_acct('HDFC Bank'), public.t_today(), 50000, 0, 0) $$,
  'A pays the minimum');
select results_eq(
  $$ select public.t_bill_status('c3000000-0000-4000-8000-000000000001'), public.card_bill_paid(public.t_bill('c3000000-0000-4000-8000-000000000001')),
            public.liability_owed(public.t_card_acct('c1000000-0000-4000-8000-000000000001')),
            (select count(*)::int from public.transactions where due_payment_id = public.t_dp('c4000000-0000-4000-8000-000000000001') and type = 'transfer'
               and account_id = public.t_acct('HDFC Bank') and counter_account_id = public.t_card_acct('c1000000-0000-4000-8000-000000000001')) $$,
  $$ values ('paid'::text, 50000::bigint, 850000::bigint, 1) $$,
  'a part-paid bill closes; the payment is a transfer to the card and the rest stays owed');
select is((select paid_minor from public.card_bill_progress where due_item_id = public.t_bill('c3000000-0000-4000-8000-000000000001')), 50000::bigint,
  'card_bill_progress shows what is paid');
select throws_ok(
  $$ select public.pay_due_item(public.t_bill('c3000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('HDFC Bank'), public.t_today(), 1000, 0, 0) $$,
  'FC034', null, 'one payment per bill');
select throws_ok($$ select public.delete_card_statement(public.t_stmt('c3000000-0000-4000-8000-000000000001')) $$,
  'FC050', null, 'a statement whose bill was paid cannot be deleted');
select lives_ok(
  $$ select public.edit_due_payment(public.t_dp('c4000000-0000-4000-8000-000000000001'), 'c4000000-0000-4000-8000-000000000002',
       public.t_acct('HDFC Bank'), public.t_today(), 100000, 0, 0) $$,
  'the bill payment is edited');
select results_eq(
  $$ select public.t_bill_status('c3000000-0000-4000-8000-000000000001'), public.card_bill_paid(public.t_bill('c3000000-0000-4000-8000-000000000001')),
            public.liability_owed(public.t_card_acct('c1000000-0000-4000-8000-000000000001')),
            (select count(*)::int from public.transactions where due_payment_id = public.t_dp('c4000000-0000-4000-8000-000000000001') and voided_at is null) $$,
  $$ values ('paid'::text, 100000::bigint, 800000::bigint, 0) $$,
  '... its old transfer is voided and the new one posted');
select throws_ok(
  $$ select public.edit_due_payment(public.t_dp('c4000000-0000-4000-8000-000000000002'), gen_random_uuid(), public.t_acct('HDFC Bank'), public.t_today(), 900001, 0, 0) $$,
  'FC047', null, 'an edit above what is owed is refused');
select throws_ok(
  $$ select public.edit_due_payment(public.t_dp('c4000000-0000-4000-8000-000000000002'), gen_random_uuid(), public.t_acct('Cash in hand'), public.t_today(), 60000, 0, 0) $$,
  'FC035', null, 'an edit onto an account that cannot cover it needs "Pay anyway"');
select lives_ok(
  $$ select public.void_due_payment(public.t_dp('c4000000-0000-4000-8000-000000000002'), 'c4000000-0000-4000-8000-0000000000a1') $$,
  'the bill payment is voided');
select results_eq(
  $$ select public.t_bill_status('c3000000-0000-4000-8000-000000000001'), public.card_bill_paid(public.t_bill('c3000000-0000-4000-8000-000000000001')),
            public.liability_owed(public.t_card_acct('c1000000-0000-4000-8000-000000000001')) $$,
  $$ values ('pending'::text, 0::bigint, 900000::bigint) $$,
  '... the bill is pending again and fully owed');
select lives_ok(
  $$ update public.due_items set planned_on = public.t_today() + 1, planned_account_id = public.t_acct('HDFC Bank')
     where id = public.t_bill('c3000000-0000-4000-8000-000000000001') $$,
  'Will pay later works on a bill');
select throws_ok(
  $$ update public.due_items set planned_on = public.t_today() + 1, planned_account_id = public.t_card_acct('c1000000-0000-4000-8000-000000000001')
     where id = public.t_bill('c3000000-0000-4000-8000-000000000001') $$,
  'FC038', null, 'a card cannot be the planned account');

-- ------------------------------------------------------------ pay_card (any amount)
select lives_ok(
  $$ select public.pay_card(public.t_card('c1000000-0000-4000-8000-000000000001'), 'c5000000-0000-4000-8000-000000000001', public.t_acct('HDFC Bank'), public.t_today(), 400000) $$,
  'A pays 4,000 to the card');
select results_eq(
  $$ select public.t_bill_status('c3000000-0000-4000-8000-000000000001'), public.card_bill_paid(public.t_bill('c3000000-0000-4000-8000-000000000001')),
            public.liability_owed(public.t_card_acct('c1000000-0000-4000-8000-000000000001')) $$,
  $$ values ('pending'::text, 400000::bigint, 500000::bigint) $$,
  'the bill stays pending until transfers cover it');
select is((select (public.pay_card(public.t_card('c1000000-0000-4000-8000-000000000001'), 'c5000000-0000-4000-8000-000000000001', public.t_acct('HDFC Bank'), public.t_today(), 400000)).id),
  public.t_lp('c5000000-0000-4000-8000-000000000001'), 'a retried card payment returns the saved one');
select throws_ok(
  $$ select public.pay_card(public.t_card('c1000000-0000-4000-8000-000000000001'), 'c5000000-0000-4000-8000-000000000001', public.t_acct('HDFC Bank'), public.t_today(), 1) $$,
  'FC007', null, 'the same key for a different payment is refused');
select lives_ok(
  $$ select public.pay_card(public.t_card('c1000000-0000-4000-8000-000000000001'), 'c5000000-0000-4000-8000-000000000002', public.t_acct('HDFC Bank'), public.t_today(), 500000) $$,
  'A pays the rest');
select results_eq(
  $$ select status, planned_on from public.due_items where id = public.t_bill('c3000000-0000-4000-8000-000000000001') $$,
  $$ values ('paid'::text, null::date) $$,
  'the bill is paid once transfers cover it, and its plan goes');
select throws_ok(
  $$ select public.pay_card(public.t_card('c1000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('HDFC Bank'), public.t_today(), 1) $$,
  'FC047', null, 'nothing is owed: a further payment needs the missing purchase first');
select throws_ok(
  $$ select public.pay_card(public.t_card('c1000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('HDFC Bank'), public.t_today() - 1, 1) $$,
  'FC036', null, 'a payment before the card was added is refused');
select lives_ok(
  $$ select public.void_liability_payment(public.t_lp('c5000000-0000-4000-8000-000000000002'), 'c5000000-0000-4000-8000-0000000000a1') $$,
  'the second card payment is voided');
select results_eq(
  $$ select public.t_bill_status('c3000000-0000-4000-8000-000000000001'), public.liability_owed(public.t_card_acct('c1000000-0000-4000-8000-000000000001')),
            (select count(*)::int from public.transactions where liability_payment_id = public.t_lp('c5000000-0000-4000-8000-000000000002') and voided_at is null) $$,
  $$ values ('pending'::text, 500000::bigint, 0) $$,
  '... with its transfer; the bill is pending again');
select is((select (public.void_liability_payment(public.t_lp('c5000000-0000-4000-8000-000000000002'), 'c5000000-0000-4000-8000-0000000000a1')).id),
  public.t_lp('c5000000-0000-4000-8000-000000000002'), 'a retried void returns the voided payment');
select throws_ok(
  $$ select public.void_transaction((select id from public.transactions where liability_payment_id = public.t_lp('c5000000-0000-4000-8000-000000000001')), gen_random_uuid()) $$,
  'FC032', null, 'void_transaction cannot void a card payment''s transfer');
select lives_ok(
  $$ select public.edit_liability_payment(public.t_lp('c5000000-0000-4000-8000-000000000001'), 'c5000000-0000-4000-8000-000000000003',
       public.t_acct('HDFC Bank'), public.t_today(), 900000) $$,
  'the first card payment is edited to the whole bill');
select results_eq(
  $$ select public.t_bill_status('c3000000-0000-4000-8000-000000000001'), public.liability_owed(public.t_card_acct('c1000000-0000-4000-8000-000000000001')),
            (select replaces_id from public.liability_payments where id = public.t_lp('c5000000-0000-4000-8000-000000000003')) = public.t_lp('c5000000-0000-4000-8000-000000000001') $$,
  $$ values ('paid'::text, 0::bigint, true) $$,
  '... replacing it: nothing is owed and the bill is paid');
select throws_ok(
  $$ select public.edit_liability_payment(public.t_lp('c5000000-0000-4000-8000-000000000003'), gen_random_uuid(), public.t_acct('HDFC Bank'), public.t_today(), 900001) $$,
  'FC047', null, 'an edit above what is owed is refused');
select throws_ok(
  $$ select public.edit_liability_payment(public.t_lp('c5000000-0000-4000-8000-000000000003'), gen_random_uuid(), public.t_acct('Cash in hand'), public.t_today(), 900000) $$,
  'FC035', null, 'an edit onto an account that cannot cover it needs "Pay anyway"');
select throws_ok(
  $$ insert into public.liability_payments (liability_account_id, account_id, paid_on, principal_minor, idempotency_key)
     values (public.t_card_acct('c1000000-0000-4000-8000-000000000001'), public.t_acct('HDFC Bank'), public.t_today(), 1, gen_random_uuid()) $$,
  'FC032', null, 'payments cannot be added directly');
select throws_ok(
  $$ update public.liability_payments set voided_at = now(), void_idempotency_key = gen_random_uuid() where id = public.t_lp('c5000000-0000-4000-8000-000000000003') $$,
  'FC032', null, 'payments cannot be voided directly');

-- ------------------------------------------------------------ archive at a zero balance only
select lives_ok($$ select public.void_transaction(public.t_tx('c2000000-0000-4000-8000-000000000001'), gen_random_uuid()) $$,
  'a refund after paying leaves the card in credit');
select throws_ok($$ select public.set_card_archived(public.t_card('c1000000-0000-4000-8000-000000000001'), true) $$,
  'FC045', null, 'a card in credit cannot be archived');
select lives_ok(
  $$ select public.record_transaction('expense', 'c2000000-0000-4000-8000-000000000005', 200000, public.t_today(),
       public.t_card_acct('c1000000-0000-4000-8000-000000000001'), public.t_misc()) $$,
  'a purchase brings it back to zero');
select lives_ok($$ select public.set_card_archived(public.t_card('c1000000-0000-4000-8000-000000000001'), true) $$, 'the card is archived');
select throws_ok(
  $$ select public.pay_card(public.t_card('c1000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('HDFC Bank'), public.t_today(), 1) $$,
  'FC048', null, 'an archived card cannot be paid');
select throws_ok(
  $$ select public.enter_card_statement(public.t_card('c1000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_today() - 2, 1) $$,
  'FC048', null, '... nor get a statement');
select lives_ok($$ select public.set_card_archived(public.t_card('c1000000-0000-4000-8000-000000000001'), false) $$, 'the card is restored');

-- ------------------------------------------------------------ a second and a third card
select lives_ok($$ select public.create_card('c1000000-0000-4000-8000-000000000002', 'SBI Card', 5000000, 5, 25, 1000000) $$, 'A adds a second card');
select lives_ok(
  $$ select public.enter_card_statement(public.t_card('c1000000-0000-4000-8000-000000000002'), 'c3000000-0000-4000-8000-000000000002',
       public.t_today(), 300000, p_difference_category_id => public.t_misc()) $$,
  'a statement below what is owed');
select results_eq(
  $$ select owed_at_statement_minor, difference_minor, difference_transaction_id from public.card_statements where id = public.t_stmt('c3000000-0000-4000-8000-000000000002') $$,
  $$ values (1000000::bigint, 0::bigint, null::uuid) $$,
  '... posts no difference (never negative)');
select throws_ok($$ select public.delete_card(public.t_card('c1000000-0000-4000-8000-000000000002')) $$,
  'FC050', null, 'a card with a statement cannot be deleted');
select lives_ok($$ select public.create_card('c1000000-0000-4000-8000-000000000003', 'Axis Bank', 5000000, 5, 25) $$, 'A adds a third card');
select lives_ok(
  $$ select public.create_loan('c6000000-0000-4000-8000-000000000001', 'credit_card_emi', 'Axis Bank', 120000, 120000, 0, 'fixed', 6, 'ongoing', 120000, 6,
       pg_catalog.date_trunc('month', public.t_today()::timestamp)::date, 20000, 20000) $$,
  'a card EMI loan');
select lives_ok(
  $$ select public.create_loan('c6000000-0000-4000-8000-000000000002', 'personal', 'Axis Bank', 120000, 120000, 0, 'fixed', 6, 'ongoing', 120000, 6,
       pg_catalog.date_trunc('month', public.t_today()::timestamp)::date, 20000, 20000) $$,
  'a personal loan');
select lives_ok(
  $$ select public.link_card_emi((select id from public.loans where idempotency_key = 'c6000000-0000-4000-8000-000000000001'), public.t_card('c1000000-0000-4000-8000-000000000003')) $$,
  'the card EMI is linked to its card');
select throws_ok(
  $$ select public.link_card_emi((select id from public.loans where idempotency_key = 'c6000000-0000-4000-8000-000000000002'), public.t_card('c1000000-0000-4000-8000-000000000003')) $$,
  '22023', null, 'only a card EMI can be linked to a card');
select lives_ok($$ select public.delete_card(public.t_card('c1000000-0000-4000-8000-000000000003')) $$, 'a card without history is deleted');
select results_eq(
  $$ select (select count(*)::int from public.credit_cards where idempotency_key = 'c1000000-0000-4000-8000-000000000003'),
            (select count(*)::int from public.accounts where kind = 'card' and name = 'Axis Bank'),
            (select card_id from public.loans where idempotency_key = 'c6000000-0000-4000-8000-000000000001') $$,
  $$ values (0, 0, null::uuid) $$,
  '... with its account; its card EMI is unlinked');

-- ------------------------------------------------------------ borrowing
select lives_ok(
  $$ select public.create_borrowing('b1000000-0000-4000-8000-000000000001', 'Ravi', 2000000, public.t_acct('HDFC Bank'), public.t_today() - 5, public.t_today() + 30) $$,
  'A borrows 20,000 from Ravi, received into the bank 5 days ago');
select results_eq(
  $$ select a.kind, a.opening_balance_minor, a.opening_balance_date = public.t_today() - 5, t.type, t.amount_minor, t.counter_account_id = public.t_acct('HDFC Bank'),
            t.occurred_on = public.t_today() - 5, public.liability_owed(a.id)
     from public.borrowings as b join public.accounts as a on a.id = b.account_id join public.transactions as t on t.id = b.receipt_transaction_id
     where b.id = public.t_borrow('b1000000-0000-4000-8000-000000000001') $$,
  $$ values ('borrowing'::text, 0::bigint, true, 'transfer'::text, 2000000::bigint, true, true, 2000000::bigint) $$,
  'the money is posted as a transfer from the borrowing account into the bank; 20,000 is owed');
select results_eq(
  $$ select d.kind, d.status, d.amount_due_minor, d.due_date = public.t_today() + 30 from public.due_items as d
     where d.borrowing_id = public.t_borrow('b1000000-0000-4000-8000-000000000001') $$,
  $$ values ('borrowing_due'::text, 'pending'::text, 2000000::bigint, true) $$,
  'its due date is a pending due item');
select is((select (public.create_borrowing('b1000000-0000-4000-8000-000000000001', 'Ravi', 2000000, public.t_acct('HDFC Bank'), public.t_today() - 5)).id),
  public.t_borrow('b1000000-0000-4000-8000-000000000001'), 'a retry with the same request key returns the same borrowing');
select throws_ok($$ select public.create_borrowing('b1000000-0000-4000-8000-000000000001', 'Ravi', 1) $$,
  'FC007', null, 'the same key for a different borrowing is refused');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi 2', 100) $$, '23514', null, 'a digit in who you owe is refused');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, public.t_acct('HDFC Bank'), public.t_today() + 1) $$,
  'FC003', null, 'money received in the future is refused');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, public.t_acct('HDFC Bank')) $$,
  '22023', null, 'the account needs the date');
select throws_ok(
  $$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, public.t_card_acct('c1000000-0000-4000-8000-000000000001'), public.t_today()) $$,
  'FC038', null, 'money cannot be received into a card');
select throws_ok($$ select public.create_borrowing(gen_random_uuid(), 'Ravi', 100, public.t_acct('HDFC Bank'), public.t_today(), public.t_today() - 1) $$,
  'FC051', null, 'a due date before the money came is refused');
select lives_ok($$ select public.create_borrowing('b1000000-0000-4000-8000-000000000002', 'Asha', 500000) $$, 'A records 5,000 borrowed earlier');
select results_eq(
  $$ select a.opening_balance_minor, a.opening_balance_date = public.t_today(), b.receipt_transaction_id,
            (select count(*)::int from public.due_items where borrowing_id = b.id)
     from public.borrowings as b join public.accounts as a on a.id = b.account_id where b.id = public.t_borrow('b1000000-0000-4000-8000-000000000002') $$,
  $$ values (-500000::bigint, true, null::uuid, 0) $$,
  '... only what is owed, from today: no entry, no due date');
select throws_ok(
  $$ select public.void_transaction((select receipt_transaction_id from public.borrowings where id = public.t_borrow('b1000000-0000-4000-8000-000000000001')), gen_random_uuid()) $$,
  'FC032', null, 'the money received cannot be voided on its own');
select throws_ok(
  $$ select public.edit_transaction((select receipt_transaction_id from public.borrowings where id = public.t_borrow('b1000000-0000-4000-8000-000000000001')),
       gen_random_uuid(), 1, public.t_today(), public.t_borrow_acct('b1000000-0000-4000-8000-000000000001'),
       p_counter_account_id => public.t_acct('HDFC Bank')) $$,
  'FC032', null, '... nor edited');
select throws_ok(
  $$ insert into public.recurring_rules (type, amount_minor, currency, account_id, category_id, frequency, start_date, idempotency_key)
     values ('expense', 100, 'INR', public.t_borrow_acct('b1000000-0000-4000-8000-000000000001'), public.t_misc(), 'monthly', public.t_today(), gen_random_uuid()) $$,
  'FC032', null, 'a recurring item cannot use a borrowing account');
select throws_ok(
  $$ select public.record_transaction('expense', gen_random_uuid(), 100, public.t_today(), public.t_borrow_acct('b1000000-0000-4000-8000-000000000001'), public.t_misc()) $$,
  'FC032', null, 'nothing is recorded on a borrowing account directly');
select throws_ok(
  $$ insert into public.borrowings (account_id, lender, currency, borrowed_minor, idempotency_key)
     values (public.t_acct('HDFC Bank'), 'X', 'INR', 1, gen_random_uuid()) $$,
  'FC032', null, 'borrowings cannot be added directly');
select throws_ok($$ update public.borrowings set lender = 'X' where id = public.t_borrow('b1000000-0000-4000-8000-000000000001') $$,
  'FC032', null, 'borrowings cannot be changed directly');

-- ------------------------------------------------------------ repayments
select lives_ok(
  $$ select public.repay_borrowing(public.t_borrow('b1000000-0000-4000-8000-000000000001'), 'b2000000-0000-4000-8000-000000000001',
       public.t_acct('HDFC Bank'), public.t_today(), 500000, 10000) $$,
  'A repays 5,000 with 100 interest');
select results_eq(
  $$ select public.liability_owed(public.t_borrow_acct('b1000000-0000-4000-8000-000000000001')), public.t_borrow_due('b1000000-0000-4000-8000-000000000001'),
            (select count(*)::int from public.transactions as t join public.categories as c on c.id = t.category_id
              where t.liability_payment_id = public.t_lp('b2000000-0000-4000-8000-000000000001') and t.type = 'expense' and t.amount_minor = 10000
                and c.system_key = 'loan_interest'),
            (select count(*)::int from public.transactions where liability_payment_id = public.t_lp('b2000000-0000-4000-8000-000000000001') and type = 'transfer') $$,
  $$ values (1500000::bigint, 'pending'::text, 1, 1) $$,
  'principal is a transfer, interest an expense; the due date stays pending');
select throws_ok(
  $$ select public.repay_borrowing(public.t_borrow('b1000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('HDFC Bank'), public.t_today(), 1500001) $$,
  'FC037', null, 'more than is owed is refused');
select throws_ok(
  $$ select public.repay_borrowing(public.t_borrow('b1000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('HDFC Bank'), public.t_today() - 6, 100) $$,
  'FC036', null, 'a repayment before the money came is refused');
select throws_ok(
  $$ select public.repay_borrowing(public.t_borrow('b1000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('Cash in hand'), public.t_today(), 100000) $$,
  'FC035', null, 'an account that cannot cover it needs "Pay anyway"');
select lives_ok(
  $$ select public.repay_borrowing(public.t_borrow('b1000000-0000-4000-8000-000000000001'), 'b2000000-0000-4000-8000-000000000002',
       public.t_acct('HDFC Bank'), public.t_today(), 1500000) $$,
  'A repays the rest');
select results_eq(
  $$ select public.liability_owed(public.t_borrow_acct('b1000000-0000-4000-8000-000000000001')), public.t_borrow_due('b1000000-0000-4000-8000-000000000001') $$,
  $$ values (0::bigint, 'paid'::text) $$,
  'nothing is owed: the due item closes');
select lives_ok(
  $$ select public.void_liability_payment(public.t_lp('b2000000-0000-4000-8000-000000000002'), 'b2000000-0000-4000-8000-0000000000a1') $$,
  'the last repayment is voided');
select results_eq(
  $$ select public.liability_owed(public.t_borrow_acct('b1000000-0000-4000-8000-000000000001')), public.t_borrow_due('b1000000-0000-4000-8000-000000000001') $$,
  $$ values (1500000::bigint, 'pending'::text) $$,
  '... the due item is pending again');
select lives_ok(
  $$ select public.edit_liability_payment(public.t_lp('b2000000-0000-4000-8000-000000000001'), 'b2000000-0000-4000-8000-000000000003',
       public.t_acct('HDFC Bank'), public.t_today(), 2000000, 0) $$,
  'the first repayment is edited to the whole amount');
select results_eq(
  $$ select public.liability_owed(public.t_borrow_acct('b1000000-0000-4000-8000-000000000001')), public.t_borrow_due('b1000000-0000-4000-8000-000000000001'),
            (select count(*)::int from public.transactions where liability_payment_id = public.t_lp('b2000000-0000-4000-8000-000000000001') and voided_at is null) $$,
  $$ values (0::bigint, 'paid'::text, 0) $$,
  '... both its parts are voided, the new one posted; the due item closes');
select throws_ok(
  $$ select public.pay_due_item((select id from public.due_items where borrowing_id = public.t_borrow('b1000000-0000-4000-8000-000000000001')),
       gen_random_uuid(), public.t_acct('HDFC Bank'), public.t_today(), 1, 0, 0) $$,
  'FC032', null, 'a borrowing''s due item is closed by repaying, not by pay_due_item');
select throws_ok(
  $$ select public.post_liability_payment(public.t_acct('HDFC Bank'), gen_random_uuid(), public.t_acct('Cash in hand'), public.t_today(), 1) $$,
  'FC032', null, 'post_liability_payment refuses an account that is not a card or borrowing');

-- ------------------------------------------------------------ due date: change, remove, add
select throws_ok($$ select public.set_borrowing_due_date(public.t_borrow('b1000000-0000-4000-8000-000000000001'), public.t_today() - 1) $$,
  'FC041', null, 'a new due date in the past is refused');
select lives_ok($$ select public.set_borrowing_due_date(public.t_borrow('b1000000-0000-4000-8000-000000000001'), public.t_today() + 60) $$, 'the due date moves');
select is((select due_date from public.due_items where borrowing_id = public.t_borrow('b1000000-0000-4000-8000-000000000001')), public.t_today() + 60, '... to the new date');
select lives_ok($$ select public.set_borrowing_due_date(public.t_borrow('b1000000-0000-4000-8000-000000000001')) $$, 'the due date is removed');
select is((select count(*)::int from public.due_items where borrowing_id = public.t_borrow('b1000000-0000-4000-8000-000000000001')), 0, '... with its due item');
select lives_ok($$ select public.set_borrowing_due_date(public.t_borrow('b1000000-0000-4000-8000-000000000001'), public.t_today() + 10) $$, 'a due date is added again');
select is(public.t_borrow_due('b1000000-0000-4000-8000-000000000001'), 'paid', '... already paid, as nothing is owed');
select lives_ok(
  $$ select public.set_borrowing_due_date(public.t_borrow('b1000000-0000-4000-8000-000000000002'), public.t_today() + 10) $$,
  'a due date for the borrowing recorded earlier');
select lives_ok(
  $$ update public.due_items set planned_on = public.t_today() + 1, planned_account_id = public.t_acct('HDFC Bank')
     where borrowing_id = public.t_borrow('b1000000-0000-4000-8000-000000000002') $$,
  'Will pay later works on a borrowing');

-- ------------------------------------------------------------ archive and delete borrowings
select throws_ok($$ select public.set_borrowing_archived(public.t_borrow('b1000000-0000-4000-8000-000000000002'), true) $$,
  'FC045', null, 'a borrowing still owed cannot be archived');
select lives_ok($$ select public.set_borrowing_archived(public.t_borrow('b1000000-0000-4000-8000-000000000001'), true) $$, 'a repaid borrowing is archived');
select throws_ok(
  $$ select public.repay_borrowing(public.t_borrow('b1000000-0000-4000-8000-000000000001'), gen_random_uuid(), public.t_acct('HDFC Bank'), public.t_today(), 1) $$,
  'FC048', null, 'an archived borrowing cannot be repaid');
select throws_ok($$ select public.delete_borrowing(public.t_borrow('b1000000-0000-4000-8000-000000000001')) $$,
  'FC050', null, 'a borrowing with repayments cannot be deleted');
select lives_ok($$ select public.delete_borrowing(public.t_borrow('b1000000-0000-4000-8000-000000000002')) $$, 'a borrowing never repaid is deleted');
select results_eq(
  $$ select (select count(*)::int from public.accounts where kind = 'borrowing' and name = 'Asha'),
            (select count(*)::int from public.due_items where kind = 'borrowing_due' and planned_on is not null) $$,
  $$ values (0, 0) $$,
  '... with its account and due item');
select lives_ok(
  $$ select public.create_borrowing('b1000000-0000-4000-8000-000000000003', 'Meera', 300000, public.t_acct('HDFC Bank'), public.t_today()) $$,
  'A borrows 3,000 from Meera into the bank');
select set_config('t.bank_before', public.t_bal(public.t_acct('HDFC Bank'))::text, true);
select lives_ok($$ select public.delete_borrowing(public.t_borrow('b1000000-0000-4000-8000-000000000003')) $$, 'it is deleted');
select results_eq(
  $$ select public.t_bal(public.t_acct('HDFC Bank')), (select count(*)::int from public.transactions where note = 'Borrowed · Meera') $$,
  $$ select current_setting('t.bank_before')::bigint - 300000, 0 $$,
  'the money-received entry goes with it and the bank balance drops by it');

-- ------------------------------------------------------------ owed parity and Total available
select is_empty(
  $$ select a.id from public.accounts as a join public.account_balances as b on b.account_id = a.id
     where public.is_liability_kind(a.kind)
       and public.liability_owed(a.id) is distinct from -(a.opening_balance_minor + b.inflow_minor - b.outflow_minor) $$,
  'liability_owed equals minus the account_balances balance for every liability account');
select is(
  (select count(*)::int from public.accounts where kind in ('bank', 'cash', 'other')), 2,
  'cards and borrowings add no money account (Total available sums bank, cash and other only)');

-- Hand the ids to B (transaction-local settings).
select set_config('t.card', public.t_card('c1000000-0000-4000-8000-000000000001')::text, true);
select set_config('t.card_acct', public.t_card_acct('c1000000-0000-4000-8000-000000000001')::text, true);
select set_config('t.borrow', public.t_borrow('b1000000-0000-4000-8000-000000000001')::text, true);
select set_config('t.bill', public.t_bill('c3000000-0000-4000-8000-000000000002')::text, true);
select set_config('t.lp', public.t_lp('c5000000-0000-4000-8000-000000000003')::text, true);

-- ------------------------------------------------------------ as B
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
select results_eq(
  $$ select (select count(*)::int from public.credit_cards), (select count(*)::int from public.card_statements), (select count(*)::int from public.borrowings),
            (select count(*)::int from public.liability_payments), (select count(*)::int from public.card_bill_progress),
            (select count(*)::int from public.accounts), (select count(*)::int from public.due_items) $$,
  $$ values (0, 0, 0, 0, 0, 0, 0) $$,
  'B sees none of A''s cards, statements, borrowings, payments, bills or accounts');
select throws_ok($$ select public.pay_card(current_setting('t.card')::uuid, gen_random_uuid(), gen_random_uuid(), current_date, 1) $$,
  'FC008', null, 'B cannot pay A''s card');
select throws_ok($$ select public.enter_card_statement(current_setting('t.card')::uuid, gen_random_uuid(), current_date - 1, 1) $$,
  'FC008', null, 'B cannot enter a statement on it');
select throws_ok($$ select public.delete_card(current_setting('t.card')::uuid) $$, 'FC008', null, 'B cannot delete it');
select throws_ok($$ select public.set_card_archived(current_setting('t.card')::uuid, true) $$, 'FC008', null, 'B cannot archive it');
select throws_ok($$ select public.post_liability_payment(current_setting('t.card_acct')::uuid, gen_random_uuid(), gen_random_uuid(), current_date, 1) $$,
  'FC010', null, 'B cannot pay A''s card account directly');
select throws_ok($$ select public.pay_due_item(current_setting('t.bill')::uuid, gen_random_uuid(), gen_random_uuid(), current_date, 1, 0, 0) $$,
  'FC008', null, 'B cannot pay A''s bill');
select throws_ok($$ select public.repay_borrowing(current_setting('t.borrow')::uuid, gen_random_uuid(), gen_random_uuid(), current_date, 1) $$,
  'FC008', null, 'B cannot repay A''s borrowing');
select throws_ok($$ select public.set_borrowing_due_date(current_setting('t.borrow')::uuid, current_date + 1) $$,
  'FC008', null, 'B cannot change its due date');
select throws_ok($$ select public.delete_borrowing(current_setting('t.borrow')::uuid) $$, 'FC008', null, 'B cannot delete it');
select throws_ok($$ select public.void_liability_payment(current_setting('t.lp')::uuid, gen_random_uuid()) $$,
  'FC008', null, 'B cannot void A''s payment');
select is((select count(*)::int from public.due_items), 0, 'nothing B did reached A''s rows');

-- ------------------------------------------------------------ anon
set local role anon;
select throws_ok($$ select count(*) from public.credit_cards $$, '42501', null, 'anon cannot read cards');
select throws_ok($$ select count(*) from public.borrowings $$, '42501', null, 'anon cannot read borrowings');
select throws_ok($$ select count(*) from public.liability_payments $$, '42501', null, 'anon cannot read payments');

select * from finish();
rollback;
