-- Sprint 8b: credit cards and informal borrowing.
--
-- Model (docs/sprint-plan.md, Sprint 8b):
--   * Liability kinds are loan, card and borrowing, named only in is_liability_kind() (and
--     LIABILITY_ACCOUNT_KINDS in packages/domain). A liability account's balance is minus what
--     is owed; it is never in Total available and is written only by the functions below.
--   * A card owns a liability account (kind 'card'), opened at minus the amount owed when it
--     was added (not posted). Purchases are ordinary expenses on the card account (also from
--     recurring items); nothing else may be posted to it directly. Refunds: void the purchase.
--   * A statement (card_statements) is entered once per card and statement date, on or before
--     today. Its bill = total − card EMIs included (those are paid from the loan row). When
--     the bill is more than what is owed on the statement date, the difference may be posted
--     as an expense in a category the person picks, dated the statement date (never negative).
--     A bill above zero is a due item of kind card_bill (Due soon, bell, "Will pay later").
--   * Paying a bill (pay_due_item, one active payment per bill) or paying any amount (pay_card)
--     is a transfer to the card account, never more than what is owed now (FC047: record the
--     missing purchase first). A part-paid bill is closed; the rest stays owed on the card.
--     card_sync_due also marks a bill paid once transfers into the card dated on or after its
--     statement date (card_bill_paid) cover it, and pending again when a void undoes that.
--   * A borrowing (who you owe, a name only) owns a liability account (kind 'borrowing'):
--     either the money was received into an account on a date (a transfer from the borrowing
--     account, posted with it) or it was received earlier (opening balance = minus the amount,
--     today). Part payments (repay_borrowing) are transfers to it, interest is an expense
--     ("Loan interest"). An optional due date is a due item of kind borrowing_due: it is paid
--     when nothing is owed and pending (so overdue once past) otherwise.
--   * Free payments and repayments are liability_payments; their entries carry
--     transactions.liability_payment_id and change only through edit / void below.
--   * Shortfall: as 8a (FC035, detail = the shortfall, unless p_allow_shortfall).
--   * A card or borrowing is archived only when nothing is owed; it is deleted only when it
--     has no history (no purchase, statement or payment).
--   * No digits at all in a card issuer, card nickname or the name of who you owe.
--   * The difference expense and a borrowing's receipt change only with their statement or
--     borrowing; a recurring item on a card starts on or after the day the card was added.
--
-- Writes are marked with fin_creador.loan_write (8a's transaction-local setting).
--
-- New error codes (mapped in packages/api):
--   FC045 still owed (can't archive)                       FC046 a statement for this date exists
--   FC047 more than owed: record the missing purchase first FC048 card or borrowing archived
--   FC049 only expenses can be recorded on a card          FC050 has history (can't be deleted)
--   FC051 due date before the statement / borrowing date
-- Reused: FC001, FC002, FC003, FC005, FC007, FC008, FC009, FC010, FC014, FC017, FC032, FC034,
-- FC035, FC036 (date before the card or borrowing was added), FC037, FC038, FC039, FC041.

-- ---------------------------------------------------------------------------
-- Liability kinds (the one list; parity: LIABILITY_ACCOUNT_KINDS in packages/domain)
-- ---------------------------------------------------------------------------

create function public.is_liability_kind(p_kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_kind in ('loan', 'card', 'borrowing');
$$;

alter table public.accounts drop constraint accounts_kind;
alter table public.accounts add constraint accounts_kind check (
  kind in ('bank', 'cash', 'other') or public.is_liability_kind(kind)
);

alter table public.accounts drop constraint accounts_opening_balance_sign;
alter table public.accounts add constraint accounts_opening_balance_sign check (
  kind = 'bank'
  or (public.is_liability_kind(kind) and opening_balance_minor <= 0)
  or (kind in ('cash', 'other') and opening_balance_minor >= 0)
);

alter table public.accounts drop constraint accounts_loan_no_number;
alter table public.accounts add constraint accounts_liability_no_number check (
  not public.is_liability_kind(kind) or last4 is null
);

create or replace function public.accounts_liability_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (public.is_liability_kind(new.kind) or (tg_op = 'UPDATE' and public.is_liability_kind(old.kind)))
     and pg_catalog.current_setting('fin_creador.loan_write', true) is distinct from 'on' then
    raise exception 'This account changes only through its loan, card or borrowing' using errcode = 'FC032';
  end if;
  return new;
end;
$$;

-- What a liability account owes: −(opening + inflows − outflows), counting entries on or after
-- its opening date and, with p_as_of, on or before that date. Invoker: RLS applies.
create function public.liability_owed(p_account_id uuid, p_as_of date default null)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select -(a.opening_balance_minor + coalesce(sum(
           case when t.type = 'income' or t.counter_account_id = a.id then t.amount_minor else -t.amount_minor end
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

-- The difference expense and the receipt reference their entry with its owner through
-- transactions_id_user_unique (Sprint 3).

-- ---------------------------------------------------------------------------
-- Card cycle dates (parity with packages/domain: supabase/tests/database/card_dates_parity.test.sql)
-- ---------------------------------------------------------------------------

-- Day p_day of p_month's month, clamped to the month end (31 → 30 April, 28 or 29 February).
create function public.card_cycle_date(p_day integer, p_month date)
returns date
language sql
immutable
set search_path = ''
as $$
  select (pg_catalog.date_trunc('month', p_month::timestamp)::date
          + (least(p_day, extract(day from (pg_catalog.date_trunc('month', p_month::timestamp) + interval '1 month - 1 day'))::integer) - 1));
$$;

-- The due date for a statement: due day in the statement's month when it is later than the
-- statement day, else in the next month; clamped to the month end.
create function public.card_due_date(p_statement_date date, p_statement_day integer, p_due_day integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_due_day > p_statement_day then public.card_cycle_date(p_due_day, p_statement_date)
    else public.card_cycle_date(p_due_day, (p_statement_date + interval '1 month')::date)
  end;
$$;

-- ---------------------------------------------------------------------------
-- Credit cards and statements
-- ---------------------------------------------------------------------------

create table public.credit_cards (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id          uuid not null,
  issuer              text not null,
  nickname            text,
  currency            text not null,
  limit_minor         bigint not null,
  statement_day       integer not null,
  due_day             integer not null,
  -- Owed when the card was added (the account's opening balance, negated; never posted).
  opening_owed_minor  bigint not null,
  tracking_started_on date not null,
  archived_at         timestamptz,
  idempotency_key     uuid not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint credit_cards_id_user_unique unique (id, user_id),
  constraint credit_cards_account_unique unique (account_id),
  constraint credit_cards_idempotency_unique unique (user_id, idempotency_key),
  constraint credit_cards_account_owned
    foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  -- No card numbers: no digits at all.
  constraint credit_cards_issuer check (char_length(btrim(issuer)) between 1 and 80 and issuer !~ '[0-9]'),
  constraint credit_cards_nickname check (
    nickname is null or (char_length(btrim(nickname)) between 1 and 40 and nickname !~ '[0-9]')
  ),
  constraint credit_cards_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint credit_cards_limit_range check (limit_minor > 0 and limit_minor <= 10000000000000),
  constraint credit_cards_statement_day check (statement_day between 1 and 31),
  constraint credit_cards_due_day check (due_day between 1 and 31),
  constraint credit_cards_opening_owed check (opening_owed_minor between 0 and 10000000000000)
);

create index credit_cards_user_idx on public.credit_cards (user_id) where archived_at is null;

comment on table public.credit_cards is
  'Credit cards. Owed = −(balance of account_id, a card account). Cycle dates: card_cycle_date / card_due_date and packages/domain.';

create function public.credit_cards_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('fin_creador.loan_write', true) is distinct from 'on' then
    raise exception 'Cards change only through the card functions' using errcode = 'FC032';
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.user_id, new.account_id, new.currency, new.opening_owed_minor, new.tracking_started_on,
        new.idempotency_key, new.created_at)
       is distinct from
       (old.id, old.user_id, old.account_id, old.currency, old.opening_owed_minor, old.tracking_started_on,
        old.idempotency_key, old.created_at)
    then
      raise exception 'A card''s identity can''t change' using errcode = 'FC009';
    end if;
    if old.archived_at is not null and new.archived_at is not null
       and (new.issuer, new.nickname, new.limit_minor, new.statement_day, new.due_day)
           is distinct from (old.issuer, old.nickname, old.limit_minor, old.statement_day, old.due_day)
    then
      raise exception 'Card is archived' using errcode = 'FC048';
    end if;
    if old.archived_at is null and new.archived_at is not null then
      new.archived_at := pg_catalog.now();
    elsif old.archived_at is not null and new.archived_at is not null then
      new.archived_at := old.archived_at;
    end if;
  else
    if new.currency is distinct from (select p.currency from public.profiles as p where p.id = new.user_id) then
      raise exception 'A card uses your profile currency' using errcode = 'FC002';
    end if;
    new.archived_at := null;
    new.created_at := pg_catalog.now();
    new.tracking_started_on := public.user_local_today(new.user_id);
  end if;
  new.issuer := pg_catalog.btrim(pg_catalog.regexp_replace(new.issuer, '\s+', ' ', 'g'));
  new.nickname := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(new.nickname, ''), '\s+', ' ', 'g')), '');
  return new;
end;
$$;

create trigger credit_cards_validate
  before insert or update on public.credit_cards
  for each row execute function public.credit_cards_validate();

create trigger credit_cards_set_updated_at
  before update on public.credit_cards
  for each row execute function public.set_updated_at();

create table public.card_statements (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id                   uuid not null,
  statement_date            date not null,
  due_date                  date not null,
  total_minor               bigint not null,
  minimum_minor             bigint not null default 0,
  -- Card EMIs on this statement (paid from the loan row, not from the bill).
  emi_included_minor        bigint not null default 0,
  -- Owed on the statement date; null when the statement is before the card was added.
  owed_at_statement_minor   bigint,
  -- The difference posted as an expense (0 when none was posted).
  difference_minor          bigint not null default 0,
  difference_transaction_id uuid,
  idempotency_key           uuid not null,
  created_at                timestamptz not null default now(),

  constraint card_statements_id_user_unique unique (id, user_id),
  constraint card_statements_one_per_date unique (card_id, statement_date),
  constraint card_statements_idempotency_unique unique (user_id, idempotency_key),
  constraint card_statements_card_owned
    foreign key (card_id, user_id) references public.credit_cards (id, user_id) on delete cascade,
  constraint card_statements_difference_owned
    foreign key (difference_transaction_id, user_id) references public.transactions (id, user_id),
  constraint card_statements_dates check (statement_date >= date '1970-01-01' and due_date >= statement_date),
  constraint card_statements_total_range check (total_minor between 0 and 10000000000000),
  constraint card_statements_minimum_range check (minimum_minor between 0 and total_minor),
  constraint card_statements_emi_range check (emi_included_minor between 0 and total_minor),
  constraint card_statements_difference check (
    difference_minor between 0 and 10000000000000
    and (difference_minor > 0) = (difference_transaction_id is not null)
  )
);

create index card_statements_difference_idx on public.card_statements (difference_transaction_id)
  where difference_transaction_id is not null;

comment on table public.card_statements is
  'One statement per card and statement date. Bill = total − emi_included; a bill above zero is a card_bill due item.';

create function public.card_statements_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('fin_creador.loan_write', true) is distinct from 'on' then
    raise exception 'Statements change only through the card functions' using errcode = 'FC032';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'A statement can''t be edited; delete it and enter it again' using errcode = 'FC009';
  end if;
  new.created_at := pg_catalog.now();
  return new;
end;
$$;

create trigger card_statements_guard
  before insert or update on public.card_statements
  for each row execute function public.card_statements_guard();

-- A card EMI (loan type credit_card_emi) may name its card, to fill "EMIs included".
alter table public.loans add column card_id uuid;
alter table public.loans add constraint loans_card_owned
  foreign key (card_id, user_id) references public.credit_cards (id, user_id);
alter table public.loans add constraint loans_card_emi_only check (card_id is null or loan_type = 'credit_card_emi');
create index loans_card_idx on public.loans (card_id) where card_id is not null;

-- ---------------------------------------------------------------------------
-- Informal borrowing
-- ---------------------------------------------------------------------------

create table public.borrowings (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id             uuid not null,
  -- Who you owe: a name only.
  lender                 text not null,
  currency               text not null,
  borrowed_minor         bigint not null,
  -- "Money received into <account> on <date>": the transfer posted with it; null when it was
  -- received earlier (only what is owed is recorded).
  received_on            date,
  receipt_transaction_id uuid,
  archived_at            timestamptz,
  idempotency_key        uuid not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint borrowings_id_user_unique unique (id, user_id),
  constraint borrowings_account_unique unique (account_id),
  constraint borrowings_idempotency_unique unique (user_id, idempotency_key),
  constraint borrowings_account_owned
    foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  constraint borrowings_receipt_owned
    foreign key (receipt_transaction_id, user_id) references public.transactions (id, user_id),
  constraint borrowings_lender check (char_length(btrim(lender)) between 1 and 80 and lender !~ '[0-9]'),
  constraint borrowings_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint borrowings_amount_range check (borrowed_minor > 0 and borrowed_minor <= 10000000000000),
  constraint borrowings_receipt_pair check ((received_on is null) = (receipt_transaction_id is null))
);

create index borrowings_user_idx on public.borrowings (user_id) where archived_at is null;
create index borrowings_receipt_idx on public.borrowings (receipt_transaction_id) where receipt_transaction_id is not null;

comment on table public.borrowings is
  'Money borrowed from friends, family or others. Owed = −(balance of account_id, a borrowing account).';

create function public.borrowings_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('fin_creador.loan_write', true) is distinct from 'on' then
    raise exception 'Borrowings change only through the borrowing functions' using errcode = 'FC032';
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.user_id, new.account_id, new.currency, new.borrowed_minor, new.received_on,
        new.receipt_transaction_id, new.idempotency_key, new.created_at)
       is distinct from
       (old.id, old.user_id, old.account_id, old.currency, old.borrowed_minor, old.received_on,
        old.receipt_transaction_id, old.idempotency_key, old.created_at)
    then
      raise exception 'A borrowing''s identity can''t change' using errcode = 'FC009';
    end if;
    if old.archived_at is not null and new.archived_at is not null and new.lender is distinct from old.lender then
      raise exception 'Borrowing is archived' using errcode = 'FC048';
    end if;
    if old.archived_at is null and new.archived_at is not null then
      new.archived_at := pg_catalog.now();
    elsif old.archived_at is not null and new.archived_at is not null then
      new.archived_at := old.archived_at;
    end if;
  else
    if new.currency is distinct from (select p.currency from public.profiles as p where p.id = new.user_id) then
      raise exception 'A borrowing uses your profile currency' using errcode = 'FC002';
    end if;
    new.archived_at := null;
    new.created_at := pg_catalog.now();
  end if;
  new.lender := pg_catalog.btrim(pg_catalog.regexp_replace(new.lender, '\s+', ' ', 'g'));
  return new;
end;
$$;

create trigger borrowings_validate
  before insert or update on public.borrowings
  for each row execute function public.borrowings_validate();

create trigger borrowings_set_updated_at
  before update on public.borrowings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Due items: card bills and borrowing due dates
-- ---------------------------------------------------------------------------

alter table public.due_items add column card_statement_id uuid;
alter table public.due_items add column borrowing_id uuid;
alter table public.due_items add constraint due_items_card_statement_owned
  foreign key (card_statement_id, user_id) references public.card_statements (id, user_id) on delete cascade;
alter table public.due_items add constraint due_items_borrowing_owned
  foreign key (borrowing_id, user_id) references public.borrowings (id, user_id) on delete cascade;
alter table public.due_items add constraint due_items_card_statement_unique unique (card_statement_id);
alter table public.due_items add constraint due_items_borrowing_unique unique (borrowing_id);

alter table public.due_items drop constraint due_items_kind;
alter table public.due_items add constraint due_items_kind check (
  kind in ('loan_emi', 'loan_interest', 'card_bill', 'borrowing_due')
);
alter table public.due_items drop constraint due_items_source;
alter table public.due_items add constraint due_items_source check (
  (kind in ('loan_emi', 'loan_interest')) = (loan_id is not null)
  and (kind = 'card_bill') = (card_statement_id is not null)
  and (kind = 'borrowing_due') = (borrowing_id is not null)
  and (kind in ('loan_emi', 'loan_interest') or seq = 0)
);

comment on table public.due_items is
  'Anything due on a date and paid from an account: loan EMIs and moratorium interest (8a), card bills and borrowing due dates (8b). Reminders are derived from these dates in packages/domain/src/due-items.ts.';

-- Replaces the 8a guard: new sources; a borrowing's due date may move (set_borrowing_due_date).
create or replace function public.due_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_marked boolean := pg_catalog.current_setting('fin_creador.loan_write', true) is not distinct from 'on';
  v_account public.accounts;
begin
  if tg_op = 'INSERT' then
    if not v_marked then
      raise exception 'Due items change only through their loan, card or borrowing' using errcode = 'FC032';
    end if;
    return new;
  end if;

  -- The planned account was deleted (ON DELETE SET NULL): the plan goes with it.
  if new.planned_account_id is null and old.planned_account_id is not null then
    new.planned_on := null;
  end if;

  if (new.id, new.user_id, new.kind, new.loan_id, new.card_statement_id, new.borrowing_id, new.seq,
      new.currency, new.created_at)
     is distinct from
     (old.id, old.user_id, old.kind, old.loan_id, old.card_statement_id, old.borrowing_id, old.seq,
      old.currency, old.created_at)
     or (new.due_date is distinct from old.due_date and not (v_marked and old.kind = 'borrowing_due'))
  then
    raise exception 'A due item''s identity can''t change' using errcode = 'FC009';
  end if;
  if (new.amount_due_minor, new.minimum_due_minor, new.status) is distinct from (old.amount_due_minor, old.minimum_due_minor, old.status)
     and not v_marked then
    raise exception 'Due items change only through their loan, card or borrowing' using errcode = 'FC032';
  end if;

  -- "Will pay later" (a direct update of planned_on / planned_account_id).
  if (new.planned_on, new.planned_account_id) is distinct from (old.planned_on, old.planned_account_id)
     and new.planned_on is not null then
    if new.status <> 'pending' then
      raise exception 'Only a pending item can be planned' using errcode = 'FC034';
    end if;
    if exists (select 1 from public.loans as l where l.id = new.loan_id and l.archived_at is not null) then
      raise exception 'Loan is archived' using errcode = 'FC033';
    end if;
    if exists (
      select 1 from public.card_statements as s join public.credit_cards as c on c.id = s.card_id
      where s.id = new.card_statement_id and c.archived_at is not null
    ) or exists (select 1 from public.borrowings as b where b.id = new.borrowing_id and b.archived_at is not null) then
      raise exception 'Card or borrowing is archived' using errcode = 'FC048';
    end if;
    if new.planned_on is distinct from old.planned_on and new.planned_on < public.user_local_today(new.user_id) then
      raise exception 'The planned date can''t be in the past' using errcode = 'FC041';
    end if;
    select * into v_account from public.accounts as a where a.id = new.planned_account_id;
    if public.is_liability_kind(v_account.kind) then
      raise exception 'A loan, card or borrowing account can''t pay' using errcode = 'FC038';
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

-- ---------------------------------------------------------------------------
-- Liability payments: free card payments and borrowing repayments
-- ---------------------------------------------------------------------------

create table public.liability_payments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The card or borrowing account paid.
  liability_account_id uuid not null,
  -- The paying account.
  account_id           uuid not null,
  paid_on              date not null,
  principal_minor      bigint not null default 0,
  interest_minor       bigint not null default 0,
  idempotency_key      uuid not null,
  replaces_id          uuid,
  voided_at            timestamptz,
  void_reason          text,
  void_idempotency_key uuid,
  created_at           timestamptz not null default now(),

  constraint liability_payments_id_user_unique unique (id, user_id),
  constraint liability_payments_idempotency_unique unique (user_id, idempotency_key),
  constraint liability_payments_void_idempotency_unique unique (user_id, void_idempotency_key),
  constraint liability_payments_liability_owned
    foreign key (liability_account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  constraint liability_payments_account_owned
    foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  constraint liability_payments_replaces_owned
    foreign key (replaces_id, user_id) references public.liability_payments (id, user_id) on delete cascade,
  constraint liability_payments_two_accounts check (account_id <> liability_account_id),
  constraint liability_payments_replaces_other check (replaces_id is null or replaces_id <> id),
  constraint liability_payments_parts check (
    principal_minor between 0 and 10000000000000
    and interest_minor between 0 and 10000000000000
    and principal_minor + interest_minor > 0
  ),
  constraint liability_payments_paid_range check (paid_on >= date '1970-01-01'),
  constraint liability_payments_void_key_with_void check ((voided_at is null) = (void_idempotency_key is null)),
  constraint liability_payments_void_reason check (
    void_reason is null or (voided_at is not null and char_length(btrim(void_reason)) between 1 and 200)
  )
);

create unique index liability_payments_replaces_idx on public.liability_payments (replaces_id) where replaces_id is not null;
create index liability_payments_liability_idx on public.liability_payments (liability_account_id);
create index liability_payments_account_idx on public.liability_payments (account_id);

comment on table public.liability_payments is
  'A card payment not tied to a statement, or a borrowing repayment. Its parts are ledger entries (transactions.liability_payment_id); an edit voids it and adds a new one (replaces_id).';

alter table public.transactions add column liability_payment_id uuid;
alter table public.transactions add constraint transactions_liability_payment_owned
  foreign key (liability_payment_id, user_id) references public.liability_payments (id, user_id) on delete cascade;
alter table public.transactions add constraint transactions_one_payment check (due_payment_id is null or liability_payment_id is null);
create index transactions_liability_payment_idx on public.transactions (liability_payment_id) where liability_payment_id is not null;

create function public.liability_payments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('fin_creador.loan_write', true) is distinct from 'on' then
    raise exception 'Payments change only through their card or borrowing' using errcode = 'FC032';
  end if;
  if tg_op = 'UPDATE' then
    if old.voided_at is not null then
      raise exception 'A voided payment can''t change' using errcode = 'FC005';
    end if;
    if (new.id, new.user_id, new.liability_account_id, new.account_id, new.paid_on, new.principal_minor,
        new.interest_minor, new.idempotency_key, new.replaces_id, new.created_at)
       is distinct from
       (old.id, old.user_id, old.liability_account_id, old.account_id, old.paid_on, old.principal_minor,
        old.interest_minor, old.idempotency_key, old.replaces_id, old.created_at)
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

create trigger liability_payments_guard
  before insert or update on public.liability_payments
  for each row execute function public.liability_payments_guard();

-- ---------------------------------------------------------------------------
-- Ledger and recurring guards (replace the 8a versions)
-- ---------------------------------------------------------------------------

-- Direct entries on liability accounts: only card purchases (expenses on a card, on or after
-- the day it was added). Payment entries, a statement's difference expense and a borrowing's
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
      if new.type <> 'expense' then
        raise exception 'Only expenses can be recorded on a card' using errcode = 'FC049';
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

-- Recurring items may be expenses on a card; no other use of a liability account.
create or replace function public.recurring_rules_liability_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
  v_opened date;
begin
  if exists (
    select 1 from public.accounts as a
    where a.id = new.counter_account_id and public.is_liability_kind(a.kind)
  ) then
    raise exception 'Pay a loan, card or borrowing from its own page' using errcode = 'FC032';
  end if;
  select a.kind, a.opening_balance_date into v_kind, v_opened from public.accounts as a where a.id = new.account_id;
  if public.is_liability_kind(v_kind) and not (v_kind = 'card' and new.type = 'expense') then
    raise exception 'Only recurring expenses can use a card' using errcode = 'FC032';
  end if;
  -- Occurrences before the card was added could never be confirmed (they are in its opening
  -- amount owed), so the rule must start on or after that day.
  if v_kind = 'card' and (tg_op = 'INSERT' or new.account_id is distinct from old.account_id)
     and new.start_date < v_opened then
    raise exception 'A recurring item on a card starts on or after the day the card was added' using errcode = 'FC036';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cards: create, update, archive, delete, link a card EMI
-- ---------------------------------------------------------------------------

create function public.create_card(
  p_idempotency_key uuid,
  p_issuer text,
  p_limit_minor bigint,
  p_statement_day integer,
  p_due_day integer,
  p_opening_owed_minor bigint default 0,
  p_nickname text default null
)
returns public.credit_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_issuer text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_issuer, ''), '\s+', ' ', 'g'));
  v_nickname text := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g')), '');
  v_currency text;
  v_account public.accounts;
  v_card public.credit_cards;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text || p_idempotency_key::text, 0));

  select * into v_card from public.credit_cards as c where c.user_id = v_uid and c.idempotency_key = p_idempotency_key;
  if v_card.id is not null then
    if (v_card.issuer, v_card.limit_minor, v_card.statement_day, v_card.due_day, v_card.opening_owed_minor)
       is distinct from (v_issuer, p_limit_minor, p_statement_day, p_due_day, coalesce(p_opening_owed_minor, 0)) then
      raise exception 'This request key was already used for a different card' using errcode = 'FC007';
    end if;
    return v_card;
  end if;

  select p.currency into v_currency from public.profiles as p where p.id = v_uid;
  if v_currency is null then
    raise exception 'Profile not found' using errcode = 'FC010';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  insert into public.accounts (kind, name, institution, currency, opening_balance_minor, opening_balance_date)
  values ('card', pg_catalog.left(coalesce(v_nickname, v_issuer), 80), nullif(v_issuer, ''), v_currency,
          -coalesce(p_opening_owed_minor, 0), public.user_local_today(v_uid))
  returning * into v_account;

  insert into public.credit_cards (
    account_id, issuer, nickname, currency, limit_minor, statement_day, due_day, opening_owed_minor,
    tracking_started_on, idempotency_key
  ) values (
    v_account.id, v_issuer, v_nickname, v_currency, p_limit_minor, p_statement_day, p_due_day,
    coalesce(p_opening_owed_minor, 0), v_account.opening_balance_date, p_idempotency_key
  )
  returning * into v_card;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_card;
