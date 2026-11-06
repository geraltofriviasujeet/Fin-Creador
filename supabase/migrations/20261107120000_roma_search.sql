-- Sprint 10.8: web lookups for trip and goal estimates (Tavily). The credit ledger behind the
-- search caps, on the same reserve-and-settle pattern as roma_usage.
--
-- Rules (docs/sprint-plan.md, 10.8 web research and decisions 2026-11-06):
--   * The search caps live in the one roma_settings row, beside the model caps, changed by the
--     owner in the SQL editor with no redeploy, e.g.
--       update public.roma_settings set search_enabled = false;
--     No cap comes from the caller or from the environment. SEARCH_ENABLED in the server's
--     environment stays the deploy switch; search_enabled here is the kill switch. Both must
--     be on, and roma_settings.enabled too, for any lookup.
--   * Credits: a basic search costs 1. At most 3 per question (search_reserve_credits), at
--     most search_monthly_credits for everyone in a UTC calendar month (900 of the free plan's
--     1,000; the rest covers the snippet measurement and drift between our month and
--     Tavily's), at most search_user_daily_credits for one person in their own day.
--   * Lookups belong to a question: roma_search_begin needs the caller's own open roma_usage
--     reservation (a question that already passed every model check), and a question gets at
--     most one search reservation. Rows hold no query, place or result text: only counts.
--   * Begin grants up to search_reserve_credits, fewer when the month or the person's day has
--     fewer left; the server runs at most the granted number of searches. On a refusal it
--     writes nothing.
--   * A reservation ends exactly once: roma_search_settle (searches were sent; a timed-out
--     search counts as sent) or roma_search_release (none was sent: counts as nothing). A
--     reservation never ended keeps counting at its reserved credits.
--   * No client can read or write the ledger; rows are written only by the three functions
--     below, on the caller's own rows. Deleting an account keeps its rows with user_id null,
--     so the month's count stays true.
--   * Accepted limitation: a person calling roma_search_settle directly can under-report
--     credits already spent (down to 1), as with roma_settle_request. It can't buy more
--     searches than begin granted, and the plan's own credit limit bounds it.
--
-- New error codes: none (bad arguments are 22023).

-- ---------------------------------------------------------------------------
-- Kill switch and caps, on the existing settings row
-- ---------------------------------------------------------------------------

alter table public.roma_settings
  add column search_enabled            boolean not null default true,
  -- Credits for everyone in a UTC calendar month.
  add column search_monthly_credits    integer not null default 900,
  -- Credits one person may use in their own day.
  add column search_user_daily_credits integer not null default 5,
  -- Credits reserved per question (one per search, searches run in parallel).
  add column search_reserve_credits    integer not null default 3,
  add constraint roma_settings_search_monthly check (search_monthly_credits between 0 and 100000),
  add constraint roma_settings_search_daily check (search_user_daily_credits between 0 and 100),
  add constraint roma_settings_search_reserve check (search_reserve_credits between 1 and 3);

comment on column public.roma_settings.search_enabled is
  'Kill switch for web lookups alone; questions still answer from the person''s records.';

-- ---------------------------------------------------------------------------
-- Credit ledger
-- ---------------------------------------------------------------------------

create table public.roma_search_usage (
  id               uuid primary key default gen_random_uuid(),
  -- The question these lookups belong to; one search reservation per question.
  request_id       uuid not null unique references public.roma_usage (id),
  user_id          uuid references auth.users (id) on delete set null,
  provider         text not null,
  status           text not null default 'reserved',
  reserved_credits integer not null,
  -- Set when settled (searches were sent); null otherwise.
  credits          integer,
  created_at       timestamptz not null default now(),
  ended_at         timestamptz,

  constraint roma_search_usage_provider check (provider ~ '^[a-z0-9_-]{1,32}$'),
  constraint roma_search_usage_status check (status in ('reserved', 'settled', 'released')),
  constraint roma_search_usage_reserved_range check (reserved_credits between 1 and 3),
  constraint roma_search_usage_credits_range check (
    credits is null or (credits between 1 and reserved_credits)
  ),
  constraint roma_search_usage_shape check (
    (status = 'reserved' and ended_at is null and credits is null)
    or (status = 'settled' and ended_at is not null and credits is not null)
    or (status = 'released' and ended_at is not null and credits is null)
  )
);

create index roma_search_usage_created_idx on public.roma_search_usage (created_at);
create index roma_search_usage_user_created_idx on public.roma_search_usage (user_id, created_at);

comment on table public.roma_search_usage is
  'Roma web lookup credits: one row per question that was granted lookups (counts only; no query or result text). Written only by roma_search_begin, roma_search_settle and roma_search_release. No client access.';

revoke all on table public.roma_search_usage from anon, authenticated, service_role;
-- RLS on with no policies: no client role can read it even with a grant.
alter table public.roma_search_usage enable row level security;

-- What a row counts toward the caps: a reservation at its reserved credits, a settled row at
-- the credits used, a release at nothing.
create function public.roma_search_counted(p_row public.roma_search_usage)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_row.status
    when 'reserved' then p_row.reserved_credits
    when 'settled' then p_row.credits
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
-- Begin: every check, then a reservation
-- ---------------------------------------------------------------------------

-- Every limit comes from roma_settings; the caller gives only the question's request id and
-- the provider name (a label for the ledger, checked by its constraint).
-- outcome: 'ok' (credits = searches allowed, 1 to 3) or a refusal, with credits 0 and
-- nothing written:
--   'disabled'     the kill switch or the search kill switch is off (or the row is missing)
--   'no_request'   the request id is not the caller's own open question, or it already has
--                  a search reservation
--   'monthly_cap'  this month's credits for everyone are used up
--   'daily_limit'  the person's credits for their own day are used up
create function public.roma_search_begin(p_request_id uuid, p_provider text)
returns table (outcome text, credits integer)
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
  v_month_used integer;
  v_today_used integer;
  v_grant integer;
begin
  if v_user is null then
    raise exception 'Sign in to ask Roma' using errcode = '42501';
  end if;

  -- One check at a time for everyone, so two questions can't both fit under a cap.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.roma_search_usage', 0));

  select * into v_settings from public.roma_settings as s where s.id;
  if not found or not v_settings.enabled or not v_settings.search_enabled then
    return query select 'disabled'::text, 0;
    return;
  end if;

  perform 1
    from public.roma_usage as u
   where u.id = p_request_id
     and u.user_id = v_user
     and u.status = 'reserved'
     and not exists (select 1 from public.roma_search_usage as r where r.request_id = u.id);
  if not found then
    return query select 'no_request'::text, 0;
    return;
  end if;

  select coalesce(sum(public.roma_search_counted(r)), 0)::integer into v_month_used
    from public.roma_search_usage as r
   where r.created_at >= v_month_start;
  if v_month_used >= v_settings.search_monthly_credits then
    return query select 'monthly_cap'::text, 0;
    return;
  end if;

  -- Same fallback as user_local_today, so a missing time zone can never switch the daily
  -- limit off. The 2-day bound only narrows the index scan; the local-date test decides.
  select coalesce(p.time_zone, 'UTC') into v_time_zone
    from public.profiles as p
   where p.id = v_user;
  v_time_zone := coalesce(v_time_zone, 'UTC');
  v_today := public.user_local_today(v_user);
  select coalesce(sum(public.roma_search_counted(r)), 0)::integer into v_today_used
    from public.roma_search_usage as r
   where r.user_id = v_user
     and r.created_at >= pg_catalog.now() - interval '2 days'
     and (r.created_at at time zone v_time_zone)::date = v_today;
  if v_today_used >= v_settings.search_user_daily_credits then
    return query select 'daily_limit'::text, 0;
    return;
  end if;

  v_grant := least(
    v_settings.search_reserve_credits,
    v_settings.search_monthly_credits - v_month_used,
    v_settings.search_user_daily_credits - v_today_used
  );

  insert into public.roma_search_usage (request_id, user_id, provider, reserved_credits)
  values (p_request_id, v_user, p_provider, v_grant);

  return query select 'ok'::text, v_grant;
