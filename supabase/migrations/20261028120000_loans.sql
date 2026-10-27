-- Sprint 8a: loans, EMIs and due items.
--
-- Model (docs/sprint-plan.md, Sprint 8a):
--   * Each loan owns a liability account (accounts.kind = 'loan'). Its balance is minus what
--     is owed: the opening balance is −(principal owed when tracking started), dated that
--     day. A loan account is never in Total available and can't be used for ordinary entries.
--   * Paying an instalment posts, in one database transaction: principal as a transfer from
--     the paying account to the loan account, interest and fees as expenses from the paying
--     account (system categories "Loan interest" and "Loan fees & charges"). Moratorium
--     interest that is capitalised is posted once, with the first EMI paid, as an interest
--     expense on the loan account (the amount owed grows by it).
--   * due_items are generic: anything with a due date paid from an account (loan EMIs and
--     moratorium interest now; credit-card bills in 8b). One active payment per item.
--     Status: pending, paid, or before_tracking (paid before the loan was added: never posted).
--   * A payment that would take the paying account below zero is refused with FC035 (detail =
--     the shortfall in minor units) unless p_allow_shortfall is true ("Pay anyway": the
--     person saw the warning). Edits and voids move every part of a payment together.
--   * All figures (EMI estimate, schedule, split, moratorium interest) come from
--     packages/domain/src/loans.ts; SQL stores and checks them, never computes them.
--
-- Writes go through the functions below (SECURITY INVOKER, so RLS and grants apply). They
-- mark their own writes with a transaction-local setting (fin_creador.loan_write, not
-- reachable through the API, as set_cash_on_hand does); triggers refuse any direct write to
-- loan accounts, loans, due items, payments and payment entries without it.
--
-- New error codes (mapped in packages/api):
--   FC032 loan rows change only through the loan functions   FC033 loan archived
--   FC034 instalment not pending                             FC035 not enough money (unless allowed)
--   FC036 date before the loan was added                     FC037 principal more than owed
--   FC038 a loan account can't pay                           FC039 date before the account's opening balance
--   FC040 loan has payments (can't be deleted)               FC041 planned date in the past
--   FC042 loan categories can't be archived                  FC043 EMI dates don't fit the loan
--   FC044 archive the loan before deleting it
-- Reused: FC001 archived account, FC002 currency, FC003 future date, FC005 already voided,
-- FC007 request key reused, FC008 not found, FC009 identity, FC010 account not found,
-- FC014 changed elsewhere, FC017 nothing changed.

-- ---------------------------------------------------------------------------
-- Accounts: the loan (liability) kind
-- ---------------------------------------------------------------------------

alter table public.accounts drop constraint accounts_kind;
alter table public.accounts add constraint accounts_kind check (kind in ('bank', 'cash', 'other', 'loan'));

-- Banks may start overdrawn; a loan account starts at minus what is owed; cash and other >= 0.
alter table public.accounts drop constraint accounts_opening_balance_sign;
alter table public.accounts add constraint accounts_opening_balance_sign check (
  kind = 'bank'
  or (kind = 'loan' and opening_balance_minor <= 0)
  or (kind in ('cash', 'other') and opening_balance_minor >= 0)
);
-- No loan or card number, not even the last digits.
alter table public.accounts add constraint accounts_loan_no_number check (kind <> 'loan' or last4 is null);

create function public.accounts_liability_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.kind = 'loan' or (tg_op = 'UPDATE' and old.kind = 'loan'))
     and pg_catalog.current_setting('fin_creador.loan_write', true) is distinct from 'on' then
    raise exception 'A loan account changes only through its loan' using errcode = 'FC032';
  end if;
  return new;
end;
$$;

create trigger accounts_liability_guard
  before insert or update on public.accounts
  for each row execute function public.accounts_liability_guard();

-- ---------------------------------------------------------------------------
-- Categories: system expense categories for loan interest and fees
-- ---------------------------------------------------------------------------

alter table public.categories add column system_key text;
alter table public.categories add constraint categories_system_key check (
  system_key is null or (kind = 'expense' and system_key in ('loan_interest', 'loan_fees'))
);
create unique index categories_user_system_key_idx on public.categories (user_id, system_key)
  where system_key is not null;

comment on column public.categories.system_key is
  'Set on the categories loan payments post to (loan_interest, loan_fees). They can be renamed, not archived.';

create function public.categories_system_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.system_key is distinct from old.system_key and old.system_key is not null then
    raise exception 'A category''s identity can''t change' using errcode = 'FC009';
  end if;
  if old.system_key is not null and new.archived_at is not null and old.archived_at is null then
    raise exception 'Loan categories can''t be archived' using errcode = 'FC042';
  end if;
  return new;
end;
$$;

create trigger categories_system_guard
  before update on public.categories
  for each row execute function public.categories_system_guard();

