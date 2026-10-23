-- Sprint 3 Phase 2: expenses, transfers, edits with history, voids with a request key,
-- expense categories, and the transaction list / search / summary functions.
--
-- Rules (docs/sprint-plan.md decisions 2026-10-23):
--   * Expense: money out of one account, in an expense category. Optional payment mode
--     (a label) only for expenses from a bank account. Cash and other accounts may go
--     below zero (the app warns); bank accounts may go negative.
--   * Transfer: ONE row. account_id = from, counter_account_id = to. Never income or
--     expense. Both accounts active and in the same currency. Voiding the row restores
--     both accounts (account_balances skips voided rows on both sides).
--   * Edit: void the old version and insert the new one, linked by replaces_id, in one
--     database transaction (edit_transaction). The type never changes. Editing a version
--     that an edit already replaced is refused as stale (FC014); one that was voided is FC005.
--   * Every write takes an idempotency key: record_transaction and edit_transaction use
--     the row's idempotency_key; every void stores void_idempotency_key (enforced by a
--     CHECK, so even a direct table update cannot void without one). A retry with the
--     same key returns the saved result and saves nothing new.
--   * Lists, search and totals go through parameterised functions. Search compares
--     literal text (strpos, not LIKE), so %, _, commas and parentheses have no special
--     meaning. Paging is keyset on (occurred_on, created_at, id), newest first.
--   * Expense categories: 12 defaults per user (sign-up trigger, backfill, lazy
--     fallback), then add / rename / archive by the user.
--
-- New error codes (mapped to messages in packages/api):
--   FC014 entry changed elsewhere (already voided or replaced)
--   FC015 transfer accounts have different currencies
--   FC016 payment mode needs a bank account
--   FC017 edit changes nothing
-- Existing codes reused: FC001 archived account, FC002 currency, FC003 future date,
-- FC005 already voided, FC006 category not usable, FC007 request key reused,
-- FC008 entry not found, FC009 immutable field, FC010 account not found.

-- ---------------------------------------------------------------------------
-- Turn on expenses and transfers, expense categories
-- ---------------------------------------------------------------------------

alter table public.transactions drop constraint transactions_type_enabled;
alter table public.categories drop constraint categories_kind_enabled;

-- ---------------------------------------------------------------------------
-- Categories: icon for expense categories
-- ---------------------------------------------------------------------------

alter table public.categories add column icon text;

-- Expense categories pick an icon from a fixed set; income sources use their type.
alter table public.categories add constraint categories_icon check (
  icon is null
  or (kind = 'expense' and icon in (
    'food', 'groceries', 'transport', 'home', 'bills', 'shopping', 'health', 'fun',
    'education', 'travel', 'care', 'other'
  ))
);

-- ---------------------------------------------------------------------------
-- Transactions: payment mode, edit link, void request key
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column payment_mode text,
  add column replaces_id uuid,
  add column void_idempotency_key uuid;

-- Needed for the same-user foreign key below.
alter table public.transactions add constraint transactions_id_user_unique unique (id, user_id);

alter table public.transactions add constraint transactions_payment_mode check (
  payment_mode is null
  or (type = 'expense' and payment_mode in ('upi', 'debit_card', 'net_banking', 'cheque'))
);

-- An edit's new version points at the version it replaced, owned by the same user.
-- CASCADE only runs when the whole user is deleted (clients cannot delete entries).
alter table public.transactions add constraint transactions_replaces_owned
  foreign key (replaces_id, user_id) references public.transactions (id, user_id) on delete cascade;
alter table public.transactions add constraint transactions_replaces_other
  check (replaces_id is null or replaces_id <> id);

-- A version is replaced at most once.
create unique index transactions_replaces_id_key on public.transactions (replaces_id)
  where replaces_id is not null;

-- One void per request key per user. Every void from now on carries a key, and only a
-- voided row has one. NOT VALID: rows voided before this migration have no key and are
-- immutable, so they are left as they are; every new or updated row is checked.
alter table public.transactions add constraint transactions_void_idempotency_unique
  unique (user_id, void_idempotency_key);
alter table public.transactions add constraint transactions_void_key_with_void
  check ((voided_at is null) = (void_idempotency_key is null)) not valid;

