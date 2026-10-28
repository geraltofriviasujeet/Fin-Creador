-- Sprint 8c: account balances as of past dates, for the month-end net worth trend on Reports.
--
-- Rules (docs/sprint-plan.md, Sprint 8c decisions 2026-10-29):
--   * Same posting rule as the account_balances view: an entry counts when it is not voided
--     and is dated on or after the account's opening-balance date; here also on or before the
--     as-of date. Balance = opening balance + inflows − outflows (a liability account: minus
--     what is owed). Voided entries never count in any month ("as corrected"): an edit voids
--     the old version, so only the current version counts.
--   * The dates are the person's own calendar dates (the client sends month-ends in the
--     profile time zone). An account counts from its opening-balance date up to the day
--     before it was archived: archived_at is turned into a local date with the profile time
--     zone, and on that date and later the account is left out.
--   * Every account kind is returned (money and liability); the client decides what counts.
--   * At most 120 dates per call (10 years of month-ends); each date from 1900-01-01 to
--     today + 1 in the person's time zone (no future balances).
--
-- No new tables, policies or grants beyond execute for signed-in users; security invoker,
-- so row level security on accounts, transactions and profiles applies: a caller only ever
-- sees their own accounts and entries.

create function public.account_balances_at(p_dates date[])
returns table (
  as_of date,
  account_id uuid,
  balance_minor bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_today date;
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if p_dates is null or pg_catalog.cardinality(p_dates) = 0 then
    raise exception 'At least one date is required' using errcode = '22023';
  end if;
  if pg_catalog.cardinality(p_dates) > 120 then
    raise exception 'At most 120 dates' using errcode = '22023';
  end if;
  if pg_catalog.array_position(p_dates, null) is not null then
    raise exception 'Dates must not be empty' using errcode = '22023';
  end if;

  select coalesce((select p.time_zone from public.profiles as p where p.id = v_uid), 'UTC') into v_tz;
  v_today := (pg_catalog.now() at time zone v_tz)::date;
  if exists (select 1 from pg_catalog.unnest(p_dates) as d(day) where d.day < date '1900-01-01' or d.day > v_today + 1) then
    raise exception 'Dates must be from 1900-01-01 to today' using errcode = '22023';
  end if;

  return query
    with days as (
      select distinct d.day from pg_catalog.unnest(p_dates) as d(day)
    ),
    live as (
      -- Each account on each date it counts: opened by then, not yet archived (local date).
      select d.day, a.id, a.opening_balance_minor, a.opening_balance_date
      from days as d
      join public.accounts as a
        on a.user_id = v_uid
       and a.opening_balance_date <= d.day
       and (a.archived_at is null or (a.archived_at at time zone v_tz)::date > d.day)
    )
    select
      l.day,
      l.id,
      (l.opening_balance_minor
        + coalesce(sum(t.amount_minor) filter (
            where t.type = 'income' or (t.type = 'transfer' and t.counter_account_id = l.id)), 0)
        - coalesce(sum(t.amount_minor) filter (
            where t.type = 'expense' or (t.type = 'transfer' and t.account_id = l.id)), 0)
      )::bigint
    from live as l
    left join public.transactions as t
      on (t.account_id = l.id or t.counter_account_id = l.id)
     and t.voided_at is null
     and t.occurred_on >= l.opening_balance_date
     and t.occurred_on <= l.day
    group by l.day, l.id, l.opening_balance_minor
    order by 1, 2;
end;
$$;

comment on function public.account_balances_at(date[]) is
  'Balance of each of the caller''s accounts on each given local date (opening + posted inflows - outflows up to that date, voided excluded), from the opening-balance date until the archive date. At most 120 dates.';

revoke execute on function public.account_balances_at(date[]) from public, anon;
grant execute on function public.account_balances_at(date[]) to authenticated;