-- The caller's category for a system key, never null: an existing one; else an expense
-- category with the same name (an active one, or else an archived one, which is restored),
-- adopted; else a new one. SECURITY DEFINER because system_key is not client-writable; acts
-- only on the caller's own user id.
create function public.loan_category_id(p_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  v_name := case p_key when 'loan_interest' then 'Loan interest' when 'loan_fees' then 'Loan fees & charges' end;
  if v_name is null then
    raise exception 'Unknown category key' using errcode = '22023';
  end if;
  -- One caller at a time per user here, so adoption and creation can't race.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('loan_category:' || v_uid::text, 0));

  select c.id into v_id from public.categories as c where c.user_id = v_uid and c.system_key = p_key;
  if v_id is not null then
    return v_id;
  end if;

  -- Adopt a same-name expense category: an active one first, else the latest archived one
  -- (restored; no active one has the name, so the unique active-name index allows it).
  select c.id into v_id from public.categories as c
  where c.user_id = v_uid and c.kind = 'expense' and c.system_key is null
    and pg_catalog.lower(pg_catalog.btrim(c.name)) = pg_catalog.lower(v_name)
  order by (c.archived_at is null) desc, c.archived_at desc nulls first, c.created_at desc
  limit 1;
  if v_id is not null then
    update public.categories as c set system_key = p_key, archived_at = null where c.id = v_id;
    return v_id;
  end if;

  insert into public.categories (user_id, kind, name, icon, is_default, system_key)
  values (v_uid, 'expense', v_name, 'bills', true, p_key)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------

create table public.loans (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id                uuid not null,
  loan_type                 text not null,
  type_other                text,
  lender                    text not null,
  nickname                  text,
  currency                  text not null,
  sanctioned_minor          bigint not null,
  disbursed_minor           bigint not null,
  rate_bps                  integer not null,
  rate_kind                 text not null default 'fixed',
  tenure_months             integer not null,
  start_mode                text not null,
  -- Owed when tracking started (ongoing), or the amount taken (starts later).
  opening_outstanding_minor bigint not null,
  -- EMIs scheduled from first_due_date: EMIs left (ongoing) or the tenure (starts later).
  instalment_months         integer not null,
  first_due_date            date not null,
  moratorium_months         integer not null default 0,
  moratorium_interest       text,
  capitalised_minor         bigint not null default 0,
  emi_estimate_minor        bigint not null,
  emi_minor                 bigint not null,
  tracking_started_on       date not null,
  archived_at               timestamptz,
  idempotency_key           uuid not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint loans_id_user_unique unique (id, user_id),
  constraint loans_account_unique unique (account_id),
  constraint loans_idempotency_unique unique (user_id, idempotency_key),
  constraint loans_account_owned
    foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  constraint loans_type check (loan_type in (
    'home', 'vehicle', 'personal', 'education', 'gold', 'business', 'consumer',
    'property_securities', 'credit_card_emi', 'other'
  )),
  constraint loans_type_other check (
    (loan_type = 'other' and type_other is not null and char_length(btrim(type_other)) between 1 and 40)
    or (loan_type <> 'other' and type_other is null)
  ),
  -- Four digits in a row are refused so no card or loan account number is stored.
  constraint loans_lender check (char_length(btrim(lender)) between 1 and 80 and lender !~ '[0-9]{4}'),
  constraint loans_nickname check (
    nickname is null or (char_length(btrim(nickname)) between 1 and 40 and nickname !~ '[0-9]{4}')
  ),
  constraint loans_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint loans_sanctioned_range check (sanctioned_minor > 0 and sanctioned_minor <= 10000000000000),
  constraint loans_disbursed_range check (disbursed_minor > 0 and disbursed_minor <= sanctioned_minor),
  constraint loans_rate_range check (rate_bps between 0 and 10000),
  constraint loans_rate_kind check (rate_kind in ('fixed', 'floating')),
  constraint loans_tenure_range check (tenure_months between 1 and 480),
  constraint loans_start_mode check (start_mode in ('ongoing', 'starts_later')),
  constraint loans_opening_outstanding check (
    opening_outstanding_minor > 0
    and ((start_mode = 'ongoing' and opening_outstanding_minor <= disbursed_minor)
         or (start_mode = 'starts_later' and opening_outstanding_minor = disbursed_minor))
  ),
  constraint loans_instalment_months check (
    instalment_months between 1 and tenure_months
    and (start_mode = 'ongoing' or instalment_months = tenure_months)
  ),
  constraint loans_first_due_range check (first_due_date >= date '1970-01-01'),
  constraint loans_moratorium check (
    capitalised_minor between 0 and 10000000000000
    and (
      (start_mode = 'ongoing' and moratorium_months = 0 and moratorium_interest is null and capitalised_minor = 0)
      or (start_mode = 'starts_later' and moratorium_months = 0 and moratorium_interest is null and capitalised_minor = 0)
      or (start_mode = 'starts_later' and moratorium_months between 1 and 120
          and moratorium_interest is not null and moratorium_interest in ('capitalise', 'pay_monthly')
          and (moratorium_interest = 'capitalise' or capitalised_minor = 0))
    )
  ),
  constraint loans_emi_range check (
    emi_minor > 0 and emi_minor <= 10000000000000
    and emi_estimate_minor > 0 and emi_estimate_minor <= 10000000000000
  )
);

create index loans_user_idx on public.loans (user_id) where archived_at is null;

comment on table public.loans is
  'Loans and card EMIs. Owed = −(balance of account_id, a liability account). Figures come from packages/domain/src/loans.ts.';
comment on column public.loans.emi_minor is
  'The EMI in use: the estimate (emi_estimate_minor) or the bank''s EMI the person entered. Pending EMIs are due at this amount.';

create function public.loans_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('fin_creador.loan_write', true) is distinct from 'on' then
    raise exception 'Loans change only through the loan functions' using errcode = 'FC032';
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.user_id, new.account_id, new.currency, new.idempotency_key, new.created_at, new.tracking_started_on)
       is distinct from
       (old.id, old.user_id, old.account_id, old.currency, old.idempotency_key, old.created_at, old.tracking_started_on)
    then
      raise exception 'A loan''s identity can''t change' using errcode = 'FC009';
    end if;
    -- What shaped the schedule stays as entered (re-add the loan to change it).
    if (new.disbursed_minor, new.tenure_months, new.start_mode, new.opening_outstanding_minor,
        new.instalment_months, new.first_due_date, new.moratorium_months, new.moratorium_interest,
        new.capitalised_minor, new.emi_estimate_minor)
       is distinct from
       (old.disbursed_minor, old.tenure_months, old.start_mode, old.opening_outstanding_minor,
        old.instalment_months, old.first_due_date, old.moratorium_months, old.moratorium_interest,
        old.capitalised_minor, old.emi_estimate_minor)
    then
      raise exception 'The loan amounts, dates and tenure can''t change' using errcode = 'FC009';
    end if;
    if old.archived_at is not null and new.archived_at is not null
       and (new.loan_type, new.type_other, new.lender, new.nickname, new.sanctioned_minor, new.rate_bps, new.rate_kind, new.emi_minor)
           is distinct from
           (old.loan_type, old.type_other, old.lender, old.nickname, old.sanctioned_minor, old.rate_bps, old.rate_kind, old.emi_minor)
    then
      raise exception 'Loan is archived' using errcode = 'FC033';
    end if;
    if old.archived_at is null and new.archived_at is not null then
      new.archived_at := pg_catalog.now();
    elsif old.archived_at is not null and new.archived_at is not null then
      new.archived_at := old.archived_at;
    end if;
  else
    new.archived_at := null;
    new.created_at := pg_catalog.now();
    new.tracking_started_on := public.user_local_today(new.user_id);
  end if;
  new.lender := pg_catalog.btrim(pg_catalog.regexp_replace(new.lender, '\s+', ' ', 'g'));
  new.nickname := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(new.nickname, ''), '\s+', ' ', 'g')), '');
  new.type_other := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(new.type_other, ''), '\s+', ' ', 'g')), '');
  return new;
