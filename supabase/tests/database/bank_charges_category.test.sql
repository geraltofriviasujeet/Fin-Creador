-- pgTAP tests for the "Bank charges & interest" system category (migration 20261029180000):
-- the key, sign-up and the lazy fallback, the backfill for users from before the migration
-- (create, adopt an active or an archived same-name category), re-runs with no duplicates,
-- loan_category_id unchanged, privileges, the archive guard and RLS. Users are fictional.
-- Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

insert into auth.users (id, email) values
  ('1b000000-0000-4000-8000-000000000001', 'bc-asha@example.test'),
  ('1b000000-0000-4000-8000-000000000002', 'bc-bala@example.test'),
  ('1b000000-0000-4000-8000-000000000003', 'bc-chitra@example.test'),
  ('1b000000-0000-4000-8000-000000000004', 'bc-devi@example.test'),
  ('1b000000-0000-4000-8000-000000000005', 'bc-eshan@example.test'),
  ('1b000000-0000-4000-8000-000000000006', 'bc-farah@example.test');

create function pg_temp.bank(p_user uuid) returns uuid language sql stable
  as $$ select c.id from public.categories as c where c.user_id = p_user and c.system_key = 'bank_charges' $$;
create function pg_temp.named(p_user uuid) returns integer language sql stable
  as $$ select count(*)::int from public.categories as c
        where c.user_id = p_user and c.kind = 'expense' and lower(btrim(c.name)) = 'bank charges & interest' $$;

-- ------------------------------------------------------------ the key and sign-up (1-6)
select ok(
  (select pg_get_constraintdef(oid) like '%bank_charges%' from pg_constraint where conname = 'categories_system_key'),
  'categories_system_key allows bank_charges'
);
select throws_ok(
  $$ insert into public.categories (user_id, kind, name, system_key)
     values ('1b000000-0000-4000-8000-000000000001', 'expense', 'Odd', 'bank_fees') $$,
  '23514', null, 'an unknown system key is refused'
);
select results_eq(
  $$ select name, icon, is_default, archived_at is null, kind from public.categories
     where user_id = '1b000000-0000-4000-8000-000000000001' and system_key = 'bank_charges' $$,
  $$ values ('Bank charges & interest'::text, 'bills'::text, true, true, 'expense'::text) $$,
  'sign-up creates Bank charges & interest (bills icon, default, active)'
);
select is(
  (select count(*)::int from public.categories where user_id = '1b000000-0000-4000-8000-000000000001' and kind = 'expense'),
  15, 'a new user has 15 expense defaults'
);
select is(public.ensure_default_expense_categories('1b000000-0000-4000-8000-000000000001'), 0, 'the defaults again create nothing');
select is(pg_temp.named('1b000000-0000-4000-8000-000000000001'), 1, 'and no second one');

-- ------------------------------------------------------------ users from before the migration (7-18)
-- B: no bank_charges category. C: an active one of their own with that name (any case, spaces),
-- with an entry on it. D: only an archived one. E: an active one and an archived one.
-- F: no expense categories at all.
delete from public.categories where system_key = 'bank_charges' and user_id in (
  '1b000000-0000-4000-8000-000000000002', '1b000000-0000-4000-8000-000000000003', '1b000000-0000-4000-8000-000000000004',
  '1b000000-0000-4000-8000-000000000005');
delete from public.categories where kind = 'expense' and user_id = '1b000000-0000-4000-8000-000000000006';
insert into public.categories (id, user_id, kind, name, icon) values
  ('1c000000-0000-4000-8000-000000000003', '1b000000-0000-4000-8000-000000000003', 'expense', ' bank CHARGES & interest ', 'other'),
  ('1c000000-0000-4000-8000-000000000004', '1b000000-0000-4000-8000-000000000004', 'expense', 'Bank charges & interest', 'other'),
  ('1c000000-0000-4000-8000-000000000051', '1b000000-0000-4000-8000-000000000005', 'expense', 'Bank charges & interest', 'other');
-- (The categories trigger clears archived_at on insert, so archive with an update.)
update public.categories set archived_at = now() where id in ('1c000000-0000-4000-8000-000000000004', '1c000000-0000-4000-8000-000000000051');
insert into public.categories (id, user_id, kind, name, icon) values
  ('1c000000-0000-4000-8000-000000000052', '1b000000-0000-4000-8000-000000000005', 'expense', 'Bank Charges & Interest', 'bills');
