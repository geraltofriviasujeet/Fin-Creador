-- Sprint 2 Step 1: accounts, income sources (income categories) and income entries.
--
-- Money rules (CLAUDE.md §5, docs/sprint-plan.md decisions 2026-10-22):
--   * Amounts are integer minor units (bigint) with an ISO 4217 currency. No floats.
--   * Income sources classify income and hold no balance; money lives only in accounts.
--   * Account balance = opening balance + posted inflows - posted outflows, where an entry
--     is posted to the balance if it is not voided and occurred on or after the account's
--     opening-balance date (the opening balance is the balance at the start of that day).
--     The formula itself lives in packages/domain; account_balances supplies the sums.
--   * Ledger rows are immutable. A mistaken income is voided (one-way), never edited or
--     deleted. Editing with history arrives in Sprint 3.
--
-- Access model:
--   * RLS on every table: a user reads and writes only their own rows.
--   * Column grants: user_id is never client-writable (it defaults to auth.uid()), and
--     ledger rows only allow voided_at / void_reason to change. No DELETE for clients.
--   * Ownership across tables is enforced by composite foreign keys (id, user_id), so a
--     row can only reference the same user's accounts and categories.
--   * record_income / void_income are SECURITY INVOKER helpers (RLS still applies) used by
--     web and mobile; the triggers enforce the same rules for any direct write.
--
-- Error codes raised here (mapped to messages in packages/api):
--   FC001 account archived          FC002 currency differs from the account
--   FC003 date in the future        FC004 account currency locked (has entries)
--   FC005 void is final             FC006 category not usable for this entry
--   FC007 idempotency key reused    FC008 entry not found
--   FC009 ledger row is immutable   FC010 account not found
--   FC011 opening-balance date locked (account has entries)

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Today's date in the user's profile time zone (UTC if the profile is not visible).
-- Called from the validation triggers, which run as the role that fired them
-- (authenticated), so that role needs EXECUTE. SECURITY INVOKER: profiles RLS applies,
-- so a caller only ever sees their own time zone; anyone else's id falls back to UTC.
create function public.user_local_today(p_user_id uuid)
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select (pg_catalog.now() at time zone coalesce(
    (select p.time_zone from public.profiles as p where p.id = p_user_id),
    'UTC'
  ))::date;
$$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind                  text not null,
  bank_type             text,
  name                  text not null,
  institution           text,
  last4                 text,
  currency              text not null,
  opening_balance_minor bigint not null default 0,
  opening_balance_date  date not null,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint accounts_id_user_unique unique (id, user_id),
  constraint accounts_kind check (kind in ('bank', 'cash', 'other')),
  -- Banks are savings or current; other kinds have no bank type.
  constraint accounts_bank_type check (
    (kind = 'bank' and bank_type in ('savings', 'current')) or (kind <> 'bank' and bank_type is null)
  ),
  constraint accounts_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint accounts_institution_length
    check (institution is null or char_length(btrim(institution)) between 1 and 80),
  constraint accounts_last4_format check (last4 is null or last4 ~ '^[0-9]{4}$'),
  constraint accounts_currency_format check (currency ~ '^[A-Z]{3}$'),
  -- Only bank accounts may start overdrawn; cash and other stay >= 0 until Sprint 8.
  constraint accounts_opening_balance_sign check (kind = 'bank' or opening_balance_minor >= 0),
  -- 10^13 minor units (e.g. 100 billion rupees): keeps every sum exact in JavaScript.
  constraint accounts_opening_balance_range
    check (opening_balance_minor between -10000000000000 and 10000000000000),
  constraint accounts_opening_balance_date_range check (opening_balance_date >= date '1970-01-01')
);

comment on table public.accounts is
  'Where money is held: bank (savings/current), cash and other. User-owned, RLS-protected; archived, never deleted.';
comment on column public.accounts.opening_balance_date is
  'The opening balance is the balance at the start of this day; entries on or after it change the balance.';

create index accounts_user_active_idx on public.accounts (user_id) where archived_at is null;

