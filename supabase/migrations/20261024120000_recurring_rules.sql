-- Sprint 4 Phase 2: recurring rules, skips, confirming an occurrence, and the Membership /
-- Subscription default categories.
--
-- Rules (docs/sprint-plan.md decisions 2026-10-23 and 2026-10-24):
--   * A rule never posts by itself. Its due occurrence is confirmed (or skipped) by the person.
--   * Occurrences are anchored to the start date: weekly every 7 days; monthly, quarterly
--     and yearly on the start day, or the month's last day when the month is shorter.
--     recurring_is_occurrence() is the database copy of packages/domain/src/recurrence.ts.
--   * An occurrence can be confirmed or skipped only within start..min(end, today), with
--     "today" in the person's time zone (user_local_today).
--   * Confirming records the transaction and links it to the rule and occurrence date in one
--     row (transactions.recurring_rule_id / occurrence_date), in one function, once per
--     request key. A rule and occurrence date post at most once among non-voided entries
--     (partial unique index), so voiding the entry makes the occurrence due again. The entry
--     date is the date the person confirms (not in the future); the category is the rule's.
--   * A rule's type, frequency and start date never change; amount, accounts, category,
--     payment mode, note and end date can (future occurrences only; entries never change).
--     The end date can't move before an occurrence already posted.
--   * A rule whose account or category is archived "needs attention": it can't post until
--     fixed (the transaction checks refuse archived accounts and categories). Archived
--     rules can be restored.
--   * A skip can be undone only while it is the rule's latest handled occurrence.
--   * Expense categories: a stable internal key ('membership', 'subscription') marks the two
--     new defaults; clients can't write it. New users get 14 defaults; existing users get
--     the two keyed ones from a one-time idempotent backfill (the old function skipped
--     anyone who already had expense categories).
--
-- New error codes (mapped to messages in packages/api):
--   FC018 recurring item is archived
--   FC019 not an occurrence of the rule, or outside start..min(end, today)
--   FC020 occurrence already handled (posted or skipped)
--   FC021 skip can't be undone (not the latest handled occurrence)
--   FC022 end date before an occurrence already posted
--   FC023 recurring item not found
-- Existing codes reused: FC001 archived account, FC002 currency, FC003 future date,
-- FC006 category not usable, FC007 request key reused, FC009 immutable field, FC010
-- account not found, FC015 transfer currencies, FC016 payment mode needs a bank account,
-- FC017 nothing changed.

-- ---------------------------------------------------------------------------
-- Categories: stable key, two new icons
-- ---------------------------------------------------------------------------

alter table public.categories add column key text;

alter table public.categories add constraint categories_key check (
  key is null or (kind = 'expense' and key in ('membership', 'subscription'))
);

-- One category per key per person, archived or not (a key never moves to another row).
create unique index categories_user_key_idx on public.categories (user_id, key) where key is not null;

comment on column public.categories.key is
  'Stable internal key of a default category (membership, subscription). Groups recurring costs whatever the name. Not client-writable.';

alter table public.categories drop constraint categories_icon;
alter table public.categories add constraint categories_icon check (
  icon is null
  or (kind = 'expense' and icon in (
    'food', 'groceries', 'transport', 'home', 'bills', 'shopping', 'health', 'fun',
    'education', 'travel', 'care', 'membership', 'subscription', 'other'
  ))
);

-- ---------------------------------------------------------------------------
-- Occurrence dates (the database copy of packages/domain recurrence.ts)
-- ---------------------------------------------------------------------------

