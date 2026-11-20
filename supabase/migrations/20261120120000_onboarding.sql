-- Before Sprint 12a: the first sign-in tour and the Get started checklist (tester feedback
-- 2026-11-20: "the app looks complicated, no tour").
--
-- 1. profiles.tour_done_at and profiles.getting_started_dismissed_at, per person, so they follow
--    the person across devices. Set like the consent columns: a trigger turns any value a client
--    sends into the database's now(); null is allowed (Settings → Replay the tour clears
--    tour_done_at). A client can write only these two columns (column-level UPDATE grant), and
--    only its own row (profiles_update_own).
--    Profiles that exist when this migration runs count the tour as done, so it doesn't pop up
--    for people already using the app. Profiles created later start with null (tour shows).
--    getting_started_dismissed_at is not backfilled: the checklist shows for existing people
--    unless all four items are already done (the app hides it then; nothing is written on render).
--
-- 2. upi_imports: one row per UPI statement import that saved at least one entry. The UPI save
--    path inserts it afterwards; a failed insert never fails the import. Imported entries can't
--    be told apart in transactions (their keys are UUID v5 hashes of the UPI reference), so this
--    small log is what "import a statement" reads. Owner-only; insert-only (saved_count > 0);
--    no update or delete. A person can only ever affect their own checklist with it.
--
-- 3. getting_started_status(): the four checklist answers for the signed-in person, from their
--    own data (invoker, so RLS applies; no user id argument). Each answer is false when unknown.
--      has_account    a money account (bank, cash or other; archived counts: it was added)
--      has_expense    a live (not deleted) expense
--      has_import     a upi_imports row
--      has_asked_roma an ai_messages row (each row is one turn and its question is always the
--                     person's; the table has no role column)
--
-- New error codes: none.

-- ---------------------------------------------------------------------------
-- 1. Tour and checklist times on the profile
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column tour_done_at timestamptz,
  add column getting_started_dismissed_at timestamptz;

comment on column public.profiles.tour_done_at is
  'When the person finished or skipped the first sign-in tour (database time). Null: show the tour.';
comment on column public.profiles.getting_started_dismissed_at is
  'When the person dismissed the Get started card on Overview (database time). Null: not dismissed.';

-- Only the rows that exist now. Runs before the trigger exists; now() is the migration's time.
update public.profiles set tour_done_at = pg_catalog.now() where tour_done_at is null;

grant update (tour_done_at, getting_started_dismissed_at) on table public.profiles to authenticated;

-- The stored time is always the database's: any value a client sends becomes now(), null is kept.
-- An unchanged value is left alone, so an update that repeats it doesn't move the time.
create function public.profiles_onboarding_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tour_done_at is not null
     and (tg_op = 'INSERT' or new.tour_done_at is distinct from old.tour_done_at) then
    new.tour_done_at := pg_catalog.now();
  end if;
  if new.getting_started_dismissed_at is not null
     and (tg_op = 'INSERT' or new.getting_started_dismissed_at is distinct from old.getting_started_dismissed_at) then
    new.getting_started_dismissed_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

create trigger profiles_onboarding_times
  before insert or update of tour_done_at, getting_started_dismissed_at on public.profiles
  for each row execute function public.profiles_onboarding_times();

revoke execute on function public.profiles_onboarding_times() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. UPI import log
-- ---------------------------------------------------------------------------

create table public.upi_imports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  saved_count integer not null,
  created_at  timestamptz not null default now(),

  constraint upi_imports_saved_count check (saved_count > 0)
);

create index upi_imports_user_idx on public.upi_imports (user_id);

comment on table public.upi_imports is
  'One row per UPI statement import that saved at least one entry (owner-only, insert-only). Read by getting_started_status.';

revoke all on table public.upi_imports from anon, authenticated;
grant select on table public.upi_imports to authenticated;
-- user_id and created_at come from their defaults; a client sends only the count.
grant insert (saved_count) on table public.upi_imports to authenticated;

alter table public.upi_imports enable row level security;

create policy upi_imports_select_own on public.upi_imports
  for select to authenticated using (user_id = (select auth.uid()));
create policy upi_imports_insert_own on public.upi_imports
  for insert to authenticated with check (user_id = (select auth.uid()) and saved_count > 0);

-- ---------------------------------------------------------------------------
-- 3. Checklist answers
-- ---------------------------------------------------------------------------

create function public.getting_started_status()
returns table (has_account boolean, has_expense boolean, has_import boolean, has_asked_roma boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(exists (select 1 from public.accounts as a
                      where a.user_id = (select auth.uid()) and a.kind in ('bank', 'cash', 'other')), false),
    coalesce(exists (select 1 from public.transactions as t
                      where t.user_id = (select auth.uid()) and t.type = 'expense' and t.voided_at is null), false),
    coalesce(exists (select 1 from public.upi_imports as u where u.user_id = (select auth.uid())), false),
    coalesce(exists (select 1 from public.ai_messages as m where m.user_id = (select auth.uid())), false)
$$;

comment on function public.getting_started_status() is
  'The Get started checklist for the signed-in person: account, expense, UPI import, Roma question. False when unknown.';

revoke execute on function public.getting_started_status() from public, anon;
grant execute on function public.getting_started_status() to authenticated;
