-- pgTAP tests for expenses, transfers, edits, voids, lists and expense categories
-- (migration 20261023120000). Run with `supabase test db` (CI). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(97);

-- Users A, B and C (fictional); sign-up triggers create profiles and default categories.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bala@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'chitra@example.test');

-- Fixtures as owner. A: two banks (HDFC, Axis), cash, a USD wallet, a piggy bank, an
-- archived bank and a bank to archive later. B: one bank and one own expense category.
insert into public.accounts (id, user_id, kind, bank_type, name, last4, currency, opening_balance_minor, opening_balance_date) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'bank', 'savings', 'HDFC Bank', '4321', 'INR', 100000, current_date - 30),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'cash', null, 'Cash in hand', null, 'INR', 0, current_date - 30),
  ('a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'other', null, 'Travel wallet', null, 'USD', 0, current_date - 30),
  ('a0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'bank', 'current', 'Old Bank', null, 'INR', 0, current_date - 30),
  ('a0000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'bank', 'savings', 'Axis Bank', null, 'INR', 0, current_date - 30),
  ('a0000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'other', null, 'Piggy bank', null, 'INR', 0, current_date - 30),
  ('a0000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'bank', 'savings', 'Kotak Bank', null, 'INR', 0, current_date - 30),
  ('b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'bank', 'savings', 'SBI', null, 'INR', 0, current_date - 30);
update public.accounts set archived_at = now() where id = 'a0000000-0000-4000-8000-000000000004';
insert into public.categories (id, user_id, kind, name, icon) values
  ('c0000000-0000-4000-8000-000000000b01', '22222222-2222-4222-8222-222222222222', 'expense', 'Pets', 'other');

-- ------------------------------------------------------------ schema (1-2)
select has_index('public', 'transactions', 'transactions_user_list_idx', 'the keyset list index exists');
select hasnt_index('public', 'transactions', 'transactions_user_occurred_on_idx', 'the old date index is dropped');

-- ------------------------------------------------------------ type shapes, enforced by CHECKs alone (3-13)
-- The insert trigger is switched off here so each CHECK is shown to reject the row by itself.
alter table public.transactions disable trigger transactions_validate_insert;

select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'expense', 100, 'INR', null,
             (select id from public.categories where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'expense' and name = 'Groceries'),
             current_date - 2, gen_random_uuid()) $$,
  '23502', null, 'an entry needs an account'
);
select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, occurred_on, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'expense', 100, 'INR', 'a0000000-0000-4000-8000-000000000001', current_date - 2, gen_random_uuid()) $$,
  '23514', 'new row for relation "transactions" violates check constraint "transactions_shape"',
  'an expense needs a category'
);
select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, counter_account_id, category_id, occurred_on, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'expense', 100, 'INR', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
             (select id from public.categories where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'expense' and name = 'Groceries'),
             current_date - 2, gen_random_uuid()) $$,
  '23514', 'new row for relation "transactions" violates check constraint "transactions_shape"',
  'an expense cannot have a counter account'
);
select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, occurred_on, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'income', 100, 'INR', 'a0000000-0000-4000-8000-000000000001', current_date - 2, gen_random_uuid()) $$,
  '23514', 'new row for relation "transactions" violates check constraint "transactions_shape"',
  'income needs a category'
);
select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, counter_account_id, category_id, occurred_on, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'income', 100, 'INR', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
             (select id from public.categories where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'income' and name = 'Salary'),
             current_date - 2, gen_random_uuid()) $$,
  '23514', 'new row for relation "transactions" violates check constraint "transactions_shape"',
  'income cannot have a counter account'
);
select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, occurred_on, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'transfer', 100, 'INR', 'a0000000-0000-4000-8000-000000000001', current_date - 2, gen_random_uuid()) $$,
  '23514', 'new row for relation "transactions" violates check constraint "transactions_shape"',
  'a transfer needs a counter account'
);
select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, counter_account_id, occurred_on, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'transfer', 100, 'INR', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', current_date - 2, gen_random_uuid()) $$,
  '23514', 'new row for relation "transactions" violates check constraint "transactions_shape"',
  'a transfer cannot go to the same account'
);
select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, counter_account_id, category_id, occurred_on, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'transfer', 100, 'INR', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
             (select id from public.categories where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'expense' and name = 'Groceries'),
             current_date - 2, gen_random_uuid()) $$,
  '23514', 'new row for relation "transactions" violates check constraint "transactions_shape"',
  'a transfer cannot have a category'
);
select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, counter_account_id, occurred_on, payment_mode, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'transfer', 100, 'INR', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', current_date - 2, 'upi', gen_random_uuid()) $$,
  '23514', 'new row for relation "transactions" violates check constraint "transactions_payment_mode"',
  'a transfer cannot have a payment mode'
);
select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, category_id, occurred_on, payment_mode, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'income', 100, 'INR', 'a0000000-0000-4000-8000-000000000001',
             (select id from public.categories where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'income' and name = 'Salary'),
             current_date - 2, 'upi', gen_random_uuid()) $$,
  '23514', 'new row for relation "transactions" violates check constraint "transactions_payment_mode"',
  'income cannot have a payment mode'
);
select throws_ok(
  $$ insert into public.transactions (user_id, type, amount_minor, currency, account_id, category_id, occurred_on, void_idempotency_key, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'expense', 100, 'INR', 'a0000000-0000-4000-8000-000000000001',
             (select id from public.categories where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'expense' and name = 'Groceries'),
             current_date - 2, gen_random_uuid(), gen_random_uuid()) $$,
  '23514', 'new row for relation "transactions" violates check constraint "transactions_void_key_with_void"',
  'a void key needs a void'
);

