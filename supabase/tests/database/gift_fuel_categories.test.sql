-- pgTAP tests for the Gift and Fuel default expense categories (migration 20261115180000):
-- sign-up, the backfill for users from before the migration (create; adopt an active
-- same-name category; adopt an archived one, which stays archived), re-runs that change
-- nothing, and that they can be archived. Users are fictional. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- N: new. X: from before the migration, no Gift or Fuel. S: own active " gift " and "FUEL".
-- R: own archived "Gift" only.
insert into auth.users (id, email) values
  ('6f000000-0000-4000-8000-000000000001', 'gf-neha@example.test'),
  ('6f000000-0000-4000-8000-000000000002', 'gf-xavier@example.test'),
  ('6f000000-0000-4000-8000-000000000003', 'gf-sana@example.test'),
  ('6f000000-0000-4000-8000-000000000004', 'gf-ravi@example.test');

create function pg_temp.named(p_user uuid, p_name text) returns integer language sql stable
  as $$ select count(*)::int from public.categories as c
        where c.user_id = p_user and c.kind = 'expense' and lower(btrim(c.name)) = lower(p_name) $$;
create function pg_temp.keyed(p_user uuid, p_key text) returns uuid language sql stable
  as $$ select c.id from public.categories as c where c.user_id = p_user and c.key = p_key $$;

-- ------------------------------------------------------------ keys and sign-up (1-5)
select ok(
  (select pg_get_constraintdef(oid) like '%gift%' and pg_get_constraintdef(oid) like '%fuel%'
   from pg_constraint where conname = 'categories_key'),
  'categories_key allows gift and fuel'
);
select throws_ok(
  $$ insert into public.categories (user_id, kind, name, key)
     values ('6f000000-0000-4000-8000-000000000001', 'expense', 'Petrol', 'petrol') $$,
  '23514', null, 'an unknown key is refused'
);
select results_eq(
  $$ select key, name, icon, is_default, archived_at is null, system_key is null from public.categories
     where user_id = '6f000000-0000-4000-8000-000000000001' and key in ('gift', 'fuel') order by key $$,
  $$ values ('fuel'::text, 'Fuel'::text, 'fuel'::text, true, true, true), ('gift', 'Gift', 'gift', true, true, true) $$,
  'sign-up creates Gift and Fuel (own icons, default, active, not system categories)'
);
select is(
  (select count(*)::int from public.categories where user_id = '6f000000-0000-4000-8000-000000000001' and kind = 'expense'),
  19, 'a new user has 19 expense defaults'
);
select is(public.ensure_default_expense_categories('6f000000-0000-4000-8000-000000000001'), 0, 'the defaults again create nothing');

-- ------------------------------------------------------------ users from before the migration (6-12)
delete from public.categories where key in ('gift', 'fuel') and user_id in (
  '6f000000-0000-4000-8000-000000000002', '6f000000-0000-4000-8000-000000000003', '6f000000-0000-4000-8000-000000000004');
insert into public.categories (id, user_id, kind, name, icon) values
  ('6c000000-0000-4000-8000-000000000031', '6f000000-0000-4000-8000-000000000003', 'expense', ' gift ', 'other'),
  ('6c000000-0000-4000-8000-000000000032', '6f000000-0000-4000-8000-000000000003', 'expense', 'FUEL', 'transport'),
  ('6c000000-0000-4000-8000-000000000041', '6f000000-0000-4000-8000-000000000004', 'expense', 'Gift', 'other');
-- (The categories trigger clears archived_at on insert, so archive with an update.)
update public.categories set archived_at = now() where id = '6c000000-0000-4000-8000-000000000041';

select is(public.backfill_default_expense_categories(), 3, 'the backfill creates Gift and Fuel for X and Fuel for R; S and R adopt theirs');
select ok(
  pg_temp.keyed('6f000000-0000-4000-8000-000000000002', 'gift') is not null
  and pg_temp.keyed('6f000000-0000-4000-8000-000000000002', 'fuel') is not null,
  'X gets both'
);
select results_eq(
  $$ select id, name, icon, archived_at is null from public.categories
     where user_id = '6f000000-0000-4000-8000-000000000003' and key in ('gift', 'fuel') order by key $$,
  $$ values ('6c000000-0000-4000-8000-000000000032'::uuid, 'FUEL'::text, 'transport'::text, true),
            ('6c000000-0000-4000-8000-000000000031', ' gift ', 'other', true) $$,
  'S''s own active categories take the keys and keep their names and icons'
);
select ok(
  pg_temp.named('6f000000-0000-4000-8000-000000000003', 'gift') = 1 and pg_temp.named('6f000000-0000-4000-8000-000000000003', 'fuel') = 1,
  'S has no duplicates'
);
select is(pg_temp.keyed('6f000000-0000-4000-8000-000000000004', 'gift'), '6c000000-0000-4000-8000-000000000041'::uuid,
  'R''s archived Gift takes the key');
select ok((select archived_at is not null from public.categories where id = '6c000000-0000-4000-8000-000000000041'),
  'and stays archived');
select is(pg_temp.named('6f000000-0000-4000-8000-000000000004', 'gift'), 1, 'R has no second Gift');

-- ------------------------------------------------------------ re-runs (13-14)
create temporary table gf_before as
  select id, user_id, name, icon, key, archived_at, updated_at from public.categories;
select is(public.backfill_default_expense_categories(), 0, 'running the backfill again creates nothing');
select set_eq(
  $$ select id, user_id, name, icon, key, archived_at, updated_at from public.categories $$,
  $$ select * from gf_before $$,
  'and changes no category'
);

-- ------------------------------------------------------------ the owner can archive them (15-16)
select set_config('request.jwt.claims', '{"sub": "6f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$ update public.categories set archived_at = now() where key = 'gift' $$,
  'Gift can be archived (not a system category)'
);
select throws_ok(
  $$ update public.categories set key = 'fuel' where key = 'gift' $$,
  '42501', null, 'a client cannot set a category key'
);
reset role;

select * from finish();
rollback;
