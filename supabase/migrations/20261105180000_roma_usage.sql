-- Sprint 10.1: Roma, the assistant. Opt-in, a kill switch, and the spend ledger behind the
-- budget caps.
--
-- Rules (docs/sprint-plan.md, Sprint 10 and decisions 2026-11-05):
--   * Roma is off for everyone until the person turns her on in Settings (profiles.roma_enabled,
--     default false). roma_descriptions_ok_at records when they agreed, in Roma, to transaction
--     descriptions being sent (used from step 10.2). A trigger makes it a real consent record:
--     any value a client sends becomes now(), null withdraws it, and turning Roma off clears it.
--   * One row in roma_settings holds the kill switch, the caps and the reservation amount. The
--     owner changes them in the SQL editor, with no redeploy, e.g.
--       update public.roma_settings set enabled = false;
--     No client can read or change it, and roma_begin_request reads every limit from it: no
--     cap or amount comes from the caller. A missing row counts as off.
--   * roma_usage is the spend ledger: one row per question that passed every check. No client
--     can read or write it; rows are written only by the three functions below, which act on
--     the caller's own rows. Rows hold no question or answer text, only the model, token
--     counts and cost. Deleting an account keeps its rows with user_id null, so the month's
--     global spend stays true.
--   * roma_begin_request runs every check in one place, under a lock so two questions at
--     once can't both pass a cap: kill switch, opt-in, global monthly cap, the person's
--     monthly cap, the person's daily request limit. On success it reserves the worst-case
--     cost and returns the request id; on a refusal it writes nothing, so a refused question
--     consumes no budget and no daily allowance.
--   * A reservation ends exactly once: roma_settle_request (a provider call was made: the
--     real tokens and cost replace the reservation; the real cost is normally lower) or
--     roma_release_request (no provider call was made: counts as nothing). A reservation never
--     ended (the server stopped mid-way) keeps counting at its reserved cost.
--   * The API route is the only code that calls a provider, and it always calls
--     roma_begin_request first. A person calling the function directly gets the same limits:
--     at most their own monthly cap and daily limit of reservations, never the global budget
--     beyond their share.
--   * Months are calendar months in UTC (how the provider bills). The daily limit uses the
--     person's own day (profile time zone, user_local_today).
--
-- New error codes: none (bad arguments are 22023).

-- ---------------------------------------------------------------------------
-- Opt-in on the profile
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column roma_enabled boolean not null default false,
  add column roma_descriptions_ok_at timestamptz,
  add constraint profiles_roma_descriptions_need_roma
    check (roma_descriptions_ok_at is null or roma_enabled);

comment on column public.profiles.roma_enabled is
  'The person turned Roma on in Settings. Off by default; nothing is sent to a model while off.';
comment on column public.profiles.roma_descriptions_ok_at is
  'When the person agreed, in Roma, to transaction descriptions being sent. Cleared when Roma is turned off.';

grant update (roma_enabled, roma_descriptions_ok_at) on table public.profiles to authenticated;

-- The consent time is the server's: a client may only give consent (any value becomes now())
-- or withdraw it (null). Turning Roma off withdraws it, so the check above always holds.
create function public.profiles_roma_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.roma_enabled then
    new.roma_descriptions_ok_at := null;
  elsif new.roma_descriptions_ok_at is not null
        and (tg_op = 'INSERT' or new.roma_descriptions_ok_at is distinct from old.roma_descriptions_ok_at) then
    new.roma_descriptions_ok_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

create trigger profiles_roma_consent
  before insert or update of roma_enabled, roma_descriptions_ok_at on public.profiles
  for each row execute function public.profiles_roma_consent();

-- ---------------------------------------------------------------------------
-- Kill switch, caps and reservation: one row
-- ---------------------------------------------------------------------------

