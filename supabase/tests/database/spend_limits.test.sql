-- pgTAP tests for the daily spend limit (migration 20261127120000_spend_limits.sql). Run with
-- `supabase test db` (CI). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

-- Users A and B (fictional). Sign-up gives each a profile.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bala@example.test');

-- A lives far east of UTC, so A's today can differ from the server's.
update public.profiles set time_zone = 'Pacific/Kiritimati' where id = '11111111-1111-4111-8111-111111111111';

create function public.t_a_today() returns date language sql stable
  as $$ select public.user_local_today('11111111-1111-4111-8111-111111111111') $$;
grant execute on function public.t_a_today() to authenticated;

-- ------------------------------------------------------------ structure and privileges
select has_table('public', 'spend_limits', 'spend_limits exists');
select col_is_pk('public', 'spend_limits', 'user_id', 'user_id is the primary key (one limit per person)');
select ok((select relrowsecurity from pg_class where oid = 'public.spend_limits'::regclass), 'RLS is on');
select policies_are('public', 'spend_limits',
  array['spend_limits_select_own', 'spend_limits_insert_own', 'spend_limits_update_own', 'spend_limits_delete_own'],
  'only the four own-row policies');
select ok(not has_table_privilege('anon', 'public.spend_limits', 'SELECT')
          and not has_table_privilege('anon', 'public.spend_limits', 'INSERT')
          and not has_table_privilege('anon', 'public.spend_limits', 'DELETE'), 'anon has no access');
select ok(not has_function_privilege('anon', 'public.set_spend_limit(bigint, text, integer)', 'EXECUTE'), 'anon cannot call set_spend_limit');
select ok(not has_function_privilege('authenticated', 'public.spend_limits_validate()', 'EXECUTE'), 'clients cannot call the trigger function');
select ok(has_table_privilege('authenticated', 'public.spend_limits', 'DELETE'), 'clients may remove their limit');
select ok(not has_column_privilege('authenticated', 'public.spend_limits', 'starts_on', 'INSERT')
          and not has_column_privilege('authenticated', 'public.spend_limits', 'starts_on', 'UPDATE'), 'clients cannot set starts_on');
select ok(not has_column_privilege('authenticated', 'public.spend_limits', 'currency', 'INSERT')
          and not has_column_privilege('authenticated', 'public.spend_limits', 'currency', 'UPDATE'), 'clients cannot set the currency');
select ok(not has_column_privilege('authenticated', 'public.spend_limits', 'user_id', 'UPDATE'), 'clients cannot move a limit to another user');
select ok(not has_column_privilege('authenticated', 'public.spend_limits', 'updated_at', 'UPDATE'), 'clients cannot set updated_at');

-- ------------------------------------------------------------ A sets a limit
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok($$ select public.set_spend_limit(700000, 'week', 7) $$, 'A sets ₹7,000 a week');
select results_eq(
  $$ select amount_minor, currency, period, period_days, starts_on = public.t_a_today() from public.spend_limits $$,
  $$ values (700000::bigint, 'INR'::text, 'week'::text, 7, true) $$,
  'the currency comes from the profile and the period starts on A''s local today'
);
select lives_ok($$ select public.set_spend_limit(700000, 'week', 7) $$, 'the same call again is harmless');
select is((select count(*) from public.spend_limits), 1::bigint, 'still one row');
select throws_ok(
  $$ insert into public.spend_limits (amount_minor, period, period_days) values (100000, 'day', 1) $$,
  '23505', null, 'a second limit row for A is refused'
);

-- Bad values
select throws_ok($$ select public.set_spend_limit(0, 'day', 1) $$, '23514', null, 'amount 0 is refused');
select throws_ok($$ select public.set_spend_limit(-100, 'day', 1) $$, '23514', null, 'a negative amount is refused');
select throws_ok($$ select public.set_spend_limit(10000000000001, 'day', 1) $$, '23514', null, 'an amount over the cap is refused');
select throws_ok($$ select public.set_spend_limit(100000, 'week', 5) $$, '23514', null, 'a week must be 7 days');
select throws_ok($$ select public.set_spend_limit(100000, 'month', 30) $$, '23514', null, 'a month has no day count');
select throws_ok($$ select public.set_spend_limit(100000, 'custom', 1) $$, '23514', null, 'custom 1 day is refused (use day)');
select throws_ok($$ select public.set_spend_limit(100000, 'custom', 366) $$, '23514', null, 'custom over 365 days is refused');
select throws_ok($$ select public.set_spend_limit(100000, 'fortnight', 14) $$, '23514', null, 'an unknown period is refused');
select throws_ok(
  $$ insert into public.spend_limits (amount_minor, period, period_days, currency) values (100000, 'day', 1, 'USD') $$,
  '42501', null, 'a client cannot choose the currency'
);
select throws_ok(
  $$ update public.spend_limits set starts_on = date '2020-01-01' $$,
  '42501', null, 'a client cannot change starts_on'
);