-- Keyset paging: newest first by date, then creation time, then id. Covers the old
-- (user_id, occurred_on) index, which is dropped.
create index transactions_user_list_idx
  on public.transactions (user_id, occurred_on desc, created_at desc, id desc);
drop index public.transactions_user_occurred_on_idx;

comment on table public.transactions is
  'Ledger of income, expense and transfer entries. Rows never change except a one-way void; an edit voids the old version and adds a new one (replaces_id).';
comment on column public.transactions.replaces_id is
  'The version this entry replaced (an edit). The replaced version is voided in the same database transaction.';
comment on column public.transactions.void_idempotency_key is
  'Request key of the void: void_transaction''s key, or for a version replaced by an edit, the edit''s key. Lets a retried request be recognised.';

-- ---------------------------------------------------------------------------
-- Insert validation (replaces the Sprint 2 version)
-- ---------------------------------------------------------------------------

create or replace function public.transactions_validate_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_account public.accounts;
  v_counter public.accounts;
  v_category public.categories;
  v_original public.transactions;
begin
  -- A new version of an edited entry. Only edit_transaction produces a valid one: the
  -- original must have been voided by this same database transaction (the void stamps
  -- voided_at with now(), which is the transaction's start time).
  if new.replaces_id is not null then
    select * into v_original from public.transactions as t where t.id = new.replaces_id;
    if v_original.id is null then
      raise exception 'Entry not found' using errcode = 'FC008';
    end if;
    if v_original.type <> new.type then
      raise exception 'An edit cannot change the entry type' using errcode = 'FC009';
    end if;
    if v_original.voided_at is distinct from pg_catalog.now() then
      raise exception 'This entry was changed elsewhere' using errcode = 'FC014';
    end if;
  end if;

  -- Archived accounts and categories can't be used for new entries. An edit may keep
  -- the one its original already used (same slot), so old entries stay correctable.
  select * into v_account from public.accounts as a where a.id = new.account_id;
  if v_account.archived_at is not null and new.account_id is distinct from v_original.account_id then
    raise exception 'Account is archived' using errcode = 'FC001';
  end if;
  if v_account.currency <> new.currency then
    raise exception 'Currency must match the account (%)', v_account.currency using errcode = 'FC002';
  end if;

  if new.type = 'transfer' then
    select * into v_counter from public.accounts as a where a.id = new.counter_account_id;
    if v_counter.archived_at is not null
       and new.counter_account_id is distinct from v_original.counter_account_id then
      raise exception 'Account is archived' using errcode = 'FC001';
    end if;
    if v_counter.currency <> v_account.currency then
      raise exception 'Both accounts of a transfer need the same currency' using errcode = 'FC015';
    end if;
  end if;

  if new.category_id is not null then
    select * into v_category from public.categories as c where c.id = new.category_id;
    if v_category.kind <> new.type
       or (v_category.archived_at is not null and new.category_id is distinct from v_original.category_id) then
      raise exception 'Category cannot be used for this entry' using errcode = 'FC006';
    end if;
  end if;

  if new.payment_mode is not null and v_account.kind <> 'bank' then
    raise exception 'A payment mode needs a bank account' using errcode = 'FC016';
  end if;

  if new.occurred_on > public.user_local_today(new.user_id) then
    raise exception 'Date cannot be in the future' using errcode = 'FC003';
  end if;

  new.voided_at := null;
  new.void_reason := null;
  new.void_idempotency_key := null;
  new.created_at := pg_catalog.now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Update guard (replaces the Sprint 2 version): rows never change except one void
-- ---------------------------------------------------------------------------

create or replace function public.transactions_guard_update()
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
      new.payment_mode, new.replaces_id, new.idempotency_key, new.created_at)
     is distinct from
     (old.id, old.user_id, old.type, old.amount_minor, old.currency, old.account_id,
      old.counter_account_id, old.category_id, old.occurred_on, old.note,
      old.payment_mode, old.replaces_id, old.idempotency_key, old.created_at)
  then
    raise exception 'Ledger entries cannot be edited' using errcode = 'FC009';
  end if;

  -- A void reason or void key without a void, or a void without a key, fails a CHECK.
  if new.voided_at is not null then
    new.voided_at := pg_catalog.now(); -- server time, whatever the client sent
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_transaction: income, expense or transfer, once per request key
-- ---------------------------------------------------------------------------