alter table public.transactions enable trigger transactions_validate_insert;

-- C loses its expense categories (as if sign-up had not created them), for the lazy fallback.
delete from public.categories where user_id = '33333333-3333-4333-8333-333333333333' and kind = 'expense';

select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

-- ------------------------------------------------------------ expense categories (14-20)
select is(
  (select count(*)::int from public.categories where kind = 'expense' and is_default and icon is not null),
  12, 'sign-up creates 12 default expense categories with icons'
);
select is(public.ensure_my_expense_categories(), 0, 'the lazy fallback does nothing when defaults exist');
select lives_ok(
  $$ insert into public.categories (kind, name, icon) values ('expense', 'Pets', 'other') $$,
  'a person can add an expense category with an icon'
);
select lives_ok(
  $$ update public.categories set name = 'Pets & vet', icon = 'health' where kind = 'expense' and name = 'Pets' $$,
  'a person can rename an expense category and change its icon'
);
select throws_ok(
  $$ insert into public.categories (kind, name, icon) values ('expense', 'Gadgets', 'rocket') $$,
  '23514', null, 'an icon outside the fixed set is rejected'
);
select throws_ok(
  $$ insert into public.categories (kind, name, source_type, icon) values ('income', 'Gifts', 'other', 'food') $$,
  '23514', null, 'an income source cannot have an icon'
);
select throws_ok(
  $$ insert into public.categories (kind, name, icon) values ('expense', ' groceries ', 'groceries') $$,
  '23505', null, 'two active expense categories cannot share a name'
);

