-- Welcome on every sign-in (owner review 2026-11-20): the welcome carousel shows after each
-- sign-in unless the person ticked "Don't show this again" (or turned off Settings → "Show the
-- welcome when I sign in"). The profile column that said "tour done" now says "welcome hidden".
--
-- 1. profiles.tour_done_at is renamed welcome_hidden_at. A rename keeps the column's identity, so
--    the column-level UPDATE grant to authenticated and the trigger's column list
--    (before insert or update of ...) follow it; both are checked in pgTAP.
-- 2. profiles_onboarding_times() is recreated to use the new name. Same rules as before: any value
--    a client sends becomes the database's now(), null is kept, an unchanged value is left alone.
-- 3. The comment is rewritten for the new meaning.
-- 4. Every row is set to null: nobody has opted out yet (the old backfill meant "tour done", not
--    "don't show me the welcome").
--
-- Migration 20261120120000_onboarding.sql is already applied on dev and is not edited.
-- New error codes: none.

alter table public.profiles rename column tour_done_at to welcome_hidden_at;

comment on column public.profiles.welcome_hidden_at is
  'When the person chose not to see the welcome at sign-in (database time). Null: show it after each sign-in.';

create or replace function public.profiles_onboarding_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.welcome_hidden_at is not null
     and (tg_op = 'INSERT' or new.welcome_hidden_at is distinct from old.welcome_hidden_at) then
    new.welcome_hidden_at := pg_catalog.now();
  end if;
  if new.getting_started_dismissed_at is not null
     and (tg_op = 'INSERT' or new.getting_started_dismissed_at is distinct from old.getting_started_dismissed_at) then
    new.getting_started_dismissed_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

-- create or replace keeps the earlier revoke; stated again so this file reads on its own.
revoke execute on function public.profiles_onboarding_times() from public, anon, authenticated;

update public.profiles set welcome_hidden_at = null where welcome_hidden_at is not null;