end;
$$;

create trigger loans_validate
  before insert or update on public.loans
  for each row execute function public.loans_validate();

create trigger loans_set_updated_at
  before update on public.loans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Due items (generic) and their payments
-- ---------------------------------------------------------------------------

create table public.due_items (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- loan_emi, loan_interest (moratorium interest paid monthly); 8b adds card_bill.
  kind               text not null,
  loan_id            uuid,
  -- Order within its source: EMI number (0 = this month's, already paid before tracking),
  -- or the moratorium month.
  seq                integer not null,
  due_date           date not null,
  amount_due_minor   bigint not null,
  -- Card bills (8b); null for loans.
  minimum_due_minor  bigint,
  currency           text not null,
  status             text not null default 'pending',
  -- "Will pay later": both or neither.
  planned_on         date,
  planned_account_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint due_items_id_user_unique unique (id, user_id),
  constraint due_items_kind check (kind in ('loan_emi', 'loan_interest')),
  constraint due_items_source check ((kind in ('loan_emi', 'loan_interest')) = (loan_id is not null)),
  constraint due_items_loan_owned
    foreign key (loan_id, user_id) references public.loans (id, user_id) on delete cascade,
  constraint due_items_loan_seq_unique unique (loan_id, kind, seq),
  constraint due_items_seq_range check (seq between 0 and 480),
  constraint due_items_due_range check (due_date >= date '1970-01-01'),
  constraint due_items_amount_range check (amount_due_minor > 0 and amount_due_minor <= 10000000000000),
  constraint due_items_minimum_range check (minimum_due_minor is null or (minimum_due_minor > 0 and minimum_due_minor <= amount_due_minor)),
  constraint due_items_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint due_items_status check (status in ('pending', 'paid', 'before_tracking')),
  constraint due_items_plan_pair check ((planned_on is null) = (planned_account_id is null)),
  constraint due_items_plan_pending check (planned_on is null or status = 'pending'),
  constraint due_items_planned_account_owned
    -- SET NULL may name only foreign-key columns; due_items_guard clears planned_on with it,
    -- before due_items_plan_pair is checked.
    foreign key (planned_account_id, user_id) references public.accounts (id, user_id)
    on delete set null (planned_account_id)
);

create index due_items_user_pending_idx on public.due_items (user_id, due_date) where status = 'pending';
create index due_items_planned_account_idx on public.due_items (planned_account_id) where planned_account_id is not null;

comment on table public.due_items is
  'Anything due on a date and paid from an account: loan EMIs and moratorium interest (8a), card bills (8b). Reminders are derived from these dates in packages/domain/src/due-items.ts.';

create table public.due_payments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  due_item_id          uuid not null,
  account_id           uuid not null,
  paid_on              date not null,
  principal_minor      bigint not null default 0,
  interest_minor       bigint not null default 0,
  fees_minor           bigint not null default 0,
  -- Moratorium interest added to the loan with this payment (the first EMI paid).
  capitalised_minor    bigint not null default 0,
  idempotency_key      uuid not null,
  replaces_id          uuid,
  voided_at            timestamptz,
  void_reason          text,
  void_idempotency_key uuid,
  created_at           timestamptz not null default now(),

  constraint due_payments_id_user_unique unique (id, user_id),
  constraint due_payments_idempotency_unique unique (user_id, idempotency_key),
  constraint due_payments_void_idempotency_unique unique (user_id, void_idempotency_key),
  constraint due_payments_item_owned
    foreign key (due_item_id, user_id) references public.due_items (id, user_id) on delete cascade,
  constraint due_payments_account_owned
    foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  constraint due_payments_replaces_owned
    foreign key (replaces_id, user_id) references public.due_payments (id, user_id) on delete cascade,
  constraint due_payments_replaces_other check (replaces_id is null or replaces_id <> id),
  constraint due_payments_parts check (
    principal_minor between 0 and 10000000000000
    and interest_minor between 0 and 10000000000000
    and fees_minor between 0 and 10000000000000
    and capitalised_minor between 0 and 10000000000000
    and principal_minor + interest_minor + fees_minor > 0
  ),
  constraint due_payments_paid_range check (paid_on >= date '1970-01-01'),
  constraint due_payments_void_key_with_void check ((voided_at is null) = (void_idempotency_key is null)),
  constraint due_payments_void_reason check (
    void_reason is null or (voided_at is not null and char_length(btrim(void_reason)) between 1 and 200)
  )
);

-- One active payment per due item; a payment is replaced at most once.
create unique index due_payments_one_active_idx on public.due_payments (due_item_id) where voided_at is null;
create unique index due_payments_replaces_idx on public.due_payments (replaces_id) where replaces_id is not null;
create index due_payments_account_idx on public.due_payments (account_id);

comment on table public.due_payments is
  'A payment of a due item. Its parts are ledger entries (transactions.due_payment_id); an edit voids it and its entries and adds a new payment (replaces_id).';

-- The entries a payment posted.
alter table public.transactions add column due_payment_id uuid;
alter table public.transactions add constraint transactions_due_payment_owned
  foreign key (due_payment_id, user_id) references public.due_payments (id, user_id) on delete cascade;
create index transactions_due_payment_idx on public.transactions (due_payment_id) where due_payment_id is not null;

comment on column public.transactions.due_payment_id is
  'The due payment (loan EMI) this entry is part of. Such entries change only with their payment.';

-- ---------------------------------------------------------------------------
-- Guards: direct writes are refused; "Will pay later" is the one direct update
-- ---------------------------------------------------------------------------

create function public.due_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_marked boolean := pg_catalog.current_setting('fin_creador.loan_write', true) is not distinct from 'on';
  v_account public.accounts;
  v_loan public.loans;