-- ------------------------------------------------------------ privileges (21-24)
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key, void_idempotency_key)
     values ('expense', 100, 'INR', 'a0000000-0000-4000-8000-000000000001',
             (select id from public.categories where kind = 'expense' and name = 'Groceries'),
             current_date - 2, gen_random_uuid(), gen_random_uuid()) $$,
  '42501', null, 'a client cannot set a void key on insert'
);
select throws_ok(
  $$ select public.backfill_default_expense_categories() $$,
  '42501', null, 'a client cannot run the backfill'
);
select throws_ok(
  $$ select public.ensure_default_expense_categories('22222222-2222-4222-8222-222222222222') $$,
  '42501', null, 'a client cannot create defaults for another user'
);
set local role anon;
select throws_ok(
  $$ select public.record_transaction('expense', gen_random_uuid(), 100, current_date - 2, 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot record entries'
);
set local role authenticated;

-- ------------------------------------------------------------ record_transaction (25-37)
select lives_ok(
  $$ select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000001', 50000, current_date - 2,
       'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'),
       p_note => 'Monthly groceries', p_payment_mode => 'upi') $$,
  'an expense from a bank account with a payment mode is recorded'
);
select is(
  (select id from public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000001', 50000, current_date - 2,
     'a0000000-0000-4000-8000-000000000001',
     p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'),
     p_note => ' Monthly groceries ', p_payment_mode => 'upi')),
  (select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000001'),
  'a retry with the same key returns the saved entry'
);
select throws_ok(
  $$ select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000001', 51000, current_date - 2,
       'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'),
       p_note => 'Monthly groceries', p_payment_mode => 'upi') $$,
  'FC007', null, 'a key reused for a different entry is rejected'
);
select throws_ok(
  $$ select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000002', 100, current_date - 2,
       'a0000000-0000-4000-8000-000000000002',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'), p_payment_mode => 'upi') $$,
  'FC016', null, 'a payment mode needs a bank account'
);
select throws_ok(
  $$ select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000003', 100, current_date - 2,
       'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'income' and name = 'Salary')) $$,
  'FC006', null, 'an expense cannot use an income source'
);
select throws_ok(
  $$ select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000004', 100, current_date - 2,
       'a0000000-0000-4000-8000-000000000004',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries')) $$,
  'FC001', null, 'an expense cannot come from an archived account'
);
select throws_ok(
  $$ select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000005', 100,
       public.user_local_today('11111111-1111-4111-8111-111111111111') + 1,
       'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries')) $$,
  'FC003', null, 'an expense cannot be dated in the future'
);
select throws_ok(
  $$ select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000006', 100, current_date - 2,
       'b0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries')) $$,
  'FC010', null, 'another user''s account is not found'
);
select throws_ok(
  $$ select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000006', 100, current_date - 2,
       'a0000000-0000-4000-8000-000000000001', p_category_id => 'c0000000-0000-4000-8000-000000000b01') $$,
  '23503', null, 'another user''s category is rejected'
);
select throws_ok(
  $$ select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000008', 100, current_date - 2,
       'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'), p_payment_mode => 'cash') $$,
  '23514', null, 'an unknown payment mode is rejected'
);
select lives_ok(
  $$ select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000007', 5000000, current_date - 2,
       'a0000000-0000-4000-8000-000000000002',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Shopping')) $$,
  'an expense may take cash below zero'
);
select ok(
  (select inflow_minor - outflow_minor < 0 from public.account_balances where account_id = 'a0000000-0000-4000-8000-000000000002'),
  'the cash balance is now negative'
);
select lives_ok(
  $$ select public.record_income('a0000000-0000-4000-8000-000000000001',
       (select id from public.categories where kind = 'income' and name = 'Salary'), 100000, current_date - 2,
       'e0000000-0000-4000-8000-000000000009') $$,
  'record_income still records income'
);

