-- pgTAP tests for recurring rules, skips, confirming occurrences and the keyed default
-- categories (migration 20261024120000). Occurrence-date parity with packages/domain is in
-- recurrence_parity.test.sql. Run with `supabase test db` (CI). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(85);

-- Users A, B (fictional; sign-up gives them 14 expense defaults), and D, E who stand in for
-- users created before this migration.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bala@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'devi@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'eshan@example.test');

-- The first day of the month k months from this one (occurrences of the monthly rules below).
create function public.t_month(k integer) returns date language sql stable
  as $$ select (date_trunc('month', current_date::timestamp) + make_interval(months => k))::date $$;
grant execute on function public.t_month(integer) to authenticated;

insert into public.accounts (id, user_id, kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'bank', 'savings', 'HDFC Bank', 'INR', 100000, current_date - 200),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'cash', null, 'Cash in hand', 'INR', 0, current_date - 200),
  ('a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'bank', 'savings', 'Axis Bank', 'INR', 0, current_date - 200),
  ('a0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'other', null, 'Travel wallet', 'USD', 0, current_date - 200),
  ('b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'bank', 'savings', 'SBI', 'INR', 0, current_date - 200);
insert into public.categories (id, user_id, kind, name, icon) values
  ('c0000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'expense', 'Gym', 'health');

-- D and E as before the migration: no keyed categories. D once had a "Subscription"
-- category of their own, now archived.
delete from public.categories where user_id in ('44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555') and key is not null;
insert into public.categories (user_id, kind, name, icon) values
  ('44444444-4444-4444-8444-444444444444', 'expense', ' subscription ', 'other');
-- (The categories trigger clears archived_at on insert, so archive it with an update.)
update public.categories set archived_at = now()
where user_id = '44444444-4444-4444-8444-444444444444' and name = ' subscription ';

-- ------------------------------------------------------------ backfill (1-6), as owner
select is(public.backfill_default_expense_categories(), 3, 'the backfill creates the keyed defaults that are missing (D: 1, E: 2)');
select ok(
  (select key = 'subscription' and archived_at is not null from public.categories
   where user_id = '44444444-4444-4444-8444-444444444444' and lower(btrim(name)) = 'subscription'),
  'a matching archived category takes the key and stays archived'
);
select is(
  (select count(*)::int from public.categories where user_id = '44444444-4444-4444-8444-444444444444' and lower(btrim(name)) = 'subscription'),
  1, 'and no second "Subscription" is created'
);
select is(
  (select array_agg(key order by key) from public.categories where user_id = '55555555-5555-4555-8555-555555555555' and key is not null),
  array['membership', 'subscription'], 'a user without them gets both keyed defaults'
);
select is(public.backfill_default_expense_categories(), 0, 'running the backfill again creates nothing');
select is(
  (select count(*)::int from public.categories where user_id = '55555555-5555-4555-8555-555555555555' and kind = 'expense'),
  14, 'and leaves E with its 12 classic and 2 keyed defaults'
);

select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

-- ------------------------------------------------------------ categories (7-11)
select is(
  (select count(*)::int from public.categories where kind = 'expense' and is_default and icon is not null),
  14, 'sign-up creates 14 default expense categories with icons'
);
select results_eq(
  $$ select key, name, icon from public.categories where key is not null order by key $$,
  $$ values ('membership'::text, 'Membership'::text, 'membership'::text), ('subscription', 'Subscription', 'subscription') $$,
  'two of them carry the stable keys'
);
select throws_ok(
  $$ insert into public.categories (kind, name, icon, key) values ('expense', 'Clubs', 'membership', 'membership') $$,
  '42501', null, 'a client cannot set a category key'
);
select throws_ok(
  $$ update public.categories set key = null where key = 'subscription' $$,
  '42501', null, 'a client cannot change a category key'
);
select lives_ok(
  $$ update public.categories set name = 'Apps & streaming' where key = 'subscription' $$,
  'a keyed category can be renamed (the key stays)'
);

-- ------------------------------------------------------------ rules (12-23)
-- R1: monthly expense on the 1st, from three months ago (Subscription, HDFC).
select lives_ok(
  $$ select public.create_recurring_rule('f1000000-0000-4000-8000-000000000001', 'expense', 64900, 'monthly', public.t_month(-3),
       'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where key = 'subscription'),
       p_payment_mode => 'upi', p_note => 'Streaming') $$,
  'a recurring expense is created'
);
select is(
  (select id from public.create_recurring_rule('f1000000-0000-4000-8000-000000000001', 'expense', 64900, 'monthly', public.t_month(-3),
     'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where key = 'subscription'),
     p_payment_mode => 'upi', p_note => ' Streaming ')),
  (select id from public.recurring_rules where idempotency_key = 'f1000000-0000-4000-8000-000000000001'),
  'replaying the request key returns the same rule'
);
select throws_ok(
  $$ select public.create_recurring_rule('f1000000-0000-4000-8000-000000000001', 'expense', 99900, 'monthly', public.t_month(-3),
       'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where key = 'subscription')) $$,
  'FC007', null, 'the same key with different details is refused'
);
select throws_ok(
  $$ select public.create_recurring_rule(gen_random_uuid(), 'expense', 100, 'monthly', current_date,
       'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where kind = 'income' and name = 'Salary')) $$,
  'FC006', null, 'an expense rule cannot use an income source'
);
select throws_ok(
  $$ select public.create_recurring_rule(gen_random_uuid(), 'expense', 100, 'monthly', current_date,
       'a0000000-0000-4000-8000-000000000002', p_category_id => (select id from public.categories where key = 'subscription'), p_payment_mode => 'upi') $$,
  'FC016', null, 'a payment mode needs a bank account'
);
select throws_ok(
  $$ select public.create_recurring_rule(gen_random_uuid(), 'transfer', 100, 'monthly', current_date,
       'a0000000-0000-4000-8000-000000000001', p_counter_account_id => 'a0000000-0000-4000-8000-000000000004') $$,
  'FC015', null, 'a transfer rule needs one currency'
);
select throws_ok(
  $$ select public.create_recurring_rule(gen_random_uuid(), 'expense', 100, 'monthly', current_date,
       'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where key = 'subscription'), p_end_date => current_date - 1) $$,
  '23514', null, 'the end date cannot be before the start'
);
select throws_ok(
  $$ select public.create_recurring_rule(gen_random_uuid(), 'expense', 100, 'daily', current_date,
       'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where key = 'subscription')) $$,
  '23514', null, 'an unknown frequency is rejected'
);
select throws_ok(
  $$ update public.recurring_rules set frequency = 'weekly' where idempotency_key = 'f1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a client cannot change a rule''s frequency'
);
-- R2: weekly rent, every 7 days from four weeks ago. R3: monthly salary into Axis. R4: monthly gym.
select lives_ok(
  $$ select public.create_recurring_rule('f1000000-0000-4000-8000-000000000002', 'expense', 2500000, 'weekly', current_date - 28,
       'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where name = 'Rent & housing')) $$,
  'a weekly rule is created'
);
select lives_ok(
  $$ select public.create_recurring_rule('f1000000-0000-4000-8000-000000000003', 'income', 9500000, 'monthly', public.t_month(-2),
       'a0000000-0000-4000-8000-000000000003', p_category_id => (select id from public.categories where kind = 'income' and name = 'Salary')) $$,
  'an income rule is created'
);
select lives_ok(
  $$ select public.create_recurring_rule('f1000000-0000-4000-8000-000000000004', 'expense', 150000, 'monthly', public.t_month(-2),
       'a0000000-0000-4000-8000-000000000001', p_category_id => 'c0000000-0000-4000-8000-0000000000a1') $$,
  'a rule on a category the person added is created'
);
select set_config('test.r1', (select id::text from public.recurring_rules where idempotency_key = 'f1000000-0000-4000-8000-000000000001'), true);
select set_config('test.r2', (select id::text from public.recurring_rules where idempotency_key = 'f1000000-0000-4000-8000-000000000002'), true);
select set_config('test.r3', (select id::text from public.recurring_rules where idempotency_key = 'f1000000-0000-4000-8000-000000000003'), true);
select set_config('test.r4', (select id::text from public.recurring_rules where idempotency_key = 'f1000000-0000-4000-8000-000000000004'), true);

-- ------------------------------------------------------------ confirm (24-38)
select is(
  (select array[recurring_rule_id::text, occurrence_date::text, category_id::text]
   from public.confirm_recurring_occurrence(current_setting('test.r1')::uuid, public.t_month(-3), 'f2000000-0000-4000-8000-000000000001',
     64900, public.t_month(-3), 'a0000000-0000-4000-8000-000000000001', p_payment_mode => 'upi')),
  array[current_setting('test.r1'), public.t_month(-3)::text, (select id::text from public.categories where key = 'subscription')],
  'confirming records the entry with its rule, occurrence and the rule''s category'
);
select is(
  (select id from public.confirm_recurring_occurrence(current_setting('test.r1')::uuid, public.t_month(-3), 'f2000000-0000-4000-8000-000000000001',
     64900, public.t_month(-3), 'a0000000-0000-4000-8000-000000000001', p_payment_mode => 'upi')),
  (select id from public.transactions where idempotency_key = 'f2000000-0000-4000-8000-000000000001'),
  'replaying the confirm key returns the same entry'
);
select throws_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r1')::uuid, public.t_month(-3), 'f2000000-0000-4000-8000-000000000001',
       70000, public.t_month(-3), 'a0000000-0000-4000-8000-000000000001', p_payment_mode => 'upi') $$,
  'FC007', null, 'the confirm key with different details is refused'
);
select throws_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r1')::uuid, public.t_month(-3), 'f2000000-0000-4000-8000-000000000002',
       64900, public.t_month(-3), 'a0000000-0000-4000-8000-000000000001') $$,
  'FC020', null, 'a second confirm of the same occurrence (another key) is refused'
);
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key, recurring_rule_id, occurrence_date)
     values ('expense', 64900, 'INR', 'a0000000-0000-4000-8000-000000000001', (select id from public.categories where key = 'subscription'),
             public.t_month(-3), gen_random_uuid(), current_setting('test.r1')::uuid, public.t_month(-3)) $$,
  '23505', null, 'a direct second entry for the occurrence hits the once-only index'
);
select throws_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r1')::uuid, public.t_month(-3) + 1, gen_random_uuid(),
       64900, public.t_month(-3), 'a0000000-0000-4000-8000-000000000001') $$,
  'FC019', null, 'a date that is not an occurrence is refused'
);
select throws_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r1')::uuid, public.t_month(-4), gen_random_uuid(),
       64900, public.t_month(-4), 'a0000000-0000-4000-8000-000000000001') $$,
  'FC019', null, 'a date before the start is refused'
);
select throws_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r1')::uuid, public.t_month(2), gen_random_uuid(),
       64900, public.t_month(-1), 'a0000000-0000-4000-8000-000000000001') $$,
  'FC019', null, 'a future occurrence is refused'
);
select throws_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r1')::uuid, public.t_month(-2), gen_random_uuid(),
       64900, public.user_local_today('11111111-1111-4111-8111-111111111111') + 1, 'a0000000-0000-4000-8000-000000000001') $$,
  'FC003', null, 'the entry date cannot be in the future'
);
select is(
  (select array[occurrence_date, occurred_on]
   from public.confirm_recurring_occurrence(current_setting('test.r1')::uuid, public.t_month(-2), 'f2000000-0000-4000-8000-000000000003',
     64900, public.t_month(-2) + 3, 'a0000000-0000-4000-8000-000000000001')),
  array[public.t_month(-2), public.t_month(-2) + 3],
  'the entry uses the confirmed date; the occurrence keeps the rule''s date'
);
-- A direct insert with a link passes the same checks as confirm.
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key, recurring_rule_id, occurrence_date)
     values ('expense', 64900, 'INR', 'a0000000-0000-4000-8000-000000000001', (select id from public.categories where name = 'Groceries'),
             public.t_month(-1), gen_random_uuid(), current_setting('test.r1')::uuid, public.t_month(-1)) $$,
  'FC006', null, 'a direct link with another category is refused'
);
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key, recurring_rule_id, occurrence_date)
     values ('income', 64900, 'INR', 'a0000000-0000-4000-8000-000000000001', (select id from public.categories where kind = 'income' and name = 'Salary'),
             public.t_month(-1), gen_random_uuid(), current_setting('test.r1')::uuid, public.t_month(-1)) $$,
  'FC009', null, 'a direct link with another type is refused'
);
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key, recurring_rule_id, occurrence_date)
     values ('expense', 64900, 'INR', 'a0000000-0000-4000-8000-000000000001', (select id from public.categories where key = 'subscription'),
             public.t_month(-1), gen_random_uuid(), current_setting('test.r1')::uuid, public.t_month(-1) + 2) $$,
  'FC019', null, 'a direct link to a date that is not an occurrence is refused'
);
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key, occurrence_date)
     values ('expense', 64900, 'INR', 'a0000000-0000-4000-8000-000000000001', (select id from public.categories where key = 'subscription'),
             public.t_month(-1), gen_random_uuid(), public.t_month(-1)) $$,
  '23514', null, 'an occurrence date needs its rule (and the other way round)'
);
select throws_ok(
  $$ update public.transactions set recurring_rule_id = null where idempotency_key = 'f2000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a client cannot change the link'
);