begin
  -- Clients can't delete due items (no grant); deletes come from delete_loan or account deletion.
  if tg_op = 'INSERT' then
    if not v_marked then
      raise exception 'Due items change only through their loan' using errcode = 'FC032';
    end if;
    return new;
  end if;

  -- The planned account was deleted (ON DELETE SET NULL): the plan goes with it.
  if new.planned_account_id is null and old.planned_account_id is not null then
    new.planned_on := null;
  end if;

  if (new.id, new.user_id, new.kind, new.loan_id, new.seq, new.due_date, new.currency, new.created_at)
     is distinct from
     (old.id, old.user_id, old.kind, old.loan_id, old.seq, old.due_date, old.currency, old.created_at)
  then
    raise exception 'A due item''s identity can''t change' using errcode = 'FC009';
  end if;
  if (new.amount_due_minor, new.minimum_due_minor, new.status) is distinct from (old.amount_due_minor, old.minimum_due_minor, old.status)
     and not v_marked then
    raise exception 'Due items change only through their loan' using errcode = 'FC032';
  end if;

  -- "Will pay later" (a direct update of planned_on / planned_account_id).
  if (new.planned_on, new.planned_account_id) is distinct from (old.planned_on, old.planned_account_id)
     and new.planned_on is not null then
    if new.status <> 'pending' then
      raise exception 'Only a pending instalment can be planned' using errcode = 'FC034';
    end if;
    if new.loan_id is not null then
      select * into v_loan from public.loans as l where l.id = new.loan_id;
      if v_loan.archived_at is not null then
        raise exception 'Loan is archived' using errcode = 'FC033';
      end if;
    end if;
    if new.planned_on is distinct from old.planned_on and new.planned_on < public.user_local_today(new.user_id) then
      raise exception 'The planned date can''t be in the past' using errcode = 'FC041';
    end if;
    select * into v_account from public.accounts as a where a.id = new.planned_account_id;
    if v_account.kind = 'loan' then
      raise exception 'A loan account can''t pay' using errcode = 'FC038';
    end if;
    if v_account.archived_at is not null then
      raise exception 'Account is archived' using errcode = 'FC001';
    end if;
    if v_account.currency <> new.currency then
      raise exception 'Currency must match the account (%)', v_account.currency using errcode = 'FC002';
    end if;
  end if;
  return new;
end;
$$;

create trigger due_items_guard
  before insert or update on public.due_items
  for each row execute function public.due_items_guard();

create trigger due_items_set_updated_at
  before update on public.due_items
  for each row execute function public.set_updated_at();

-- Payments: written only by the functions; never changed except one void.
create function public.due_payments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('fin_creador.loan_write', true) is distinct from 'on' then
    raise exception 'Payments change only through their loan' using errcode = 'FC032';
  end if;
  if tg_op = 'UPDATE' then
    if old.voided_at is not null then
      raise exception 'A voided payment can''t change' using errcode = 'FC005';
    end if;
    if (new.id, new.user_id, new.due_item_id, new.account_id, new.paid_on, new.principal_minor,
        new.interest_minor, new.fees_minor, new.capitalised_minor, new.idempotency_key,
        new.replaces_id, new.created_at)
       is distinct from
       (old.id, old.user_id, old.due_item_id, old.account_id, old.paid_on, old.principal_minor,
        old.interest_minor, old.fees_minor, old.capitalised_minor, old.idempotency_key,
        old.replaces_id, old.created_at)
    then
      raise exception 'Payments can''t be edited in place' using errcode = 'FC009';
    end if;
    if new.voided_at is not null then
      new.voided_at := pg_catalog.now();
    end if;
  else
    new.voided_at := null;
    new.void_reason := null;
    new.void_idempotency_key := null;
    new.created_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

create trigger due_payments_guard
  before insert or update on public.due_payments
  for each row execute function public.due_payments_guard();

-- Entries on a loan account, or belonging to a payment, are written and voided only by the
-- payment functions (so void_transaction / edit_transaction can't split a payment).
create function public.transactions_liability_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('fin_creador.loan_write', true) is not distinct from 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.due_payment_id is not null or exists (
      select 1 from public.accounts as a
      where a.id in (new.account_id, new.counter_account_id) and a.kind = 'loan'
    ) then
      raise exception 'Loan payments are recorded from the loan' using errcode = 'FC032';
    end if;
  elsif old.due_payment_id is not null then
    raise exception 'Change this payment from the loan' using errcode = 'FC032';
  end if;
  return new;
end;
$$;

create trigger transactions_liability_guard
  before insert or update on public.transactions
  for each row execute function public.transactions_liability_guard();

-- Recurring items can't use a loan account.
create function public.recurring_rules_liability_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.accounts as a
    where a.id in (new.account_id, new.counter_account_id) and a.kind = 'loan'
  ) then
    raise exception 'Loan payments are recorded from the loan' using errcode = 'FC032';
  end if;
  return new;
end;
$$;

create trigger recurring_rules_liability_guard
  before insert or update on public.recurring_rules
  for each row execute function public.recurring_rules_liability_guard();

-- ---------------------------------------------------------------------------
-- Instalment dates (parity with packages/domain: supabase/tests/database/loan_dates_parity.test.sql)
-- ---------------------------------------------------------------------------

