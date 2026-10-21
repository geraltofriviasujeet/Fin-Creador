-- Sprint 1 Step 2: user profiles.
--
-- One row per auth user, created automatically on sign-up. Holds display preferences
-- only (no money). Email stays in auth.users and is not duplicated here.
-- Defaults (India / INR / Asia/Kolkata) must match PROFILE_DEFAULTS in packages/schemas.
--
-- Access model:
--   * RLS: a signed-in user can read and update only their own row.
--   * Column grants: users may update only display_name, phone, country, currency, time_zone.
--     id, avatar_url, created_at and updated_at are not user-writable.
--   * No insert/delete for clients: rows are created by the sign-up trigger (plus a
--     one-time backfill for users who existed before it) and removed by ON DELETE
--     CASCADE when the auth user is deleted.

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  phone        text,
  avatar_url   text,
  country      text not null default 'IN',
  currency     text not null default 'INR',
  time_zone    text not null default 'Asia/Kolkata',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_display_name_length
    check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  -- E.164, same rule as phoneSchema in packages/schemas.
  constraint profiles_phone_e164
    check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint profiles_avatar_url_length
    check (avatar_url is null or char_length(avatar_url) <= 2048),
  -- ISO 3166-1 alpha-2 / ISO 4217 shape; the app validates against the full code lists.
  constraint profiles_country_format  check (country ~ '^[A-Z]{2}$'),
  constraint profiles_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint profiles_time_zone_length check (char_length(time_zone) between 1 and 64)
);

comment on table public.profiles is
  'Per-user profile and regional preferences. One row per auth.users row; user-owned, RLS-protected.';
comment on column public.profiles.time_zone is
  'IANA time zone used for day/week/month boundaries and reminders. Validated against pg_timezone_names.';

-- ---------------------------------------------------------------------------
-- Validation and bookkeeping triggers
-- ---------------------------------------------------------------------------

-- CHECK constraints cannot query catalogs, so the time zone is validated in a trigger.
create function public.profiles_validate_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'Unknown time zone: %', new.time_zone
      using errcode = '22023'; -- invalid_parameter_value
  end if;
  return new;
end;
$$;

create trigger profiles_validate_time_zone
  before insert or update of time_zone on public.profiles
  for each row execute function public.profiles_validate_time_zone();

create function public.profiles_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.profiles_set_updated_at();

-- ---------------------------------------------------------------------------
-- Create a profile for every new auth user
-- ---------------------------------------------------------------------------

-- Display name from sign-up metadata: our form sends display_name; Google sends
-- full_name / name. Blank values are skipped so the next key is used, and the result
-- is trimmed and capped at 80 characters so bad metadata can never block sign-up.
-- Returns null when no usable name exists.
create function public.profile_display_name(meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.left(coalesce(
    nullif(pg_catalog.btrim(meta ->> 'display_name'), ''),
    nullif(pg_catalog.btrim(meta ->> 'full_name'), ''),
    nullif(pg_catalog.btrim(meta ->> 'name'), '')
  ), 80));
$$;

-- SECURITY DEFINER so it can insert while the client has no INSERT privilege.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, public.profile_display_name(new.raw_user_meta_data));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Internal functions are not callable through the API.
revoke execute on function public.profile_display_name(jsonb) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.profiles_validate_time_zone() from public, anon, authenticated;
revoke execute on function public.profiles_set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and Row Level Security
-- ---------------------------------------------------------------------------

-- Supabase's default privileges grant everything on new public tables to anon and
-- authenticated. Start from nothing and grant only what the app needs.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, phone, country, currency, time_zone) on table public.profiles to authenticated;

alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Creates profiles for auth users that existed before the sign-up trigger (or lack one
-- for any other reason). Idempotent; returns the number of profiles created.
-- A function rather than an inline statement so the pgTAP tests can exercise it.
create function public.backfill_missing_profiles()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  created integer;
begin
  insert into public.profiles (id, display_name)
  select u.id, public.profile_display_name(u.raw_user_meta_data)
  from auth.users as u
  on conflict (id) do nothing;
  get diagnostics created = row_count;
  return created;
end;
$$;

revoke execute on function public.backfill_missing_profiles() from public, anon, authenticated;

select public.backfill_missing_profiles();
