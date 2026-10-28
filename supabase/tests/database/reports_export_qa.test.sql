-- QA pgTAP for the Reports CSV export (Sprint 8c). The export reads accounts, categories and
-- transactions with the person's own session, with the same filters the code builds (date range,
-- voided_at, account_id/counter_account_id or-filter, category_id, replaces_id lookup). Each read
-- must return only that person's rows, whatever filter or foreign id is supplied; a signed-out
-- caller reads none. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'exp-asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'exp-bala@example.test');

insert into public.accounts (id, user_id, kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('a9e00000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'bank', 'savings', 'A bank', 'INR', 0, current_date - 10),
  ('a9e00000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'cash', null, 'A cash', 'INR', 0, current_date - 10),
  ('b9e00000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'bank', 'savings', '=B bank', 'INR', 0, current_date - 10),
  ('b9e00000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'cash', null, 'B cash', 'INR', 0, current_date - 10);

create function pg_temp.cat(p_user uuid) returns uuid language sql stable as $$
  select c.id from public.categories as c where c.user_id = p_user and c.kind = 'expense' and c.archived_at is null order by c.name limit 1 $$;

insert into public.transactions (user_id, id, type, amount_minor, currency, account_id, counter_account_id, category_id, occurred_on, note, idempotency_key) values
  ('11111111-1111-4111-8111-111111111111', 'e9e00000-0000-4000-8000-0000000000a1', 'expense', 1000, 'INR', 'a9e00000-0000-4000-8000-000000000001', null, pg_temp.cat('11111111-1111-4111-8111-111111111111'), current_date - 1, 'A one', gen_random_uuid()),
  ('11111111-1111-4111-8111-111111111111', 'e9e00000-0000-4000-8000-0000000000a2', 'transfer', 500, 'INR', 'a9e00000-0000-4000-8000-000000000001', 'a9e00000-0000-4000-8000-000000000002', null, current_date - 1, 'A two', gen_random_uuid()),
  ('22222222-2222-4222-8222-222222222222', 'e9e00000-0000-4000-8000-0000000000b1', 'expense', 2000, 'INR', 'b9e00000-0000-4000-8000-000000000001', null, pg_temp.cat('22222222-2222-4222-8222-222222222222'), current_date - 1, '=B one', gen_random_uuid()),
  ('22222222-2222-4222-8222-222222222222', 'e9e00000-0000-4000-8000-0000000000b2', 'transfer', 700, 'INR', 'b9e00000-0000-4000-8000-000000000001', 'b9e00000-0000-4000-8000-000000000002', null, current_date - 1, 'B two', gen_random_uuid());

-- ------------------------------------------------------------ as A
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.transactions where occurred_on >= current_date - 5 and occurred_on <= current_date and voided_at is null), 2,
  'A, no filter: only A''s two entries');
select is((select count(*)::int from public.transactions where account_id = 'b9e00000-0000-4000-8000-000000000001' or counter_account_id = 'b9e00000-0000-4000-8000-000000000001'), 0,
  'A filtering by B''s account id (either side): nothing');
select is((select count(*)::int from public.transactions where category_id = pg_temp.cat('22222222-2222-4222-8222-222222222222')), 0,
  'A filtering by B''s category id: nothing');
select is((select count(*)::int from public.transactions where account_id = 'a9e00000-0000-4000-8000-000000000001' or counter_account_id = 'a9e00000-0000-4000-8000-000000000001'), 2,
  'A filtering by own account: both own entries (expense and transfer)');
select is((select count(*)::int from public.accounts where name like '%B %'), 0, 'A reads none of B''s account names');
select is((select count(*)::int from public.accounts), 2, 'A reads exactly own two accounts');
select is((select count(*)::int from public.categories where user_id <> '11111111-1111-4111-8111-111111111111'), 0, 'A reads none of B''s categories');
select is((select count(*)::int from public.transactions where replaces_id in ('e9e00000-0000-4000-8000-0000000000b1')), 0, 'replaces_id lookup with a foreign id: nothing');

-- ------------------------------------------------------------ as B
reset role;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
set local role authenticated;

select results_eq($$ select id from public.transactions order by id $$,
  $$ values ('e9e00000-0000-4000-8000-0000000000b1'::uuid), ('e9e00000-0000-4000-8000-0000000000b2'::uuid) $$, 'B, no filter: only B''s entries');
select is((select count(*)::int from public.transactions where account_id = 'a9e00000-0000-4000-8000-000000000001' or counter_account_id = 'a9e00000-0000-4000-8000-000000000002'), 0,
  'B filtering by A''s account ids: nothing');
select is((select count(*)::int from public.categories where user_id = '11111111-1111-4111-8111-111111111111'), 0, 'B reads none of A''s categories');
select is((select count(*)::int from public.accounts where user_id = '11111111-1111-4111-8111-111111111111'), 0, 'B reads none of A''s accounts');
-- The update must be the statement's top-level WITH (Postgres refuses it inside a subquery).
with u as (update public.transactions set voided_at = now() where id = 'e9e00000-0000-4000-8000-0000000000a1' returning 1)
select is((select count(*)::int from u), 0, 'B cannot void A''s entry (no row matches)');

-- ------------------------------------------------------------ signed out
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select count(*) from public.transactions $$, '42501', null, 'anon: transactions denied');
select throws_ok($$ select count(*) from public.accounts $$, '42501', null, 'anon: accounts denied');

reset role;
select * from finish();
rollback;