-- Helper: p_date is a whole number of p_step months after p_start, on the start day or on
-- the month's last day when the month is shorter. Dates are cast to timestamp (without
-- time zone), so the result never depends on the session's time zone.
create function public.recurring_month_match(p_start date, p_date date, p_step integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select ((pg_catalog.date_part('year', p_date::timestamp) * 12 + pg_catalog.date_part('month', p_date::timestamp))
          - (pg_catalog.date_part('year', p_start::timestamp) * 12 + pg_catalog.date_part('month', p_start::timestamp)))::integer % p_step = 0
     and pg_catalog.date_part('day', p_date::timestamp)::integer = least(
           pg_catalog.date_part('day', p_start::timestamp)::integer,
           pg_catalog.date_part('day', pg_catalog.date_trunc('month', p_date::timestamp) + interval '1 month - 1 day')::integer);
$$;

-- Whether p_date is an occurrence of a schedule starting on p_start (and ending on p_end,
-- inclusive, if set). NULL-safe: any NULL input gives false.
create function public.recurring_is_occurrence(p_frequency text, p_start date, p_end date, p_date date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_date >= p_start
    and (p_end is null or p_date <= p_end)
    and case p_frequency
      when 'weekly' then (p_date - p_start) % 7 = 0
      when 'monthly' then public.recurring_month_match(p_start, p_date, 1)
      when 'quarterly' then public.recurring_month_match(p_start, p_date, 3)
      when 'yearly' then public.recurring_month_match(p_start, p_date, 12)
      else false
    end,
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- recurring_rules
-- ---------------------------------------------------------------------------

create table public.recurring_rules (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type               text not null,
  amount_minor       bigint not null,
  currency           text not null,
  -- income: the account it goes into; expense and transfer: the account it leaves.
  account_id         uuid not null,
  -- transfer only: the account it goes into.
  counter_account_id uuid,
  -- income and expense only.
  category_id        uuid,
  payment_mode       text,
  note               text,
  frequency          text not null,
  start_date         date not null,
  end_date           date,
  archived_at        timestamptz,
  idempotency_key    uuid not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint recurring_rules_type check (type in ('income', 'expense', 'transfer')),
  constraint recurring_rules_amount_range check (amount_minor > 0 and amount_minor <= 10000000000000),
  constraint recurring_rules_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint recurring_rules_shape check (
    (type = 'transfer' and counter_account_id is not null and category_id is null
       and counter_account_id <> account_id)
    or (type in ('income', 'expense') and counter_account_id is null and category_id is not null)
  ),
  constraint recurring_rules_payment_mode check (
    payment_mode is null
    or (type = 'expense' and payment_mode in ('upi', 'debit_card', 'net_banking', 'cheque'))
  ),
  constraint recurring_rules_frequency check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  constraint recurring_rules_start_range check (start_date >= date '1970-01-01'),
  constraint recurring_rules_end_after_start check (end_date is null or end_date >= start_date),
  constraint recurring_rules_note_length check (note is null or char_length(note) <= 280),
  constraint recurring_rules_idempotency_unique unique (user_id, idempotency_key),
  constraint recurring_rules_id_user_unique unique (id, user_id),
  -- Same-user ownership of every referenced row. Clients cannot delete accounts or
  -- categories (archive only), so CASCADE only runs when the whole user is deleted.
  constraint recurring_rules_account_owned
    foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  constraint recurring_rules_counter_account_owned
    foreign key (counter_account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  constraint recurring_rules_category_owned
    foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);

create index recurring_rules_user_idx on public.recurring_rules (user_id) where archived_at is null;
create index recurring_rules_account_idx on public.recurring_rules (account_id);
create index recurring_rules_counter_account_idx on public.recurring_rules (counter_account_id) where counter_account_id is not null;
create index recurring_rules_category_idx on public.recurring_rules (category_id) where category_id is not null;

comment on table public.recurring_rules is
  'Recurring income, expense and transfer rules. Nothing posts by itself: due occurrences are confirmed (confirm_recurring_occurrence) or skipped.';

create function public.recurring_rules_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_account public.accounts;
  v_counter public.accounts;
  v_category public.categories;
  v_old_account uuid;
  v_old_counter uuid;
  v_old_category uuid;
  v_last_posted date;
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.user_id, new.type, new.frequency, new.start_date, new.idempotency_key, new.created_at)
       is distinct from
       (old.id, old.user_id, old.type, old.frequency, old.start_date, old.idempotency_key, old.created_at)
    then
      raise exception 'A recurring item''s type, frequency and start date can''t change' using errcode = 'FC009';
    end if;
    v_old_account := old.account_id;
    v_old_counter := old.counter_account_id;
    v_old_category := old.category_id;

    -- Archive stamps server time once; restore clears it.
    if old.archived_at is null and new.archived_at is not null then
      new.archived_at := pg_catalog.now();
    elsif old.archived_at is not null and new.archived_at is not null then
      new.archived_at := old.archived_at;
    end if;

    -- The end date can't cut off an occurrence already posted (and not voided).
    if new.end_date is not null and new.end_date is distinct from old.end_date then
      select max(t.occurrence_date) into v_last_posted
      from public.transactions as t
      where t.recurring_rule_id = new.id and t.voided_at is null;
      if v_last_posted > new.end_date then
        raise exception 'The end date is before an entry already saved (%)', v_last_posted using errcode = 'FC022';
      end if;
    end if;
  else
    new.archived_at := null;
    new.created_at := pg_catalog.now();
  end if;

  -- Archived accounts and categories can't be chosen; an edit may keep the one it has
  -- (the rule then still needs attention before it can post).
  select * into v_account from public.accounts as a where a.id = new.account_id;
  if v_account.archived_at is not null and new.account_id is distinct from v_old_account then
    raise exception 'Account is archived' using errcode = 'FC001';
  end if;
  if v_account.currency <> new.currency then
    raise exception 'Currency must match the account (%)', v_account.currency using errcode = 'FC002';
  end if;

  if new.type = 'transfer' then
    select * into v_counter from public.accounts as a where a.id = new.counter_account_id;
    if v_counter.archived_at is not null and new.counter_account_id is distinct from v_old_counter then
      raise exception 'Account is archived' using errcode = 'FC001';
    end if;
    if v_counter.currency <> v_account.currency then
      raise exception 'Both accounts of a transfer need the same currency' using errcode = 'FC015';
    end if;
  end if;

  if new.category_id is not null then
    select * into v_category from public.categories as c where c.id = new.category_id;
    if v_category.kind <> new.type
       or (v_category.archived_at is not null and new.category_id is distinct from v_old_category) then
      raise exception 'Category cannot be used for this entry' using errcode = 'FC006';
    end if;
  end if;

  if new.payment_mode is not null and v_account.kind <> 'bank' then
    raise exception 'A payment mode needs a bank account' using errcode = 'FC016';
  end if;
  return new;
end;
$$;

create trigger recurring_rules_validate
  before insert or update on public.recurring_rules
  for each row execute function public.recurring_rules_validate();

create trigger recurring_rules_set_updated_at
  before update on public.recurring_rules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Transactions: link to a rule's occurrence
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column recurring_rule_id uuid,
  add column occurrence_date date;

alter table public.transactions add constraint transactions_recurring_pair
  check ((recurring_rule_id is null) = (occurrence_date is null));

-- Same-user rule. NO ACTION: a rule with linked entries can never be deleted on its own
-- (clients have no delete grant anyway). Deleting the whole user still works: the entries
-- and the rule go in the same statement, and NO ACTION is checked at its end.
alter table public.transactions add constraint transactions_recurring_rule_owned
  foreign key (recurring_rule_id, user_id) references public.recurring_rules (id, user_id) on delete no action;

-- A rule's occurrence posts at most once among non-voided entries. Voiding the entry
-- frees the occurrence (it is due again); an edit voids the old version before inserting
-- the new one, which carries the same link.
create unique index transactions_recurring_once
  on public.transactions (recurring_rule_id, occurrence_date)
  where recurring_rule_id is not null and voided_at is null;

comment on column public.transactions.recurring_rule_id is
  'The recurring rule this entry confirmed (with occurrence_date). Set only by confirm_recurring_occurrence and carried over by edits.';
comment on column public.transactions.occurrence_date is
  'The rule''s occurrence this entry confirmed. occurred_on is the date the person entered.';

-- ---------------------------------------------------------------------------
-- recurring_skips
-- ---------------------------------------------------------------------------

create table public.recurring_skips (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rule_id         uuid not null,
  occurrence_date date not null,
  reason          text,
  idempotency_key uuid not null,
  -- Set when the skip is undone; the row stays for history.
  undone_at       timestamptz,
  created_at      timestamptz not null default now(),

  constraint recurring_skips_reason_length
    check (reason is null or char_length(pg_catalog.btrim(reason)) between 1 and 200),
  constraint recurring_skips_idempotency_unique unique (user_id, idempotency_key),
  constraint recurring_skips_rule_owned
    foreign key (rule_id, user_id) references public.recurring_rules (id, user_id) on delete cascade
);

-- One active skip per occurrence.
create unique index recurring_skips_once on public.recurring_skips (rule_id, occurrence_date) where undone_at is null;

comment on table public.recurring_skips is
  'Occurrences the person skipped (nothing posted). Undone skips keep their row with undone_at.';

-- Insert: a valid, unhandled occurrence of an active rule, on or before today.
-- Update: only undoing, and only the rule's latest handled occurrence.
create function public.recurring_skips_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rule public.recurring_rules;
begin
  select * into v_rule from public.recurring_rules as r where r.id = new.rule_id;
  if v_rule.id is null then
    raise exception 'Recurring item not found' using errcode = 'FC023';
  end if;

  if tg_op = 'INSERT' then
    if v_rule.archived_at is not null then
      raise exception 'This recurring item is archived' using errcode = 'FC018';
    end if;
    if not public.recurring_is_occurrence(v_rule.frequency, v_rule.start_date, v_rule.end_date, new.occurrence_date)
       or new.occurrence_date > public.user_local_today(v_rule.user_id) then
      raise exception 'Not a due date of this recurring item' using errcode = 'FC019';
    end if;
    if exists (select 1 from public.transactions as t
               where t.recurring_rule_id = new.rule_id and t.occurrence_date = new.occurrence_date
                 and t.voided_at is null) then
      raise exception 'This date was already handled' using errcode = 'FC020';
    end if;
    new.undone_at := null;
    new.created_at := pg_catalog.now();
    return new;
  end if;

  if (new.id, new.user_id, new.rule_id, new.occurrence_date, new.reason, new.idempotency_key, new.created_at)
     is distinct from
     (old.id, old.user_id, old.rule_id, old.occurrence_date, old.reason, old.idempotency_key, old.created_at)
     or old.undone_at is not null or new.undone_at is null then
    raise exception 'A skip can only be undone, once' using errcode = 'FC009';
  end if;
  if exists (select 1 from public.transactions as t
             where t.recurring_rule_id = old.rule_id and t.occurrence_date > old.occurrence_date
               and t.voided_at is null)
     or exists (select 1 from public.recurring_skips as s
                where s.rule_id = old.rule_id and s.occurrence_date > old.occurrence_date
                  and s.undone_at is null) then
    raise exception 'Only the latest handled date can be undone' using errcode = 'FC021';
  end if;
  new.undone_at := pg_catalog.now();
  return new;
end;
$$;

create trigger recurring_skips_validate
  before insert or update on public.recurring_skips
  for each row execute function public.recurring_skips_validate();

-- ---------------------------------------------------------------------------
-- Insert validation (replaces the 20261023120000 version; adds the recurring link)
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
  v_rule public.recurring_rules;
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
    -- An edit keeps the recurring link of the version it replaces.
    if (new.recurring_rule_id, new.occurrence_date)
       is distinct from (v_original.recurring_rule_id, v_original.occurrence_date) then
      raise exception 'An edit cannot change the recurring item it confirmed' using errcode = 'FC009';
    end if;
  elsif new.recurring_rule_id is not null then
    -- Confirming an occurrence: an active rule, its type and category, a valid date on or
    -- before today, not skipped. (Posting twice is stopped by transactions_recurring_once.)
    select * into v_rule from public.recurring_rules as r where r.id = new.recurring_rule_id;
    if v_rule.id is null then
      raise exception 'Recurring item not found' using errcode = 'FC023';
    end if;
    if v_rule.archived_at is not null then
      raise exception 'This recurring item is archived' using errcode = 'FC018';
    end if;
    if v_rule.type <> new.type then
      raise exception 'The entry type must match the recurring item' using errcode = 'FC009';
    end if;
    if new.category_id is distinct from v_rule.category_id then
      raise exception 'The category comes from the recurring item' using errcode = 'FC006';
    end if;
    if not public.recurring_is_occurrence(v_rule.frequency, v_rule.start_date, v_rule.end_date, new.occurrence_date)
       or new.occurrence_date > public.user_local_today(new.user_id) then
      raise exception 'Not a due date of this recurring item' using errcode = 'FC019';
    end if;
    if exists (select 1 from public.recurring_skips as s
               where s.rule_id = new.recurring_rule_id and s.occurrence_date = new.occurrence_date
                 and s.undone_at is null) then
      raise exception 'This date was already handled' using errcode = 'FC020';
    end if;
  end if;

  -- Archived accounts and categories can't be used for new entries. An edit may keep the
  -- one its original already used (same slot), so old entries stay correctable.
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
-- Update guard (replaces the 20261023120000 version): the link is immutable too
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
      new.payment_mode, new.replaces_id, new.idempotency_key, new.created_at,
      new.recurring_rule_id, new.occurrence_date)
     is distinct from
     (old.id, old.user_id, old.type, old.amount_minor, old.currency, old.account_id,
      old.counter_account_id, old.category_id, old.occurred_on, old.note,
      old.payment_mode, old.replaces_id, old.idempotency_key, old.created_at,
      old.recurring_rule_id, old.occurrence_date)
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
-- edit_transaction (replaces the 20261023120000 version): carries the recurring link
-- ---------------------------------------------------------------------------

create or replace function public.edit_transaction(
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
     occurred_on, note, payment_mode, idempotency_key, replaces_id,
     recurring_rule_id, occurrence_date)
  values
    (v_old.type, p_amount_minor, v_currency, p_account_id, p_counter_account_id, p_category_id,
     p_occurred_on, v_note, p_payment_mode, p_idempotency_key, v_old.id,
     v_old.recurring_rule_id, v_old.occurrence_date)
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rule functions (SECURITY INVOKER: RLS, column grants and the triggers apply)
-- ---------------------------------------------------------------------------

-- Creates a rule once per request key. Replaying the key with the same details returns the
-- rule; with different details it is FC007.
create function public.create_recurring_rule(
  p_idempotency_key uuid,
  p_type text,
  p_amount_minor bigint,
  p_frequency text,
  p_start_date date,
  p_account_id uuid,
  p_category_id uuid default null,
  p_counter_account_id uuid default null,
  p_payment_mode text default null,
  p_note text default null,
  p_end_date date default null
)
returns public.recurring_rules
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_currency text;
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_row public.recurring_rules;
begin
  select * into v_row from public.recurring_rules as r
  where r.user_id = (select auth.uid()) and r.idempotency_key = p_idempotency_key;

  if v_row.id is null then
    select a.currency into v_currency from public.accounts as a where a.id = p_account_id;
    if v_currency is null then
      raise exception 'Account not found' using errcode = 'FC010';
    end if;
    if p_counter_account_id is not null
       and not exists (select 1 from public.accounts as a where a.id = p_counter_account_id) then
      raise exception 'Account not found' using errcode = 'FC010';
    end if;

    insert into public.recurring_rules
      (type, amount_minor, currency, account_id, counter_account_id, category_id, payment_mode,
       note, frequency, start_date, end_date, idempotency_key)
    values
      (p_type, p_amount_minor, v_currency, p_account_id, p_counter_account_id, p_category_id, p_payment_mode,
       v_note, p_frequency, p_start_date, p_end_date, p_idempotency_key)
    on conflict on constraint recurring_rules_idempotency_unique do nothing
    returning * into v_row;

    if v_row.id is not null then
      return v_row;
    end if;
    select * into v_row from public.recurring_rules as r
    where r.user_id = (select auth.uid()) and r.idempotency_key = p_idempotency_key;
  end if;

  if (v_row.type, v_row.amount_minor, v_row.frequency, v_row.start_date, v_row.account_id,
      v_row.category_id, v_row.counter_account_id, v_row.payment_mode, v_row.note, v_row.end_date)
     is distinct from
     (p_type, p_amount_minor, p_frequency, p_start_date, p_account_id,
      p_category_id, p_counter_account_id, p_payment_mode, v_note, p_end_date) then
    raise exception 'This request key was already used for a different recurring item' using errcode = 'FC007';
  end if;
  return v_row;
end;
$$;

-- Changes what future occurrences post. Type, frequency and start date stay (the trigger
-- refuses them anyway). Saving the same values is FC017.
create function public.update_recurring_rule(
  p_rule_id uuid,
  p_amount_minor bigint,
  p_account_id uuid,
  p_category_id uuid default null,
  p_counter_account_id uuid default null,
  p_payment_mode text default null,
  p_note text default null,
  p_end_date date default null
)
returns public.recurring_rules
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old public.recurring_rules;
  v_row public.recurring_rules;
  v_currency text;
  v_note text := nullif(pg_catalog.btrim(p_note), '');
begin
  select * into v_old from public.recurring_rules as r where r.id = p_rule_id for update;
  if v_old.id is null then
    raise exception 'Recurring item not found' using errcode = 'FC023';
  end if;

  if (v_old.amount_minor, v_old.account_id, v_old.category_id, v_old.counter_account_id,
      v_old.payment_mode, v_old.note, v_old.end_date)
     is not distinct from
     (p_amount_minor, p_account_id, p_category_id, p_counter_account_id,
      p_payment_mode, v_note, p_end_date) then
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

  update public.recurring_rules as r
  set amount_minor = p_amount_minor,
      currency = v_currency,
      account_id = p_account_id,
      category_id = p_category_id,
      counter_account_id = p_counter_account_id,
      payment_mode = p_payment_mode,
      note = v_note,
      end_date = p_end_date
  where r.id = p_rule_id
  returning * into v_row;
  return v_row;
end;
$$;

-- Archive (no longer due, kept with its entries) or restore. Repeating either returns the rule.
create function public.set_recurring_rule_archived(p_rule_id uuid, p_archived boolean)
returns public.recurring_rules
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.recurring_rules;
begin
  if p_archived is null then
    raise exception 'Archive or restore must be chosen' using errcode = '22023';
  end if;
  update public.recurring_rules as r
  set archived_at = case when p_archived then coalesce(r.archived_at, pg_catalog.now()) end
  where r.id = p_rule_id
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Recurring item not found' using errcode = 'FC023';
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirm and skip
-- ---------------------------------------------------------------------------

-- Records the entry for one occurrence of a rule, atomically, once per request key. The
-- type and category come from the rule; the amount, entry date, account(s), note and
-- payment mode come from the person (pre-filled from the rule). Retrying the key with the
-- same details returns the saved entry; with different details it is FC007.
create function public.confirm_recurring_occurrence(
  p_rule_id uuid,
  p_occurrence_date date,
  p_idempotency_key uuid,
  p_amount_minor bigint,
  p_occurred_on date,
  p_account_id uuid,
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
  v_rule public.recurring_rules;
  v_row public.transactions;
  v_currency text;
  v_note text := nullif(pg_catalog.btrim(p_note), '');
begin
  -- One confirmation per rule at a time: a second request waits here, then sees the first.
  select * into v_rule from public.recurring_rules as r where r.id = p_rule_id for update;
  if v_rule.id is null then
    raise exception 'Recurring item not found' using errcode = 'FC023';
  end if;

  select * into v_row from public.transactions as t
  where t.user_id = (select auth.uid()) and t.idempotency_key = p_idempotency_key;
  if v_row.id is not null then
    if (v_row.recurring_rule_id, v_row.occurrence_date, v_row.amount_minor, v_row.occurred_on,
        v_row.account_id, v_row.counter_account_id, v_row.note, v_row.payment_mode)
       is distinct from
       (p_rule_id, p_occurrence_date, p_amount_minor, p_occurred_on,
        p_account_id, p_counter_account_id, v_note, p_payment_mode) then
      raise exception 'This request key was already used for a different entry' using errcode = 'FC007';
    end if;
    return v_row;
  end if;

  if exists (select 1 from public.transactions as t
             where t.recurring_rule_id = p_rule_id and t.occurrence_date = p_occurrence_date
               and t.voided_at is null) then
    raise exception 'This date was already handled' using errcode = 'FC020';
  end if;

  select a.currency into v_currency from public.accounts as a where a.id = p_account_id;
  if v_currency is null then
    raise exception 'Account not found' using errcode = 'FC010';
  end if;
  if p_counter_account_id is not null
     and not exists (select 1 from public.accounts as a where a.id = p_counter_account_id) then
    raise exception 'Account not found' using errcode = 'FC010';
  end if;

  -- The insert trigger checks the rule is active, the date is an occurrence on or before
  -- today and not skipped, the accounts and category are usable, and the entry date.
  insert into public.transactions
    (type, amount_minor, currency, account_id, counter_account_id, category_id,
     occurred_on, note, payment_mode, idempotency_key, recurring_rule_id, occurrence_date)
  values
    (v_rule.type, p_amount_minor, v_currency, p_account_id, p_counter_account_id, v_rule.category_id,
     p_occurred_on, v_note, p_payment_mode, p_idempotency_key, p_rule_id, p_occurrence_date)
  returning * into v_row;
  return v_row;
end;
$$;

-- Skips one occurrence (nothing is posted), once per request key.
create function public.skip_recurring_occurrence(
  p_rule_id uuid,
  p_occurrence_date date,
  p_idempotency_key uuid,
  p_reason text default null
)
returns public.recurring_skips
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.recurring_skips;
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
begin
  perform 1 from public.recurring_rules as r where r.id = p_rule_id for update;
  if not found then
    raise exception 'Recurring item not found' using errcode = 'FC023';
  end if;

  select * into v_row from public.recurring_skips as s
  where s.user_id = (select auth.uid()) and s.idempotency_key = p_idempotency_key;
  if v_row.id is not null then
    if (v_row.rule_id, v_row.occurrence_date, v_row.reason) is distinct from (p_rule_id, p_occurrence_date, v_reason) then
      raise exception 'This request key was already used for a different skip' using errcode = 'FC007';
    end if;
    return v_row;
  end if;

  if exists (select 1 from public.recurring_skips as s
             where s.rule_id = p_rule_id and s.occurrence_date = p_occurrence_date and s.undone_at is null) then
    raise exception 'This date was already handled' using errcode = 'FC020';
  end if;

  -- The trigger checks the rule is active, the date is a due occurrence and not posted.
  insert into public.recurring_skips (rule_id, occurrence_date, reason, idempotency_key)
  values (p_rule_id, p_occurrence_date, v_reason, p_idempotency_key)
  returning * into v_row;
  return v_row;
end;
$$;

-- Undoes the active skip of an occurrence; only the rule's latest handled occurrence.
create function public.undo_recurring_skip(p_rule_id uuid, p_occurrence_date date)
returns public.recurring_skips
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.recurring_skips;
begin
  perform 1 from public.recurring_rules as r where r.id = p_rule_id for update;
  if not found then
    raise exception 'Recurring item not found' using errcode = 'FC023';
  end if;

  update public.recurring_skips as s
  set undone_at = pg_catalog.now()
  where s.rule_id = p_rule_id and s.occurrence_date = p_occurrence_date and s.undone_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'There is no skip to undo on this date' using errcode = 'FC021';
  end if;
  return v_row;
end;
$$;

-- Per rule, the latest posted (non-voided) and the latest skipped (not undone) occurrence.
-- The apps compute what is due from these with packages/domain: an occurrence is handled
-- when it equals one of them.
create view public.recurring_rule_progress
with (security_invoker = true)
as
select
  r.id      as rule_id,
  r.user_id as user_id,
  (select max(t.occurrence_date) from public.transactions as t
   where t.recurring_rule_id = r.id and t.voided_at is null) as last_posted_on,
  (select max(s.occurrence_date) from public.recurring_skips as s
   where s.rule_id = r.id and s.undone_at is null) as last_skipped_on
from public.recurring_rules as r;

comment on view public.recurring_rule_progress is
  'Latest posted and latest skipped occurrence per recurring rule (RLS of the underlying tables applies).';

-- ---------------------------------------------------------------------------
-- Default expense categories: 14, with the two keyed ones for everyone
-- ---------------------------------------------------------------------------

-- Creates the 12 classic defaults for a user who has no expense categories yet (archived
-- ones count, so defaults a user removed are never re-created), and the keyed Membership
-- and Subscription defaults for every user who doesn't have that key yet. A category the
-- user already named exactly that (without a key) takes the key instead of getting a
-- duplicate: an active one first, else an archived one (which stays archived). Idempotent.
-- Returns the number of categories created.
create or replace function public.ensure_default_expense_categories(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  created integer := 0;
  n integer;
  d record;
begin
  if p_user_id is null then
    return 0;
  end if;

  if not exists (select 1 from public.categories as c where c.user_id = p_user_id and c.kind = 'expense') then
    insert into public.categories (user_id, kind, name, icon, is_default)
    select p_user_id, 'expense', v.name, v.icon, true
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
    ) as v (name, icon)
    on conflict do nothing;
    get diagnostics n = row_count;
    created := n;
  end if;

  for d in
    select * from (values ('membership', 'Membership'), ('subscription', 'Subscription')) as v (key, name)
  loop
    continue when exists (select 1 from public.categories as c where c.user_id = p_user_id and c.key = d.key);

    update public.categories as c
    set key = d.key, icon = coalesce(c.icon, d.key)
    where c.id = (
      select c2.id from public.categories as c2
      where c2.user_id = p_user_id and c2.kind = 'expense' and c2.key is null
        and pg_catalog.lower(pg_catalog.btrim(c2.name)) = pg_catalog.lower(d.name)
      order by c2.archived_at is not null, c2.created_at
      limit 1
    );
    get diagnostics n = row_count;
    if n = 0 then
      insert into public.categories (user_id, kind, name, icon, is_default, key)
      values (p_user_id, 'expense', d.name, d.key, true, d.key)
      on conflict do nothing;
      get diagnostics n = row_count;
      created := created + n;
    end if;
  end loop;
  return created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on table public.recurring_rules, public.recurring_skips, public.recurring_rule_progress
  from anon, authenticated;

grant select on table public.recurring_rules to authenticated;
grant insert (type, amount_minor, currency, account_id, counter_account_id, category_id, payment_mode,
              note, frequency, start_date, end_date, idempotency_key)
  on table public.recurring_rules to authenticated;
grant update (amount_minor, currency, account_id, counter_account_id, category_id, payment_mode,
              note, end_date, archived_at)
  on table public.recurring_rules to authenticated;

grant select on table public.recurring_skips to authenticated;
grant insert (rule_id, occurrence_date, reason, idempotency_key) on table public.recurring_skips to authenticated;
grant update (undone_at) on table public.recurring_skips to authenticated;

grant select on table public.recurring_rule_progress to authenticated;

-- The link columns, for confirm_recurring_occurrence (an invoker function). The insert
-- trigger validates any direct insert the same way. categories.key gets no client grant.
grant insert (recurring_rule_id, occurrence_date) on table public.transactions to authenticated;

alter table public.recurring_rules enable row level security;
alter table public.recurring_skips enable row level security;

create policy recurring_rules_select_own on public.recurring_rules
  for select to authenticated using ((select auth.uid()) = user_id);
create policy recurring_rules_insert_own on public.recurring_rules
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy recurring_rules_update_own on public.recurring_rules
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy recurring_skips_select_own on public.recurring_skips
  for select to authenticated using ((select auth.uid()) = user_id);
create policy recurring_skips_insert_own on public.recurring_skips
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy recurring_skips_update_own on public.recurring_skips
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke execute on function public.recurring_is_occurrence(text, date, date, date) from public, anon;
revoke execute on function public.recurring_month_match(date, date, integer) from public, anon;
revoke execute on function public.recurring_rules_validate() from public, anon, authenticated;
revoke execute on function public.recurring_skips_validate() from public, anon, authenticated;
revoke execute on function public.create_recurring_rule(uuid, text, bigint, text, date, uuid, uuid, uuid, text, text, date) from public, anon;
revoke execute on function public.update_recurring_rule(uuid, bigint, uuid, uuid, uuid, text, text, date) from public, anon;
revoke execute on function public.set_recurring_rule_archived(uuid, boolean) from public, anon;
revoke execute on function public.confirm_recurring_occurrence(uuid, date, uuid, bigint, date, uuid, uuid, text, text) from public, anon;
revoke execute on function public.skip_recurring_occurrence(uuid, date, uuid, text) from public, anon;
revoke execute on function public.undo_recurring_skip(uuid, date) from public, anon;

grant execute on function public.recurring_is_occurrence(text, date, date, date) to authenticated;
grant execute on function public.recurring_month_match(date, date, integer) to authenticated;
grant execute on function public.create_recurring_rule(uuid, text, bigint, text, date, uuid, uuid, uuid, text, text, date) to authenticated;
grant execute on function public.update_recurring_rule(uuid, bigint, uuid, uuid, uuid, text, text, date) to authenticated;
grant execute on function public.set_recurring_rule_archived(uuid, boolean) to authenticated;
grant execute on function public.confirm_recurring_occurrence(uuid, date, uuid, bigint, date, uuid, uuid, text, text) to authenticated;
grant execute on function public.skip_recurring_occurrence(uuid, date, uuid, text) to authenticated;
grant execute on function public.undo_recurring_skip(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill existing users (idempotent: running it again creates nothing)
-- ---------------------------------------------------------------------------

select public.backfill_default_expense_categories();