-- Due date of instalment p_seq counted from the first EMI: first + (p_seq − 1) months,
-- clamped to the month end, always from the first date (instalmentDate in the domain).
-- p_seq 0 is one month before (this month's EMI paid before tracking); moratorium month m
-- of M is p_seq = m − M (moratoriumDates).
create function public.loan_due_date(p_first_due date, p_seq integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select (p_first_due + pg_catalog.make_interval(months => p_seq - 1))::date;
$$;

-- ---------------------------------------------------------------------------
-- create_loan
-- ---------------------------------------------------------------------------

-- Adds a loan, its liability account and its instalments, once per request key. The figures
-- (EMI estimate, capitalised and monthly moratorium interest) come from packages/domain.
--   * EMIs 1..p_instalment_months on p_first_due_date + (n − 1) months (month-end clamped,
--     counted from the first date, as the domain's instalmentDate), due at p_emi_minor.
--   * Ongoing, this month's EMI already paid: p_before_tracking_on adds EMI 0 as
--     before_tracking (never posted); the first pending EMI must then be after today.
--     Still due: the first EMI is this month's (it may be overdue).
--   * Starts later, interest paid monthly: an interest-only item for each moratorium month,
--     the last one month before the first EMI (the domain's moratoriumDates); months before
--     today are before_tracking.
-- Optional values come last, with defaults, so clients can leave them out.
create function public.create_loan(
  p_idempotency_key uuid,
  p_loan_type text,
  p_lender text,
  p_sanctioned_minor bigint,
  p_disbursed_minor bigint,
  p_rate_bps integer,
  p_rate_kind text,
  p_tenure_months integer,
  p_start_mode text,
  p_outstanding_minor bigint,
  p_instalment_months integer,
  p_first_due_date date,
  p_emi_estimate_minor bigint,
  p_emi_minor bigint,
  p_type_other text default null,
  p_nickname text default null,
  p_before_tracking_on date default null,
  p_moratorium_months integer default 0,
  p_moratorium_interest text default null,
  p_capitalised_minor bigint default 0,
  p_moratorium_interest_minor bigint default 0
)
returns public.loans
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_today date;
  v_month_start date;
  v_currency text;
  v_lender text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_lender, ''), '\s+', ' ', 'g'));
  v_nickname text := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g')), '');
  v_account public.accounts;
  v_loan public.loans;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  -- Serialise retries of the same request.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text || p_idempotency_key::text, 0));

  select * into v_loan from public.loans as l where l.user_id = v_uid and l.idempotency_key = p_idempotency_key;
  if v_loan.id is not null then
    if (v_loan.loan_type, v_loan.disbursed_minor, v_loan.opening_outstanding_minor, v_loan.first_due_date, v_loan.emi_minor)
       is distinct from (p_loan_type, p_disbursed_minor, p_outstanding_minor, p_first_due_date, p_emi_minor) then
      raise exception 'This request key was already used for a different loan' using errcode = 'FC007';
    end if;
    return v_loan;
  end if;

  v_today := public.user_local_today(v_uid);
  v_month_start := pg_catalog.make_date(extract(year from v_today)::integer, extract(month from v_today)::integer, 1);
  if p_start_mode = 'starts_later' and (p_first_due_date <= v_today or p_before_tracking_on is not null) then
    raise exception 'The first EMI of a loan that starts later is after today' using errcode = 'FC043';
  end if;
  if p_start_mode = 'ongoing' then
    if p_before_tracking_on is null
       and p_first_due_date not between v_month_start and (v_month_start + interval '1 month')::date - 1 then
      raise exception 'A still-due EMI is this month''s' using errcode = 'FC043';
    end if;
    if p_before_tracking_on is not null
       and (p_first_due_date <= v_today
            or p_before_tracking_on <> public.loan_due_date(p_first_due_date, 0)) then
      raise exception 'With this month''s EMI paid, the next one is after today' using errcode = 'FC043';
    end if;
  end if;
  if p_moratorium_interest = 'pay_monthly' and p_rate_bps > 0 and coalesce(p_moratorium_interest_minor, 0) <= 0 then
    raise exception 'Moratorium interest is missing' using errcode = '22023';
  end if;

  select p.currency into v_currency from public.profiles as p where p.id = v_uid;
  if v_currency is null then
    raise exception 'Profile not found' using errcode = 'FC010';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);

  insert into public.accounts (kind, name, institution, currency, opening_balance_minor, opening_balance_date)
  values ('loan', pg_catalog.left(coalesce(v_nickname, v_lender), 80), nullif(v_lender, ''), v_currency, -p_outstanding_minor, v_today)
  returning * into v_account;

  insert into public.loans (
    account_id, loan_type, type_other, lender, nickname, currency, sanctioned_minor, disbursed_minor,
    rate_bps, rate_kind, tenure_months, start_mode, opening_outstanding_minor, instalment_months,
    first_due_date, moratorium_months, moratorium_interest, capitalised_minor, emi_estimate_minor,
    emi_minor, tracking_started_on, idempotency_key
  ) values (
    v_account.id, p_loan_type, p_type_other, v_lender, v_nickname, v_currency, p_sanctioned_minor, p_disbursed_minor,
    p_rate_bps, coalesce(p_rate_kind, 'fixed'), p_tenure_months, p_start_mode, p_outstanding_minor, p_instalment_months,
    p_first_due_date, coalesce(p_moratorium_months, 0), p_moratorium_interest, coalesce(p_capitalised_minor, 0), p_emi_estimate_minor,
    p_emi_minor, v_today, p_idempotency_key
  )
  returning * into v_loan;

  if p_before_tracking_on is not null then
    insert into public.due_items (kind, loan_id, seq, due_date, amount_due_minor, currency, status)
    values ('loan_emi', v_loan.id, 0, p_before_tracking_on, v_loan.emi_minor, v_currency, 'before_tracking');
  end if;

  if v_loan.moratorium_interest = 'pay_monthly' and coalesce(p_moratorium_interest_minor, 0) > 0 then
    -- Moratorium months already past when the loan is added were paid before tracking.
    insert into public.due_items (kind, loan_id, seq, due_date, amount_due_minor, currency, status)
    select 'loan_interest', v_loan.id, m.n, m.due, p_moratorium_interest_minor, v_currency,
           case when m.due < v_today then 'before_tracking' else 'pending' end
    from (
      select s as n, public.loan_due_date(v_loan.first_due_date, s - v_loan.moratorium_months) as due
      from pg_catalog.generate_series(1, v_loan.moratorium_months) as s
    ) as m;
  end if;

  insert into public.due_items (kind, loan_id, seq, due_date, amount_due_minor, currency)
  select 'loan_emi', v_loan.id, n, public.loan_due_date(v_loan.first_due_date, n), v_loan.emi_minor, v_currency
  from pg_catalog.generate_series(1, v_loan.instalment_months) as n;

  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_loan;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_loan, set_loan_archived, delete_loan
-- ---------------------------------------------------------------------------

-- Edits names, sanctioned amount, rate and the EMI. A new EMI applies to pending EMIs.
create function public.update_loan(
  p_loan_id uuid,
  p_loan_type text,
  p_lender text,
  p_sanctioned_minor bigint,
  p_rate_bps integer,
  p_rate_kind text,
  p_emi_minor bigint,
  p_type_other text default null,
  p_nickname text default null
)
returns public.loans
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans as l where l.id = p_loan_id for update;
  if v_loan.id is null then
    raise exception 'Loan not found' using errcode = 'FC008';
  end if;
  if v_loan.archived_at is not null then
    raise exception 'Loan is archived' using errcode = 'FC033';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.loans as l
  set loan_type = p_loan_type, type_other = p_type_other, lender = p_lender, nickname = p_nickname,
      sanctioned_minor = p_sanctioned_minor, rate_bps = p_rate_bps, rate_kind = p_rate_kind, emi_minor = p_emi_minor
  where l.id = v_loan.id
  returning * into v_loan;

  update public.accounts as a
  set name = pg_catalog.left(coalesce(v_loan.nickname, v_loan.lender), 80), institution = v_loan.lender
  where a.id = v_loan.account_id;

  update public.due_items as d
  set amount_due_minor = v_loan.emi_minor
  where d.loan_id = v_loan.id and d.kind = 'loan_emi' and d.status = 'pending'
    and d.amount_due_minor <> v_loan.emi_minor;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_loan;