-- ------------------------------------------------------------ edit, void, end date (39-46)
select is(
  (select array[recurring_rule_id::text, occurrence_date::text]
   from public.edit_transaction((select id from public.transactions where idempotency_key = 'f2000000-0000-4000-8000-000000000003'),
     'f2000000-0000-4000-8000-000000000004', 70000, public.t_month(-2) + 3, 'a0000000-0000-4000-8000-000000000001',
     p_category_id => (select id from public.categories where key = 'subscription'))),
  array[current_setting('test.r1'), public.t_month(-2)::text],
  'an edit keeps the link'
);
select is(
  (select last_posted_on from public.recurring_rule_progress where rule_id = current_setting('test.r1')::uuid),
  public.t_month(-2), 'progress shows the latest posted occurrence'
);
select lives_ok(
  $$ select public.void_transaction((select id from public.transactions where idempotency_key = 'f2000000-0000-4000-8000-000000000004'),
       'f3000000-0000-4000-8000-000000000001') $$,
  'the posted entry is voided'
);
select is(
  (select last_posted_on from public.recurring_rule_progress where rule_id = current_setting('test.r1')::uuid),
  public.t_month(-3), 'a voided occurrence is no longer posted'
);
select lives_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r1')::uuid, public.t_month(-2), 'f2000000-0000-4000-8000-000000000005',
       64900, public.t_month(-2), 'a0000000-0000-4000-8000-000000000001') $$,
  'and can be confirmed again'
);
select throws_ok(
  $$ select public.update_recurring_rule(current_setting('test.r1')::uuid, 64900, 'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where key = 'subscription'), p_payment_mode => 'upi', p_note => 'Streaming',
       p_end_date => public.t_month(-3)) $$,
  'FC022', null, 'the end date cannot cut off a posted occurrence'
);
select lives_ok(
  $$ select public.update_recurring_rule(current_setting('test.r1')::uuid, 64900, 'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where key = 'subscription'), p_payment_mode => 'upi', p_note => 'Streaming',
       p_end_date => public.t_month(-2)) $$,
  'the end date can be the last posted occurrence'
);
select throws_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r1')::uuid, public.t_month(-1), gen_random_uuid(),
       64900, public.t_month(-1), 'a0000000-0000-4000-8000-000000000001') $$,
  'FC019', null, 'an occurrence after the end date is refused'
);