-- Replaying the same key with the same details returns the saved entry (even if the
-- account was archived since); reusing a key for different details is FC007.
-- SECURITY INVOKER: RLS, column grants and the insert trigger apply.
create function public.record_transaction(
  p_type text,
  p_idempotency_key uuid,
  p_amount_minor bigint,
  p_occurred_on date,
  p_account_id uuid,
  p_category_id uuid default null,
  p_counter_account_id uuid default null,
  p_note text default null,
  p_payment_mode text default null
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
  select * into v_row from public.transactions as t
  where t.user_id = (select auth.uid()) and t.idempotency_key = p_idempotency_key;

  if v_row.id is null then
    select a.currency into v_currency from public.accounts as a where a.id = p_account_id;
    if v_currency is null then
      raise exception 'Account not found' using errcode = 'FC010';
    end if;
    if p_counter_account_id is not null
       and not exists (select 1 from public.accounts as a where a.id = p_counter_account_id) then
      raise exception 'Account not found' using errcode = 'FC010';
    end if;

    insert into public.transactions
      (type, amount_minor, currency, account_id, counter_account_id, category_id,
       occurred_on, note, payment_mode, idempotency_key)
    values
      (p_type, p_amount_minor, v_currency, p_account_id, p_counter_account_id, p_category_id,
       p_occurred_on, v_note, p_payment_mode, p_idempotency_key)
    -- Two simultaneous requests with the same key: the loser reads the winner's row.
    on conflict on constraint transactions_idempotency_unique do nothing
    returning * into v_row;

    if v_row.id is not null then
      return v_row;
    end if;
    select * into v_row from public.transactions as t
    where t.user_id = (select auth.uid()) and t.idempotency_key = p_idempotency_key;
  end if;

  if (v_row.type, v_row.amount_minor, v_row.account_id, v_row.counter_account_id, v_row.category_id,
      v_row.occurred_on, v_row.note, v_row.payment_mode, v_row.replaces_id)
     is distinct from
     (p_type, p_amount_minor, p_account_id, p_counter_account_id, p_category_id,
      p_occurred_on, v_note, p_payment_mode, null::uuid) then
    raise exception 'This request key was already used for a different entry' using errcode = 'FC007';
  end if;
  return v_row;
end;
$$;

-- Sprint 2's record_income keeps its signature for the current clients and now goes
-- through record_transaction (one code path).
create or replace function public.record_income(
  p_account_id uuid,
  p_category_id uuid,
  p_amount_minor bigint,
  p_occurred_on date,
  p_idempotency_key uuid,
  p_note text default null
)
returns public.transactions
language sql
security invoker
set search_path = ''
as $$
  select * from public.record_transaction(
    'income', p_idempotency_key, p_amount_minor, p_occurred_on, p_account_id,
    p_category_id => p_category_id, p_note => p_note
  );
$$;

-- ---------------------------------------------------------------------------
-- edit_transaction: void the old version and insert the new one, atomically
-- ---------------------------------------------------------------------------

-- p_transaction_id is the version the person was looking at. If another edit replaced
-- it, the edit is stale (FC014); if it was voided, FC005. The type is taken from the original.
create function public.edit_transaction(
  p_transaction_id uuid,
  p_idempotency_key uuid,
  p_amount_minor bigint,
  p_occurred_on date,
  p_account_id uuid,
  p_category_id uuid default null,
  p_counter_account_id uuid default null,
  p_note text default null,
  p_payment_mode text default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old public.transactions;
  v_row public.transactions;
  v_currency text;
  v_note text := nullif(pg_catalog.btrim(p_note), '');
begin
  -- Lock the version being edited: a second edit of it waits here, then finds it voided.
  select * into v_old from public.transactions as t where t.id = p_transaction_id for update;
  if v_old.id is null then
    raise exception 'Entry not found' using errcode = 'FC008';
  end if;

  -- A retry of an edit that was already saved returns the saved version.
  select * into v_row from public.transactions as t
  where t.user_id = (select auth.uid()) and t.idempotency_key = p_idempotency_key;
  if v_row.id is not null then
    if (v_row.replaces_id, v_row.amount_minor, v_row.occurred_on, v_row.account_id,
        v_row.counter_account_id, v_row.category_id, v_row.note, v_row.payment_mode)
       is distinct from
       (p_transaction_id, p_amount_minor, p_occurred_on, p_account_id,
        p_counter_account_id, p_category_id, v_note, p_payment_mode) then
      raise exception 'This request key was already used for a different entry' using errcode = 'FC007';
    end if;
    return v_row;
  end if;

  -- Replaced by another edit: stale (FC014). Plainly voided: FC005.
  if v_old.voided_at is not null then
    if exists (select 1 from public.transactions as r where r.replaces_id = v_old.id) then
      raise exception 'This entry was changed elsewhere' using errcode = 'FC014';
    end if;
    raise exception 'This entry is already voided' using errcode = 'FC005';
  end if;

  if (v_old.amount_minor, v_old.occurred_on, v_old.account_id, v_old.counter_account_id,
      v_old.category_id, v_old.note, v_old.payment_mode)
     is not distinct from
     (p_amount_minor, p_occurred_on, p_account_id, p_counter_account_id,
      p_category_id, v_note, p_payment_mode) then
    raise exception 'Nothing has changed' using errcode = 'FC017';
  end if;

  select a.currency into v_currency from public.accounts as a where a.id = p_account_id;
  if v_currency is null then
    raise exception 'Account not found' using errcode = 'FC010';
  end if;
  if p_counter_account_id is not null
     and not exists (select 1 from public.accounts as a where a.id = p_counter_account_id) then
    raise exception 'Account not found' using errcode = 'FC010';
  end if;

  -- Void without a reason (the replacement explains it), under the edit's request key.
  update public.transactions as t
  set voided_at = pg_catalog.now(), void_idempotency_key = p_idempotency_key
  where t.id = v_old.id;

  insert into public.transactions
    (type, amount_minor, currency, account_id, counter_account_id, category_id,
     occurred_on, note, payment_mode, idempotency_key, replaces_id)
  values
    (v_old.type, p_amount_minor, v_currency, p_account_id, p_counter_account_id, p_category_id,
     p_occurred_on, v_note, p_payment_mode, p_idempotency_key, v_old.id)
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_transaction: one-way, once per request key
-- ---------------------------------------------------------------------------

-- A retry with the same key returns the voided row. Voiding a version that an edit
-- replaced is stale (FC014); voiding an entry voided by another request is FC005.
create function public.void_transaction(
  p_transaction_id uuid,
  p_idempotency_key uuid,
  p_reason text default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.transactions;
begin
  select * into v_row from public.transactions as t where t.id = p_transaction_id for update;
  if v_row.id is null then
    raise exception 'Entry not found' using errcode = 'FC008';
  end if;

  if v_row.voided_at is not null then
    -- Replaced by an edit: stale, whatever the key.
    if exists (select 1 from public.transactions as r where r.replaces_id = v_row.id) then
      raise exception 'This entry was changed elsewhere' using errcode = 'FC014';
    end if;
    if v_row.void_idempotency_key = p_idempotency_key then
      return v_row; -- a retry of this void
    end if;
    raise exception 'This entry is already voided' using errcode = 'FC005';
  end if;

  update public.transactions as t
  set voided_at = pg_catalog.now(),
      void_reason = nullif(pg_catalog.btrim(p_reason), ''),
      void_idempotency_key = p_idempotency_key
  where t.id = p_transaction_id
  returning * into v_row;
  return v_row;
end;
$$;

-- void_income (Sprint 2) keeps its signature for the current clients until they move to
-- void_transaction in Phase 2 (a later migration drops it). It now records a fresh void
-- key, which the CHECK requires; repeating it on a voided entry still returns the entry.
create or replace function public.void_income(p_transaction_id uuid, p_reason text default null)
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
  set voided_at = pg_catalog.now(),
      void_reason = nullif(pg_catalog.btrim(p_reason), ''),
      void_idempotency_key = pg_catalog.gen_random_uuid()
  where t.id = p_transaction_id
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- List, search and totals (parameterised; SECURITY INVOKER, RLS applies)
-- ---------------------------------------------------------------------------

-- Current versions (never a replaced one) of the caller's entries matching the filters.
-- Voided entries are included; callers decide. p_query is literal text compared with
-- strpos on lower-cased values, so no character in it is a wildcard. p_amount_minor is
-- the query read as an amount by the client (packages/domain parseAmount), or null.
create function public.transactions_matching(
  p_from date,
  p_to date,
  p_category_id uuid,
  p_account_id uuid,
  p_query text,
  p_amount_minor bigint
)
returns setof public.transactions
language sql
stable
security invoker
set search_path = ''
as $$
  select t.*
  from public.transactions as t
  where t.user_id = (select auth.uid())
    and t.occurred_on between p_from and p_to
    and not exists (select 1 from public.transactions as r where r.replaces_id = t.id)
    and (p_category_id is null or t.category_id = p_category_id)
    and (p_account_id is null or t.account_id = p_account_id or t.counter_account_id = p_account_id)
    and (
      p_query is null
      or (p_amount_minor is not null and t.amount_minor = p_amount_minor)
      or pg_catalog.strpos(pg_catalog.lower(coalesce(t.note, '')), pg_catalog.lower(p_query)) > 0
      or exists (
        select 1 from public.categories as c
        where c.id = t.category_id
          and pg_catalog.strpos(pg_catalog.lower(c.name), pg_catalog.lower(p_query)) > 0
      )
      or exists (
        select 1 from public.accounts as a
        where a.id in (t.account_id, t.counter_account_id)
          and pg_catalog.strpos(
                pg_catalog.lower(pg_catalog.concat_ws(' ', a.name, a.institution, a.last4)),
                pg_catalog.lower(p_query)) > 0
      )
    );
$$;

-- One page of the list, newest first. Pass the last row's (occurred_on, created_at, id)
-- to get the next page. p_limit is clamped to 1..100.
create function public.list_transactions(
  p_from date,
  p_to date,
  p_type text default null,
  p_category_id uuid default null,
  p_account_id uuid default null,
  p_query text default null,
  p_amount_minor bigint default null,
  p_include_voided boolean default false,
  p_after_occurred_on date default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns setof public.transactions
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query text := nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_query, '')), 100), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'A valid date range is required' using errcode = '22023';
  end if;
  if p_type is not null and p_type not in ('income', 'expense', 'transfer') then
    raise exception 'Unknown entry type' using errcode = '22023';
  end if;
  if (p_after_occurred_on is null) <> (p_after_id is null)
     or (p_after_occurred_on is null) <> (p_after_created_at is null) then
    raise exception 'The page cursor needs a date, a time and an id' using errcode = '22023';
  end if;

  return query
    select t.*
    from public.transactions_matching(p_from, p_to, p_category_id, p_account_id, v_query, p_amount_minor) as t
    where (p_type is null or t.type = p_type)
      and (coalesce(p_include_voided, false) or t.voided_at is null)
      and (p_after_id is null
           or (t.occurred_on, t.created_at, t.id) < (p_after_occurred_on, p_after_created_at, p_after_id))
    order by t.occurred_on desc, t.created_at desc, t.id desc
    limit v_limit;
end;
$$;

-- Totals for the same filters (without the type tab), per currency. Voided entries never
-- count; transfers are counted, never summed into income or expenses. Net and savings
-- rate are derived in packages/domain.
create function public.transaction_summary(
  p_from date,
  p_to date,
  p_category_id uuid default null,
  p_account_id uuid default null,
  p_query text default null,
  p_amount_minor bigint default null
)
returns table (
  currency text,
  income_minor bigint,
  expense_minor bigint,
  income_count integer,
  expense_count integer,
  transfer_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_query text := nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_query, '')), 100), '');
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'A valid date range is required' using errcode = '22023';
  end if;

  return query
    select
      t.currency,
      coalesce(sum(t.amount_minor) filter (where t.type = 'income'), 0)::bigint,
      coalesce(sum(t.amount_minor) filter (where t.type = 'expense'), 0)::bigint,
      (count(*) filter (where t.type = 'income'))::integer,
      (count(*) filter (where t.type = 'expense'))::integer,
      (count(*) filter (where t.type = 'transfer'))::integer
    from public.transactions_matching(p_from, p_to, p_category_id, p_account_id, v_query, p_amount_minor) as t
    where t.voided_at is null
    group by t.currency
    order by t.currency;
