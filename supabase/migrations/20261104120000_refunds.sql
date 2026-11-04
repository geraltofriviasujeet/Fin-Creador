-- Sprint 9c: refunds.
--
-- Model (docs/sprint-plan.md, Sprint 9c decisions 2026-11-04):
--   * A refund is its own entry type: a positive amount INTO one account (bank, cash, other or
--     a card), in an EXPENSE category, never a transfer. It is not income.
--   * Spending nets refunds: period expenses, the dashboard buckets and category rows (and so
--     budgets) are expenses − refunds. A refund counts on its own date, so a refund in a later
--     month lowers that month's spending; a category's net for a period can be below zero.
--   * Balances: a refund is an inflow (account_balances, account_balances_at, liability_owed,
--     set_cash_on_hand). Into a money account it raises Total available; on a card it lowers
--     what is owed and may take the card into credit (balance above zero). A card in credit is
--     an asset in net worth (packages/domain netWorth "credit" line, already in place) and is
--     never in Total available (money account kinds only).
--   * Link: refund_of_id optionally points at the purchase (an expense) it reverses. Only a
--     LINKED refund is capped: the live (not voided) refunds linked to one purchase add up to at
--     most its amount (FC055). UNLINKED refunds are not capped. A link needs a live expense of
--     the same user and currency that is not a loan, card or borrowing payment entry or a
--     statement difference (FC056), dated on or before the refund (FC057).
--   * The cap counts live rows only: editing a refund (void + insert) frees its old amount first.
--   * A purchase that is voided keeps its refunds: they stay posted and their link clears (set to
--     null by transactions_refund_links_clear, whatever path voided it). An edit of the purchase
--     moves the links to its new version (edit_transaction); an edit whose new amount is below
--     the linked refunds, or whose date is after one of them, is refused (FC055 / FC057).
--   * refund_of_id is the only column of a live entry that may change, and only under the
--     transaction-local mark fin_creador.refund_link (set only by the two functions above).
--   * Card statements: liability_owed now counts refunds, so a refunded purchase no longer
--     looks owed and the statement difference shrinks accordingly. A card in credit on the
--     statement date with a zero bill posts no difference (a statement total is never below 0,
--     so a credit balance prints as 0); with a bill above zero the difference is bill − owed,
--     as before (owed may now be negative).
--   * Refunds never pay a card bill (card_bill_paid counts transfers only) and are not recurring.
--
-- New error codes (mapped in packages/api):
--   FC055 refunds would add up to more than the purchase (detail: what is left to refund)
--   FC056 that entry can't take a refund        FC057 a refund is dated before its purchase
-- Reused: FC006 (category kind), FC008, FC009, FC014, FC036, FC049 (now "expenses and refunds").

-- ---------------------------------------------------------------------------
-- Table: the refund type and the link
-- ---------------------------------------------------------------------------

alter table public.transactions drop constraint transactions_type;
alter table public.transactions add constraint transactions_type
  check (type in ('income', 'expense', 'transfer', 'refund'));

alter table public.transactions add column refund_of_id uuid;

-- Same-user link. CASCADE only runs when the whole user is deleted (clients cannot delete entries).
alter table public.transactions add constraint transactions_refund_of_owned
  foreign key (refund_of_id, user_id) references public.transactions (id, user_id) on delete cascade;
alter table public.transactions add constraint transactions_refund_of_shape
  check (refund_of_id is null or (type = 'refund' and refund_of_id <> id));

create index transactions_refund_of_idx on public.transactions (refund_of_id)
  where refund_of_id is not null;

comment on column public.transactions.refund_of_id is
  'Refunds only: the purchase (expense) this refund reverses, or null. Cleared when that purchase is voided; moved to its new version when it is edited.';
comment on table public.transactions is
  'Ledger of income, expense, transfer and refund entries. Rows never change except a one-way void (and a refund''s link, see refund_of_id); an edit voids the old version and adds a new one (replaces_id).';

-- ---------------------------------------------------------------------------
-- Link check (insert trigger, edit relink)
-- ---------------------------------------------------------------------------

