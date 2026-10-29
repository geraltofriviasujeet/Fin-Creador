-- Upgrade check for migration 20261029180000 (CI job "Migration upgrade check"), step 1: run on a
-- database migrated up to 20261029120000, before the new migration. Seeds three users from before
-- it: one with the usual 14 expense defaults, one with an active category of their own named
-- "Bank charges & interest" (with an entry on it), one with only an archived one. Fictional users.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('5b000000-0000-4000-8000-000000000001', 'upgrade-plain@example.test'),
  ('5b000000-0000-4000-8000-000000000002', 'upgrade-active@example.test'),
  ('5b000000-0000-4000-8000-000000000003', 'upgrade-archived@example.test');

insert into public.categories (id, user_id, kind, name, icon) values
  ('5c000000-0000-4000-8000-000000000002', '5b000000-0000-4000-8000-000000000002', 'expense', 'Bank charges & interest', 'other'),
  ('5c000000-0000-4000-8000-000000000003', '5b000000-0000-4000-8000-000000000003', 'expense', 'bank charges & interest', 'other');
update public.categories set archived_at = now() where id = '5c000000-0000-4000-8000-000000000003';

select set_config('request.jwt.claims', '{"sub": "5b000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
  values ('bank', 'savings', 'Up Bank', 'INR', 1000000, public.user_local_today(auth.uid()) - 30);
select public.record_transaction('expense', 'a0000000-0000-4000-8000-0000000000c1', 59000, public.user_local_today(auth.uid()) - 2,
  (select id from public.accounts where name = 'Up Bank'), p_category_id => '5c000000-0000-4000-8000-000000000002');
reset role;

create table public.upgrade_check_before as
  select c.user_id, count(*)::int as expense_categories
  from public.categories as c
  where c.user_id::text like '5b000000-%' and c.kind = 'expense'
  group by c.user_id;
commit;
