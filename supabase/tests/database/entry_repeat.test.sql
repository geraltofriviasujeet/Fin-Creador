-- pgTAP tests for "Repeat this?" (migration 20261105120000). Run with `supabase test db` (CI).
-- Everything is rolled back. Fictional users and amounts only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- Users A and B (Asia/Kolkata, the default), fictional.
insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-00000000000a', 'meera@example.test'),
  ('b1000000-0000-4000-8000-00000000000b', 'kabir@example.test');

-- Helpers (SECURITY INVOKER: RLS applies to whoever calls them).
create function public.t_today() returns date language sql stable set search_path = ''
  as $$ select public.user_local_today((select auth.uid())) $$;
create function public.t_acct(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select a.id from public.accounts as a where a.name = p_name $$;
create function public.t_cat(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select c.id from public.categories as c where c.kind = 'expense' and c.name = p_name $$;
create function public.t_inc(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select c.id from public.categories as c where c.kind = 'income' and c.name = p_name $$;
create function public.t_bal(p_account uuid) returns bigint language sql stable set search_path = ''
  as $$ select a.opening_balance_minor + b.inflow_minor - b.outflow_minor
        from public.accounts as a join public.account_balances as b on b.account_id = a.id where a.id = p_account $$;
grant execute on function public.t_today(), public.t_acct(text), public.t_cat(text), public.t_inc(text), public.t_bal(uuid)
  to authenticated;

-- ------------------------------------------------------------ privileges (1)
select ok(not has_function_privilege('anon', 'public.record_entry_with_repeat(uuid, text, text, bigint, date, uuid, uuid, text, text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.record_entry_with_repeat(uuid, text, text, bigint, date, uuid, uuid, text, text)', 'EXECUTE'),
  'record_entry_with_repeat: signed-in users only');

-- ------------------------------------------------------------ as A
select set_config('request.jwt.claims', '{"sub": "a1000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('bank', 'savings', 'M Bank', 'INR', 1000000, public.t_today() - 400);

-- ------------------------------------------------------------ rule and entry together (2-6)
select lives_ok(
  $$ select public.record_entry_with_repeat('e2000000-0000-4000-8000-000000000001', 'income', 'monthly', 5000000,
       public.t_today() - 40, public.t_acct('M Bank'), public.t_inc('Salary'), 'Salary') $$,
  'a back-dated monthly salary saves');
select is(
  (select array[r.type, r.frequency, r.start_date::text, r.amount_minor::text]
   from public.recurring_rules as r where r.idempotency_key = 'e2000000-0000-4000-8000-000000000001'),
  array['income', 'monthly', (public.t_today() - 40)::text, '5000000'],
  '... creates a monthly income rule starting on the entry date');
select is(
  (select count(*)::int from public.transactions as t
   join public.recurring_rules as r on r.id = t.recurring_rule_id
   where t.idempotency_key = 'e2000000-0000-4000-8000-000000000001'
     and t.occurrence_date = r.start_date and t.occurred_on = r.start_date and t.voided_at is null),
  1, '... and the entry is that rule''s first occurrence');
select is(public.t_bal(public.t_acct('M Bank')), 6000000::bigint, '... counted once in the balance');
select is(
  (select p.last_posted_on from public.recurring_rule_progress as p
   join public.recurring_rules as r on r.id = p.rule_id
   where r.idempotency_key = 'e2000000-0000-4000-8000-000000000001'),
  public.t_today() - 40, '... so the start date shows as handled, not due');

-- ------------------------------------------------------------ retries and duplicates (7-10)
select lives_ok(
  $$ select public.record_entry_with_repeat('e2000000-0000-4000-8000-000000000001', 'income', 'monthly', 5000000,
       public.t_today() - 40, public.t_acct('M Bank'), public.t_inc('Salary'), 'Salary') $$,
  'retrying the same request saves nothing new');
select is(
  (select array[(select count(*) from public.recurring_rules), (select count(*) from public.transactions)]::int[]),
  array[1, 1], '... still one rule and one entry');
select throws_ok(
  $$ select public.record_entry_with_repeat('e2000000-0000-4000-8000-000000000001', 'income', 'monthly', 4000000,
       public.t_today() - 40, public.t_acct('M Bank'), public.t_inc('Salary'), 'Salary') $$,
  'FC007', null, 'the same request key with a different amount is refused');
select throws_ok(
  format($$ select public.confirm_recurring_occurrence(%L, %L, gen_random_uuid(), 5000000, %L, %L) $$,
    (select id from public.recurring_rules where idempotency_key = 'e2000000-0000-4000-8000-000000000001'),
    public.t_today() - 40, public.t_today() - 40, public.t_acct('M Bank')),
  'FC020', null, 'the first occurrence can''t be confirmed a second time');

-- ------------------------------------------------------------ back-dated: later occurrences are due, not posted (11-12)
select is(
  (select count(*)::int from public.transactions where recurring_rule_id is not null),
  1, 'nothing between the back-dated start and today posts by itself');
select lives_ok(
  format($$ select public.confirm_recurring_occurrence(%L, %L, gen_random_uuid(), 5000000, %L, %L) $$,
    (select id from public.recurring_rules where idempotency_key = 'e2000000-0000-4000-8000-000000000001'),
    ((public.t_today() - 40) + interval '1 month')::date, public.t_today(), public.t_acct('M Bank')),
  '... the next month is due and can be confirmed');

-- ------------------------------------------------------------ expenses (13)
select lives_ok(
  $$ select public.record_entry_with_repeat('e2000000-0000-4000-8000-000000000002', 'expense', 'yearly', 120000,
       public.t_today(), public.t_acct('M Bank'), public.t_cat('Shopping'), null, 'upi') $$,
  'a yearly expense with a payment mode saves');

-- ------------------------------------------------------------ refused, and all or nothing (14-18)
select throws_ok(
  $$ select public.record_entry_with_repeat(gen_random_uuid(), 'transfer', 'monthly', 100, public.t_today(),
       public.t_acct('M Bank'), public.t_cat('Shopping')) $$,
  '22023', null, 'a transfer can''t repeat from the add form');
select throws_ok(
  $$ select public.record_entry_with_repeat(gen_random_uuid(), 'expense', 'weekly', 100, public.t_today(),
       public.t_acct('M Bank'), public.t_cat('Shopping')) $$,
  '22023', null, 'only every month or every year');
select throws_ok(
  $$ select public.record_entry_with_repeat(gen_random_uuid(), 'expense', 'monthly', 100, public.t_today() + 1,
       public.t_acct('M Bank'), public.t_cat('Shopping')) $$,
  'FC003', null, 'a future entry is refused');
select throws_ok(
  $$ select public.record_entry_with_repeat(gen_random_uuid(), 'expense', 'monthly', 100, public.t_today(),
       public.t_acct('M Bank'), public.t_inc('Salary')) $$,
  'FC006', null, 'an income source is not an expense category');
select is((select count(*)::int from public.recurring_rules), 2, '... and no refused request left a rule behind');

-- ------------------------------------------------------------ other users (19-20)
select set_config('test.a_bank', public.t_acct('M Bank')::text, true);
select set_config('request.jwt.claims', '{"sub": "b1000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.record_entry_with_repeat(gen_random_uuid(), 'income', 'monthly', 100, public.t_today(), %L, public.t_inc('Salary')) $$,
    current_setting('test.a_bank')),
  'FC010', null, 'B can''t repeat income into A''s account');
select is(
  (select array[(select count(*) from public.recurring_rules), (select count(*) from public.transactions)]::int[]),
  array[0, 0], 'B sees none of A''s rules or entries');

select * from finish();
rollback;