-- ------------------------------------------------------------ skip and undo (47-62)
select lives_ok(
  $$ select public.skip_recurring_occurrence(current_setting('test.r2')::uuid, current_date - 14, 'f4000000-0000-4000-8000-000000000001', ' paid by hand ') $$,
  'an occurrence is skipped'
);
select is(
  (select id from public.skip_recurring_occurrence(current_setting('test.r2')::uuid, current_date - 14, 'f4000000-0000-4000-8000-000000000001', 'paid by hand')),
  (select id from public.recurring_skips where idempotency_key = 'f4000000-0000-4000-8000-000000000001'),
  'replaying the skip key returns the same skip'
);
select throws_ok(
  $$ select public.skip_recurring_occurrence(current_setting('test.r2')::uuid, current_date - 14, gen_random_uuid()) $$,
  'FC020', null, 'a skipped date cannot be skipped again'
);
select throws_ok(
  $$ select public.skip_recurring_occurrence(current_setting('test.r2')::uuid, current_date - 13, gen_random_uuid()) $$,
  'FC019', null, 'a date that is not an occurrence cannot be skipped'
);
select throws_ok(
  $$ select public.skip_recurring_occurrence(current_setting('test.r2')::uuid, current_date + 7, gen_random_uuid()) $$,
  'FC019', null, 'a future occurrence cannot be skipped'
);
select lives_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r2')::uuid, current_date - 21, 'f2000000-0000-4000-8000-000000000006',
       2500000, current_date - 21, 'a0000000-0000-4000-8000-000000000001') $$,
  'another occurrence is confirmed'
);
select throws_ok(
  $$ select public.skip_recurring_occurrence(current_setting('test.r2')::uuid, current_date - 21, gen_random_uuid()) $$,
  'FC020', null, 'a posted occurrence cannot be skipped'
);
select throws_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r2')::uuid, current_date - 14, gen_random_uuid(),
       2500000, current_date - 14, 'a0000000-0000-4000-8000-000000000001') $$,
  'FC020', null, 'a skipped occurrence cannot be confirmed'
);
select lives_ok(
  $$ select public.skip_recurring_occurrence(current_setting('test.r2')::uuid, current_date - 7, 'f4000000-0000-4000-8000-000000000002') $$,
  'a later occurrence is skipped'
);
select throws_ok(
  $$ select public.undo_recurring_skip(current_setting('test.r2')::uuid, current_date - 14) $$,
  'FC021', null, 'an earlier skip cannot be undone while a later one stands'
);
select lives_ok(
  $$ select public.undo_recurring_skip(current_setting('test.r2')::uuid, current_date - 7) $$,
  'the latest skip can be undone'
);
select lives_ok(
  $$ select public.undo_recurring_skip(current_setting('test.r2')::uuid, current_date - 14) $$,
  'then the earlier one, now the latest handled'
);
select throws_ok(
  $$ select public.undo_recurring_skip(current_setting('test.r2')::uuid, current_date - 14) $$,
  'FC021', null, 'an undone skip cannot be undone again'
);
select lives_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r2')::uuid, current_date - 14, 'f2000000-0000-4000-8000-000000000007',
       2500000, current_date - 14, 'a0000000-0000-4000-8000-000000000001') $$,
  'an occurrence whose skip was undone can be confirmed'
);
select lives_ok(
  $$ select public.skip_recurring_occurrence(current_setting('test.r2')::uuid, current_date - 28, 'f4000000-0000-4000-8000-000000000003') $$,
  'an older unhandled occurrence can be skipped'
);
select throws_ok(
  $$ select public.undo_recurring_skip(current_setting('test.r2')::uuid, current_date - 28) $$,
  'FC021', null, 'a skip older than a posted occurrence cannot be undone'
);

