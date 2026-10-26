-- pgTAP tests for goals and monthly budgets (migration 20261026180000). Run with
-- `supabase test db` (CI). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

-- Users A and B (fictional). Sign-up gives each a profile and default categories.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bala@example.test');

-- A lives far east of UTC, so A's month can differ from the server's.
update public.profiles set time_zone = 'Pacific/Kiritimati' where id = '11111111-1111-4111-8111-111111111111';

-- The first day of A's local month, k months from now.
create function public.t_month(k integer) returns date language sql stable
  as $$ select (date_trunc('month', public.user_local_today('11111111-1111-4111-8111-111111111111')::timestamp)
                + make_interval(months => k))::date $$;
grant execute on function public.t_month(integer) to authenticated;

insert into public.categories (id, user_id, kind, name, icon) values
  ('c0000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'expense', 'Groceries plus', 'food'),
  ('c0000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'expense', 'Old hobby', 'other'),
  ('c0000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'expense', 'Fuel plus', 'transport');
-- (The categories trigger clears archived_at on insert, so archive with an update.)
update public.categories set archived_at = now() where id = 'c0000000-0000-4000-8000-0000000000a2';

-- A budget row from last month, written past the trigger (as it would be after a month passes).
alter table public.budgets disable trigger budgets_validate;
insert into public.budgets (user_id, category_id, effective_from, amount_minor, currency) values
  ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-0000000000a3', public.t_month(-1), 500000, 'INR');
alter table public.budgets enable trigger budgets_validate;

-- ------------------------------------------------------------ privileges
select ok(not has_table_privilege('authenticated', 'public.goals', 'DELETE'), 'clients cannot delete goals');
select ok(not has_table_privilege('authenticated', 'public.budgets', 'DELETE'), 'clients cannot delete budgets');
select ok(not has_column_privilege('authenticated', 'public.goals', 'currency', 'INSERT'), 'clients cannot set a goal''s currency');
select ok(not has_column_privilege('authenticated', 'public.goals', 'type', 'UPDATE'), 'clients cannot change a goal''s type');
select ok(not has_column_privilege('authenticated', 'public.goals', 'user_id', 'UPDATE'), 'clients cannot move a goal to another user');
select ok(not has_column_privilege('authenticated', 'public.budgets', 'currency', 'INSERT'), 'clients cannot set a budget''s currency');
select ok(not has_column_privilege('authenticated', 'public.budgets', 'category_id', 'UPDATE'), 'clients cannot move a budget to another category');
select ok(not has_table_privilege('anon', 'public.goals', 'SELECT') and not has_table_privilege('anon', 'public.budgets', 'SELECT'),
  'anon has no access to either table');

-- ------------------------------------------------------------ goals as A
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$ insert into public.goals (type, name, target_amount_minor, saved_amount_minor, target_date, details, idempotency_key)
     values ('other', '  Wedding gift ', 2500000, 0, current_date + 60, '{"v": 1, "description": "Gift"}', 'f6000000-0000-4000-8000-000000000001') $$,
  'A adds a goal'
);
select results_eq(
  $$ select name, currency, archived_at is null from public.goals where idempotency_key = 'f6000000-0000-4000-8000-000000000001' $$,
  $$ values ('Wedding gift'::text, 'INR'::text, true) $$,
  'the name is trimmed and the currency comes from the profile'
);
select throws_ok(
  $$ insert into public.goals (type, name, target_amount_minor, currency, details, idempotency_key)
     values ('other', 'Gift', 100, 'USD', '{"v": 1, "description": "x"}', 'f6000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'a client cannot choose a goal''s currency'
);
select throws_ok(
  $$ insert into public.goals (type, name, target_amount_minor, details, idempotency_key)
     values ('other', 'Again', 100, '{"v": 1, "description": "x"}', 'f6000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'the same request key cannot add a second goal'
);
select throws_ok(
  $$ insert into public.goals (type, name, target_amount_minor, details, idempotency_key)
     values ('other', 'List', 100, '[1, 2]', 'f6000000-0000-4000-8000-000000000003') $$,
  '23514', null, 'details must be an object, not an array'
);
select throws_ok(
  $$ insert into public.goals (type, name, target_amount_minor, details, idempotency_key)
     values ('other', 'Big', 100, jsonb_build_object('v', 1, 'description', repeat('x', 8200)), 'f6000000-0000-4000-8000-000000000004') $$,
  '23514', null, 'details over 8,192 bytes are refused'
);
select throws_ok(
  $$ insert into public.goals (type, name, target_amount_minor, details, idempotency_key)
     values ('boat', 'Boat', 100, '{"v": 1}', 'f6000000-0000-4000-8000-000000000005') $$,
  '23514', null, 'unknown goal types are refused'
);
select throws_ok(
  $$ insert into public.goals (type, name, target_amount_minor, details, idempotency_key)
     values ('other', 'Minus', -1, '{"v": 1, "description": "x"}', 'f6000000-0000-4000-8000-000000000006') $$,
  '23514', null, 'a negative target is refused'
);
select lives_ok(
  $$ insert into public.goals (type, name, target_amount_minor, details, idempotency_key)
     values ('mobile', 'Phone', 0, '{"v": 1, "item": "Phone", "payment": "no_cost_emi", "priceMinor": 6000000, "emiRateBps": null, "emiMonths": 6}',
             'f6000000-0000-4000-8000-000000000007') $$,
  'a target of 0 is allowed (nothing to save upfront)'
);
select throws_ok(
  $$ update public.goals set type = 'car' where idempotency_key = 'f6000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a client cannot change a goal''s type'
);

update public.goals set archived_at = '2000-01-01' where idempotency_key = 'f6000000-0000-4000-8000-000000000001';
select ok(
  (select archived_at > now() - interval '1 minute' from public.goals where idempotency_key = 'f6000000-0000-4000-8000-000000000001'),
  'archiving stamps the server time, not the client''s'
);
select throws_ok(
  $$ update public.goals set saved_amount_minor = 100 where idempotency_key = 'f6000000-0000-4000-8000-000000000001' $$,
  'FC024', null, 'an archived goal cannot be edited'
);
select lives_ok(
  $$ update public.goals set archived_at = null where idempotency_key = 'f6000000-0000-4000-8000-000000000001' $$,
  'an archived goal can be restored'
);
select lives_ok(
  $$ update public.goals set saved_amount_minor = 100, name = 'Gift for Meera' where idempotency_key = 'f6000000-0000-4000-8000-000000000001' $$,
  'and edited again after restoring'
);
select throws_ok($$ delete from public.goals $$, '42501', null, 'a client cannot delete goals');
select is((select count(*)::int from public.goals), 2, 'A sees their two goals');

-- ------------------------------------------------------------ budgets as A
select is(
  (select currency from public.set_category_budget('c0000000-0000-4000-8000-0000000000a1', public.t_month(0), 1200000)),
  'INR', 'A sets a budget from this month (A''s local month); currency from the profile'
);
select lives_ok(
  $$ select public.set_category_budget('c0000000-0000-4000-8000-0000000000a1', public.t_month(0), 1200000) $$,
  'setting the same budget again works'
);
select results_eq(
  $$ select count(*)::int, max(amount_minor) from public.budgets where category_id = 'c0000000-0000-4000-8000-0000000000a1' $$,
  $$ values (1, 1200000::bigint) $$,
  'and leaves one row (idempotent)'
);
select lives_ok(
  $$ select public.set_category_budget('c0000000-0000-4000-8000-0000000000a1', public.t_month(0), 1500000) $$,
  'changing this month''s amount'
);
select results_eq(
  $$ select count(*)::int, max(amount_minor) from public.budgets where category_id = 'c0000000-0000-4000-8000-0000000000a1' $$,
  $$ values (1, 1500000::bigint) $$,
  'updates the same row'
);
select lives_ok(
  $$ insert into public.budgets (category_id, effective_from, amount_minor) values ('c0000000-0000-4000-8000-0000000000a1', public.t_month(2), 0) $$,
  'a 0 row ends the budget from a later month'
);
select throws_ok(
  $$ insert into public.budgets (category_id, effective_from, amount_minor) values ('c0000000-0000-4000-8000-0000000000a1', public.t_month(-1), 100) $$,
  'FC025', null, 'a budget cannot start in a past month (insert)'
);
select throws_ok(
  $$ select public.set_category_budget('c0000000-0000-4000-8000-0000000000a3', public.t_month(-1), 900000) $$,
  'FC025', null, 'nor through set_category_budget onto an existing past row'
);
select throws_ok(
  $$ update public.budgets set amount_minor = 1 where category_id = 'c0000000-0000-4000-8000-0000000000a3' and effective_from = public.t_month(-1) $$,
  'FC025', null, 'a past month''s budget cannot change'
);
select is(
  (select amount_minor from public.budgets where category_id = 'c0000000-0000-4000-8000-0000000000a3'),
  500000::bigint, 'and keeps its amount'
);

set local timezone = 'America/St_Johns';
select throws_ok(
  $$ insert into public.budgets (category_id, effective_from, amount_minor) values ('c0000000-0000-4000-8000-0000000000a3', public.t_month(1) + 14, 100) $$,
  '23514', null, 'a month must start on day 1 (session time zone UTC−3:30)'
);
select lives_ok(
  $$ insert into public.budgets (category_id, effective_from, amount_minor) values ('c0000000-0000-4000-8000-0000000000a3', public.t_month(1), 100) $$,
  'and day 1 is accepted in that time zone'
);
reset timezone;

select throws_ok(
  $$ select public.set_category_budget((select id from public.categories where kind = 'income' and name = 'Salary'), public.t_month(0), 100) $$,
  'FC026', null, 'income sources cannot have a budget'
);
select throws_ok(
  $$ select public.set_category_budget('c0000000-0000-4000-8000-0000000000a2', public.t_month(0), 100) $$,
  'FC026', null, 'an archived category cannot get a budget above 0'
);
select lives_ok(
  $$ select public.set_category_budget('c0000000-0000-4000-8000-0000000000a2', public.t_month(0), 0) $$,
  'but can get 0 (ending a budget)'
);
select throws_ok(
  $$ insert into public.budgets (category_id, effective_from, amount_minor, currency) values ('c0000000-0000-4000-8000-0000000000a1', public.t_month(3), 100, 'USD') $$,
  '42501', null, 'a client cannot choose a budget''s currency'
);
select throws_ok($$ delete from public.budgets $$, '42501', null, 'a client cannot delete budgets');

-- ------------------------------------------------------------ currency change
update public.profiles set currency = 'USD' where id = '11111111-1111-4111-8111-111111111111';
select is(
  (select currency from public.set_category_budget('c0000000-0000-4000-8000-0000000000a1', public.t_month(0), 20000)),
  'USD', 'after a currency change, re-setting this month''s budget takes the new currency'
);
select is(
  (select currency from public.goals where idempotency_key = 'f6000000-0000-4000-8000-000000000001'),
  'INR', 'a goal keeps the currency it was created in'
);
update public.profiles set currency = 'INR' where id = '11111111-1111-4111-8111-111111111111';

-- ------------------------------------------------------------ B cannot reach A's rows
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
select is((select count(*)::int from public.goals) + (select count(*)::int from public.budgets), 0, 'B sees none of A''s goals or budgets');
select is(
  (with u as (update public.goals set saved_amount_minor = 1 returning 1) select count(*)::int from u),
  0, 'B cannot change A''s goals'
);
select is(
  (with u as (update public.budgets set amount_minor = 1 returning 1) select count(*)::int from u),
  0, 'B cannot change A''s budgets'
);
select throws_ok(
  $$ select public.set_category_budget('c0000000-0000-4000-8000-0000000000a1', public.t_month(0), 100) $$,
  'FC026', null, 'B cannot budget A''s category'
);
select throws_ok(
  $$ insert into public.goals (user_id, type, name, target_amount_minor, details, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'other', 'X', 1, '{"v": 1, "description": "x"}', 'f6000000-0000-4000-8000-000000000009') $$,
  '42501', null, 'B cannot add a goal for A'
);

-- ------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$ select public.set_category_budget('c0000000-0000-4000-8000-0000000000a1', current_date, 1) $$,
  '42501', null, 'anon cannot set budgets');

-- ------------------------------------------------------------ account deletion
reset role;
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is(
  (select count(*)::int from public.goals where user_id = '11111111-1111-4111-8111-111111111111')
  + (select count(*)::int from public.budgets where user_id = '11111111-1111-4111-8111-111111111111'),
  0, 'deleting the user removes their goals and budgets'
);

select * from finish();
rollback;
