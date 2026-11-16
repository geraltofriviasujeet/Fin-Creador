-- Upgrade check for migration 20261116120000 (CI job "Migration upgrade check"), step 1: run on a
-- database migrated up to 20261115180000, before the new migration. Seeds users from before it:
-- P with the old default names untouched (and an entry on Other expenses), Q who renamed Health,
-- T with an own active "Transport & Cabs", and Y with an own "Money sent to people". Fictional users.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('5e000000-0000-4000-8000-000000000001', 'upgrade-upi-plain@example.test'),
  ('5e000000-0000-4000-8000-000000000002', 'upgrade-upi-renamed@example.test'),
  ('5e000000-0000-4000-8000-000000000003', 'upgrade-upi-own@example.test'),
  ('5e000000-0000-4000-8000-000000000004', 'upgrade-upi-sent@example.test');

update public.categories set name = 'Doctor visits'
 where user_id = '5e000000-0000-4000-8000-000000000002' and is_default and name = 'Health';
insert into public.categories (id, user_id, kind, name, icon) values
  ('5c000000-0000-4000-8000-000000000e03', '5e000000-0000-4000-8000-000000000003', 'expense', 'Transport & Cabs', 'transport'),
  ('5c000000-0000-4000-8000-000000000e04', '5e000000-0000-4000-8000-000000000004', 'expense', 'Money sent to people', 'other');

select set_config('request.jwt.claims', '{"sub": "5e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
  values ('bank', 'savings', 'Up Bank', 'INR', 1000000, public.user_local_today(auth.uid()) - 30);
select public.record_transaction('expense', 'a0000000-0000-4000-8000-0000000000e1', 59000, public.user_local_today(auth.uid()) - 2,
  (select id from public.accounts where name = 'Up Bank'),
  p_category_id => (select id from public.categories where kind = 'expense' and name = 'Other expenses'));
reset role;

create table public.upgrade_check_before as
  select c.user_id, count(*)::int as expense_categories,
         (select c2.id from public.categories as c2 where c2.user_id = c.user_id and c2.is_default and c2.icon = 'other' and c2.key is null) as misc_id
  from public.categories as c
  where c.user_id::text like '5e000000-%' and c.kind = 'expense'
  group by c.user_id;
commit;