-- ------------------------------------------------------------ void (38-44)
select lives_ok(
  $$ select public.void_income((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000009')) $$,
  'void_income still voids income'
);
select ok(
  (select void_idempotency_key is not null from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000009'),
  'void_income records a void key'
);
select lives_ok(
  $$ select public.void_income((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000009')) $$,
  'void_income on a voided entry returns it'
);
select is(
  (select void_reason from public.void_transaction(
     (select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000001'),
     'f0000000-0000-4000-8000-000000000001', '  duplicate  ')),
  'duplicate', 'void_transaction voids with a trimmed reason'
);
select is(
  (select void_idempotency_key from public.void_transaction(
     (select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000001'),
     'f0000000-0000-4000-8000-000000000001')),
  'f0000000-0000-4000-8000-000000000001'::uuid, 'a retried void returns the voided entry'
);
select throws_ok(
  $$ select public.void_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000001'),
       'f0000000-0000-4000-8000-000000000002') $$,
  'FC005', null, 'voiding under another key is rejected'
);
select throws_ok(
  $$ update public.transactions set voided_at = now() where idempotency_key = 'e0000000-0000-4000-8000-000000000007' $$,
  '23514', null, 'a direct void without a key is rejected'
);

-- ------------------------------------------------------------ edit_transaction (45-61)
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000010', 5000, current_date - 5,
  'a0000000-0000-4000-8000-000000000001',
  p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'),
  p_note => 'veg', p_payment_mode => 'upi');
select lives_ok(
  $$ select public.edit_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000010'),
       'e0000000-0000-4000-8000-000000000011', 6000, current_date - 5, 'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'),
       p_note => 'veg', p_payment_mode => 'upi') $$,
  'an expense can be edited'
);
select is(
  (select replaces_id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000011'),
  (select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000010'),
  'the new version points at the old one'
);
select ok(
  (select voided_at is not null and void_reason is null and void_idempotency_key = 'e0000000-0000-4000-8000-000000000011'
   from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000010'),
  'the old version is voided under the edit''s key, without a reason'
);
select is(
  (select id from public.edit_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000010'),
     'e0000000-0000-4000-8000-000000000011', 6000, current_date - 5, 'a0000000-0000-4000-8000-000000000001',
     p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'),
     p_note => 'veg', p_payment_mode => 'upi')),
  (select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000011'),
  'a retried edit returns the saved version'
);
select throws_ok(
  $$ select public.edit_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000010'),
       'e0000000-0000-4000-8000-000000000011', 7000, current_date - 5, 'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'),
       p_note => 'veg', p_payment_mode => 'upi') $$,
  'FC007', null, 'an edit key reused for different details is rejected'
);
select throws_ok(
  $$ select public.edit_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000010'),
       'e0000000-0000-4000-8000-000000000012', 7000, current_date - 5, 'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'),
       p_note => 'veg', p_payment_mode => 'upi') $$,
  'FC014', null, 'editing a replaced version is stale'
);
select throws_ok(
  $$ select public.edit_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000011'),
       'e0000000-0000-4000-8000-000000000013', 6000, current_date - 5, 'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'),
       p_note => ' veg ', p_payment_mode => 'upi') $$,
  'FC017', null, 'an edit that changes nothing is rejected'
);
select throws_ok(
  $$ select public.void_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000010'),
       'f0000000-0000-4000-8000-000000000003') $$,
  'FC014', null, 'voiding a replaced version is stale'
);
-- A plainly voided entry.
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000014', 1000, current_date - 4,
  'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'));
select public.void_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000014'),
  'f0000000-0000-4000-8000-000000000004');
select throws_ok(
  $$ select public.edit_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000014'),
       'e0000000-0000-4000-8000-000000000016', 2000, current_date - 4, 'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries')) $$,
  'FC005', null, 'editing a voided (not replaced) entry is FC005'
);
-- An entry on an account archived afterwards can still be corrected, but not moved to another archived one.
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000017', 1500, current_date - 4,
  'a0000000-0000-4000-8000-000000000007', p_category_id => (select id from public.categories where kind = 'expense' and name = 'Shopping'));
update public.accounts set archived_at = now() where id = 'a0000000-0000-4000-8000-000000000007';
select lives_ok(
  $$ select public.edit_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000017'),
       'e0000000-0000-4000-8000-000000000018', 1600, current_date - 4, 'a0000000-0000-4000-8000-000000000007',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Shopping')) $$,
  'an edit may keep the archived account it already used'
);
select throws_ok(
  $$ select public.edit_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000018'),
       'e0000000-0000-4000-8000-000000000019', 1600, current_date - 4, 'a0000000-0000-4000-8000-000000000004',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Shopping')) $$,
  'FC001', null, 'an edit cannot move an entry to an archived account'
);
-- The same for an archived category.
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000020', 800, current_date - 4,
  'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where kind = 'expense' and name = 'Personal care'));
