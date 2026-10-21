-- pgTAP tests for public.profiles: schema, sign-up trigger, grants and RLS.
-- Run with `supabase test db` (local stack). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

-- Fixed test users (fictional).
--   A: Asha  11111111-1111-4111-8111-111111111111
--   B: Bala  22222222-2222-4222-8222-222222222222
--   C: long name metadata                 33333333-3333-4333-8333-333333333333
--   D: no name metadata                   44444444-4444-4444-8444-444444444444
--   E: blank display_name, has full_name  66666666-6666-4666-8666-666666666666
--   F: empty display_name, has name       77777777-7777-4777-8777-777777777777
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test', '{"display_name": "  Asha Rao  "}'),
  ('22222222-2222-4222-8222-222222222222', 'bala@example.test', '{"full_name": "Bala"}'),
  ('33333333-3333-4333-8333-333333333333', 'long@example.test', jsonb_build_object('name', repeat('x', 100))),
  ('44444444-4444-4444-8444-444444444444', 'none@example.test', '{}'),
  ('66666666-6666-4666-8666-666666666666', 'esha@example.test', '{"display_name": "   ", "full_name": "Esha"}'),
  ('77777777-7777-4777-8777-777777777777', 'neel@example.test', '{"display_name": "", "name": "Neel"}');

-- ---------------------------------------------------------------- schema (1-5)
select has_table('public', 'profiles', 'profiles table exists');
select col_is_pk('public', 'profiles', 'id', 'id is the primary key');
select fk_ok('public', 'profiles', 'id', 'auth', 'users', 'id', 'id references auth.users');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.profiles'::regclass),
  'RLS is enabled on profiles'
);
select policies_are('public', 'profiles', array['profiles_select_own', 'profiles_update_own'],
  'only the select-own and update-own policies exist');

-- ------------------------------------------------------- sign-up trigger (6-15)
select results_eq(
  $$ select display_name, country, currency, time_zone from public.profiles
     where id = '11111111-1111-4111-8111-111111111111' $$,
  $$ values ('Asha Rao'::text, 'IN'::text, 'INR'::text, 'Asia/Kolkata'::text) $$,
  'trigger creates a profile with trimmed name and India / INR / Asia/Kolkata defaults'
);
select is(
  (select display_name from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  'Bala', 'falls back to full_name metadata (Google)'
);
select is(
  (select char_length(display_name) from public.profiles where id = '33333333-3333-4333-8333-333333333333'),
  80, 'over-long metadata name is capped at 80 characters instead of failing sign-up'
);
select is(
  (select display_name from public.profiles where id = '44444444-4444-4444-8444-444444444444'),
  null, 'missing name metadata leaves display_name null'
);
select ok(
  not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
  'authenticated cannot call handle_new_user'
);
select ok(
  not has_function_privilege('anon', 'public.handle_new_user()', 'execute'),
  'anon cannot call handle_new_user'
);
select is(
  (select display_name from public.profiles where id = '66666666-6666-4666-8666-666666666666'),
  'Esha', 'blank display_name falls back to full_name'
);
select is(
  (select display_name from public.profiles where id = '77777777-7777-4777-8777-777777777777'),
  'Neel', 'empty display_name falls back to name'
);
select ok(
  not has_function_privilege('authenticated', 'public.backfill_missing_profiles()', 'execute')
  and not has_function_privilege('anon', 'public.backfill_missing_profiles()', 'execute'),
  'API roles cannot call backfill_missing_profiles'
);
select ok(
  not has_function_privilege('authenticated', 'public.profile_display_name(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.profile_display_name(jsonb)', 'execute'),
  'API roles cannot call profile_display_name'
);

-- ------------------------------------------------------- table grants (16-17)
select table_privs_are('public', 'profiles', 'anon', array[]::text[], 'anon has no table privileges');
select table_privs_are('public', 'profiles', 'authenticated', array['SELECT'],
  'authenticated has only SELECT at table level (UPDATE is column-level)');

-- ------------------------------------------------------- as user A (18-31)
select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

select results_eq(
  $$ select id from public.profiles $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid) $$,
  'user A sees only their own profile'
);
select lives_ok(
  $$ update public.profiles
     set display_name = 'Asha R', phone = '+919876543210', country = 'US',
         currency = 'USD', time_zone = 'America/New_York'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  'user A can update their editable fields'
);
select results_eq(
  $$ select display_name, phone, country, currency, time_zone from public.profiles
     where id = '11111111-1111-4111-8111-111111111111' $$,
  $$ values ('Asha R'::text, '+919876543210'::text, 'US'::text, 'USD'::text, 'America/New_York'::text) $$,
  'user A''s changes persist'
);
select results_eq(
  $$ with u as (
       update public.profiles set display_name = 'hacked'
       where id = '22222222-2222-4222-8222-222222222222' returning id
     ) select count(*) from u $$,
  $$ values (0::bigint) $$,
  'user A cannot update user B''s profile (0 rows affected)'
);
select throws_ok(
  $$ update public.profiles set id = '22222222-2222-4222-8222-222222222222'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'user A cannot change id'
);
select throws_ok(
  $$ update public.profiles set created_at = now() where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'user A cannot change created_at'
);
select throws_ok(
  $$ update public.profiles set avatar_url = 'https://example.test/a.png'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'user A cannot set avatar_url (no upload flow yet)'
);
select throws_ok(
  $$ insert into public.profiles (id) values ('55555555-5555-4555-8555-555555555555') $$,
  '42501', null, 'user A cannot insert profiles'
);
select throws_ok(
  $$ delete from public.profiles where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'user A cannot delete profiles'
);
select throws_ok(
  $$ update public.profiles set currency = 'inr' where id = '11111111-1111-4111-8111-111111111111' $$,
  '23514', null, 'currency must be 3 upper-case letters'
);
select throws_ok(
  $$ update public.profiles set country = 'IND' where id = '11111111-1111-4111-8111-111111111111' $$,
  '23514', null, 'country must be 2 upper-case letters'
);
select throws_ok(
  $$ update public.profiles set time_zone = 'Mars/Olympus_Mons' where id = '11111111-1111-4111-8111-111111111111' $$,
  '22023', null, 'unknown time zone is rejected'
);
select throws_ok(
  $$ update public.profiles set phone = '12345' where id = '11111111-1111-4111-8111-111111111111' $$,
  '23514', null, 'phone must be E.164'
);
select throws_ok(
  $$ update public.profiles set display_name = '   ' where id = '11111111-1111-4111-8111-111111111111' $$,
  '23514', null, 'blank display name is rejected'
);