end;
$$;

-- Archive (hidden, no payments, no reminders) or restore a loan with its account.
create function public.set_loan_archived(p_loan_id uuid, p_archived boolean)
returns public.loans
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_loan public.loans;
  v_at timestamptz := case when p_archived then pg_catalog.now() end;
begin
  select * into v_loan from public.loans as l where l.id = p_loan_id for update;
  if v_loan.id is null then
    raise exception 'Loan not found' using errcode = 'FC008';
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.loans as l set archived_at = v_at where l.id = v_loan.id returning * into v_loan;
  update public.accounts as a set archived_at = v_at where a.id = v_loan.account_id;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_loan;
end;
$$;

-- Deletes an archived loan that never had a payment (voided ones count: they are history),
-- with its instalments and its account. SECURITY DEFINER because clients can't delete
-- accounts; it acts only on the caller's own loan. Nothing else references a loan account:
-- its entries all belong to payments, and there are none.
create function public.delete_loan(p_loan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans as l
  where l.id = p_loan_id and l.user_id = (select auth.uid())
  for update;
  if v_loan.id is null then
    raise exception 'Loan not found' using errcode = 'FC008';
  end if;
  if v_loan.archived_at is null then
    raise exception 'Archive the loan before deleting it' using errcode = 'FC044';
  end if;
  if exists (
    select 1 from public.due_payments as p join public.due_items as d on d.id = p.due_item_id
    where d.loan_id = v_loan.id
  ) or exists (
    select 1 from public.transactions as t
    where t.account_id = v_loan.account_id or t.counter_account_id = v_loan.account_id
  ) then
    raise exception 'A loan with payments can''t be deleted' using errcode = 'FC040';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  delete from public.loans as l where l.id = v_loan.id; -- due items cascade
  delete from public.accounts as a where a.id = v_loan.account_id;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- pay_due_item, void_due_payment, edit_due_payment
-- ---------------------------------------------------------------------------

-- Pays a pending instalment once per request key: principal as a transfer to the loan
-- account, interest and fees as expenses, all from p_account_id and dated p_paid_on. The
-- split comes from the person (default from packages/domain defaultPaymentSplit).
-- When the account's balance doesn't cover the total it is refused (FC035, detail = the
-- shortfall) unless p_allow_shortfall is true ("Pay anyway", sent again under the same key).
-- p_replaces_id is set only by edit_due_payment (the replaced payment must have been voided
-- in this same database transaction).
create function public.pay_due_item(
  p_due_item_id uuid,
  p_idempotency_key uuid,
  p_account_id uuid,
  p_paid_on date,
  p_principal_minor bigint,
  p_interest_minor bigint,
  p_fees_minor bigint,
  p_allow_shortfall boolean default false,
  p_replaces_id uuid default null
)
returns public.due_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pay public.due_payments;
  v_old public.due_payments;
  v_item public.due_items;
  v_loan public.loans;
  v_account public.accounts;
  v_cap bigint := 0;
  v_owed bigint;
  v_balance bigint;
  v_total bigint := coalesce(p_principal_minor, 0) + coalesce(p_interest_minor, 0) + coalesce(p_fees_minor, 0);
  v_note text;
begin
  select * into v_pay from public.due_payments as p where p.user_id = v_uid and p.idempotency_key = p_idempotency_key;
  if v_pay.id is not null then
    if (v_pay.due_item_id, v_pay.account_id, v_pay.paid_on, v_pay.principal_minor, v_pay.interest_minor, v_pay.fees_minor, v_pay.replaces_id)
       is distinct from (p_due_item_id, p_account_id, p_paid_on, p_principal_minor, p_interest_minor, p_fees_minor, p_replaces_id) then
      raise exception 'This request key was already used for a different payment' using errcode = 'FC007';
    end if;
    return v_pay;
  end if;

  select * into v_item from public.due_items as d where d.id = p_due_item_id;
  if v_item.id is null then
    raise exception 'Instalment not found' using errcode = 'FC008';
  end if;
  -- One payment at a time per loan (balance, capitalisation and status checks below).
  select * into v_loan from public.loans as l where l.id = v_item.loan_id for update;
  select * into v_item from public.due_items as d where d.id = p_due_item_id for update;
  if v_loan.archived_at is not null then
    raise exception 'Loan is archived' using errcode = 'FC033';
  end if;
  -- A simultaneous retry of this request may have saved it while we waited for the lock.
  select * into v_pay from public.due_payments as p where p.user_id = v_uid and p.idempotency_key = p_idempotency_key;
  if v_pay.id is not null then
    if (v_pay.due_item_id, v_pay.account_id, v_pay.paid_on, v_pay.principal_minor, v_pay.interest_minor, v_pay.fees_minor, v_pay.replaces_id)
       is distinct from (p_due_item_id, p_account_id, p_paid_on, p_principal_minor, p_interest_minor, p_fees_minor, p_replaces_id) then
      raise exception 'This request key was already used for a different payment' using errcode = 'FC007';
    end if;
    return v_pay;
  end if;
  if v_item.status <> 'pending' then
    raise exception 'This instalment is not pending' using errcode = 'FC034';
  end if;
  if p_replaces_id is not null then
    select * into v_old from public.due_payments as p where p.id = p_replaces_id;
    if v_old.id is null or v_old.due_item_id <> v_item.id or v_old.voided_at is distinct from pg_catalog.now() then
      raise exception 'This payment was changed elsewhere' using errcode = 'FC014';
    end if;
  end if;

  -- The paying account, locked so two payments from it can't both pass the balance check.
  select * into v_account from public.accounts as a where a.id = p_account_id for update;
  if v_account.id is null then
    raise exception 'Account not found' using errcode = 'FC010';
  end if;
  if v_account.kind = 'loan' then
    raise exception 'A loan account can''t pay' using errcode = 'FC038';
  end if;
  if v_account.archived_at is not null then
    raise exception 'Account is archived' using errcode = 'FC001';
  end if;
  if v_account.currency <> v_item.currency then
    raise exception 'Currency must match the account (%)', v_account.currency using errcode = 'FC002';
  end if;

  if p_paid_on is null or p_paid_on > public.user_local_today(v_uid) then
    raise exception 'Date cannot be in the future' using errcode = 'FC003';
  end if;
  if p_paid_on < v_loan.tracking_started_on then
    raise exception 'Payments before the loan was added aren''t recorded' using errcode = 'FC036';
  end if;
  if p_paid_on < v_account.opening_balance_date then
    raise exception 'The date is before the account''s opening balance' using errcode = 'FC039';
  end if;

  -- Capitalised moratorium interest is added once, with the first EMI paid.
  if v_item.kind = 'loan_emi' and v_loan.moratorium_interest = 'capitalise' and v_loan.capitalised_minor > 0
     and not exists (
       select 1 from public.due_payments as p join public.due_items as d on d.id = p.due_item_id
       where d.loan_id = v_loan.id and p.voided_at is null and p.capitalised_minor > 0
     ) then
    v_cap := v_loan.capitalised_minor;
  end if;

  select -(a.opening_balance_minor + b.inflow_minor - b.outflow_minor) + v_cap into v_owed
  from public.accounts as a join public.account_balances as b on b.account_id = a.id
  where a.id = v_loan.account_id;
  if coalesce(p_principal_minor, 0) > greatest(v_owed, 0) then
    raise exception 'The principal is more than what is owed' using errcode = 'FC037', detail = greatest(v_owed, 0)::text;
  end if;

  select v_account.opening_balance_minor + b.inflow_minor - b.outflow_minor into v_balance
  from public.account_balances as b where b.account_id = v_account.id;
  if v_balance < v_total and not coalesce(p_allow_shortfall, false) then
    raise exception 'Not enough money in this account' using errcode = 'FC035', detail = (v_total - v_balance)::text;
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);

  insert into public.due_payments (
    due_item_id, account_id, paid_on, principal_minor, interest_minor, fees_minor, capitalised_minor,
    idempotency_key, replaces_id
  ) values (
    v_item.id, v_account.id, p_paid_on, coalesce(p_principal_minor, 0), coalesce(p_interest_minor, 0),
    coalesce(p_fees_minor, 0), v_cap, p_idempotency_key, p_replaces_id
  )
  returning * into v_pay;

  v_note := case v_item.kind when 'loan_emi' then 'EMI ' || v_item.seq else 'Moratorium interest ' || v_item.seq end
            || ' · ' || coalesce(v_loan.nickname, v_loan.lender);

  if v_pay.principal_minor > 0 then
    insert into public.transactions (type, amount_minor, currency, account_id, counter_account_id, occurred_on, note, idempotency_key, due_payment_id)
    values ('transfer', v_pay.principal_minor, v_item.currency, v_account.id, v_loan.account_id, p_paid_on, v_note, pg_catalog.gen_random_uuid(), v_pay.id);
  end if;
  if v_pay.interest_minor > 0 then
    insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, note, idempotency_key, due_payment_id)
    values ('expense', v_pay.interest_minor, v_item.currency, v_account.id, public.loan_category_id('loan_interest'), p_paid_on, v_note, pg_catalog.gen_random_uuid(), v_pay.id);
  end if;
  if v_pay.fees_minor > 0 then
    insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, note, idempotency_key, due_payment_id)
    values ('expense', v_pay.fees_minor, v_item.currency, v_account.id, public.loan_category_id('loan_fees'), p_paid_on, v_note, pg_catalog.gen_random_uuid(), v_pay.id);
  end if;
  if v_cap > 0 then
    -- On the loan account: what is owed grows by the moratorium interest.
    insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, note, idempotency_key, due_payment_id)
    values ('expense', v_cap, v_item.currency, v_loan.account_id, public.loan_category_id('loan_interest'), p_paid_on,
            'Moratorium interest added · ' || coalesce(v_loan.nickname, v_loan.lender), pg_catalog.gen_random_uuid(), v_pay.id);
  end if;

  update public.due_items as d set status = 'paid', planned_on = null, planned_account_id = null where d.id = v_item.id;

  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_pay;