create function public.accounts_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_has_entries boolean;
begin
  -- Only a new or changed date is checked, so edits and archiving keep working after the
  -- user's time zone changes.
  if (tg_op = 'INSERT' or new.opening_balance_date is distinct from old.opening_balance_date)
     and new.opening_balance_date > public.user_local_today(new.user_id) then
    raise exception 'Opening balance date cannot be in the future' using errcode = 'FC003';
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.kind <> old.kind then
      raise exception 'Account owner and kind cannot change' using errcode = 'FC009';
    end if;
    v_has_entries := exists (
      select 1 from public.transactions as t
      where t.account_id = old.id or t.counter_account_id = old.id
    );
    if new.currency <> old.currency and v_has_entries then
      raise exception 'Currency cannot change once the account has entries' using errcode = 'FC004';
    end if;
    -- The as-of date decides which entries count toward the balance, so it is fixed once
    -- entries exist. The opening amount itself may still be corrected.
    if new.opening_balance_date <> old.opening_balance_date and v_has_entries then
      raise exception 'Opening balance date cannot change once the account has entries' using errcode = 'FC011';
    end if;
    -- Archive time is set by the server, whatever the client sends.
    if old.archived_at is null and new.archived_at is not null then
      new.archived_at := pg_catalog.now();
    elsif old.archived_at is not null and new.archived_at is not null then
      new.archived_at := old.archived_at;
    end if;
  else
    new.archived_at := null; -- accounts are created active
  end if;

  return new;
end;
$$;

create trigger accounts_validate
  before insert or update on public.accounts
  for each row execute function public.accounts_validate();

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Categories (income categories are the income sources)
-- ---------------------------------------------------------------------------

create table public.categories (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind               text not null,
  name               text not null,
  source_type        text,
  default_account_id uuid,
  is_default         boolean not null default false,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint categories_id_user_unique unique (id, user_id),
  constraint categories_kind check (kind in ('income', 'expense')),
  -- Expense categories arrive in Sprint 3 (drop this constraint then).
  constraint categories_kind_enabled check (kind = 'income'),
  constraint categories_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint categories_source_type check (
    (kind = 'income' and source_type in ('salary', 'rent', 'freelance', 'business', 'interest', 'other'))
    or (kind <> 'income' and source_type is null)
  ),
  constraint categories_default_account_income_only check (kind = 'income' or default_account_id is null),
  -- Clients cannot delete accounts (archive only); this action only runs when the whole
  -- user is deleted, and clears just the default account (user_id is still required).
  constraint categories_default_account_owned
    foreign key (default_account_id, user_id) references public.accounts (id, user_id)
    on delete set null (default_account_id)
);

comment on table public.categories is
  'Transaction categories. Income categories are the income sources (type + optional default account); they hold no balance.';
comment on column public.categories.is_default is
  'Created by ensure_default_income_sources. The Income sources panel lists user-added sources and sources with income.';

-- One active category per name and kind, ignoring case and surrounding spaces.
create unique index categories_user_kind_name_active_idx
  on public.categories (user_id, kind, lower(btrim(name)))
  where archived_at is null;

create function public.categories_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.kind <> old.kind or new.is_default <> old.is_default then
      raise exception 'Category owner, kind and default flag cannot change' using errcode = 'FC009';
    end if;
    if old.archived_at is null and new.archived_at is not null then
      new.archived_at := pg_catalog.now();
    elsif old.archived_at is not null and new.archived_at is not null then
      new.archived_at := old.archived_at;
    end if;
  else
    new.archived_at := null;
  end if;
  return new;
end;
$$;

create trigger categories_validate
  before insert or update on public.categories
  for each row execute function public.categories_validate();

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Transactions (designed for income, expense and transfer; only income enabled)
-- ---------------------------------------------------------------------------