-- ------------------------------------------------------- as user B (32-33)
select set_config('request.jwt.claims',
  '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);

select results_eq(
  $$ select id from public.profiles $$,
  $$ values ('22222222-2222-4222-8222-222222222222'::uuid) $$,
  'user B sees only their own profile'
);
select results_eq(
  $$ with u as (
       update public.profiles set display_name = 'hacked'
       where id = '11111111-1111-4111-8111-111111111111' returning id
     ) select count(*) from u $$,
  $$ values (0::bigint) $$,
  'user B cannot update user A''s profile (0 rows affected)'
);

-- --------------------------------------------- signed in, no user id (34)
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select results_eq(
  $$ select count(*) from public.profiles $$,
  $$ values (0::bigint) $$,
  'authenticated role without a user id sees nothing'
);

-- ------------------------------------------------------- anonymous (35-36)
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;

select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon cannot read profiles');
select throws_ok(
  $$ update public.profiles set display_name = 'x' $$,
  '42501', null, 'anon cannot update profiles'
);

-- ------------------------------------------------------- as owner (37-42)
reset role;

select results_eq(
  $$ select id, display_name from public.profiles
     where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
     order by id $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid, 'Asha R'::text),
            ('22222222-2222-4222-8222-222222222222'::uuid, 'Bala'::text) $$,
  'cross-user update attempts left both profiles unchanged'
);

-- now() is fixed within a transaction, so backdate updated_at first to observe the bump.
alter table public.profiles disable trigger profiles_set_updated_at;
update public.profiles set updated_at = '2000-01-01' where id = '11111111-1111-4111-8111-111111111111';
alter table public.profiles enable trigger profiles_set_updated_at;
update public.profiles set display_name = 'Asha' where id = '11111111-1111-4111-8111-111111111111';
select is(
  (select updated_at from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  now(), 'updated_at is refreshed on update'
);

delete from auth.users where id = '44444444-4444-4444-8444-444444444444';
select is(
  (select count(*) from public.profiles where id = '44444444-4444-4444-8444-444444444444'),
  0::bigint, 'deleting the auth user deletes the profile'
);

-- Backfill: simulate auth users that exist without a profile (e.g. created before
-- the trigger) by removing two profiles, then run the migration's backfill again.
delete from public.profiles
where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
select is(public.backfill_missing_profiles(), 2, 'backfill creates the two missing profiles');
select results_eq(
  $$ select id, display_name, country, currency, time_zone from public.profiles
     where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
     order by id $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid, 'Asha Rao'::text, 'IN'::text, 'INR'::text, 'Asia/Kolkata'::text),
            ('22222222-2222-4222-8222-222222222222'::uuid, 'Bala'::text, 'IN'::text, 'INR'::text, 'Asia/Kolkata'::text) $$,
  'backfilled profiles get names from metadata and the default preferences'
);
select is(public.backfill_missing_profiles(), 0, 'backfill is idempotent (existing profiles untouched)');

select * from finish();
rollback;