create table public.roma_settings (
  id                      boolean primary key default true,
  enabled                 boolean not null default true,
  -- Spend for everyone in a UTC calendar month.
  monthly_budget_usd      numeric(12, 6) not null default 5,
  -- Spend for one person in a UTC calendar month.
  user_monthly_budget_usd numeric(12, 6) not null default 1,
  -- Questions one person may ask in their own day (released ones don't count).
  user_daily_requests     integer not null default 50,
  -- Reserved per question until it is settled or released: above the worst case of one
  -- question (4 model rounds within the prompt and output bounds, about $0.008).
  reserve_usd             numeric(12, 6) not null default 0.01,
  updated_at              timestamptz not null default now(),

  constraint roma_settings_one_row check (id),
  constraint roma_settings_budgets check (
    monthly_budget_usd between 0 and 1000 and user_monthly_budget_usd between 0 and 1000
  ),
  constraint roma_settings_daily check (user_daily_requests between 0 and 1000),
  constraint roma_settings_reserve check (reserve_usd > 0 and reserve_usd <= 0.05)
);

comment on table public.roma_settings is
  'Roma kill switch, caps and per-question reservation (one row), changed by the owner in the SQL editor. Set enabled = false to stop every question at once. No client access.';

create trigger roma_settings_set_updated_at
  before update on public.roma_settings
  for each row execute function public.set_updated_at();

insert into public.roma_settings (id) values (true) on conflict (id) do nothing;

revoke all on table public.roma_settings from anon, authenticated, service_role;
-- RLS on with no policies: no client role can read it even with a grant.
alter table public.roma_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Spend ledger
-- ---------------------------------------------------------------------------

create table public.roma_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users (id) on delete set null,
  provider      text not null,
  model         text not null,
  status        text not null default 'reserved',
  reserved_usd  numeric(12, 6) not null,
  -- Set when settled (a provider call was made); null otherwise.
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(12, 6),
  created_at    timestamptz not null default now(),
  ended_at      timestamptz,

  constraint roma_usage_provider check (provider ~ '^[a-z0-9_-]{1,32}$'),
  constraint roma_usage_model check (model ~ '^[a-z0-9._-]{1,64}$'),
  constraint roma_usage_status check (status in ('reserved', 'settled', 'released')),
  -- Worst case for one question is well under a cent; 5 cents is a hard ceiling.
  constraint roma_usage_reserved_range check (reserved_usd > 0 and reserved_usd <= 0.05),
  constraint roma_usage_tokens_range check (
    (input_tokens is null or input_tokens between 0 and 10000000)
    and (output_tokens is null or output_tokens between 0 and 10000000)
  ),
  constraint roma_usage_cost_range check (cost_usd is null or (cost_usd >= 0 and cost_usd <= 1)),
  constraint roma_usage_shape check (
    (status = 'reserved' and ended_at is null and cost_usd is null and input_tokens is null and output_tokens is null)
    or (status = 'settled' and ended_at is not null and cost_usd is not null and input_tokens is not null and output_tokens is not null)
    or (status = 'released' and ended_at is not null and cost_usd is null and input_tokens is null and output_tokens is null)
  )
);

create index roma_usage_created_idx on public.roma_usage (created_at);
create index roma_usage_user_created_idx on public.roma_usage (user_id, created_at);

comment on table public.roma_usage is
  'Roma spend ledger: one row per question that passed the checks (model, tokens, cost; no text). Written only by roma_begin_request, roma_settle_request and roma_release_request. No client access.';

revoke all on table public.roma_usage from anon, authenticated, service_role;
-- RLS on with no policies: no client role can read it even with a grant.
alter table public.roma_usage enable row level security;

-- What a row counts toward the caps: a reservation at its reserved cost, a settled call at
-- its real cost, a release at nothing.
create function public.roma_counted_usd(p_row public.roma_usage)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_row.status
    when 'reserved' then p_row.reserved_usd
    when 'settled' then p_row.cost_usd
    else 0::numeric
  end;
$$;

-- ---------------------------------------------------------------------------
-- Begin: every check, then a reservation
-- ---------------------------------------------------------------------------