end;
$$;

-- ---------------------------------------------------------------------------
-- Default expense categories
-- ---------------------------------------------------------------------------

-- Creates the default expense categories for a user who has none yet (archived ones
-- count, so defaults a user removed are never re-created). Returns the number created.
create function public.ensure_default_expense_categories(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  created integer;
begin
  if p_user_id is null
     or exists (select 1 from public.categories as c where c.user_id = p_user_id and c.kind = 'expense') then
    return 0;
  end if;

  insert into public.categories (user_id, kind, name, icon, is_default)
  select p_user_id, 'expense', d.name, d.icon, true
  from (values
    ('Food & dining', 'food'),
    ('Groceries', 'groceries'),
    ('Transport', 'transport'),
    ('Rent & housing', 'home'),
    ('Utilities & bills', 'bills'),
    ('Shopping', 'shopping'),
    ('Health', 'health'),
    ('Entertainment', 'fun'),
    ('Education', 'education'),
    ('Travel', 'travel'),
    ('Personal care', 'care'),
    ('Other expenses', 'other')
  ) as d (name, icon)
  on conflict do nothing;
  get diagnostics created = row_count;
  return created;
end;
$$;

-- Sign-up hook, wrapped so a failure can never block sign-up (the lazy fallback below
-- creates the defaults later).
create function public.seed_expense_categories_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.ensure_default_expense_categories(new.id);
  exception when others then
    raise warning 'Default expense categories not created for user %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger on_auth_user_created_seed_expense_categories
  after insert on auth.users
  for each row execute function public.seed_expense_categories_on_signup();

-- Lazy fallback the apps call on first use. Acts only on the caller's own user id.
create function public.ensure_my_expense_categories()
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.ensure_default_expense_categories((select auth.uid()));
$$;

-- One-time backfill for existing users. Idempotent.
create function public.backfill_default_expense_categories()
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
    total := total + public.ensure_default_expense_categories(u.id);
  end loop;
  return total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.ensure_default_expense_categories(uuid) from public, anon, authenticated;
revoke execute on function public.seed_expense_categories_on_signup() from public, anon, authenticated;
revoke execute on function public.backfill_default_expense_categories() from public, anon, authenticated;

revoke execute on function public.record_transaction(text, uuid, bigint, date, uuid, uuid, uuid, text, text) from public, anon;
revoke execute on function public.edit_transaction(uuid, uuid, bigint, date, uuid, uuid, uuid, text, text) from public, anon;
revoke execute on function public.void_transaction(uuid, uuid, text) from public, anon;
revoke execute on function public.transactions_matching(date, date, uuid, uuid, text, bigint) from public, anon;
revoke execute on function public.list_transactions(date, date, text, uuid, uuid, text, bigint, boolean, date, timestamptz, uuid, integer) from public, anon;
revoke execute on function public.transaction_summary(date, date, uuid, uuid, text, bigint) from public, anon;
revoke execute on function public.ensure_my_expense_categories() from public, anon;

grant execute on function public.record_transaction(text, uuid, bigint, date, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.edit_transaction(uuid, uuid, bigint, date, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.void_transaction(uuid, uuid, text) to authenticated;
grant execute on function public.transactions_matching(date, date, uuid, uuid, text, bigint) to authenticated;
grant execute on function public.list_transactions(date, date, text, uuid, uuid, text, bigint, boolean, date, timestamptz, uuid, integer) to authenticated;
grant execute on function public.transaction_summary(date, date, uuid, uuid, text, bigint) to authenticated;
grant execute on function public.ensure_my_expense_categories() to authenticated;

-- Column grants: the new columns a client (or an invoker function) may write. user_id,
-- voided_at on insert, created_at and the void fields on insert stay server-controlled.
grant insert (counter_account_id, payment_mode, replaces_id) on table public.transactions to authenticated;
grant update (void_idempotency_key) on table public.transactions to authenticated;
grant insert (icon) on table public.categories to authenticated;
grant update (icon) on table public.categories to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill existing users
-- ---------------------------------------------------------------------------

select public.backfill_default_expense_categories();