-- ------------------------------------------------------------ starts_on: kept or started again
-- Move A's period start into the past, past the trigger, as if the limit was set 3 days ago.
reset role;
alter table public.spend_limits disable trigger spend_limits_validate;
update public.spend_limits set starts_on = public.t_a_today() - 3, updated_at = now() - interval '3 days'
  where user_id = '11111111-1111-4111-8111-111111111111';
alter table public.spend_limits enable trigger spend_limits_validate;
set local role authenticated;

select lives_ok($$ select public.set_spend_limit(900000, 'week', 7) $$, 'A changes only the amount');
select results_eq(
  $$ select amount_minor, starts_on = public.t_a_today() - 3, updated_at > now() - interval '1 minute' from public.spend_limits $$,
  $$ values (900000::bigint, true, true) $$,
  'a change of amount keeps starts_on; updated_at is the database time'
);
select lives_ok($$ select public.set_spend_limit(900000, 'week', 7) $$, 'A repeats the same call (a double submit)');
select results_eq(
  $$ select count(*), bool_and(starts_on = public.t_a_today() - 3), min(amount_minor) from public.spend_limits $$,
  $$ values (1::bigint, true, 900000::bigint) $$,
  'the repeated call keeps one row and keeps starts_on'
);
select lives_ok($$ select public.set_spend_limit(500000, 'custom', 10) $$, 'A changes the period to 10 days');
select results_eq(
  $$ select period, period_days, starts_on = public.t_a_today() from public.spend_limits $$,
  $$ values ('custom'::text, 10, true) $$,
  'a change of period starts a fresh period from today'
);

reset role;
alter table public.spend_limits disable trigger spend_limits_validate;
update public.spend_limits set starts_on = public.t_a_today() - 3 where user_id = '11111111-1111-4111-8111-111111111111';
alter table public.spend_limits enable trigger spend_limits_validate;
set local role authenticated;

select lives_ok($$ select public.set_spend_limit(500000, 'custom', 12) $$, 'A changes the custom day count');
select is((select starts_on from public.spend_limits), public.t_a_today(), 'a change of custom day count starts from today');

-- A currency change starts a fresh period too (the earlier spending was in the old currency).
reset role;
alter table public.spend_limits disable trigger spend_limits_validate;
update public.spend_limits set starts_on = public.t_a_today() - 3 where user_id = '11111111-1111-4111-8111-111111111111';
alter table public.spend_limits enable trigger spend_limits_validate;
update public.profiles set currency = 'USD' where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;

select lives_ok($$ select public.set_spend_limit(50000, 'custom', 12) $$, 'A sets the amount after a currency change');
select results_eq(
  $$ select currency, starts_on = public.t_a_today() from public.spend_limits $$,
  $$ values ('USD'::text, true) $$,
  'the limit takes the new profile currency and starts from today'
);

-- ------------------------------------------------------------ B cannot see or change A's limit
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);

select is((select count(*) from public.spend_limits), 0::bigint, 'B sees no limits');
select lives_ok(
  $$ update public.spend_limits set amount_minor = 1 where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'B''s update of A''s limit runs (and matches no row)'
);
select lives_ok(
  $$ delete from public.spend_limits where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'B''s delete of A''s limit runs (and matches no row)'
);
select throws_ok(
  $$ insert into public.spend_limits (user_id, amount_minor, period, period_days)
     values ('11111111-1111-4111-8111-111111111111', 100, 'day', 1) $$,
  '42501', null, 'B cannot add a limit for A'
);
select lives_ok($$ select public.set_spend_limit(200000, 'day', 1) $$, 'B sets B''s own limit');

reset role;
select results_eq(
  $$ select user_id::text, amount_minor from public.spend_limits order by user_id $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::text, 50000::bigint), ('22222222-2222-4222-8222-222222222222'::text, 200000::bigint) $$,
  'B''s writes changed nothing of A''s; B''s own limit is separate'
);

-- ------------------------------------------------------------ anon
set local role anon;
select throws_ok($$ select public.set_spend_limit(100, 'day', 1) $$, '42501', null, 'anon cannot set a limit');
select throws_ok($$ delete from public.spend_limits $$, '42501', null, 'anon cannot delete limits');
reset role;

-- ------------------------------------------------------------ A removes and sets it again
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok($$ delete from public.spend_limits $$, 'A removes the limit');
select is((select count(*) from public.spend_limits), 0::bigint, 'A''s limit is gone');
select lives_ok($$ select public.set_spend_limit(100000, 'day', 1) $$, 'A sets a limit again');
select is((select starts_on from public.spend_limits), public.t_a_today(), 'a limit set again starts from today');

-- ------------------------------------------------------------ deleting the user removes the limit
reset role;
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is(
  (select count(*) from public.spend_limits where user_id = '11111111-1111-4111-8111-111111111111'),
  0::bigint, 'deleting the user deletes the limit'
);

select * from finish();
rollback;