update public.categories set archived_at = now() where kind = 'expense' and name = 'Personal care';
select lives_ok(
  $$ select public.edit_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000020'),
       'e0000000-0000-4000-8000-000000000021', 900, current_date - 4, 'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Personal care')) $$,
  'an edit may keep the archived category it already used'
);
select throws_ok(
  $$ select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000022', 900, current_date - 4,
       'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where kind = 'expense' and name = 'Personal care')) $$,
  'FC006', null, 'a new entry cannot use an archived category'
);
-- Direct inserts of a new version are refused unless edit_transaction made them.
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key, replaces_id)
     values ('income', 100, 'INR', 'a0000000-0000-4000-8000-000000000001',
             (select id from public.categories where kind = 'income' and name = 'Salary'), current_date - 4, gen_random_uuid(),
             (select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000021')) $$,
  'FC009', null, 'an edit cannot change the entry type'
);
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key, replaces_id)
     values ('expense', 100, 'INR', 'a0000000-0000-4000-8000-000000000001',
             (select id from public.categories where kind = 'expense' and name = 'Groceries'), current_date - 4, gen_random_uuid(),
             (select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000021')) $$,
  'FC014', null, 'a direct new version of an entry that is not voided is rejected'
);
select throws_ok(
  $$ update public.transactions set void_reason = 'late'
     where idempotency_key = 'e0000000-0000-4000-8000-000000000010' $$,
  'FC005', null, 'a voided version cannot change'
);
select throws_ok(
  $$ select public.edit_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000021'),
       'e0000000-0000-4000-8000-000000000023', 900, public.user_local_today('11111111-1111-4111-8111-111111111111') + 1,
       'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'expense' and name = 'Personal care')) $$,
  'FC003', null, 'an edit cannot move an entry into the future'
);

-- ------------------------------------------------------------ transfers (62-70)
select lives_ok(
  $$ select public.record_transaction('transfer', 'e0000000-0000-4000-8000-000000000030', 30000, current_date - 3,
       'a0000000-0000-4000-8000-000000000005', p_counter_account_id => 'a0000000-0000-4000-8000-000000000006') $$,
  'a transfer between two accounts is recorded'
);
select is(
  array[(select outflow_minor from public.account_balances where account_id = 'a0000000-0000-4000-8000-000000000005'),
        (select inflow_minor from public.account_balances where account_id = 'a0000000-0000-4000-8000-000000000006')],
  array[30000, 30000]::bigint[], 'a transfer moves money out of one account and into the other'
);
select lives_ok(
  $$ select public.edit_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000030'),
       'e0000000-0000-4000-8000-000000000031', 40000, current_date - 3,
       'a0000000-0000-4000-8000-000000000005', p_counter_account_id => 'a0000000-0000-4000-8000-000000000006') $$,
  'a transfer can be edited'
);
select is(
  array[(select outflow_minor from public.account_balances where account_id = 'a0000000-0000-4000-8000-000000000005'),
        (select inflow_minor from public.account_balances where account_id = 'a0000000-0000-4000-8000-000000000006')],
  array[40000, 40000]::bigint[], 'only the edited version counts on both sides'
);
select lives_ok(
  $$ select public.void_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000031'),
       'f0000000-0000-4000-8000-000000000031') $$,
  'a transfer can be voided'
);
select is(
  array[(select outflow_minor from public.account_balances where account_id = 'a0000000-0000-4000-8000-000000000005'),
        (select inflow_minor from public.account_balances where account_id = 'a0000000-0000-4000-8000-000000000006')],
  array[0, 0]::bigint[], 'voiding a transfer restores both accounts'
);
select throws_ok(
  $$ select public.record_transaction('transfer', 'e0000000-0000-4000-8000-000000000033', 100, current_date - 3,
       'a0000000-0000-4000-8000-000000000001', p_counter_account_id => 'a0000000-0000-4000-8000-000000000003') $$,
  'FC015', null, 'a transfer between currencies is rejected'
);
select throws_ok(
  $$ select public.record_transaction('transfer', 'e0000000-0000-4000-8000-000000000034', 100, current_date - 3,
       'a0000000-0000-4000-8000-000000000001', p_counter_account_id => 'a0000000-0000-4000-8000-000000000004') $$,
  'FC001', null, 'a transfer into an archived account is rejected'
);
select throws_ok(
  $$ select public.record_transaction('transfer', 'e0000000-0000-4000-8000-000000000035', 100, current_date - 3,
       'a0000000-0000-4000-8000-000000000001', p_counter_account_id => 'b0000000-0000-4000-8000-000000000001') $$,
  'FC010', null, 'a transfer to another user''s account is rejected'
);

