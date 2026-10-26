-- Sprint 6: goals (planned expenses) and monthly category budgets.
--
-- Rules (docs/sprint-plan.md, Sprint 6 decisions 2026-10-26):
--   * A goal's saved amount is entered by the person; it is not linked to any account and
--     never changes a balance or Total available.
--   * The goal's answers live in `details`, a JSON object (size capped here) whose shape per
--     type is validated in packages/schemas (goal-forms.ts) on every write and every read.
--     The target amount is derived from the answers in packages/domain (goalFigures), except
--     for 'other', where it is entered; 0 is allowed (e.g. a no-cost EMI: nothing upfront).
--   * A goal's type, currency and request key never change. Goals are archived, never
--     deleted by clients; an archived goal can't be edited until it is restored.
--   * Budgets: one row per category and month it applies from (effective_from is the 1st).
--     The latest row at or before a month applies (packages/domain budgetsForMonth); an
--     amount of 0 ends the budget from that month on. Rows start this month or later, in the
--     person's time zone, and past rows never change, so past months keep their budget.
--   * Budgets are for expense categories. An archived category can only get 0 (ending it).
--   * Currency is the profile currency at the time of writing, set here, never by the
--     client. A goal keeps the currency it was created in; a budget row takes the profile
--     currency on every write. Clients show and add up only rows in the profile currency
--     (like the dashboard); a budget in an old currency asks for a new amount.
--     Spending per category comes from dashboard_breakdown (Sprint 5).
--
-- Errors: FC009 (field can't change), FC024 (goal archived), FC025 (budget month in the
-- past), FC026 (category can't have a budget).

-- ---------------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------------

create table public.goals (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type                text not null,
  name                text not null,
  target_amount_minor bigint not null,
  saved_amount_minor  bigint not null default 0,
  currency            text not null,
  target_date         date,
  details             jsonb not null,
  archived_at         timestamptz,
  idempotency_key     uuid not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint goals_type check (type in ('trip', 'car', 'house', 'furniture', 'electronics', 'mobile', 'other')),
  constraint goals_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint goals_target_range check (target_amount_minor >= 0 and target_amount_minor <= 10000000000000),
  constraint goals_saved_range check (saved_amount_minor >= 0 and saved_amount_minor <= 10000000000000),
  constraint goals_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint goals_target_date_range check (target_date is null or target_date between date '1970-01-01' and date '2199-12-31'),
  -- Object only; packages/schemas caps the compact JSON at 4,096 bytes, the text form
  -- here has extra spaces, so the database allows twice that.
  constraint goals_details_object check (jsonb_typeof(details) = 'object'),
  constraint goals_details_size check (octet_length(details::text) <= 8192),
  constraint goals_idempotency_unique unique (user_id, idempotency_key)
);

create index goals_user_idx on public.goals (user_id, target_date) where archived_at is null;

comment on table public.goals is
  'Planned expenses. The saved amount is entered by the person and is not linked to accounts; details holds the per-type answers (validated in packages/schemas).';

create function public.goals_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.user_id, new.type, new.currency, new.idempotency_key, new.created_at)
       is distinct from
       (old.id, old.user_id, old.type, old.currency, old.idempotency_key, old.created_at)
    then
      raise exception 'A goal''s type and currency can''t change' using errcode = 'FC009';
    end if;
    -- An archived goal changes only by being restored.
    if old.archived_at is not null and new.archived_at is not null
       and (new.name, new.target_amount_minor, new.saved_amount_minor, new.target_date, new.details)
           is distinct from
           (old.name, old.target_amount_minor, old.saved_amount_minor, old.target_date, old.details)
    then
      raise exception 'Goal is archived' using errcode = 'FC024';
    end if;
    -- Archive stamps server time once; restore clears it.
    if old.archived_at is null and new.archived_at is not null then
      new.archived_at := pg_catalog.now();
    elsif old.archived_at is not null and new.archived_at is not null then
      new.archived_at := old.archived_at;
    end if;
  else
    new.archived_at := null;
    new.created_at := pg_catalog.now();
    new.currency := coalesce(
      (select p.currency from public.profiles as p where p.id = new.user_id),
      'INR'
    );
  end if;
  new.name := pg_catalog.btrim(new.name);
  return new;