end;
$$;

create function public.update_card(
  p_card_id uuid,
  p_issuer text,
  p_limit_minor bigint,
  p_statement_day integer,
  p_due_day integer,
  p_nickname text default null
)
returns public.credit_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_card public.credit_cards;
begin
  select * into v_card from public.credit_cards as c where c.id = p_card_id for update;
  if v_card.id is null then
    raise exception 'Card not found' using errcode = 'FC008';
  end if;
  if v_card.archived_at is not null then
    raise exception 'Card is archived' using errcode = 'FC048';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.credit_cards as c
  set issuer = p_issuer, nickname = p_nickname, limit_minor = p_limit_minor,
      statement_day = p_statement_day, due_day = p_due_day
  where c.id = v_card.id
  returning * into v_card;
  update public.accounts as a
  set name = pg_catalog.left(coalesce(v_card.nickname, v_card.issuer), 80), institution = v_card.issuer
  where a.id = v_card.account_id;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_card;
end;
$$;

-- Archive (only when nothing is owed) or restore a card with its account.
create function public.set_card_archived(p_card_id uuid, p_archived boolean)
returns public.credit_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_card public.credit_cards;
  v_owed bigint;
  v_at timestamptz := case when p_archived then pg_catalog.now() end;
begin
  select * into v_card from public.credit_cards as c where c.id = p_card_id for update;
  if v_card.id is null then
    raise exception 'Card not found' using errcode = 'FC008';
  end if;
  if p_archived then
    v_owed := public.liability_owed(v_card.account_id);
    if v_owed <> 0 then
      raise exception 'A card can be archived only at a zero balance (nothing owed, no credit)' using errcode = 'FC045', detail = v_owed::text;
    end if;
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.credit_cards as c set archived_at = v_at where c.id = v_card.id returning * into v_card;
  update public.accounts as a set archived_at = v_at where a.id = v_card.account_id;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_card;