-- Every limit comes from roma_settings; the caller gives only the provider and model names
-- (labels for the ledger, checked by its constraints).
-- outcome: 'ok' (request_id set) or a refusal, with request_id null and nothing written:
--   'disabled'      the kill switch is off (or its row is missing)
--   'not_enabled'   the person has not turned Roma on
--   'global_budget' this month's spend for everyone would pass monthly_budget_usd
--   'user_budget'   this month's spend for the person would pass user_monthly_budget_usd
--   'daily_limit'   the person has asked user_daily_requests questions today (their own day)
create function public.roma_begin_request(p_provider text, p_model text)
returns table (outcome text, request_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_settings public.roma_settings;
  v_month_start timestamptz := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC') at time zone 'UTC';
  v_time_zone text;
  v_today date;
  v_global numeric;
  v_mine numeric;
  v_today_count integer;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Sign in to ask Roma' using errcode = '42501';
  end if;

  -- One check at a time for everyone, so two questions can't both fit under a cap.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.roma_usage', 0));

  select * into v_settings from public.roma_settings as s where s.id;
  if not found or not v_settings.enabled then
    return query select 'disabled'::text, null::uuid;
    return;
  end if;

  -- Same fallback as user_local_today, so a missing time zone can never switch the daily
  -- limit off (a null date comparison would count nothing).
  select coalesce(p.time_zone, 'UTC') into v_time_zone
    from public.profiles as p
   where p.id = v_user and p.roma_enabled;
  if not found then
    return query select 'not_enabled'::text, null::uuid;
    return;
  end if;

  select coalesce(sum(public.roma_counted_usd(u)), 0) into v_global
    from public.roma_usage as u
   where u.created_at >= v_month_start;
  if v_global + v_settings.reserve_usd > v_settings.monthly_budget_usd then
    return query select 'global_budget'::text, null::uuid;
    return;
  end if;

  select coalesce(sum(public.roma_counted_usd(u)), 0) into v_mine
    from public.roma_usage as u
   where u.user_id = v_user and u.created_at >= v_month_start;
  if v_mine + v_settings.reserve_usd > v_settings.user_monthly_budget_usd then
    return query select 'user_budget'::text, null::uuid;
    return;
  end if;

  -- Released rows (no provider call) don't use up the day's questions. The 2-day bound only
  -- narrows the index scan; the local-date test decides.
  v_today := public.user_local_today(v_user);
  select count(*)::integer into v_today_count
    from public.roma_usage as u
   where u.user_id = v_user
     and u.status <> 'released'
     and u.created_at >= pg_catalog.now() - interval '2 days'
     and (u.created_at at time zone v_time_zone)::date = v_today;
  if v_today_count >= v_settings.user_daily_requests then
    return query select 'daily_limit'::text, null::uuid;
    return;
  end if;

  insert into public.roma_usage (user_id, provider, model, reserved_usd)
  values (v_user, p_provider, p_model, v_settings.reserve_usd)
  returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$$;

comment on function public.roma_begin_request(text, text) is
  'Roma: kill switch, opt-in, global and personal monthly caps, daily limit, all from roma_settings; on success reserves roma_settings.reserve_usd. A refusal writes nothing.';

-- ---------------------------------------------------------------------------
-- End: settle (a provider call was made) or release (none was)
-- ---------------------------------------------------------------------------

-- The real tokens and cost replace the reservation (normally lower than it). Only the
-- caller's own open reservation; false if there is none (already ended, someone else's, or
-- unknown).
create function public.roma_settle_request(
  p_request_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_usd numeric
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_input_tokens is null or p_input_tokens < 0
     or p_output_tokens is null or p_output_tokens < 0
     or p_cost_usd is null or p_cost_usd < 0 or p_cost_usd > 1 then
    raise exception 'Invalid Roma usage' using errcode = '22023';
  end if;

  update public.roma_usage as u
     set status = 'settled',
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         cost_usd = p_cost_usd,
         ended_at = pg_catalog.now()
   where u.id = p_request_id
     and u.user_id = (select auth.uid())
     and u.status = 'reserved';
  return found;
end;
$$;

comment on function public.roma_settle_request(uuid, integer, integer, numeric) is
  'Roma: a provider call was made; records its real tokens and cost in place of the reservation (own open reservation only).';

-- No provider call was made (bad input, a check after the reservation failed, or the
-- provider could not be reached before sending): the reservation counts as nothing.
create function public.roma_release_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.roma_usage as u
     set status = 'released',
         ended_at = pg_catalog.now()
   where u.id = p_request_id
     and u.user_id = (select auth.uid())
     and u.status = 'reserved';
  return found;
end;
$$;

comment on function public.roma_release_request(uuid) is
  'Roma: no provider call was made; the reservation counts as nothing (own open reservation only).';

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.roma_counted_usd(public.roma_usage) from public, anon, authenticated;
revoke execute on function public.profiles_roma_consent() from public, anon, authenticated;

revoke execute on function public.roma_begin_request(text, text) from public, anon;
grant execute on function public.roma_begin_request(text, text) to authenticated;

revoke execute on function public.roma_settle_request(uuid, integer, integer, numeric) from public, anon;
grant execute on function public.roma_settle_request(uuid, integer, integer, numeric) to authenticated;

revoke execute on function public.roma_release_request(uuid) from public, anon;
grant execute on function public.roma_release_request(uuid) to authenticated;