end;
$$;

comment on function public.roma_search_begin(uuid, text) is
  'Roma web lookups: kill switches, the caller''s own open question, monthly and daily credit caps, all from roma_settings; on success reserves up to search_reserve_credits and returns how many searches may run. A refusal writes nothing.';

-- ---------------------------------------------------------------------------
-- End: settle (searches were sent) or release (none was)
-- ---------------------------------------------------------------------------

-- The credits used replace the reservation (1 to the reserved number). Only the caller's own
-- open reservation; false if there is none (already ended, someone else's, or unknown) or the
-- credits are more than were reserved.
create function public.roma_search_settle(p_request_id uuid, p_credits integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_credits is null or p_credits < 1 or p_credits > 3 then
    raise exception 'Invalid Roma search usage' using errcode = '22023';
  end if;

  update public.roma_search_usage as r
     set status = 'settled',
         credits = p_credits,
         ended_at = pg_catalog.now()
   where r.request_id = p_request_id
     and r.user_id = (select auth.uid())
     and r.status = 'reserved'
     and p_credits <= r.reserved_credits;
  return found;
end;
$$;

comment on function public.roma_search_settle(uuid, integer) is
  'Roma web lookups: searches were sent; records the credits used in place of the reservation (own open reservation only).';

-- No search was sent (the query failed the template checks, the place is not listed, or the
-- question ended first): the reservation counts as nothing.
create function public.roma_search_release(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.roma_search_usage as r
     set status = 'released',
         ended_at = pg_catalog.now()
   where r.request_id = p_request_id
     and r.user_id = (select auth.uid())
     and r.status = 'reserved';
  return found;
end;
$$;

comment on function public.roma_search_release(uuid) is
  'Roma web lookups: no search was sent; the reservation counts as nothing (own open reservation only).';

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.roma_search_counted(public.roma_search_usage) from public, anon, authenticated;

revoke execute on function public.roma_search_begin(uuid, text) from public, anon;
grant execute on function public.roma_search_begin(uuid, text) to authenticated;

revoke execute on function public.roma_search_settle(uuid, integer) from public, anon;
grant execute on function public.roma_search_settle(uuid, integer) to authenticated;

revoke execute on function public.roma_search_release(uuid) from public, anon;
grant execute on function public.roma_search_release(uuid) to authenticated;