-- ------------------------------------------------------------ list, search, totals (71-90)
-- A's entries from 25 to 21 days ago (nothing else is in this range):
--   e1 expense 100.00 HDFC, Groceries, "Big Bazaar 50% off"      (25 days ago)
--   e5 expense   3.00 USD wallet, Shopping                         (25 days ago)
--   e2 expense  25.00 cash, Transport, "auto_rickshaw"             (24 days ago)
--   i1 income 5000.00 HDFC, Salary                                (23 days ago)
--   t1 transfer 200.00 HDFC -> cash                               (22 days ago)
--   e3 expense  75.00 HDFC, Food & dining, "dinner (team), paid"   (21 days ago, voided)
--   e4 expense 100.00 HDFC, Food & dining, edited to 120.00        (21 days ago)
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000051', 10000, current_date - 25,
  'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where kind = 'expense' and name = 'Groceries'),
  p_note => 'Big Bazaar 50% off');
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000055', 300, current_date - 25,
  'a0000000-0000-4000-8000-000000000003', p_category_id => (select id from public.categories where kind = 'expense' and name = 'Shopping'));
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000052', 2500, current_date - 24,
  'a0000000-0000-4000-8000-000000000002', p_category_id => (select id from public.categories where kind = 'expense' and name = 'Transport'),
  p_note => 'auto_rickshaw');
select public.record_transaction('income', 'e0000000-0000-4000-8000-000000000053', 500000, current_date - 23,
  'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where kind = 'income' and name = 'Salary'));
select public.record_transaction('transfer', 'e0000000-0000-4000-8000-000000000054', 20000, current_date - 22,
  'a0000000-0000-4000-8000-000000000001', p_counter_account_id => 'a0000000-0000-4000-8000-000000000002');
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000056', 7500, current_date - 21,
  'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where kind = 'expense' and name = 'Food & dining'),
  p_note => 'dinner (team), paid');
select public.void_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000056'),
  'f0000000-0000-4000-8000-000000000056');
