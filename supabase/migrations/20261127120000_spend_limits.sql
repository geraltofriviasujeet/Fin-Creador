-- Daily spend limit (owner, decisions log 2026-11-24 "Daily spend limit" and "Daily spend limit:
-- final rule"; plan approved 2026-11-27). One overall spending cap a person chooses: an amount
-- for a period of 1 day, 1 week, 1 month or a custom number of days. Separate from the
-- monthly category budgets in Goals.
--
-- Rules:
--   * One limit per person (user_id is the primary key). It is a setting, not financial
--     history: removing the limit deletes the row.
--   * period / period_days: 'day' = 1, 'week' = 7, 'month' = null (the same day each month,
--     worked out in packages/domain), 'custom' = 2 to 365 days (1 day is 'day').
--   * starts_on (the first day of the first period) is set here, never by the client: the
--     person's local today on insert, and again when the period type, the custom day count or
--     the currency changes. A change of amount only keeps starts_on, so the current period
--     goes on (owner, 2026-11-27). Removing the limit and setting it again starts from today
--     (a new row).
--   * Currency is the profile currency on every write, set here, never by the client
--     (like budgets). Clients use the limit only when it matches the profile currency.
--   * The daily figure, the period's spending and what counts as spending are worked out in
--     packages/domain, not here.
--
-- Errors: none new (column grants refuse client-set starts_on, currency and user_id).

create table public.spend_limits (
  user_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  amount_minor bigint not null,
  currency     text not null,
  period       text not null,
  period_days  integer,
  starts_on    date not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint spend_limits_amount_range check (amount_minor > 0 and amount_minor <= 10000000000000),
  constraint spend_limits_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint spend_limits_period check (
    (period = 'day' and period_days = 1)
    or (period = 'week' and period_days = 7)
    or (period = 'month' and period_days is null)
    or (period = 'custom' and period_days between 2 and 365)
  ),
  constraint spend_limits_starts_on_range check (starts_on >= date '1970-01-01')
);

comment on table public.spend_limits is
  'A person''s overall spending limit: amount_minor per period (day, week, month or custom days), repeating from starts_on.';
comment on column public.spend_limits.starts_on is
  'First day of the first period, set by the database: local today on insert or when the period or currency changes.';

create function public.spend_limits_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.currency := coalesce(
    (select p.currency from public.profiles as p where p.id = new.user_id),
    'INR'
  );
  if tg_op = 'INSERT' then
    new.starts_on := public.user_local_today(new.user_id);
    new.created_at := pg_catalog.now();
    new.updated_at := pg_catalog.now();
  else
    -- user_id and created_at have no client update grant; kept as they were regardless.
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    if (new.period, new.period_days, new.currency) is distinct from (old.period, old.period_days, old.currency) then
      new.starts_on := public.user_local_today(new.user_id);
    else
      new.starts_on := old.starts_on;
    end if;
    new.updated_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

create trigger spend_limits_validate
  before insert or update on public.spend_limits
  for each row execute function public.spend_limits_validate();

-- Sets the signed-in person's limit: inserts it or changes it. SECURITY INVOKER: RLS, column
-- grants and the trigger apply. Repeating the same call gives the same row, so a double
-- submit is harmless.
create function public.set_spend_limit(
  p_amount_minor bigint,
  p_period text,
  p_period_days integer default null
)
returns public.spend_limits
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.spend_limits;
begin
  insert into public.spend_limits as s (amount_minor, period, period_days)
  values (p_amount_minor, p_period, p_period_days)
  on conflict (user_id)
  do update set amount_minor = excluded.amount_minor, period = excluded.period, period_days = excluded.period_days
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------

revoke all on table public.spend_limits from anon, authenticated;

grant select, delete on table public.spend_limits to authenticated;
grant insert (amount_minor, period, period_days) on table public.spend_limits to authenticated;
grant update (amount_minor, period, period_days) on table public.spend_limits to authenticated;

alter table public.spend_limits enable row level security;

create policy spend_limits_select_own on public.spend_limits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy spend_limits_insert_own on public.spend_limits
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy spend_limits_update_own on public.spend_limits
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy spend_limits_delete_own on public.spend_limits
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke execute on function public.spend_limits_validate() from public, anon, authenticated;
revoke execute on function public.set_spend_limit(bigint, text, integer) from public, anon;
grant execute on function public.set_spend_limit(bigint, text, integer) to authenticated;
