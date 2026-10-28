-- Upgrade check for migration 20261028210000 (CI job "Migration upgrade check"), step 1: run on a
-- database migrated up to 20261028180000 (Sprint 8b), before the new migration. Seeds one
-- borrowing with a due date, one without, and one with a due date that is repaid and archived.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('55555555-5555-4555-8555-555555555555', 'upgrade@example.test');
select set_config('request.jwt.claims', '{"sub": "55555555-5555-4555-8555-555555555555", "role": "authenticated"}', true);
set local role authenticated;

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
  values ('bank', 'savings', 'Up Bank', 'INR', 1000000, public.user_local_today(auth.uid()) - 30);

select public.create_borrowing('a0000000-0000-4000-8000-000000000001', 'Due Person', 200000,
  p_received_account_id => (select id from public.accounts where name = 'Up Bank'),
  p_received_on => public.user_local_today(auth.uid()) - 1,
  p_due_date => public.user_local_today(auth.uid()) + 30);
select public.create_borrowing('a0000000-0000-4000-8000-000000000002', 'Plain Person', 50000);
select public.create_borrowing('a0000000-0000-4000-8000-000000000003', 'Done Person', 30000,
  p_due_date => public.user_local_today(auth.uid()) + 10);
select public.repay_borrowing((select id from public.borrowings where lender = 'Done Person'), 'a0000000-0000-4000-8000-0000000000b1',
  (select id from public.accounts where name = 'Up Bank'), public.user_local_today(auth.uid()), 30000);
select public.set_borrowing_archived((select id from public.borrowings where lender = 'Done Person'), true);

reset role;
create table public.upgrade_check_before as
  select b.id, b.lender, b.archived_at, d.due_date, d.status
  from public.borrowings as b left join public.due_items as d on d.borrowing_id = b.id;
commit;