create table public.transactions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type               text not null,
  amount_minor       bigint not null,
  currency           text not null,
  -- income: the account it went into; expense and transfer: the account it left.
  account_id         uuid not null,
  -- transfer only: the account it went into.
  counter_account_id uuid,
  -- income and expense only.
  category_id        uuid,
  occurred_on        date not null,
  note               text,
  idempotency_key    uuid not null,
  voided_at          timestamptz,
  void_reason        text,
  created_at         timestamptz not null default now(),

  constraint transactions_type check (type in ('income', 'expense', 'transfer')),
  -- Expenses and transfers arrive in Sprint 3 (drop this constraint then).
  constraint transactions_type_enabled check (type = 'income'),
  -- Positive; the type gives the direction. Capped so sums stay exact in JavaScript.
  constraint transactions_amount_range check (amount_minor > 0 and amount_minor <= 10000000000000),
  constraint transactions_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint transactions_shape check (
    (type = 'transfer' and counter_account_id is not null and category_id is null
       and counter_account_id <> account_id)
    or (type <> 'transfer' and counter_account_id is null and category_id is not null)
  ),
  constraint transactions_occurred_on_range check (occurred_on >= date '1970-01-01'),
  constraint transactions_note_length check (note is null or char_length(note) <= 280),
  constraint transactions_void_reason_length
    check (void_reason is null or char_length(btrim(void_reason)) between 1 and 200),
  constraint transactions_void_reason_needs_void check (void_reason is null or voided_at is not null),
  -- Duplicate-submission protection: one entry per client-generated key.
  constraint transactions_idempotency_unique unique (user_id, idempotency_key),
  -- Same-user ownership of every referenced row. Clients cannot delete accounts or
  -- categories (archive only), so CASCADE only runs when the whole user is deleted; it
  -- makes that deletion succeed whatever order Postgres processes the cascades in.
  constraint transactions_account_owned
    foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  constraint transactions_counter_account_owned
    foreign key (counter_account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  constraint transactions_category_owned
    foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);

comment on table public.transactions is
  'Ledger of income (and later expense and transfer) entries. Immutable except for a one-way void.';

create index transactions_user_occurred_on_idx on public.transactions (user_id, occurred_on);
create index transactions_account_idx on public.transactions (account_id);
create index transactions_counter_account_idx on public.transactions (counter_account_id)
  where counter_account_id is not null;
create index transactions_category_idx on public.transactions (category_id);

create function public.transactions_validate_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_account public.accounts;
  v_category public.categories;
begin
  select * into v_account from public.accounts where id = new.account_id;
  if v_account.archived_at is not null then
    raise exception 'Account is archived' using errcode = 'FC001';
  end if;
  if v_account.currency <> new.currency then
    raise exception 'Currency must match the account (%)', v_account.currency using errcode = 'FC002';
  end if;

  if new.category_id is not null then
    select * into v_category from public.categories where id = new.category_id;
    if v_category.kind <> new.type or v_category.archived_at is not null then
      raise exception 'Category cannot be used for this entry' using errcode = 'FC006';
    end if;
  end if;

  if new.occurred_on > public.user_local_today(new.user_id) then
    raise exception 'Date cannot be in the future' using errcode = 'FC003';
  end if;

  new.voided_at := null;
  new.void_reason := null;
  new.created_at := pg_catalog.now();
  return new;
end;
$$;

create trigger transactions_validate_insert
  before insert on public.transactions
  for each row execute function public.transactions_validate_insert();

-- Ledger rows never change, except for a single, final void.
create function public.transactions_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'A voided entry cannot change' using errcode = 'FC005';
  end if;

  if (new.id, new.user_id, new.type, new.amount_minor, new.currency, new.account_id,
      new.counter_account_id, new.category_id, new.occurred_on, new.note,
      new.idempotency_key, new.created_at)
     is distinct from
     (old.id, old.user_id, old.type, old.amount_minor, old.currency, old.account_id,
      old.counter_account_id, old.category_id, old.occurred_on, old.note,
      old.idempotency_key, old.created_at)
  then
    raise exception 'Ledger entries cannot be edited' using errcode = 'FC009';
  end if;

  if new.voided_at is not null then
    new.voided_at := pg_catalog.now(); -- server time, whatever the client sent
  end if;
  return new;
end;
$$;

create trigger transactions_guard_update
  before update on public.transactions
  for each row execute function public.transactions_guard_update();

-- ---------------------------------------------------------------------------
-- Balance sums (formula in packages/domain)
-- ---------------------------------------------------------------------------