end;
$$;

-- Voids a payment and every entry it posted; the instalment is pending again. A retry with
-- the same key returns the voided payment.
create function public.void_due_payment(p_payment_id uuid, p_idempotency_key uuid, p_reason text default null)
returns public.due_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pay public.due_payments;
  v_item public.due_items;
  v_loan public.loans;
begin
  select * into v_pay from public.due_payments as p where p.id = p_payment_id;
  if v_pay.id is null then
    raise exception 'Payment not found' using errcode = 'FC008';
  end if;
  select * into v_item from public.due_items as d where d.id = v_pay.due_item_id;
  select * into v_loan from public.loans as l where l.id = v_item.loan_id for update;
  select * into v_pay from public.due_payments as p where p.id = p_payment_id for update;

  if v_pay.voided_at is not null then
    if exists (select 1 from public.due_payments as r where r.replaces_id = v_pay.id) then
      raise exception 'This payment was changed elsewhere' using errcode = 'FC014';
    end if;
    if v_pay.void_idempotency_key = p_idempotency_key then
      return v_pay;
    end if;
    raise exception 'This payment is already voided' using errcode = 'FC005';
  end if;
  if v_loan.archived_at is not null then
    raise exception 'Loan is archived' using errcode = 'FC033';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.transactions as t
  set voided_at = pg_catalog.now(), void_reason = nullif(pg_catalog.btrim(p_reason), ''),
      void_idempotency_key = pg_catalog.gen_random_uuid()
  where t.due_payment_id = v_pay.id and t.voided_at is null;
  update public.due_payments as p
  set voided_at = pg_catalog.now(), void_reason = nullif(pg_catalog.btrim(p_reason), ''), void_idempotency_key = p_idempotency_key
  where p.id = v_pay.id
  returning * into v_pay;
  update public.due_items as d set status = 'pending' where d.id = v_pay.due_item_id;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_pay;
end;
$$;

-- Edits a payment: voids it with all its entries and pays the instalment again with the new
-- account, date and split, in one database transaction (linked by replaces_id).
create function public.edit_due_payment(
  p_payment_id uuid,
  p_idempotency_key uuid,
  p_account_id uuid,
  p_paid_on date,
  p_principal_minor bigint,
  p_interest_minor bigint,
  p_fees_minor bigint,
  p_allow_shortfall boolean default false
)
returns public.due_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old public.due_payments;
  v_new public.due_payments;
  v_item public.due_items;
