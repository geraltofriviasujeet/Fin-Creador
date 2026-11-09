-- Sprint 10.9 follow-up: how many web lookups the caller has left, so the plan intake can say
-- so before the person fills it in ("Only 1 web lookup left today; a plan needs 2") instead of
-- spending the last credits on a plan that then shows "No estimate".
--
-- Rules:
--   * Read only: reserves nothing and writes nothing. roma_search_begin still decides at the
--     moment a lookup is sent; this is advice for the intake, and may be stale a moment later.
--   * The same kill switches and caps as roma_search_begin (20261107180000_roma_plans.sql), in
--     the same order: disabled, then the monthly cap, then the caller's own day. A reservation
--     still open counts at its reserved credits, as there (roma_search_counted).
--   * Only the caller's own figure comes back: what they may still use, the lesser of their
--     day's and the month's credits left, and which of the two it is ('day' or 'month'), so
--     the intake can say when it resets.
--   * When the month is the limiting factor, the credits returned reveal aggregate usage across
--     all users (the month's credits left). This is intentional and carries no personal data.
--   * The caller's day is their own time zone's, with the same UTC fallback as
--     user_local_today, so a missing time zone can never switch the daily limit off.
--   * Signed-in users only; no change to earlier migrations.

create function public.roma_search_remaining()
returns table (outcome text, credits integer, limited_by text)
language plpgsql
stable
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
begin
  if v_user is null then
    raise exception 'Sign in to ask Roma' using errcode = '42501';
  end if;

  select * into v_settings from public.roma_settings as s where s.id;
  if not found or not v_settings.enabled or not v_settings.search_enabled then
    return query select 'disabled'::text, 0, null::text;
    return;
  end if;

  select coalesce(sum(public.roma_search_counted(r)), 0)::integer into v_month_used
    from public.roma_search_usage as r
   where r.created_at >= v_month_start;
  if v_month_used >= v_settings.search_monthly_credits then
    return query select 'monthly_cap'::text, 0, 'month'::text;
    return;
  end if;

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
    return query select 'daily_limit'::text, 0, 'day'::text;
    return;
  end if;

  -- The day decides on a tie: it resets first.
  return query select 'ok'::text,
    least(v_settings.search_monthly_credits - v_month_used, v_settings.search_user_daily_credits - v_today_used),
    case
      when v_settings.search_monthly_credits - v_month_used < v_settings.search_user_daily_credits - v_today_used then 'month'
      else 'day'
    end;
end;
$$;

comment on function public.roma_search_remaining() is
  'Roma web lookups the caller may still use (the lesser of their day''s and the month''s credits left, and which it is), with the same switches and caps as roma_search_begin, read only. Advice for the plan intake; roma_search_begin decides.';

revoke all on function public.roma_search_remaining() from public, anon;
grant execute on function public.roma_search_remaining() to authenticated;