-- Checks p_refund's link and locks the purchase, so two refunds against it are checked one
-- after the other. Live refunds only; p_refund itself is left out of the sum.
create function public.refund_check_link(p_refund public.transactions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_target public.transactions;
  v_linked bigint;
begin
  select * into v_target from public.transactions as t where t.id = p_refund.refund_of_id for update;
  if v_target.id is null then
    raise exception 'Purchase not found' using errcode = 'FC008';
  end if;
  if v_target.voided_at is not null then
    raise exception 'This purchase was changed elsewhere' using errcode = 'FC014';
  end if;
  if v_target.type <> 'expense'
     or v_target.currency <> p_refund.currency
     or v_target.due_payment_id is not null
     or v_target.liability_payment_id is not null
     or exists (select 1 from public.card_statements as s where s.difference_transaction_id = v_target.id) then
    raise exception 'This entry can''t take a refund' using errcode = 'FC056';
  end if;
  if p_refund.occurred_on < v_target.occurred_on then
    raise exception 'A refund can''t be dated before its purchase' using errcode = 'FC057';
  end if;

  select coalesce(sum(r.amount_minor), 0)::bigint into v_linked
  from public.transactions as r
  where r.refund_of_id = v_target.id and r.voided_at is null and r.id <> p_refund.id;
  if v_linked + p_refund.amount_minor > v_target.amount_minor then
    raise exception 'Refunds can''t add up to more than the purchase' using errcode = 'FC055',
      detail = greatest(v_target.amount_minor - v_linked, 0)::text;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Insert validation (replaces the 20261024120000 version; adds refunds)
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
    -- And a refund keeps its link (as it is now: null if its purchase was voided).
    if new.refund_of_id is distinct from v_original.refund_of_id then
      raise exception 'An edit cannot change the purchase a refund is linked to' using errcode = 'FC009';
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

  -- A refund takes an expense category; income and expense take their own kind.
  if new.category_id is not null then
    select * into v_category from public.categories as c where c.id = new.category_id;
    if v_category.kind <> (case when new.type = 'refund' then 'expense' else new.type end)
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

  if new.refund_of_id is not null then
    perform public.refund_check_link(new);
  end if;

  new.voided_at := null;
  new.void_reason := null;
  new.void_idempotency_key := null;
  new.created_at := pg_catalog.now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Update guard (replaces the 20261024120000 version): a refund's link may change under the mark
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

  -- A live refund's link: cleared when its purchase is voided, moved when it is edited, never
  -- together with a void and never without the mark.
  if new.refund_of_id is distinct from old.refund_of_id then
    if pg_catalog.current_setting('fin_creador.refund_link', true) is distinct from 'on'
       or new.voided_at is not null then
      raise exception 'Ledger entries cannot be edited' using errcode = 'FC009';
    end if;
    if new.refund_of_id is not null then
      perform public.refund_check_link(new);
    end if;
  end if;

  -- A void reason or void key without a void, or a void without a key, fails a CHECK.
  if new.voided_at is not null then
    new.voided_at := pg_catalog.now(); -- server time, whatever the client sent
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A voided purchase: its refunds stay, their link clears (every void path, direct updates too)
-- ---------------------------------------------------------------------------

create function public.transactions_refund_links_clear()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mark text := pg_catalog.current_setting('fin_creador.refund_link', true);
begin
  perform pg_catalog.set_config('fin_creador.refund_link', 'on', true);
  update public.transactions as r
  set refund_of_id = null
  where r.refund_of_id = old.id and r.voided_at is null;
  perform pg_catalog.set_config('fin_creador.refund_link', coalesce(v_mark, ''), true);
  return null;
end;
$$;

create trigger transactions_refund_links_clear
  after update of voided_at on public.transactions
  for each row
  when (old.voided_at is null and new.voided_at is not null and old.type = 'expense')
  execute function public.transactions_refund_links_clear();

-- ---------------------------------------------------------------------------
-- Cards take refunds (replaces the 20261028180000 version)
-- ---------------------------------------------------------------------------

-- Direct entries on liability accounts: only card purchases and refunds (on or after the day
-- the card was added). Payment entries, a statement's difference expense and a borrowing's
-- receipt change only through their own functions.
create or replace function public.transactions_liability_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_account public.accounts;
begin
  if pg_catalog.current_setting('fin_creador.loan_write', true) is not distinct from 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.due_payment_id is not null or new.liability_payment_id is not null then
      raise exception 'Payments are recorded from the loan, card or borrowing' using errcode = 'FC032';
    end if;
    if exists (
      select 1 from public.accounts as a
      where a.id = new.counter_account_id and public.is_liability_kind(a.kind)
    ) then
      raise exception 'Pay a loan, card or borrowing from its own page' using errcode = 'FC032';
    end if;
    select * into v_account from public.accounts as a where a.id = new.account_id;
    if public.is_liability_kind(v_account.kind) then
      if v_account.kind <> 'card' then
        raise exception 'Loan and borrowing entries are recorded from the loan or borrowing' using errcode = 'FC032';
      end if;
      if new.type not in ('expense', 'refund') then
        raise exception 'Only expenses and refunds can be recorded on a card' using errcode = 'FC049';
      end if;
      if new.occurred_on < v_account.opening_balance_date then
        raise exception 'Purchases before the card was added are in its opening amount owed' using errcode = 'FC036';
      end if;
    end if;
  elsif old.due_payment_id is not null or old.liability_payment_id is not null
        or exists (select 1 from public.card_statements as s where s.difference_transaction_id = old.id)
        or exists (select 1 from public.borrowings as b where b.receipt_transaction_id = old.id) then
    raise exception 'Change this from the loan, card or borrowing' using errcode = 'FC032';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Balances: a refund is an inflow
-- ---------------------------------------------------------------------------

create or replace view public.account_balances
with (security_invoker = true)
as
select
  a.id      as account_id,
  a.user_id as user_id,
  coalesce(sum(t.amount_minor) filter (
    where t.type in ('income', 'refund') or (t.type = 'transfer' and t.counter_account_id = a.id)
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

create or replace function public.account_balances_at(p_dates date[])
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
            where t.type in ('income', 'refund') or (t.type = 'transfer' and t.counter_account_id = l.id)), 0)
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

-- What a liability account owes (negative: a card in credit).
create or replace function public.liability_owed(p_account_id uuid, p_as_of date default null)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select -(a.opening_balance_minor + coalesce(sum(
           case when t.type in ('income', 'refund') or t.counter_account_id = a.id then t.amount_minor else -t.amount_minor end
         ), 0))::bigint
  from public.accounts as a
  left join public.transactions as t
    on (t.account_id = a.id or t.counter_account_id = a.id)
    and t.voided_at is null
    and t.occurred_on >= a.opening_balance_date
    and (p_as_of is null or t.occurred_on <= p_as_of)
  where a.id = p_account_id
  group by a.id, a.opening_balance_minor;
$$;

create or replace function public.set_cash_on_hand(p_account_id uuid, p_amount_minor bigint)
returns public.accounts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account public.accounts;
  v_today date;
  v_today_net bigint;
begin
  select * into v_account from public.accounts as a where a.id = p_account_id;
  if v_account.id is null then
    raise exception 'Account not found' using errcode = 'FC010';
  end if;
  if v_account.kind <> 'cash' or v_account.archived_at is not null then
    raise exception 'Only an active cash account can be updated this way' using errcode = 'FC013';
  end if;

  v_today := public.user_local_today(v_account.user_id);
  select coalesce(sum(case
           when t.type in ('income', 'refund') or (t.type = 'transfer' and t.counter_account_id = v_account.id) then t.amount_minor
           else -t.amount_minor
         end), 0)::bigint
    into v_today_net
  from public.transactions as t
  where (t.account_id = v_account.id or t.counter_account_id = v_account.id)
    and t.voided_at is null
    and t.occurred_on = v_today;

  perform pg_catalog.set_config('fin_creador.cash_on_hand', v_account.id::text, true);
  update public.accounts as a
  set opening_balance_minor = p_amount_minor - v_today_net,
      opening_balance_date = v_today
  where a.id = v_account.id
  returning * into v_account;
  perform pg_catalog.set_config('fin_creador.cash_on_hand', '', true);

  return v_account;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_transaction (replaces the 20261023120000 version): optional refund link
-- ---------------------------------------------------------------------------

-- Dropped and re-created: the new parameter changes the signature. Existing calls (positional
-- or named, without p_refund_of_id) resolve to the new one through its default.
drop function public.record_transaction(text, uuid, bigint, date, uuid, uuid, uuid, text, text);

create function public.record_transaction(
  p_type text,
  p_idempotency_key uuid,
  p_amount_minor bigint,
  p_occurred_on date,
  p_account_id uuid,
  p_category_id uuid default null,
  p_counter_account_id uuid default null,
  p_note text default null,
  p_payment_mode text default null,
  p_refund_of_id uuid default null
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
       occurred_on, note, payment_mode, idempotency_key, refund_of_id)
    values
      (p_type, p_amount_minor, v_currency, p_account_id, p_counter_account_id, p_category_id,
       p_occurred_on, v_note, p_payment_mode, p_idempotency_key, p_refund_of_id)
    -- Two simultaneous requests with the same key: the loser reads the winner's row.
    on conflict on constraint transactions_idempotency_unique do nothing
    returning * into v_row;

    if v_row.id is not null then
      return v_row;
    end if;
    select * into v_row from public.transactions as t
    where t.user_id = (select auth.uid()) and t.idempotency_key = p_idempotency_key;
  end if;

  -- A replay compares the link as saved (a later void of the purchase may have cleared it).
  if (v_row.type, v_row.amount_minor, v_row.account_id, v_row.counter_account_id, v_row.category_id,
      v_row.occurred_on, v_row.note, v_row.payment_mode, v_row.replaces_id)
     is distinct from
     (p_type, p_amount_minor, p_account_id, p_counter_account_id, p_category_id,
      p_occurred_on, v_note, p_payment_mode, null::uuid)
     or (v_row.refund_of_id is not null and v_row.refund_of_id is distinct from p_refund_of_id) then
    raise exception 'This request key was already used for a different entry' using errcode = 'FC007';
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- edit_transaction (replaces the 20261024120000 version): a purchase's refunds follow it
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
  v_refunds uuid[] := '{}';
begin
  -- Lock the version being edited: a second edit of it waits here, then finds it voided.
  -- A refund being linked to it waits too (refund_check_link locks it), then finds it voided.
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

  -- The purchase's live refunds, taken before the void clears their link.
  if v_old.type = 'expense' then
    select coalesce(pg_catalog.array_agg(r.id order by r.created_at, r.id), '{}') into v_refunds
    from public.transactions as r
    where r.refund_of_id = v_old.id and r.voided_at is null;
  end if;

  -- Void without a reason (the replacement explains it), under the edit's request key.
  update public.transactions as t
  set voided_at = pg_catalog.now(), void_idempotency_key = p_idempotency_key
  where t.id = v_old.id;

  insert into public.transactions
    (type, amount_minor, currency, account_id, counter_account_id, category_id,
     occurred_on, note, payment_mode, idempotency_key, replaces_id,
     recurring_rule_id, occurrence_date, refund_of_id)
  values
    (v_old.type, p_amount_minor, v_currency, p_account_id, p_counter_account_id, p_category_id,
     p_occurred_on, v_note, p_payment_mode, p_idempotency_key, v_old.id,
     v_old.recurring_rule_id, v_old.occurrence_date, v_old.refund_of_id)
  returning * into v_row;

  -- Move them to the new version; each is checked again (cap FC055, date FC057, currency FC056),
  -- so an edit below the refunds or after one of them is refused as a whole.
  if pg_catalog.cardinality(v_refunds) > 0 then
    perform pg_catalog.set_config('fin_creador.refund_link', 'on', true);
    update public.transactions as r
    set refund_of_id = v_row.id
    where r.id = any (v_refunds);
    perform pg_catalog.set_config('fin_creador.refund_link', '', true);
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- List and totals: the refund tab, spending net of refunds
-- ---------------------------------------------------------------------------

create or replace function public.list_transactions(
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
  if p_type is not null and p_type not in ('income', 'expense', 'transfer', 'refund') then
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

-- Dropped and re-created: two new columns. expense_minor is now spending net of refunds
-- (expenses − refunds, may be below zero); refund_minor and refund_count say how much of it
-- was refunds. Net and savings rate are still derived in packages/domain.
drop function public.transaction_summary(date, date, uuid, uuid, text, bigint);

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
  refund_minor bigint,
  income_count integer,
  expense_count integer,
  refund_count integer,
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
      (coalesce(sum(t.amount_minor) filter (where t.type = 'expense'), 0)
        - coalesce(sum(t.amount_minor) filter (where t.type = 'refund'), 0))::bigint,
      coalesce(sum(t.amount_minor) filter (where t.type = 'refund'), 0)::bigint,
      (count(*) filter (where t.type = 'income'))::integer,
      (count(*) filter (where t.type = 'expense'))::integer,
      (count(*) filter (where t.type = 'refund'))::integer,
      (count(*) filter (where t.type = 'transfer'))::integer
    from public.transactions_matching(p_from, p_to, p_category_id, p_account_id, v_query, p_amount_minor) as t
    where t.voided_at is null
    group by t.currency
    order by t.currency;
end;
$$;

-- Same signature as 20261026120000; expense_minor is now net of refunds in buckets and
-- category rows (a category row may be below zero), and entry_count counts refunds too.
create or replace function public.dashboard_breakdown(
  p_from date,
  p_to date
)
returns table (
  kind text,
  currency text,
  bucket_start date,
  category_id uuid,
  income_minor bigint,
  expense_minor bigint,
  entry_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_by_month boolean;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'A valid date range is required' using errcode = '22023';
  end if;
  -- p_to - p_from is the number of days minus one: 61 or less means 62 days or fewer.
  v_by_month := (p_to - p_from) > 61;

  return query
    with posted as (
      select t.type, t.currency, t.category_id, t.amount_minor,
             case when v_by_month
                  then pg_catalog.date_trunc('month', t.occurred_on::timestamp)::date
                  else t.occurred_on
             end as bucket
      from public.transactions_matching(p_from, p_to, null, null, null, null) as t
      where t.voided_at is null
        and t.type in ('income', 'expense', 'refund')
    )
    select
      case when v_by_month then 'month' else 'day' end,
      p.currency,
      p.bucket,
      null::uuid,
      coalesce(sum(p.amount_minor) filter (where p.type = 'income'), 0)::bigint,
      (coalesce(sum(p.amount_minor) filter (where p.type = 'expense'), 0)
        - coalesce(sum(p.amount_minor) filter (where p.type = 'refund'), 0))::bigint,
      count(*)::integer
    from posted as p
    group by p.currency, p.bucket
    union all
    select
      'category',
      p.currency,
      null::date,
      p.category_id,
      0::bigint,
      sum(case when p.type = 'refund' then -p.amount_minor else p.amount_minor end)::bigint,
      count(*)::integer
    from posted as p
    where p.type in ('expense', 'refund')
    group by p.currency, p.category_id
    order by 1, 2, 3, 4;
end;
$$;

-- ---------------------------------------------------------------------------
-- enter_card_statement (replaces the 20261028180000 version): a card in credit
-- ---------------------------------------------------------------------------

-- As before, except: owed on the statement date now counts refunds (liability_owed), and a
-- zero bill posts no difference even when the card was in credit (owed below zero).
create or replace function public.enter_card_statement(
  p_card_id uuid,
  p_idempotency_key uuid,
  p_statement_date date,
  p_total_minor bigint,
  p_minimum_minor bigint default 0,
  p_due_date date default null,
  p_emi_included_minor bigint default 0,
  p_difference_category_id uuid default null
)
returns public.card_statements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_card public.credit_cards;
  v_account public.accounts;
  v_statement public.card_statements;
  v_due date;
  v_bill bigint;
  v_owed_at bigint;
  v_difference bigint := 0;
  v_tx public.transactions;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text || p_idempotency_key::text, 0));

  select * into v_statement from public.card_statements as s where s.user_id = v_uid and s.idempotency_key = p_idempotency_key;
  if v_statement.id is not null then
    if (v_statement.card_id, v_statement.statement_date, v_statement.total_minor, v_statement.minimum_minor, v_statement.emi_included_minor)
       is distinct from (p_card_id, p_statement_date, p_total_minor, coalesce(p_minimum_minor, 0), coalesce(p_emi_included_minor, 0)) then
      raise exception 'This request key was already used for a different statement' using errcode = 'FC007';
    end if;
    return v_statement;
  end if;

  select * into v_card from public.credit_cards as c where c.id = p_card_id for update;
  if v_card.id is null then
    raise exception 'Card not found' using errcode = 'FC008';
  end if;
  if v_card.archived_at is not null then
    raise exception 'Card is archived' using errcode = 'FC048';
  end if;
  if p_statement_date is null or p_statement_date > public.user_local_today(v_uid) then
    raise exception 'Date cannot be in the future' using errcode = 'FC003';
  end if;
  v_due := coalesce(p_due_date, public.card_due_date(p_statement_date, v_card.due_day));
  if v_due < p_statement_date then
    raise exception 'The due date is before the statement date' using errcode = 'FC051';
  end if;
  if exists (select 1 from public.card_statements as s where s.card_id = v_card.id and s.statement_date = p_statement_date) then
    raise exception 'A statement for this date is already entered' using errcode = 'FC046';
  end if;

  v_bill := coalesce(p_total_minor, 0) - coalesce(p_emi_included_minor, 0);
  select * into v_account from public.accounts as a where a.id = v_card.account_id;
  if p_statement_date >= v_account.opening_balance_date then
    v_owed_at := public.liability_owed(v_card.account_id, p_statement_date);
    -- A zero bill is also how a statement in credit prints: nothing to add then.
    v_difference := case when v_bill > 0 then greatest(v_bill - v_owed_at, 0) else 0 end;
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);

  if v_difference > 0 and p_difference_category_id is not null then
    insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, note, idempotency_key)
    values ('expense', v_difference, v_card.currency, v_card.account_id, p_difference_category_id, p_statement_date,
            'Statement difference · ' || coalesce(v_card.nickname, v_card.issuer), pg_catalog.gen_random_uuid())
    returning * into v_tx;
  else
    v_difference := 0;
  end if;

  insert into public.card_statements (
    card_id, statement_date, due_date, total_minor, minimum_minor, emi_included_minor,
    owed_at_statement_minor, difference_minor, difference_transaction_id, idempotency_key
  ) values (
    v_card.id, p_statement_date, v_due, p_total_minor, coalesce(p_minimum_minor, 0), coalesce(p_emi_included_minor, 0),
    v_owed_at, v_difference, v_tx.id, p_idempotency_key
  )
  returning * into v_statement;

  if v_bill > 0 then
    insert into public.due_items (kind, card_statement_id, seq, due_date, amount_due_minor, minimum_due_minor, currency)
    values ('card_bill', v_statement.id, 0, v_due, v_bill,
            nullif(least(coalesce(p_minimum_minor, 0), v_bill), 0), v_card.currency);
    perform public.card_sync_due(v_card.id);
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_statement;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- refund_check_link runs inside the triggers as the caller (it reads and locks only rows RLS lets
-- the caller see); trigger functions are never called directly.
revoke execute on function public.refund_check_link(public.transactions) from public, anon;
grant execute on function public.refund_check_link(public.transactions) to authenticated;
revoke execute on function public.transactions_refund_links_clear() from public, anon, authenticated;

revoke execute on function public.record_transaction(text, uuid, bigint, date, uuid, uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.record_transaction(text, uuid, bigint, date, uuid, uuid, uuid, text, text, uuid) to authenticated;
revoke execute on function public.transaction_summary(date, date, uuid, uuid, text, bigint) from public, anon;
grant execute on function public.transaction_summary(date, date, uuid, uuid, text, bigint) to authenticated;

-- Column grants: a client may set the link on insert; changing it later passes the update guard
-- only under fin_creador.refund_link, which only the functions above set.
grant insert (refund_of_id) on table public.transactions to authenticated;
grant update (refund_of_id) on table public.transactions to authenticated;