insert into public.accounts (id, user_id, kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('1a000000-0000-4000-8000-000000000003', '1b000000-0000-4000-8000-000000000003', 'bank', 'savings', 'Example Bank', 'INR', 100000, current_date - 30);
select set_config('request.jwt.claims', '{"sub": "1b000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select public.record_transaction('expense', gen_random_uuid(), 59000, current_date - 3,
  '1a000000-0000-4000-8000-000000000003', p_category_id => '1c000000-0000-4000-8000-000000000003');
reset role;

select is(public.backfill_default_expense_categories(), 1 + 15,
  'the backfill creates one for B and the 15 defaults for F; C, D and E adopt theirs');
select isnt(pg_temp.bank('1b000000-0000-4000-8000-000000000002'), null, 'B gets the category');
select is(pg_temp.bank('1b000000-0000-4000-8000-000000000003'), '1c000000-0000-4000-8000-000000000003'::uuid, 'C''s own category takes the key');
select results_eq(
  $$ select name, icon, archived_at is null from public.categories where id = '1c000000-0000-4000-8000-000000000003' $$,
  $$ values (' bank CHARGES & interest '::text, 'other'::text, true) $$,
  'and keeps its name and icon'
);
select is(
  (select category_id from public.transactions where user_id = '1b000000-0000-4000-8000-000000000003'),
  '1c000000-0000-4000-8000-000000000003'::uuid, 'C''s entry stays on it'
);
select is(pg_temp.named('1b000000-0000-4000-8000-000000000003'), 1, 'C has no duplicate');
select is(pg_temp.bank('1b000000-0000-4000-8000-000000000004'), '1c000000-0000-4000-8000-000000000004'::uuid, 'D''s archived category takes the key');
select ok((select archived_at is null from public.categories where id = '1c000000-0000-4000-8000-000000000004'), 'and is restored');
select is(pg_temp.named('1b000000-0000-4000-8000-000000000004'), 1, 'D has no duplicate');
select is(pg_temp.bank('1b000000-0000-4000-8000-000000000005'), '1c000000-0000-4000-8000-000000000052'::uuid, 'E''s active one is adopted, not the archived one');
select ok(
  (select archived_at is not null and system_key is null from public.categories where id = '1c000000-0000-4000-8000-000000000051'),
  'E''s archived one stays archived, without the key'
);
select is(
  (select count(*)::int from public.categories where user_id = '1b000000-0000-4000-8000-000000000006' and kind = 'expense'),
  15, 'F gets all 15 defaults'
);

-- ------------------------------------------------------------ re-runs (19-21)
select is(public.backfill_default_expense_categories(), 0, 'running the backfill again creates nothing');
select is(
  (select count(*)::int from (
     select user_id from public.categories where system_key = 'bank_charges' group by user_id having count(*) <> 1) as d),
  0, 'one bank_charges category per user'
);
select is(
  (select count(*)::int from public.categories where system_key = 'bank_charges'
     and user_id::text like '1b000000-%'),
  6, 'every test user has it'
);

-- ------------------------------------------------------------ functions and privileges (22-25)
select ok(not has_function_privilege('authenticated', 'public.system_category_id(uuid, text)', 'execute'),
  'signed-in users cannot call system_category_id');
select ok(not has_function_privilege('anon', 'public.system_category_id(uuid, text)', 'execute'),
  'anon cannot call system_category_id');
select set_config('request.jwt.claims', '{"sub": "1b000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(public.loan_category_id('bank_charges'), pg_temp.bank('1b000000-0000-4000-8000-000000000001'),
  'loan_category_id returns the caller''s category for the key');
-- (Called first: a query does not see a row its own function call inserts.)
select public.loan_category_id('loan_fees');
select is(
  (select name from public.categories where system_key = 'loan_fees'),
  'Loan fees & charges', 'loan_category_id still creates the loan categories'
);

-- ------------------------------------------------------------ guard and RLS (26-31)
select throws_ok(
  $$ update public.categories set archived_at = now() where system_key = 'bank_charges' $$,
  'FC042', 'This category is used by the app and can''t be archived', 'the category cannot be archived (generic message)'
);
select lives_ok(
  $$ update public.categories set name = 'Card & bank charges' where system_key = 'bank_charges' $$,
  'it can be renamed'
);
select is(public.ensure_my_expense_categories(), 0, 'after a rename, the lazy fallback creates nothing');
select is(
  (select count(*)::int from public.categories where system_key = 'bank_charges'),
  1, 'a user sees only their own'
);
reset role;
select throws_ok(
  $$ update public.categories set system_key = null where system_key = 'bank_charges' and user_id = '1b000000-0000-4000-8000-000000000002' $$,
  'FC009', 'A category''s identity can''t change', 'even the owner cannot take the key off a system category'
);
select throws_ok(
  $$ select public.system_category_id(null, 'bank_charges') $$,
  '42501', null, 'system_category_id needs a user'
);

select * from finish();
rollback;