end;
$$;

-- Deletes a card that has no history (no purchase, statement or payment, voided ones
-- included), with its account; card EMIs linked to it are unlinked. SECURITY DEFINER because
-- clients can't delete accounts; it acts only on the caller's own card.
create function public.delete_card(p_card_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.credit_cards;
begin
  select * into v_card from public.credit_cards as c
  where c.id = p_card_id and c.user_id = (select auth.uid())
  for update;
  if v_card.id is null then
    raise exception 'Card not found' using errcode = 'FC008';
  end if;
  if exists (select 1 from public.card_statements as s where s.card_id = v_card.id)
     or exists (select 1 from public.liability_payments as p where p.liability_account_id = v_card.account_id)
     or exists (select 1 from public.transactions as t
                where t.account_id = v_card.account_id or t.counter_account_id = v_card.account_id)
     or exists (select 1 from public.recurring_rules as r where r.account_id = v_card.account_id) then
    raise exception 'A card with purchases, statements or payments can''t be deleted' using errcode = 'FC050';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.loans as l set card_id = null where l.card_id = v_card.id;
  delete from public.credit_cards as c where c.id = v_card.id;
  delete from public.accounts as a where a.id = v_card.account_id;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
end;
$$;

-- Links a card EMI loan to its card (p_card_id null or left out unlinks).
create function public.link_card_emi(p_loan_id uuid, p_card_id uuid default null)
returns public.loans
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_loan public.loans;
  v_card public.credit_cards;
begin
  select * into v_loan from public.loans as l where l.id = p_loan_id for update;
  if v_loan.id is null then
    raise exception 'Loan not found' using errcode = 'FC008';
  end if;
  if v_loan.loan_type <> 'credit_card_emi' then
    raise exception 'Only a credit card EMI can be linked to a card' using errcode = '22023';
  end if;
  if p_card_id is not null then
    select * into v_card from public.credit_cards as c where c.id = p_card_id;
    if v_card.id is null then
      raise exception 'Card not found' using errcode = 'FC008';
    end if;
    if v_card.archived_at is not null then
      raise exception 'Card is archived' using errcode = 'FC048';
    end if;
    if v_card.currency <> v_loan.currency then
      raise exception 'Currency must match the card (%)', v_card.currency using errcode = 'FC002';
    end if;
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.loans as l set card_id = p_card_id where l.id = v_loan.id returning * into v_loan;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_loan;
end;
$$;

-- ---------------------------------------------------------------------------
-- Card bill progress
-- ---------------------------------------------------------------------------

-- Paid towards a card bill: active transfers into the card account dated on or after its
-- statement date (bill payments and free card payments alike). 0 for other due items.
create function public.card_bill_paid(p_due_item_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(t.amount_minor), 0)::bigint
  from public.due_items as d
  join public.card_statements as s on s.id = d.card_statement_id
  join public.credit_cards as c on c.id = s.card_id
  join public.transactions as t
    on t.counter_account_id = c.account_id and t.type = 'transfer' and t.voided_at is null
    and t.occurred_on >= s.statement_date
  where d.id = p_due_item_id;
$$;

-- A card's bills: paid when closed through pay_due_item (an active payment) or when
-- card_bill_paid covers the bill; pending otherwise. A paid bill drops its plan. Runs under
-- the write mark (due_items_guard).
create function public.card_sync_due(p_card_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.due_items as d
  set status = v.status,
      planned_on = case when v.status = 'paid' then null else d.planned_on end,
      planned_account_id = case when v.status = 'paid' then null else d.planned_account_id end
  from (
    select i.id,
           case when exists (select 1 from public.due_payments as p where p.due_item_id = i.id and p.voided_at is null)
                  or public.card_bill_paid(i.id) >= i.amount_due_minor
                then 'paid' else 'pending' end as status
    from public.due_items as i
    join public.card_statements as s on s.id = i.card_statement_id
    where s.card_id = p_card_id
  ) as v
  where d.id = v.id and d.status <> v.status;
end;
$$;

-- Card bills with what has been paid towards them (for "Minimum paid" / "Part-paid").
create view public.card_bill_progress
with (security_invoker = true)
as
select d.id as due_item_id, d.user_id, s.card_id, public.card_bill_paid(d.id) as paid_minor
from public.due_items as d
join public.card_statements as s on s.id = d.card_statement_id;

-- ---------------------------------------------------------------------------
-- Statements
-- ---------------------------------------------------------------------------

-- Enters a statement once per request key and once per card and statement date (on or before
-- today in the person's time zone). Bill = total − p_emi_included_minor. When the statement is
-- on or after the day the card was added, what was owed on the statement date is measured;
-- if the bill is more and p_difference_category_id is given, the difference is posted as an
-- expense on the card dated the statement date. A bill above zero becomes a card_bill due
-- item; the minimum is capped at the bill (the statement's minimum may include the EMIs).
-- p_due_date null takes the card's due day (card_due_date).
create function public.enter_card_statement(
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
  v_due := coalesce(p_due_date, public.card_due_date(p_statement_date, v_card.statement_day, v_card.due_day));
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
    v_difference := greatest(v_bill - v_owed_at, 0);
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

-- Deletes a statement entered by mistake, while its bill has never been paid (voided payments
-- included); its difference expense is voided. SECURITY DEFINER because clients can't delete
-- statements or due items; it acts only on the caller's own statement.
create function public.delete_card_statement(p_statement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statement public.card_statements;
  v_card public.credit_cards;
begin
  select * into v_statement from public.card_statements as s
  where s.id = p_statement_id and s.user_id = (select auth.uid());
  if v_statement.id is null then
    raise exception 'Statement not found' using errcode = 'FC008';
  end if;
  select * into v_card from public.credit_cards as c where c.id = v_statement.card_id for update;
  if v_card.archived_at is not null then
    raise exception 'Card is archived' using errcode = 'FC048';
  end if;
  if exists (
    select 1 from public.due_payments as p join public.due_items as d on d.id = p.due_item_id
    where d.card_statement_id = v_statement.id
  ) then
    raise exception 'A statement with payments can''t be deleted' using errcode = 'FC050';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.transactions as t
  set voided_at = pg_catalog.now(), void_reason = 'Statement deleted', void_idempotency_key = pg_catalog.gen_random_uuid()
  where t.id = v_statement.difference_transaction_id and t.voided_at is null;
  delete from public.card_statements as s where s.id = v_statement.id; -- its due item cascades
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Borrowings: create, rename, due date, archive, delete
-- ---------------------------------------------------------------------------

-- Pending while anything is owed, paid when nothing is; a paid item drops its plan.
create function public.borrowing_sync_due(p_borrowing_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  select case when public.liability_owed(b.account_id) > 0 then 'pending' else 'paid' end into v_status
  from public.borrowings as b where b.id = p_borrowing_id;
  update public.due_items as d
  set status = v_status,
      planned_on = case when v_status = 'paid' then null else d.planned_on end,
      planned_account_id = case when v_status = 'paid' then null else d.planned_account_id end
  where d.borrowing_id = p_borrowing_id and d.status <> v_status;
end;
$$;

-- Adds a borrowing once per request key. With p_received_account_id and p_received_on, the
-- money is posted as received into that account on that date (a transfer from the borrowing
-- account, opened at zero on that date); without them only what is owed is recorded (opening
-- balance = minus the amount, today). p_due_date adds a borrowing_due item.
create function public.create_borrowing(
  p_idempotency_key uuid,
  p_lender text,
  p_amount_minor bigint,
  p_received_account_id uuid default null,
  p_received_on date default null,
  p_due_date date default null
)
returns public.borrowings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_lender text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_lender, ''), '\s+', ' ', 'g'));
  v_today date;
  v_currency text;
  v_open_on date;
  v_received public.accounts;
  v_account public.accounts;
  v_tx public.transactions;
  v_borrowing public.borrowings;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text || p_idempotency_key::text, 0));

  select * into v_borrowing from public.borrowings as b where b.user_id = v_uid and b.idempotency_key = p_idempotency_key;
  if v_borrowing.id is not null then
    if (v_borrowing.lender, v_borrowing.borrowed_minor, v_borrowing.received_on)
       is distinct from (v_lender, p_amount_minor, p_received_on) then
      raise exception 'This request key was already used for a different borrowing' using errcode = 'FC007';
    end if;
    return v_borrowing;
  end if;

  if (p_received_account_id is null) <> (p_received_on is null) then
    raise exception 'Choose the account and the date the money was received' using errcode = '22023';
  end if;
  select p.currency into v_currency from public.profiles as p where p.id = v_uid;
  if v_currency is null then
    raise exception 'Profile not found' using errcode = 'FC010';
  end if;
  v_today := public.user_local_today(v_uid);

  if p_received_account_id is not null then
    if p_received_on > v_today then
      raise exception 'Date cannot be in the future' using errcode = 'FC003';
    end if;
    select * into v_received from public.accounts as a where a.id = p_received_account_id for update;
    if v_received.id is null then
      raise exception 'Account not found' using errcode = 'FC010';
    end if;
    if public.is_liability_kind(v_received.kind) then
      raise exception 'Choose a bank, cash or other account' using errcode = 'FC038';
    end if;
    if v_received.archived_at is not null then
      raise exception 'Account is archived' using errcode = 'FC001';
    end if;
    if v_received.currency <> v_currency then
      raise exception 'Currency must match the account (%)', v_received.currency using errcode = 'FC002';
    end if;
    if p_received_on < v_received.opening_balance_date then
      raise exception 'The date is before the account''s opening balance' using errcode = 'FC039';
    end if;
  end if;
  v_open_on := coalesce(p_received_on, v_today);
  if p_due_date is not null and p_due_date < v_open_on then
    raise exception 'The due date is before the money was borrowed' using errcode = 'FC051';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);

  insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date)
  values ('borrowing', pg_catalog.left(v_lender, 80), v_currency,
          case when p_received_account_id is null then -p_amount_minor else 0 end, v_open_on)
  returning * into v_account;

  if p_received_account_id is not null then
    insert into public.transactions (type, amount_minor, currency, account_id, counter_account_id, occurred_on, note, idempotency_key)
    values ('transfer', p_amount_minor, v_currency, v_account.id, v_received.id, p_received_on,
            'Borrowed · ' || v_lender, pg_catalog.gen_random_uuid())
    returning * into v_tx;
  end if;

  insert into public.borrowings (account_id, lender, currency, borrowed_minor, received_on, receipt_transaction_id, idempotency_key)
  values (v_account.id, v_lender, v_currency, p_amount_minor, p_received_on, v_tx.id, p_idempotency_key)
  returning * into v_borrowing;

  if p_due_date is not null then
    insert into public.due_items (kind, borrowing_id, seq, due_date, amount_due_minor, currency)
    values ('borrowing_due', v_borrowing.id, 0, p_due_date, p_amount_minor, v_currency);
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_borrowing;
end;
$$;