-- ------------------------------------------------------------ needs attention, archive (63-71)
update public.accounts set archived_at = now() where id = 'a0000000-0000-4000-8000-000000000003';
select throws_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r3')::uuid, public.t_month(-1), gen_random_uuid(),
       9500000, public.t_month(-1), 'a0000000-0000-4000-8000-000000000003') $$,
  'FC001', null, 'a rule on an archived account cannot post (needs attention)'
);
select lives_ok(
  $$ select public.update_recurring_rule(current_setting('test.r3')::uuid, 9600000, 'a0000000-0000-4000-8000-000000000003',
       p_category_id => (select id from public.categories where kind = 'income' and name = 'Salary')) $$,
  'a rule may keep its archived account while other details change'
);
select throws_ok(
  $$ select public.update_recurring_rule(current_setting('test.r4')::uuid, 150000, 'a0000000-0000-4000-8000-000000000003',
       p_category_id => 'c0000000-0000-4000-8000-0000000000a1') $$,
  'FC001', null, 'a rule cannot move to an archived account'
);
select lives_ok(
  $$ select public.update_recurring_rule(current_setting('test.r3')::uuid, 9600000, 'a0000000-0000-4000-8000-000000000001',
       p_category_id => (select id from public.categories where kind = 'income' and name = 'Salary')) $$,
  'fixing the account'
);
select lives_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r3')::uuid, public.t_month(-1), gen_random_uuid(),
       9600000, public.t_month(-1), 'a0000000-0000-4000-8000-000000000001') $$,
  'lets it post again'
);
update public.categories set archived_at = now() where id = 'c0000000-0000-4000-8000-0000000000a1';
select throws_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r4')::uuid, public.t_month(-1), gen_random_uuid(),
       150000, public.t_month(-1), 'a0000000-0000-4000-8000-000000000001') $$,
  'FC006', null, 'a rule with an archived category cannot post (needs attention)'
);
select lives_ok(
  $$ select public.set_recurring_rule_archived(current_setting('test.r2')::uuid, true) $$,
  'a rule is archived'
);
select throws_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r2')::uuid, current_date - 7, gen_random_uuid(),
       2500000, current_date - 7, 'a0000000-0000-4000-8000-000000000001') $$,
  'FC018', null, 'an archived rule cannot post'
);
select is(
  (select archived_at from public.set_recurring_rule_archived(current_setting('test.r2')::uuid, false)),
  null::timestamptz, 'an archived rule can be restored'
);