-- Per account: sums of entries posted to its balance (not voided, on or after the
-- opening-balance date). security_invoker: the caller's RLS applies, so each user sees
-- only their own accounts and entries.
create view public.account_balances
with (security_invoker = true)
as
select
  a.id      as account_id,
  a.user_id as user_id,
  coalesce(sum(t.amount_minor) filter (
    where t.type = 'income' or (t.type = 'transfer' and t.counter_account_id = a.id)
  ), 0)::bigint as inflow_minor,
  coalesce(sum(t.amount_minor) filter (
    where t.type = 'expense' or (t.type = 'transfer' and t.account_id = a.id)
  ), 0)::bigint as outflow_minor,
  greatest(a.updated_at, max(t.created_at)) as last_activity_at
from public.accounts as a
left join public.transactions as t
  on (t.account_id = a.id or t.counter_account_id = a.id)
  and t.voided_at is null
  and t.occurred_on >= a.opening_balance_date
group by a.id, a.user_id, a.updated_at;

comment on view public.account_balances is
  'Posted inflow/outflow sums per account (not voided, on/after the opening-balance date). Balance = opening + inflow - outflow, computed in packages/domain.';

-- ---------------------------------------------------------------------------
-- Write helpers (SECURITY INVOKER: RLS and column grants still apply)
-- ---------------------------------------------------------------------------