create function public.update_borrowing(p_borrowing_id uuid, p_lender text)
returns public.borrowings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_borrowing public.borrowings;
begin
  select * into v_borrowing from public.borrowings as b where b.id = p_borrowing_id for update;
  if v_borrowing.id is null then
    raise exception 'Borrowing not found' using errcode = 'FC008';
  end if;
  if v_borrowing.archived_at is not null then
    raise exception 'Borrowing is archived' using errcode = 'FC048';
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.borrowings as b set lender = p_lender where b.id = v_borrowing.id returning * into v_borrowing;
  update public.accounts as a set name = pg_catalog.left(v_borrowing.lender, 80) where a.id = v_borrowing.account_id;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_borrowing;
end;
$$;

-- Adds, moves (to today or later) or removes (null or left out) a borrowing's due date. SECURITY DEFINER
-- because removing deletes the due item (clients can't delete due items); it acts only on the
-- caller's own borrowing.
create function public.set_borrowing_due_date(p_borrowing_id uuid, p_due_date date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_borrowing public.borrowings;
begin
  select * into v_borrowing from public.borrowings as b
  where b.id = p_borrowing_id and b.user_id = v_uid
  for update;
  if v_borrowing.id is null then
    raise exception 'Borrowing not found' using errcode = 'FC008';
  end if;
  if v_borrowing.archived_at is not null then
    raise exception 'Borrowing is archived' using errcode = 'FC048';
  end if;
  if p_due_date is not null and p_due_date < public.user_local_today(v_uid) then
    raise exception 'The due date can''t be in the past' using errcode = 'FC041';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  if p_due_date is null then
    delete from public.due_items as d where d.borrowing_id = v_borrowing.id;
  elsif exists (select 1 from public.due_items as d where d.borrowing_id = v_borrowing.id) then
    update public.due_items as d set due_date = p_due_date where d.borrowing_id = v_borrowing.id;
  else
    insert into public.due_items (user_id, kind, borrowing_id, seq, due_date, amount_due_minor, currency)
    values (v_uid, 'borrowing_due', v_borrowing.id, 0, p_due_date, v_borrowing.borrowed_minor, v_borrowing.currency);
    perform public.borrowing_sync_due(v_borrowing.id);
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
end;
$$;

-- Archive (only when nothing is owed) or restore a borrowing with its account.
create function public.set_borrowing_archived(p_borrowing_id uuid, p_archived boolean)
returns public.borrowings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_borrowing public.borrowings;
  v_owed bigint;
  v_at timestamptz := case when p_archived then pg_catalog.now() end;
begin
  select * into v_borrowing from public.borrowings as b where b.id = p_borrowing_id for update;
  if v_borrowing.id is null then
    raise exception 'Borrowing not found' using errcode = 'FC008';
  end if;
  if p_archived then
    v_owed := public.liability_owed(v_borrowing.account_id);
    if v_owed <> 0 then
      raise exception 'A borrowing can be archived only at a zero balance (nothing owed, nothing overpaid)' using errcode = 'FC045', detail = v_owed::text;
    end if;
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.borrowings as b set archived_at = v_at where b.id = v_borrowing.id returning * into v_borrowing;
  update public.accounts as a set archived_at = v_at where a.id = v_borrowing.account_id;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_borrowing;
end;
$$;

-- Deletes a borrowing that was never repaid (voided repayments count: they are history), with
-- its due item, its account and the receipt entry (the receiving account's balance drops by
-- it). SECURITY DEFINER because clients can't delete accounts; caller's own borrowing only.
create function public.delete_borrowing(p_borrowing_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_borrowing public.borrowings;
begin
  select * into v_borrowing from public.borrowings as b
  where b.id = p_borrowing_id and b.user_id = (select auth.uid())
  for update;
  if v_borrowing.id is null then
    raise exception 'Borrowing not found' using errcode = 'FC008';
  end if;
  if exists (select 1 from public.liability_payments as p where p.liability_account_id = v_borrowing.account_id) then
    raise exception 'A borrowing with repayments can''t be deleted' using errcode = 'FC050';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  delete from public.borrowings as b where b.id = v_borrowing.id; -- the due item cascades
  delete from public.accounts as a where a.id = v_borrowing.account_id; -- the receipt cascades
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- pay_card, repay_borrowing (one core), void_liability_payment, edit_liability_payment
-- ---------------------------------------------------------------------------

-- Pays a card or borrowing account once per request key: principal as a transfer from
-- p_account_id, interest (borrowings only) as a "Loan interest" expense, dated p_paid_on.
-- Principal is never more than what is owed now (cards: FC047, record the missing purchase
-- first; borrowings: FC037; detail = owed). Shortfall as pay_due_item. p_replaces_id is set
-- only by edit_liability_payment.
create function public.post_liability_payment(
  p_liability_account_id uuid,
  p_idempotency_key uuid,
  p_account_id uuid,
  p_paid_on date,
  p_principal_minor bigint,
  p_interest_minor bigint default 0,
  p_allow_shortfall boolean default false,
  p_replaces_id uuid default null
)
returns public.liability_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pay public.liability_payments;
  v_old public.liability_payments;
  v_liability public.accounts;
  v_card public.credit_cards;
  v_borrowing public.borrowings;
  v_account public.accounts;
  v_owed bigint;
  v_balance bigint;
  v_principal bigint := coalesce(p_principal_minor, 0);
  v_interest bigint := coalesce(p_interest_minor, 0);
  v_note text;
begin
  select * into v_pay from public.liability_payments as p where p.user_id = v_uid and p.idempotency_key = p_idempotency_key;
  if v_pay.id is not null then
    if (v_pay.liability_account_id, v_pay.account_id, v_pay.paid_on, v_pay.principal_minor, v_pay.interest_minor, v_pay.replaces_id)
       is distinct from (p_liability_account_id, p_account_id, p_paid_on, v_principal, v_interest, p_replaces_id) then
      raise exception 'This request key was already used for a different payment' using errcode = 'FC007';
    end if;
    return v_pay;
  end if;

  select * into v_liability from public.accounts as a where a.id = p_liability_account_id;
  if v_liability.id is null then
    raise exception 'Account not found' using errcode = 'FC010';
  end if;
  -- One payment at a time per card or borrowing (owed and status checks below).
  if v_liability.kind = 'card' then
    select * into v_card from public.credit_cards as c where c.account_id = v_liability.id for update;
    if v_card.archived_at is not null then
      raise exception 'Card is archived' using errcode = 'FC048';
    end if;
    if v_interest <> 0 then
      raise exception 'A card payment is one amount' using errcode = '22023';
    end if;
    v_note := 'Card payment · ' || coalesce(v_card.nickname, v_card.issuer);
  elsif v_liability.kind = 'borrowing' then
    select * into v_borrowing from public.borrowings as b where b.account_id = v_liability.id for update;
    if v_borrowing.archived_at is not null then
      raise exception 'Borrowing is archived' using errcode = 'FC048';
    end if;
    v_note := 'Repayment · ' || v_borrowing.lender;
  else
    raise exception 'Loan payments are recorded from the loan' using errcode = 'FC032';
  end if;

  -- A simultaneous retry of this request may have saved it while we waited for the lock.
  select * into v_pay from public.liability_payments as p where p.user_id = v_uid and p.idempotency_key = p_idempotency_key;
  if v_pay.id is not null then
    if (v_pay.liability_account_id, v_pay.account_id, v_pay.paid_on, v_pay.principal_minor, v_pay.interest_minor, v_pay.replaces_id)
       is distinct from (p_liability_account_id, p_account_id, p_paid_on, v_principal, v_interest, p_replaces_id) then
      raise exception 'This request key was already used for a different payment' using errcode = 'FC007';
    end if;
    return v_pay;
  end if;
  if p_replaces_id is not null then
    select * into v_old from public.liability_payments as p where p.id = p_replaces_id;
    if v_old.id is null or v_old.liability_account_id <> v_liability.id or v_old.voided_at is distinct from pg_catalog.now() then
      raise exception 'This payment was changed elsewhere' using errcode = 'FC014';
    end if;
  end if;

  select * into v_account from public.accounts as a where a.id = p_account_id for update;
  if v_account.id is null then
    raise exception 'Account not found' using errcode = 'FC010';
  end if;
  if public.is_liability_kind(v_account.kind) then
    raise exception 'A loan, card or borrowing account can''t pay' using errcode = 'FC038';
  end if;
  if v_account.archived_at is not null then
    raise exception 'Account is archived' using errcode = 'FC001';
  end if;
  if v_account.currency <> v_liability.currency then
    raise exception 'Currency must match the account (%)', v_account.currency using errcode = 'FC002';
  end if;

  if p_paid_on is null or p_paid_on > public.user_local_today(v_uid) then
    raise exception 'Date cannot be in the future' using errcode = 'FC003';
  end if;
  if p_paid_on < v_liability.opening_balance_date then
    raise exception 'Payments before the card or borrowing was added aren''t recorded' using errcode = 'FC036';
  end if;
  if p_paid_on < v_account.opening_balance_date then
    raise exception 'The date is before the account''s opening balance' using errcode = 'FC039';
  end if;

  v_owed := greatest(public.liability_owed(v_liability.id), 0);
  if v_principal > v_owed then
    if v_liability.kind = 'card' then
      raise exception 'More than what is owed on this card: record the missing purchase first' using errcode = 'FC047', detail = v_owed::text;
    end if;
    raise exception 'The principal is more than what is owed' using errcode = 'FC037', detail = v_owed::text;
  end if;

  select v_account.opening_balance_minor + b.inflow_minor - b.outflow_minor into v_balance
  from public.account_balances as b where b.account_id = v_account.id;
  if v_balance < v_principal + v_interest and not coalesce(p_allow_shortfall, false) then
    raise exception 'Not enough money in this account' using errcode = 'FC035', detail = (v_principal + v_interest - v_balance)::text;
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);

  insert into public.liability_payments (liability_account_id, account_id, paid_on, principal_minor, interest_minor, idempotency_key, replaces_id)
  values (v_liability.id, v_account.id, p_paid_on, v_principal, v_interest, p_idempotency_key, p_replaces_id)
  returning * into v_pay;

  if v_principal > 0 then
    insert into public.transactions (type, amount_minor, currency, account_id, counter_account_id, occurred_on, note, idempotency_key, liability_payment_id)
    values ('transfer', v_principal, v_liability.currency, v_account.id, v_liability.id, p_paid_on, v_note, pg_catalog.gen_random_uuid(), v_pay.id);
  end if;
  if v_interest > 0 then
    insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, note, idempotency_key, liability_payment_id)
    values ('expense', v_interest, v_liability.currency, v_account.id, public.loan_category_id('loan_interest'), p_paid_on, v_note, pg_catalog.gen_random_uuid(), v_pay.id);
  end if;

  if v_borrowing.id is not null then
    perform public.borrowing_sync_due(v_borrowing.id);
  end if;
  if v_card.id is not null then
    perform public.card_sync_due(v_card.id);
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_pay;
end;
$$;

-- Pays any amount to a card, not tied to a statement.
create function public.pay_card(
  p_card_id uuid,
  p_idempotency_key uuid,
  p_account_id uuid,
  p_paid_on date,
  p_amount_minor bigint,
  p_allow_shortfall boolean default false
)
returns public.liability_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  select c.account_id into v_account_id from public.credit_cards as c where c.id = p_card_id;
  if v_account_id is null then
    raise exception 'Card not found' using errcode = 'FC008';
  end if;
  return public.post_liability_payment(v_account_id, p_idempotency_key, p_account_id, p_paid_on, p_amount_minor, 0, p_allow_shortfall);
end;
$$;

-- A part (or full) repayment of a borrowing, with optional interest.
create function public.repay_borrowing(
  p_borrowing_id uuid,
  p_idempotency_key uuid,
  p_account_id uuid,
  p_paid_on date,
  p_principal_minor bigint,
  p_interest_minor bigint default 0,
  p_allow_shortfall boolean default false
)
returns public.liability_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  select b.account_id into v_account_id from public.borrowings as b where b.id = p_borrowing_id;
  if v_account_id is null then
    raise exception 'Borrowing not found' using errcode = 'FC008';
  end if;
  return public.post_liability_payment(v_account_id, p_idempotency_key, p_account_id, p_paid_on, p_principal_minor, p_interest_minor, p_allow_shortfall);
end;
$$;

-- Voids a card payment or repayment and its entries. A retry with the same key returns it.
create function public.void_liability_payment(p_payment_id uuid, p_idempotency_key uuid, p_reason text default null)
returns public.liability_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pay public.liability_payments;
  v_card public.credit_cards;
  v_borrowing public.borrowings;
begin
  select * into v_pay from public.liability_payments as p where p.id = p_payment_id;
  if v_pay.id is null then
    raise exception 'Payment not found' using errcode = 'FC008';
  end if;
  select * into v_card from public.credit_cards as c where c.account_id = v_pay.liability_account_id for update;
  select * into v_borrowing from public.borrowings as b where b.account_id = v_pay.liability_account_id for update;
  select * into v_pay from public.liability_payments as p where p.id = p_payment_id for update;

  if v_pay.voided_at is not null then
    if exists (select 1 from public.liability_payments as r where r.replaces_id = v_pay.id) then
      raise exception 'This payment was changed elsewhere' using errcode = 'FC014';
    end if;
    if v_pay.void_idempotency_key = p_idempotency_key then
      return v_pay;
    end if;
    raise exception 'This payment is already voided' using errcode = 'FC005';
  end if;
  if v_card.archived_at is not null or v_borrowing.archived_at is not null then
    raise exception 'Card or borrowing is archived' using errcode = 'FC048';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.transactions as t
  set voided_at = pg_catalog.now(), void_reason = nullif(pg_catalog.btrim(p_reason), ''),
      void_idempotency_key = pg_catalog.gen_random_uuid()
  where t.liability_payment_id = v_pay.id and t.voided_at is null;
  update public.liability_payments as p
  set voided_at = pg_catalog.now(), void_reason = nullif(pg_catalog.btrim(p_reason), ''), void_idempotency_key = p_idempotency_key
  where p.id = v_pay.id
  returning * into v_pay;
  if v_borrowing.id is not null then
    perform public.borrowing_sync_due(v_borrowing.id);
  end if;
  if v_card.id is not null then
    perform public.card_sync_due(v_card.id);
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_pay;
end;
$$;

-- Edits a card payment or repayment: voids it with its entries and posts the new one, in one
-- database transaction (linked by replaces_id).
create function public.edit_liability_payment(
  p_payment_id uuid,
  p_idempotency_key uuid,
  p_account_id uuid,
  p_paid_on date,
  p_principal_minor bigint,
  p_interest_minor bigint default 0,
  p_allow_shortfall boolean default false
)
returns public.liability_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old public.liability_payments;
  v_new public.liability_payments;
begin
  select * into v_new from public.liability_payments as p
  where p.user_id = (select auth.uid()) and p.idempotency_key = p_idempotency_key;
  if v_new.id is not null then
    if (v_new.replaces_id, v_new.account_id, v_new.paid_on, v_new.principal_minor, v_new.interest_minor)
       is distinct from (p_payment_id, p_account_id, p_paid_on, coalesce(p_principal_minor, 0), coalesce(p_interest_minor, 0)) then
      raise exception 'This request key was already used for a different payment' using errcode = 'FC007';
    end if;
    return v_new;
  end if;

  select * into v_old from public.liability_payments as p where p.id = p_payment_id;
  if v_old.id is null then
    raise exception 'Payment not found' using errcode = 'FC008';
  end if;
  if v_old.voided_at is not null then
    if exists (select 1 from public.liability_payments as r where r.replaces_id = v_old.id) then
      raise exception 'This payment was changed elsewhere' using errcode = 'FC014';
    end if;
    raise exception 'This payment is already voided' using errcode = 'FC005';
  end if;
  if (v_old.account_id, v_old.paid_on, v_old.principal_minor, v_old.interest_minor)
     is not distinct from (p_account_id, p_paid_on, coalesce(p_principal_minor, 0), coalesce(p_interest_minor, 0)) then
    raise exception 'Nothing has changed' using errcode = 'FC017';
  end if;

  perform public.void_liability_payment(v_old.id, p_idempotency_key);
  select * into v_new from public.post_liability_payment(
    v_old.liability_account_id, p_idempotency_key, p_account_id, p_paid_on, p_principal_minor, p_interest_minor,
    p_allow_shortfall, v_old.id
  );
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- pay_due_item and void_due_payment (replace the 8a versions): card bills
-- ---------------------------------------------------------------------------

-- As 8a, plus card bills: the whole amount is principal (a transfer to the card account), not
-- more than what the card owes now (FC047); full, minimum or custom; one active payment per
-- bill, and a part-paid bill is closed (the rest stays owed). Borrowing due items are closed
-- by repay_borrowing, never paid here.
create or replace function public.pay_due_item(
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
  v_card public.credit_cards;
  v_statement public.card_statements;
  v_liability_id uuid;
  v_started date;
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
  if v_item.kind = 'borrowing_due' then
    raise exception 'Repay a borrowing from the borrowing' using errcode = 'FC032';
  end if;
  -- One payment at a time per loan or card (balance, capitalisation and status checks below).
  if v_item.loan_id is not null then
    select * into v_loan from public.loans as l where l.id = v_item.loan_id for update;
    if v_loan.archived_at is not null then
      raise exception 'Loan is archived' using errcode = 'FC033';
    end if;
    v_liability_id := v_loan.account_id;
    v_started := v_loan.tracking_started_on;
  else
    select * into v_statement from public.card_statements as s where s.id = v_item.card_statement_id;
    select * into v_card from public.credit_cards as c where c.id = v_statement.card_id for update;
    if v_card.archived_at is not null then
      raise exception 'Card is archived' using errcode = 'FC048';
    end if;
    if coalesce(p_interest_minor, 0) <> 0 or coalesce(p_fees_minor, 0) <> 0 then
      raise exception 'A card bill is paid as one amount' using errcode = '22023';
    end if;
    v_liability_id := v_card.account_id;
    v_started := v_card.tracking_started_on;
  end if;
  select * into v_item from public.due_items as d where d.id = p_due_item_id for update;
  -- A simultaneous retry of this request may have saved it while we waited for the lock.
  select * into v_pay from public.due_payments as p where p.user_id = v_uid and p.idempotency_key = p_idempotency_key;
  if v_pay.id is not null then
    if (v_pay.due_item_id, v_pay.account_id, v_pay.paid_on, v_pay.principal_minor, v_pay.interest_minor, v_pay.fees_minor, v_pay.replaces_id)
       is distinct from (p_due_item_id, p_account_id, p_paid_on, p_principal_minor, p_interest_minor, p_fees_minor, p_replaces_id) then
      raise exception 'This request key was already used for a different payment' using errcode = 'FC007';
    end if;
    return v_pay;
  end if;
  -- An edit of a card bill payment may find the bill already covered by other payments
  -- (card_sync_due after the void); the one-active-payment index still applies.
  if v_item.status <> 'pending' and not (p_replaces_id is not null and v_item.kind = 'card_bill') then
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
  if public.is_liability_kind(v_account.kind) then
    raise exception 'A loan, card or borrowing account can''t pay' using errcode = 'FC038';
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
  if p_paid_on < v_started then
    raise exception 'Payments before the loan or card was added aren''t recorded' using errcode = 'FC036';
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

  v_owed := greatest(public.liability_owed(v_liability_id) + v_cap, 0);
  if coalesce(p_principal_minor, 0) > v_owed then
    if v_card.id is not null then
      raise exception 'More than what is owed on this card: record the missing purchase first' using errcode = 'FC047', detail = v_owed::text;
    end if;
    raise exception 'The principal is more than what is owed' using errcode = 'FC037', detail = v_owed::text;
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

  v_note := case v_item.kind
              when 'loan_emi' then 'EMI ' || v_item.seq || ' · ' || coalesce(v_loan.nickname, v_loan.lender)
              when 'loan_interest' then 'Moratorium interest ' || v_item.seq || ' · ' || coalesce(v_loan.nickname, v_loan.lender)
              else 'Card bill ' || pg_catalog.to_char(v_statement.statement_date, 'DD Mon YYYY') || ' · ' || coalesce(v_card.nickname, v_card.issuer)
            end;

  if v_pay.principal_minor > 0 then
    insert into public.transactions (type, amount_minor, currency, account_id, counter_account_id, occurred_on, note, idempotency_key, due_payment_id)
    values ('transfer', v_pay.principal_minor, v_item.currency, v_account.id, v_liability_id, p_paid_on, v_note, pg_catalog.gen_random_uuid(), v_pay.id);
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
  if v_card.id is not null then
    perform public.card_sync_due(v_card.id);
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_pay;
end;
$$;

-- As 8a, for loans and card bills: voids a payment and its entries; the item is pending again.
create or replace function public.void_due_payment(p_payment_id uuid, p_idempotency_key uuid, p_reason text default null)
returns public.due_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pay public.due_payments;
  v_item public.due_items;
  v_loan public.loans;
  v_card public.credit_cards;
begin
  select * into v_pay from public.due_payments as p where p.id = p_payment_id;
  if v_pay.id is null then
    raise exception 'Payment not found' using errcode = 'FC008';
  end if;
  select * into v_item from public.due_items as d where d.id = v_pay.due_item_id;
  if v_item.loan_id is not null then
    select * into v_loan from public.loans as l where l.id = v_item.loan_id for update;
  else
    select c.* into v_card from public.credit_cards as c
    join public.card_statements as s on s.card_id = c.id
    where s.id = v_item.card_statement_id
    for update of c;
  end if;
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
  if v_card.archived_at is not null then
    raise exception 'Card is archived' using errcode = 'FC048';
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
  if v_card.id is not null then
    perform public.card_sync_due(v_card.id);
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_pay;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row level security
-- ---------------------------------------------------------------------------

revoke execute on function public.credit_cards_validate() from public, anon, authenticated;
revoke execute on function public.card_statements_guard() from public, anon, authenticated;
revoke execute on function public.borrowings_validate() from public, anon, authenticated;
revoke execute on function public.liability_payments_guard() from public, anon, authenticated;

revoke execute on function public.liability_owed(uuid, date) from public, anon;
revoke execute on function public.card_cycle_date(integer, date) from public, anon;
revoke execute on function public.card_due_date(date, integer, integer) from public, anon;
revoke execute on function public.create_card(uuid, text, bigint, integer, integer, bigint, text) from public, anon;
revoke execute on function public.update_card(uuid, text, bigint, integer, integer, text) from public, anon;
revoke execute on function public.set_card_archived(uuid, boolean) from public, anon;
revoke execute on function public.delete_card(uuid) from public, anon;
revoke execute on function public.link_card_emi(uuid, uuid) from public, anon;
revoke execute on function public.enter_card_statement(uuid, uuid, date, bigint, bigint, date, bigint, uuid) from public, anon;
revoke execute on function public.delete_card_statement(uuid) from public, anon;
revoke execute on function public.borrowing_sync_due(uuid) from public, anon;
revoke execute on function public.card_bill_paid(uuid) from public, anon;
revoke execute on function public.card_sync_due(uuid) from public, anon;
revoke execute on function public.create_borrowing(uuid, text, bigint, uuid, date, date) from public, anon;
revoke execute on function public.update_borrowing(uuid, text) from public, anon;
revoke execute on function public.set_borrowing_due_date(uuid, date) from public, anon;
revoke execute on function public.set_borrowing_archived(uuid, boolean) from public, anon;
revoke execute on function public.delete_borrowing(uuid) from public, anon;
revoke execute on function public.post_liability_payment(uuid, uuid, uuid, date, bigint, bigint, boolean, uuid) from public, anon;
revoke execute on function public.pay_card(uuid, uuid, uuid, date, bigint, boolean) from public, anon;
revoke execute on function public.repay_borrowing(uuid, uuid, uuid, date, bigint, bigint, boolean) from public, anon;
revoke execute on function public.void_liability_payment(uuid, uuid, text) from public, anon;
revoke execute on function public.edit_liability_payment(uuid, uuid, uuid, date, bigint, bigint, boolean) from public, anon;

-- is_liability_kind keeps the default EXECUTE for everyone: the accounts CHECK constraints call
-- it for any role that writes accounts, and it reveals nothing.
-- Helpers called from the triggers and invoker functions, so the caller needs EXECUTE.
-- borrowing_sync_due and card_sync_due change a status only under the write mark
-- (due_items_guard), and post_liability_payment refuses loan accounts.
grant execute on function public.liability_owed(uuid, date) to authenticated;
grant execute on function public.card_cycle_date(integer, date) to authenticated;
grant execute on function public.card_due_date(date, integer, integer) to authenticated;
grant execute on function public.borrowing_sync_due(uuid) to authenticated;
grant execute on function public.card_bill_paid(uuid) to authenticated;
grant execute on function public.card_sync_due(uuid) to authenticated;
grant execute on function public.post_liability_payment(uuid, uuid, uuid, date, bigint, bigint, boolean, uuid) to authenticated;
grant execute on function public.create_card(uuid, text, bigint, integer, integer, bigint, text) to authenticated;
grant execute on function public.update_card(uuid, text, bigint, integer, integer, text) to authenticated;
grant execute on function public.set_card_archived(uuid, boolean) to authenticated;
grant execute on function public.delete_card(uuid) to authenticated;
grant execute on function public.link_card_emi(uuid, uuid) to authenticated;
grant execute on function public.enter_card_statement(uuid, uuid, date, bigint, bigint, date, bigint, uuid) to authenticated;
grant execute on function public.delete_card_statement(uuid) to authenticated;
grant execute on function public.create_borrowing(uuid, text, bigint, uuid, date, date) to authenticated;
grant execute on function public.update_borrowing(uuid, text) to authenticated;
grant execute on function public.set_borrowing_due_date(uuid, date) to authenticated;
grant execute on function public.set_borrowing_archived(uuid, boolean) to authenticated;
grant execute on function public.delete_borrowing(uuid) to authenticated;
grant execute on function public.pay_card(uuid, uuid, uuid, date, bigint, boolean) to authenticated;
grant execute on function public.repay_borrowing(uuid, uuid, uuid, date, bigint, bigint, boolean) to authenticated;
grant execute on function public.void_liability_payment(uuid, uuid, text) to authenticated;
grant execute on function public.edit_liability_payment(uuid, uuid, uuid, date, bigint, bigint, boolean) to authenticated;

revoke all on table public.credit_cards, public.card_statements, public.borrowings, public.liability_payments,
  public.card_bill_progress
  from anon, authenticated;
grant select on table public.card_bill_progress to authenticated;

-- The invoker functions write with the caller's grants; the guards refuse the same writes
-- made directly.
grant select on table public.credit_cards to authenticated;
grant insert (account_id, issuer, nickname, currency, limit_minor, statement_day, due_day, opening_owed_minor,
              tracking_started_on, idempotency_key)
  on table public.credit_cards to authenticated;
grant update (issuer, nickname, limit_minor, statement_day, due_day, archived_at) on table public.credit_cards to authenticated;

grant select on table public.card_statements to authenticated;
grant insert (card_id, statement_date, due_date, total_minor, minimum_minor, emi_included_minor,
              owed_at_statement_minor, difference_minor, difference_transaction_id, idempotency_key)
  on table public.card_statements to authenticated;

grant select on table public.borrowings to authenticated;
grant insert (account_id, lender, currency, borrowed_minor, received_on, receipt_transaction_id, idempotency_key)
  on table public.borrowings to authenticated;
grant update (lender, archived_at) on table public.borrowings to authenticated;

grant select on table public.liability_payments to authenticated;
grant insert (liability_account_id, account_id, paid_on, principal_minor, interest_minor, idempotency_key, replaces_id)
  on table public.liability_payments to authenticated;
grant update (voided_at, void_reason, void_idempotency_key) on table public.liability_payments to authenticated;

grant update (card_id) on table public.loans to authenticated;
grant insert (card_statement_id, borrowing_id, minimum_due_minor) on table public.due_items to authenticated;
grant insert (liability_payment_id) on table public.transactions to authenticated;

alter table public.credit_cards enable row level security;
alter table public.card_statements enable row level security;
alter table public.borrowings enable row level security;
alter table public.liability_payments enable row level security;

create policy credit_cards_select_own on public.credit_cards
  for select to authenticated using ((select auth.uid()) = user_id);
create policy credit_cards_insert_own on public.credit_cards
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy credit_cards_update_own on public.credit_cards
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy card_statements_select_own on public.card_statements
  for select to authenticated using ((select auth.uid()) = user_id);
create policy card_statements_insert_own on public.card_statements
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy borrowings_select_own on public.borrowings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy borrowings_insert_own on public.borrowings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy borrowings_update_own on public.borrowings
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy liability_payments_select_own on public.liability_payments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy liability_payments_insert_own on public.liability_payments
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy liability_payments_update_own on public.liability_payments
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