-- ------------------------------------------------------------ no client delete (72-73)
select throws_ok($$ delete from public.recurring_skips $$, '42501', null, 'a client cannot delete skips');
select throws_ok($$ delete from public.recurring_rules $$, '42501', null, 'a client cannot delete rules');

-- ------------------------------------------------------------ other users (74-81)
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
select is(
  (select array[(select count(*) from public.recurring_rules), (select count(*) from public.recurring_skips),
                (select count(*) from public.recurring_rule_progress),
                (select count(*) from public.transactions where recurring_rule_id is not null)]::int[]),
  array[0, 0, 0, 0], 'B sees none of A''s rules, skips, progress or linked entries'
);
select throws_ok(
  $$ select public.confirm_recurring_occurrence(current_setting('test.r1')::uuid, public.t_month(-3), gen_random_uuid(),
       100, public.t_month(-3), 'b0000000-0000-4000-8000-000000000001') $$,
  'FC023', null, 'B cannot confirm A''s rule'
);
select throws_ok(
  $$ select public.skip_recurring_occurrence(current_setting('test.r2')::uuid, current_date - 7, gen_random_uuid()) $$,
  'FC023', null, 'B cannot skip A''s rule'
);
select throws_ok(
  $$ insert into public.recurring_skips (rule_id, occurrence_date, idempotency_key)
     values (current_setting('test.r2')::uuid, current_date - 7, gen_random_uuid()) $$,
  'FC023', null, 'B cannot insert a skip for A''s rule'
);
select throws_ok(
  $$ select public.update_recurring_rule(current_setting('test.r1')::uuid, 100, 'b0000000-0000-4000-8000-000000000001') $$,
  'FC023', null, 'B cannot edit A''s rule'
);
select throws_ok(
  $$ select public.set_recurring_rule_archived(current_setting('test.r1')::uuid, true) $$,
  'FC023', null, 'B cannot archive A''s rule'
);
select throws_ok(
  $$ select public.create_recurring_rule(gen_random_uuid(), 'expense', 100, 'monthly', current_date,
       'a0000000-0000-4000-8000-000000000001', p_category_id => (select id from public.categories where key = 'subscription')) $$,
  'FC010', null, 'B cannot create a rule on A''s account'
);
select throws_ok(
  $$ insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, idempotency_key, recurring_rule_id, occurrence_date)
     values ('expense', 64900, 'INR', 'b0000000-0000-4000-8000-000000000001', (select id from public.categories where key = 'subscription'),
             public.t_month(-1), gen_random_uuid(), current_setting('test.r1')::uuid, public.t_month(-1)) $$,
  'FC023', null, 'B cannot link an entry to A''s rule'
);

-- ------------------------------------------------------------ as owner (82-85)
reset role;
select throws_ok(
  $$ update public.recurring_rules set start_date = start_date - 1 where id = current_setting('test.r1')::uuid $$,
  'FC009', null, 'even the owner cannot change a rule''s start date'
);
select throws_ok(
  $$ update public.transactions set occurrence_date = occurrence_date + 1 where idempotency_key = 'f2000000-0000-4000-8000-000000000001' $$,
  'FC009', null, 'even the owner cannot change an entry''s link'
);
select throws_ok(
  $$ delete from public.recurring_rules where id = current_setting('test.r1')::uuid $$,
  '23503', null, 'a rule with linked entries cannot be deleted on its own (NO ACTION)'
);
select lives_ok(
  $$ delete from auth.users where id = '11111111-1111-4111-8111-111111111111' $$,
  'deleting the whole user still works'
);

select * from finish();
rollback;