begin
  -- A retry of an edit that was saved returns the saved payment.
  select * into v_new from public.due_payments as p
  where p.user_id = (select auth.uid()) and p.idempotency_key = p_idempotency_key;
  if v_new.id is not null then
    if (v_new.replaces_id, v_new.account_id, v_new.paid_on, v_new.principal_minor, v_new.interest_minor, v_new.fees_minor)
       is distinct from (p_payment_id, p_account_id, p_paid_on, p_principal_minor, p_interest_minor, p_fees_minor) then
      raise exception 'This request key was already used for a different payment' using errcode = 'FC007';
    end if;
    return v_new;
  end if;

  select * into v_old from public.due_payments as p where p.id = p_payment_id;
  if v_old.id is null then
    raise exception 'Payment not found' using errcode = 'FC008';
  end if;
  if v_old.voided_at is not null then
    if exists (select 1 from public.due_payments as r where r.replaces_id = v_old.id) then
      raise exception 'This payment was changed elsewhere' using errcode = 'FC014';
    end if;
    raise exception 'This payment is already voided' using errcode = 'FC005';
  end if;
  if (v_old.account_id, v_old.paid_on, v_old.principal_minor, v_old.interest_minor, v_old.fees_minor)
     is not distinct from (p_account_id, p_paid_on, p_principal_minor, p_interest_minor, p_fees_minor) then
    raise exception 'Nothing has changed' using errcode = 'FC017';
  end if;

  -- The void runs under the edit's request key, so a retry is recognised.
  perform public.void_due_payment(v_old.id, p_idempotency_key);
  select * into v_item from public.due_items as d where d.id = v_old.due_item_id;
  select * into v_new from public.pay_due_item(
    v_item.id, p_idempotency_key, p_account_id, p_paid_on, p_principal_minor, p_interest_minor, p_fees_minor,
    p_allow_shortfall, v_old.id
  );
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row level security
-- ---------------------------------------------------------------------------

revoke execute on function public.accounts_liability_guard() from public, anon, authenticated;
revoke execute on function public.categories_system_guard() from public, anon, authenticated;
revoke execute on function public.loans_validate() from public, anon, authenticated;
revoke execute on function public.due_items_guard() from public, anon, authenticated;
revoke execute on function public.due_payments_guard() from public, anon, authenticated;
revoke execute on function public.transactions_liability_guard() from public, anon, authenticated;
revoke execute on function public.recurring_rules_liability_guard() from public, anon, authenticated;

revoke execute on function public.loan_category_id(text) from public, anon;
revoke execute on function public.loan_due_date(date, integer) from public, anon;
revoke execute on function public.create_loan(uuid, text, text, bigint, bigint, integer, text, integer, text, bigint, integer, date, bigint, bigint, text, text, date, integer, text, bigint, bigint) from public, anon;
revoke execute on function public.update_loan(uuid, text, text, bigint, integer, text, bigint, text, text) from public, anon;
revoke execute on function public.set_loan_archived(uuid, boolean) from public, anon;
revoke execute on function public.delete_loan(uuid) from public, anon;
revoke execute on function public.pay_due_item(uuid, uuid, uuid, date, bigint, bigint, bigint, boolean, uuid) from public, anon;
revoke execute on function public.void_due_payment(uuid, uuid, text) from public, anon;
revoke execute on function public.edit_due_payment(uuid, uuid, uuid, date, bigint, bigint, bigint, boolean) from public, anon;

-- loan_category_id is called by pay_due_item (invoker), so the caller needs EXECUTE.
grant execute on function public.loan_category_id(text) to authenticated;
grant execute on function public.loan_due_date(date, integer) to authenticated;
grant execute on function public.create_loan(uuid, text, text, bigint, bigint, integer, text, integer, text, bigint, integer, date, bigint, bigint, text, text, date, integer, text, bigint, bigint) to authenticated;
grant execute on function public.update_loan(uuid, text, text, bigint, integer, text, bigint, text, text) to authenticated;
grant execute on function public.set_loan_archived(uuid, boolean) to authenticated;
grant execute on function public.delete_loan(uuid) to authenticated;
grant execute on function public.pay_due_item(uuid, uuid, uuid, date, bigint, bigint, bigint, boolean, uuid) to authenticated;
grant execute on function public.void_due_payment(uuid, uuid, text) to authenticated;
grant execute on function public.edit_due_payment(uuid, uuid, uuid, date, bigint, bigint, bigint, boolean) to authenticated;

revoke all on table public.loans, public.due_items, public.due_payments from anon, authenticated;

-- The invoker functions write with the caller's grants; the guards refuse the same writes
-- made directly. "Will pay later" (planned_on, planned_account_id) is the one direct update.
grant select on table public.loans to authenticated;
grant insert (account_id, loan_type, type_other, lender, nickname, currency, sanctioned_minor, disbursed_minor,
              rate_bps, rate_kind, tenure_months, start_mode, opening_outstanding_minor, instalment_months,
              first_due_date, moratorium_months, moratorium_interest, capitalised_minor, emi_estimate_minor,
              emi_minor, tracking_started_on, idempotency_key)
  on table public.loans to authenticated;
grant update (loan_type, type_other, lender, nickname, sanctioned_minor, rate_bps, rate_kind, emi_minor, archived_at)
  on table public.loans to authenticated;

grant select on table public.due_items to authenticated;
grant insert (kind, loan_id, seq, due_date, amount_due_minor, currency, status) on table public.due_items to authenticated;
grant update (amount_due_minor, status, planned_on, planned_account_id) on table public.due_items to authenticated;

grant select on table public.due_payments to authenticated;
grant insert (due_item_id, account_id, paid_on, principal_minor, interest_minor, fees_minor, capitalised_minor,
              idempotency_key, replaces_id)
  on table public.due_payments to authenticated;
grant update (voided_at, void_reason, void_idempotency_key) on table public.due_payments to authenticated;

grant insert (due_payment_id) on table public.transactions to authenticated;

alter table public.loans enable row level security;
alter table public.due_items enable row level security;
alter table public.due_payments enable row level security;

create policy loans_select_own on public.loans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy loans_insert_own on public.loans
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy loans_update_own on public.loans
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy due_items_select_own on public.due_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy due_items_insert_own on public.due_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy due_items_update_own on public.due_items
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy due_payments_select_own on public.due_payments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy due_payments_insert_own on public.due_payments
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy due_payments_update_own on public.due_payments
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