-- Records an income entry once per idempotency key. Replaying the same key with the same
-- details returns the original entry; reusing it for different details is an error.
create function public.record_income(
  p_account_id uuid,
  p_category_id uuid,
  p_amount_minor bigint,
  p_occurred_on date,
  p_idempotency_key uuid,
  p_note text default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_currency text;
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_row public.transactions;
begin
  -- A replay returns the original even if the account was archived since.
  select * into v_row from public.transactions as t
  where t.user_id = (select auth.uid()) and t.idempotency_key = p_idempotency_key;

  if v_row.id is null then
    select a.currency into v_currency from public.accounts as a where a.id = p_account_id;
    if v_currency is null then
      raise exception 'Account not found' using errcode = 'FC010';
    end if;

    insert into public.transactions
      (type, amount_minor, currency, account_id, category_id, occurred_on, note, idempotency_key)
    values
      ('income', p_amount_minor, v_currency, p_account_id, p_category_id, p_occurred_on, v_note, p_idempotency_key)
    -- Two simultaneous requests with the same key: the loser reads the winner's row.
    on conflict on constraint transactions_idempotency_unique do nothing
    returning * into v_row;

    if v_row.id is not null then
      return v_row;
    end if;
    select * into v_row from public.transactions as t
    where t.user_id = (select auth.uid()) and t.idempotency_key = p_idempotency_key;
  end if;

  if (v_row.type, v_row.amount_minor, v_row.account_id, v_row.category_id, v_row.occurred_on, v_row.note)
     is distinct from ('income', p_amount_minor, p_account_id, p_category_id, p_occurred_on, v_note) then
    raise exception 'This request key was already used for a different entry' using errcode = 'FC007';
  end if;
  return v_row;
end;
$$;

-- Voids an income entry (one-way). Voiding an already-voided entry returns it unchanged.
create function public.void_income(p_transaction_id uuid, p_reason text default null)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.transactions;
begin
  select * into v_row from public.transactions as t where t.id = p_transaction_id;
  if v_row.id is null then
    raise exception 'Entry not found' using errcode = 'FC008';
  end if;
  if v_row.voided_at is not null then
    return v_row;
  end if;

  update public.transactions as t
  set voided_at = pg_catalog.now(), void_reason = nullif(pg_catalog.btrim(p_reason), '')
  where t.id = p_transaction_id
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Default income sources
-- ---------------------------------------------------------------------------

-- Creates the default income sources for a user who has no income categories yet
-- (archived ones count, so defaults a user removed are never re-created).
-- Returns the number created. Internal: callers below decide when it runs.
create function public.ensure_default_income_sources(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  created integer;
begin
  if p_user_id is null
     or exists (select 1 from public.categories as c where c.user_id = p_user_id and c.kind = 'income') then
    return 0;
  end if;

  insert into public.categories (user_id, kind, name, source_type, is_default)
  select p_user_id, 'income', d.name, d.source_type, true
  from (values
    ('Salary', 'salary'),
    ('Freelance', 'freelance'),
    ('Rental income', 'rent'),
    ('Business', 'business'),
    ('Interest & dividends', 'interest'),
    ('Other income', 'other')
  ) as d (name, source_type)
  on conflict do nothing;
  get diagnostics created = row_count;
  return created;
end;
$$;

-- Sign-up hook. Separate from handle_new_user and wrapped so that a failure here can
-- never block sign-up: it logs a warning and the lazy fallback creates the defaults later.
create function public.seed_income_sources_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.ensure_default_income_sources(new.id);
  exception when others then
    raise warning 'Default income sources not created for user %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger on_auth_user_created_seed_income_sources
  after insert on auth.users
  for each row execute function public.seed_income_sources_on_signup();

-- Lazy fallback the apps call on first use (no-op once the user has income sources).
-- Acts only on the caller's own user id.
create function public.ensure_my_income_sources()
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.ensure_default_income_sources((select auth.uid()));
$$;

-- One-time backfill for users who existed before this migration. Idempotent.
create function public.backfill_default_income_sources()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  total integer := 0;
  u record;
begin
  for u in select id from auth.users loop
    total := total + public.ensure_default_income_sources(u.id);
  end loop;
  return total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.user_local_today(uuid) from public, anon;
grant execute on function public.user_local_today(uuid) to authenticated;
revoke execute on function public.accounts_validate() from public, anon, authenticated;
revoke execute on function public.categories_validate() from public, anon, authenticated;
revoke execute on function public.transactions_validate_insert() from public, anon, authenticated;
revoke execute on function public.transactions_guard_update() from public, anon, authenticated;
revoke execute on function public.ensure_default_income_sources(uuid) from public, anon, authenticated;
revoke execute on function public.seed_income_sources_on_signup() from public, anon, authenticated;
revoke execute on function public.backfill_default_income_sources() from public, anon, authenticated;

revoke execute on function public.record_income(uuid, uuid, bigint, date, uuid, text) from public, anon;
revoke execute on function public.void_income(uuid, text) from public, anon;
revoke execute on function public.ensure_my_income_sources() from public, anon;
grant execute on function public.record_income(uuid, uuid, bigint, date, uuid, text) to authenticated;
grant execute on function public.void_income(uuid, text) to authenticated;
grant execute on function public.ensure_my_income_sources() to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and Row Level Security
-- ---------------------------------------------------------------------------

-- Start from nothing (Supabase grants everything on new public tables by default).
revoke all on table public.accounts, public.categories, public.transactions, public.account_balances
  from anon, authenticated;

grant select on table public.accounts to authenticated;
grant insert (kind, bank_type, name, institution, last4, currency, opening_balance_minor, opening_balance_date)
  on table public.accounts to authenticated;
grant update (bank_type, name, institution, last4, currency, opening_balance_minor, opening_balance_date, archived_at)
  on table public.accounts to authenticated;

grant select on table public.categories to authenticated;
grant insert (kind, name, source_type, default_account_id) on table public.categories to authenticated;
grant update (name, source_type, default_account_id, archived_at) on table public.categories to authenticated;

grant select on table public.transactions to authenticated;
grant insert (type, amount_minor, currency, account_id, category_id, occurred_on, note, idempotency_key)
  on table public.transactions to authenticated;
grant update (voided_at, void_reason) on table public.transactions to authenticated;

grant select on table public.account_balances to authenticated;

alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;

create policy accounts_select_own on public.accounts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy accounts_insert_own on public.accounts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy accounts_update_own on public.accounts
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy categories_select_own on public.categories
  for select to authenticated using ((select auth.uid()) = user_id);
create policy categories_insert_own on public.categories
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy categories_update_own on public.categories
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy transactions_select_own on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy transactions_insert_own on public.transactions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy transactions_update_own on public.transactions
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Backfill existing users
-- ---------------------------------------------------------------------------

select public.backfill_default_income_sources();