select public.record_transaction('expense', 'e0000000-0000-4000-8000-000000000057', 10000, current_date - 21,
  'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where kind = 'expense' and name = 'Food & dining'));
select public.edit_transaction((select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000057'),
  'e0000000-0000-4000-8000-000000000058', 12000, current_date - 21, 'a0000000-0000-4000-8000-000000000001',
  p_category_id => (select id from public.categories where kind = 'expense' and name = 'Food & dining'));

select is((select count(*)::int from public.list_transactions(current_date - 25, current_date - 21)), 6,
  'the list has the current, unvoided entries');
select is((select count(*)::int from public.list_transactions(current_date - 25, current_date - 21, p_include_voided => true)), 7,
  'voided entries are listed when asked for');
select ok(
  (select id from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000057')
    not in (select id from public.list_transactions(current_date - 25, current_date - 21, p_include_voided => true)),
  'a replaced version is never listed'
);
select is((select count(*)::int from public.list_transactions(current_date - 25, current_date - 21, p_type => 'expense')), 4,
  'the type tab filters');
select is(
  array[(select occurred_on from public.list_transactions(current_date - 25, current_date - 21) limit 1),
        (select min(occurred_on) from public.list_transactions(current_date - 25, current_date - 21))],
  array[current_date - 21, current_date - 25], 'newest first'
);
select is(
  (with p1 as (select * from public.list_transactions(current_date - 25, current_date - 21, p_limit => 2)),
        c as (select * from p1 order by occurred_on, created_at, id limit 1)
   select count(*)::int
   from c, lateral public.list_transactions(current_date - 25, current_date - 21,
     p_after_occurred_on => c.occurred_on, p_after_created_at => c.created_at, p_after_id => c.id, p_limit => 2) as p2
   where p2.id not in (select id from p1)),
  2, 'the next page continues after the cursor without repeating'
);
select is(
  (with c as (select * from public.list_transactions(current_date - 25, current_date - 21) order by occurred_on, created_at, id limit 1)
   select count(*)::int
   from c, lateral public.list_transactions(current_date - 25, current_date - 21,
     p_after_occurred_on => c.occurred_on, p_after_created_at => c.created_at, p_after_id => c.id) as p),
  0, 'nothing comes after the last row'
);
select is((select count(*)::int from public.list_transactions(current_date - 25, current_date - 21, p_limit => 0)), 1,
  'the page size is clamped to at least 1');
select is((select count(*)::int from public.list_transactions(current_date - 25, current_date - 21, p_query => '%')), 1,
  '% is literal text, not a wildcard');
select is((select count(*)::int from public.list_transactions(current_date - 25, current_date - 21, p_query => '_')), 1,
  '_ is literal text, not a wildcard');
select is((select count(*)::int from public.list_transactions(current_date - 25, current_date - 21,
  p_query => '(team),', p_include_voided => true)), 1, 'commas and parentheses are literal text');
select is((select count(*)::int from public.list_transactions(current_date - 25, current_date - 21, p_query => '  BIG bazaar ')), 1,
  'search ignores case and surrounding spaces');
select is((select count(*)::int from public.list_transactions(current_date - 25, current_date - 21, p_query => 'groceries')), 1,
  'search matches category names');
select is((select count(*)::int from public.list_transactions(current_date - 25, current_date - 21, p_query => 'cash in hand')), 2,
  'search matches either account of a transfer');
select is((select count(*)::int from public.list_transactions(current_date - 25, current_date - 21,
  p_query => '100', p_amount_minor => 10000)), 1, 'search matches an exact amount (never a replaced version)');
select is((select count(*)::int from public.list_transactions(current_date - 25, current_date - 21,
  p_account_id => 'a0000000-0000-4000-8000-000000000002')), 2, 'the account filter includes transfers into it');
select results_eq(
  $$ select currency, income_minor, expense_minor, income_count, expense_count, transfer_count
     from public.transaction_summary(current_date - 25, current_date - 21) $$,
  $$ values ('INR'::text, 500000::bigint, 24500::bigint, 1, 3, 1), ('USD', 0, 300, 0, 1, 0) $$,
  'totals per currency skip voided and replaced entries and never add transfers'
);
select results_eq(
  $$ select currency, income_minor, expense_minor, income_count, expense_count, transfer_count
     from public.transaction_summary(current_date - 25, current_date - 21, p_query => 'hdfc') $$,
  $$ values ('INR'::text, 500000::bigint, 22000::bigint, 1, 2, 1) $$,
  'totals follow the search'
);
select throws_ok(
  $$ select * from public.list_transactions(current_date - 1, current_date - 2) $$,
  '22023', null, 'a reversed date range is rejected'
);
select throws_ok(
  $$ select * from public.list_transactions(current_date - 2, current_date - 1,
       p_after_id => 'a0000000-0000-4000-8000-000000000001') $$,
  '22023', null, 'a partial page cursor is rejected'
);

-- ------------------------------------------------------------ other users (91-97)
-- Remember one of A's entries while still signed in as A.
select set_config('test.a_entry',
  (select id::text from public.transactions where idempotency_key = 'e0000000-0000-4000-8000-000000000058'), true);
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);

select is((select count(*)::int from public.list_transactions(current_date - 30, current_date)), 0,
  'B sees none of A''s entries');
select is((select count(*)::int from public.transaction_summary(current_date - 30, current_date)), 0,
  'B''s totals include none of A''s entries');
select throws_ok(
  $$ select public.edit_transaction(current_setting('test.a_entry')::uuid, gen_random_uuid(), 1, current_date - 21,
       'b0000000-0000-4000-8000-000000000001', p_category_id => 'c0000000-0000-4000-8000-000000000b01') $$,
  'FC008', null, 'B cannot edit A''s entry'
);
select throws_ok(
  $$ select public.void_transaction(current_setting('test.a_entry')::uuid, gen_random_uuid()) $$,
  'FC008', null, 'B cannot void A''s entry'
);
select throws_ok(
  $$ select public.record_transaction('expense', gen_random_uuid(), 100, current_date - 2,
       'a0000000-0000-4000-8000-000000000001', p_category_id => 'c0000000-0000-4000-8000-000000000b01') $$,
  'FC010', null, 'B cannot record on A''s account'
);
-- Defaults a person archived are never re-created; a person with none gets them lazily.
update public.categories set archived_at = now() where kind = 'expense';
select is(public.ensure_my_expense_categories(), 0, 'archived defaults are not re-created');
select set_config('request.jwt.claims', '{"sub": "33333333-3333-4333-8333-333333333333", "role": "authenticated"}', true);
select is(public.ensure_my_expense_categories(), 12, 'the lazy fallback creates the 12 defaults');

select * from finish();
rollback;