end;
$$;

create trigger goals_validate
  before insert or update on public.goals
  for each row execute function public.goals_validate();

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------

create table public.budgets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id    uuid not null,
  effective_from date not null,
  amount_minor   bigint not null,
  currency       text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint budgets_month_start check (extract(day from effective_from) = 1),
  constraint budgets_month_range check (effective_from >= date '1970-01-01'),
  constraint budgets_amount_range check (amount_minor >= 0 and amount_minor <= 10000000000000),
  constraint budgets_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint budgets_one_per_month unique (user_id, category_id, effective_from),
  -- Same-user category. Clients can't delete categories (archive only), so CASCADE only
  -- runs when the whole user is deleted.
  constraint budgets_category_owned
    foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);

create index budgets_category_idx on public.budgets (category_id);

comment on table public.budgets is
  'Monthly budget per expense category from effective_from onward; the latest row at or before a month applies, 0 ends it.';

create function public.budgets_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category public.categories;
  v_this_month date;
begin
  v_this_month := date_trunc('month', public.user_local_today(new.user_id)::timestamp)::date;

  if tg_op = 'UPDATE' then
    if (new.id, new.user_id, new.category_id, new.effective_from, new.created_at)
       is distinct from
       (old.id, old.user_id, old.category_id, old.effective_from, old.created_at)
    then
      raise exception 'Only a budget''s amount can change' using errcode = 'FC009';
    end if;
    if old.effective_from < v_this_month then
      raise exception 'Past budgets can''t change' using errcode = 'FC025';
    end if;
  else
    if new.effective_from < v_this_month then
      raise exception 'Budgets can start this month or later' using errcode = 'FC025';
    end if;
    new.created_at := pg_catalog.now();
  end if;
  -- The amount is always entered in the current profile currency (also when this month's
  -- row is changed after a currency change).
  new.currency := coalesce(
    (select p.currency from public.profiles as p where p.id = new.user_id),
    'INR'
  );

  select * into v_category from public.categories as c where c.id = new.category_id;
  if v_category.kind is distinct from 'expense'
     or (v_category.archived_at is not null and new.amount_minor > 0) then
    raise exception 'This category can''t have a budget' using errcode = 'FC026';
  end if;
  return new;
end;
$$;

create trigger budgets_validate
  before insert or update on public.budgets
  for each row execute function public.budgets_validate();

create trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

-- Sets a category's budget from a month onward: inserts the month's row or changes its
-- amount. SECURITY INVOKER: RLS, column grants and the trigger apply. Repeating the same
-- call gives the same result, so a double submit is harmless.
create function public.set_category_budget(
  p_category_id uuid,
  p_effective_from date,
  p_amount_minor bigint
)
returns public.budgets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.budgets;
begin
  insert into public.budgets as b (category_id, effective_from, amount_minor)
  values (p_category_id, p_effective_from, p_amount_minor)
  on conflict (user_id, category_id, effective_from)
  do update set amount_minor = excluded.amount_minor
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------

revoke all on table public.goals, public.budgets from anon, authenticated;

grant select on table public.goals to authenticated;
grant insert (type, name, target_amount_minor, saved_amount_minor, target_date, details, idempotency_key)
  on table public.goals to authenticated;
grant update (name, target_amount_minor, saved_amount_minor, target_date, details, archived_at)
  on table public.goals to authenticated;

grant select on table public.budgets to authenticated;
grant insert (category_id, effective_from, amount_minor) on table public.budgets to authenticated;
grant update (amount_minor) on table public.budgets to authenticated;

alter table public.goals enable row level security;
alter table public.budgets enable row level security;

create policy goals_select_own on public.goals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy goals_insert_own on public.goals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy goals_update_own on public.goals
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy budgets_select_own on public.budgets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy budgets_insert_own on public.budgets
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy budgets_update_own on public.budgets
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke execute on function public.goals_validate() from public, anon, authenticated;
revoke execute on function public.budgets_validate() from public, anon, authenticated;
revoke execute on function public.set_category_budget(uuid, date, bigint) from public, anon;
grant execute on function public.set_category_budget(uuid, date, bigint) to authenticated;
