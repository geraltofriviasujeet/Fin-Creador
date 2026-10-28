-- Sprint 8d: statutory and legal dues (income tax payable, traffic e-challans and other fines,
-- other statutory dues such as property tax).
--
-- Model (docs/sprint-plan.md, Sprint 8d):
--   * A due (statutory_dues) has a type, an amount, a due date (required, past allowed), an
--     optional description and, for a fine, optional vehicle kind and the state and city it was
--     issued in (names from the shared lists; never a challan, vehicle or RTO number). It is one
--     due item of kind statutory_due (seq 0). There is no liability account: nothing is posted
--     until it is paid, and Total available is unchanged until then. Net worth (8e) subtracts
--     what is still due.
--   * Paying (pay_due_item) posts an EXPENSE from the chosen account: income tax and other
--     statutory dues in "Taxes", fines in "Fines & penalties" (system categories, adopted by
--     name, never null). A tax due may carry interest or a penalty (interest_minor), posted as
--     a second expense in "Fines & penalties" and not counted towards the amount due.
--   * Part payments: a due takes several active payments (due_payments.allows_parts, set only
--     by the guard from the item's kind, so loans and card bills keep one active payment). It is
--     paid once active payments cover the amount, pending otherwise (statutory_sync_due, also
--     after a void, an edit or an amount change). Paying more than is still due is FC052.
--   * The due item may name the account it will be paid from (pay_from_account_id, set from the
--     due's optional "pay from"); nothing is deducted until the person confirms Paid. "Will pay
--     later", reminders, the shortfall warning with "Pay anyway", request keys, edit and void
--     work as for loans and cards.
--   * Edit: amount (never below what is paid: FC054), due date, description, fine details and
--     the paying account. Archive only once fully paid (FC045, detail = what is still due);
--     restore; delete only without payment history (voided ones count: FC050).
--
-- Writes are marked with fin_creador.loan_write (8a's transaction-local setting).
--
-- New error codes (mapped in packages/api):
--   FC052 more than is still due   FC053 statutory due archived   FC054 amount below what is paid
-- Reused: FC001, FC002, FC003, FC005, FC007, FC008, FC009, FC010, FC014, FC017, FC032, FC034,
-- FC035, FC038, FC039, FC041, FC045, FC050, 22023.

-- ---------------------------------------------------------------------------
-- Categories: Taxes and Fines & penalties
-- ---------------------------------------------------------------------------

alter table public.categories drop constraint categories_system_key;
alter table public.categories add constraint categories_system_key check (
  system_key is null or (kind = 'expense' and system_key in ('loan_interest', 'loan_fees', 'taxes', 'fines_penalties'))
);

-- Replaces the 8a version: two more keys; the rest is unchanged.
create or replace function public.loan_category_id(p_key text)
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
  v_name := case p_key
              when 'loan_interest' then 'Loan interest'
              when 'loan_fees' then 'Loan fees & charges'
              when 'taxes' then 'Taxes'
              when 'fines_penalties' then 'Fines & penalties'
            end;
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
-- Statutory dues
-- ---------------------------------------------------------------------------

create table public.statutory_dues (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  due_type            text not null,
  -- Optional words ("Advance tax, March", "Property tax"); no run of 4 or more digits.
  description         text,
  -- Fines only, all optional: no challan, vehicle or RTO numbers.
  vehicle_kind        text,
  issued_state        text,
  issued_city         text,
  currency            text not null,
  amount_minor        bigint not null,
  due_date            date not null,
  -- The account it will be paid from (copied to its due item); set null if that account is deleted.
  pay_from_account_id uuid,
  archived_at         timestamptz,
  idempotency_key     uuid not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint statutory_dues_id_user_unique unique (id, user_id),
  constraint statutory_dues_idempotency_unique unique (user_id, idempotency_key),
  constraint statutory_dues_type check (due_type in ('income_tax', 'fine', 'other_statutory')),
  constraint statutory_dues_description check (
    description is null or (char_length(btrim(description)) between 1 and 120 and not public.has_digit(description, 4))
  ),
  constraint statutory_dues_other_named check (due_type <> 'other_statutory' or description is not null),
  constraint statutory_dues_fine_details check (
    due_type = 'fine' or (vehicle_kind is null and issued_state is null and issued_city is null)
  ),
  constraint statutory_dues_vehicle_kind check (vehicle_kind is null or vehicle_kind in ('two_wheeler', 'four_wheeler', 'other')),
  constraint statutory_dues_issued_state check (
    issued_state is null or (char_length(btrim(issued_state)) between 1 and 80 and not public.has_digit(issued_state))
  ),
  constraint statutory_dues_issued_city check (
    issued_city is null or (char_length(btrim(issued_city)) between 1 and 80 and not public.has_digit(issued_city))
  ),
  constraint statutory_dues_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint statutory_dues_amount_range check (amount_minor > 0 and amount_minor <= 10000000000000),
  constraint statutory_dues_due_range check (due_date >= date '1970-01-01'),
  constraint statutory_dues_pay_from_owned
    foreign key (pay_from_account_id, user_id) references public.accounts (id, user_id)
    on delete set null (pay_from_account_id)
);

create index statutory_dues_user_idx on public.statutory_dues (user_id) where archived_at is null;
create index statutory_dues_pay_from_idx on public.statutory_dues (pay_from_account_id) where pay_from_account_id is not null;

comment on table public.statutory_dues is
  'Income tax payable, fines and other statutory dues. Not a liability account: one statutory_due due item; paying posts expenses. Net worth subtracts what is still due.';

-- Writes only through the functions below. The paying account may be cleared without the
-- write mark only by ON DELETE SET NULL (nothing else changes).
create function public.statutory_dues_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row public.statutory_dues;
begin
  if pg_catalog.current_setting('fin_creador.loan_write', true) is distinct from 'on' then
    if tg_op = 'UPDATE' and old.pay_from_account_id is not null and new.pay_from_account_id is null then
      v_row := new;
      v_row.pay_from_account_id := old.pay_from_account_id;
      v_row.updated_at := old.updated_at;
      if v_row is not distinct from old then
        return new;
      end if;
    end if;
    raise exception 'Statutory dues change only through their functions' using errcode = 'FC032';
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.user_id, new.due_type, new.currency, new.idempotency_key, new.created_at)
       is distinct from (old.id, old.user_id, old.due_type, old.currency, old.idempotency_key, old.created_at) then
      raise exception 'A due''s identity can''t change' using errcode = 'FC009';
    end if;
    if old.archived_at is not null and new.archived_at is not null
       and (new.description, new.vehicle_kind, new.issued_state, new.issued_city, new.amount_minor, new.due_date, new.pay_from_account_id)
           is distinct from
           (old.description, old.vehicle_kind, old.issued_state, old.issued_city, old.amount_minor, old.due_date, old.pay_from_account_id)
    then
      raise exception 'This due is archived' using errcode = 'FC053';
    end if;
    if old.archived_at is null and new.archived_at is not null then
      new.archived_at := pg_catalog.now();
    elsif old.archived_at is not null and new.archived_at is not null then
      new.archived_at := old.archived_at;
    end if;
  else
    if new.currency is distinct from (select p.currency from public.profiles as p where p.id = new.user_id) then
      raise exception 'A due uses your profile currency' using errcode = 'FC002';
    end if;
    new.archived_at := null;
    new.created_at := pg_catalog.now();
  end if;
  new.description := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(new.description, ''), '\s+', ' ', 'g')), '');
  new.issued_state := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(new.issued_state, ''), '\s+', ' ', 'g')), '');
  new.issued_city := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(new.issued_city, ''), '\s+', ' ', 'g')), '');
  return new;
end;
$$;

create trigger statutory_dues_validate
  before insert or update on public.statutory_dues
  for each row execute function public.statutory_dues_validate();

create trigger statutory_dues_set_updated_at
  before update on public.statutory_dues
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Due items and payments
-- ---------------------------------------------------------------------------

alter table public.due_items add column statutory_due_id uuid;
alter table public.due_items add constraint due_items_statutory_owned
  foreign key (statutory_due_id, user_id) references public.statutory_dues (id, user_id) on delete cascade;
alter table public.due_items add constraint due_items_statutory_seq_unique unique (statutory_due_id, seq);

alter table public.due_items drop constraint due_items_kind;
alter table public.due_items add constraint due_items_kind check (
  kind in ('loan_emi', 'loan_interest', 'card_bill', 'borrowing_due', 'statutory_due')
);
alter table public.due_items drop constraint due_items_source;
alter table public.due_items add constraint due_items_source check (
  (kind in ('loan_emi', 'loan_interest')) = (loan_id is not null)
  and (kind = 'card_bill') = (card_statement_id is not null)
  and (kind = 'borrowing_due') = (borrowing_id is not null)
  and (kind = 'statutory_due') = (statutory_due_id is not null)
  and (kind in ('loan_emi', 'loan_interest', 'borrowing_due') or seq = 0)
  and (kind <> 'borrowing_due' or seq between 0 and 60)
);
alter table public.due_items drop constraint due_items_pay_from_kind;
alter table public.due_items add constraint due_items_pay_from_kind
  check (pay_from_account_id is null or kind in ('borrowing_due', 'statutory_due'));

comment on table public.due_items is
  'Anything due on a date and paid from an account: loan EMIs and moratorium interest (8a), card bills and borrowing return dates or instalments (8b), statutory dues (8d). Reminders are derived from these dates in packages/domain/src/due-items.ts.';

-- Several active payments per item for statutory dues only; set by due_payments_guard from the
-- item's kind, never by the caller.
alter table public.due_payments add column allows_parts boolean not null default false;
drop index public.due_payments_one_active_idx;
create unique index due_payments_one_active_idx on public.due_payments (due_item_id) where voided_at is null and not allows_parts;
create index due_payments_item_active_idx on public.due_payments (due_item_id) where voided_at is null;

-- Replaces the 8a guard: allows_parts comes from the item's kind and never changes.
create or replace function public.due_payments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('fin_creador.loan_write', true) is distinct from 'on' then
    raise exception 'Payments change only through their loan, card or due' using errcode = 'FC032';
  end if;
  if tg_op = 'UPDATE' then
    if old.voided_at is not null then
      raise exception 'A voided payment can''t change' using errcode = 'FC005';
    end if;
    if (new.id, new.user_id, new.due_item_id, new.account_id, new.paid_on, new.principal_minor,
        new.interest_minor, new.fees_minor, new.capitalised_minor, new.idempotency_key,
        new.replaces_id, new.created_at, new.allows_parts)
       is distinct from
       (old.id, old.user_id, old.due_item_id, old.account_id, old.paid_on, old.principal_minor,
        old.interest_minor, old.fees_minor, old.capitalised_minor, old.idempotency_key,
        old.replaces_id, old.created_at, old.allows_parts)
    then
      raise exception 'Payments can''t be edited in place' using errcode = 'FC009';
    end if;
    if new.voided_at is not null then
      new.voided_at := pg_catalog.now();
    end if;
  else
    new.allows_parts := coalesce((select d.kind = 'statutory_due' from public.due_items as d where d.id = new.due_item_id), false);
    new.voided_at := null;
    new.void_reason := null;
    new.void_idempotency_key := null;
    new.created_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

-- Replaces the 8b follow-up guard: statutory sources, an archived due refuses "Will pay later",
-- a statutory due's date may move under the write mark.
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
      raise exception 'Due items change only through their loan, card, borrowing or due' using errcode = 'FC032';
    end if;
    return new;
  end if;

  -- The planned account was deleted (ON DELETE SET NULL): the plan goes with it.
  if new.planned_account_id is null and old.planned_account_id is not null then
    new.planned_on := null;
  end if;

  if (new.id, new.user_id, new.kind, new.loan_id, new.card_statement_id, new.borrowing_id, new.statutory_due_id,
      new.seq, new.currency, new.created_at)
     is distinct from
     (old.id, old.user_id, old.kind, old.loan_id, old.card_statement_id, old.borrowing_id, old.statutory_due_id,
      old.seq, old.currency, old.created_at)
     or (new.due_date is distinct from old.due_date and not (v_marked and old.kind in ('borrowing_due', 'statutory_due')))
  then
    raise exception 'A due item''s identity can''t change' using errcode = 'FC009';
  end if;
  if (new.amount_due_minor, new.minimum_due_minor, new.status, new.interest_minor)
     is distinct from (old.amount_due_minor, old.minimum_due_minor, old.status, old.interest_minor)
     and not v_marked then
    raise exception 'Due items change only through their loan, card, borrowing or due' using errcode = 'FC032';
  end if;
  if new.pay_from_account_id is distinct from old.pay_from_account_id
     and new.pay_from_account_id is not null and not v_marked then
    raise exception 'Due items change only through their loan, card, borrowing or due' using errcode = 'FC032';
  end if;

  -- "Will pay later" (a direct update of planned_on / planned_account_id).
  if (new.planned_on, new.planned_account_id) is distinct from (old.planned_on, old.planned_account_id)
     and new.planned_on is not null then
    -- An archived due is always paid, so this comes before the pending check.
    if exists (select 1 from public.statutory_dues as s where s.id = new.statutory_due_id and s.archived_at is not null) then
      raise exception 'This due is archived' using errcode = 'FC053';
    end if;
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

-- What active payments have paid towards a statutory due item (interest excluded).
create function public.statutory_paid(p_due_item_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(p.principal_minor), 0)::bigint
  from public.due_payments as p
  where p.due_item_id = p_due_item_id and p.voided_at is null;
$$;

-- Paid once active payments cover the amount, pending otherwise; a paid item loses its plan.
-- Changes a status only under the write mark (due_items_guard).
create function public.statutory_sync_due(p_statutory_due_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.due_items as d
  set status = x.status,
      planned_on = case when x.status = 'paid' then null else d.planned_on end,
      planned_account_id = case when x.status = 'paid' then null else d.planned_account_id end
  from (
    select d2.id, case when public.statutory_paid(d2.id) >= d2.amount_due_minor then 'paid' else 'pending' end as status
    from public.due_items as d2
    where d2.statutory_due_id = p_statutory_due_id
  ) as x
  where d.id = x.id and d.status <> x.status;
end;
$$;

create view public.statutory_due_progress
with (security_invoker = true)
as
select d.id as due_item_id, d.user_id, d.statutory_due_id, public.statutory_paid(d.id) as paid_minor,
       greatest(d.amount_due_minor - public.statutory_paid(d.id), 0) as left_minor
from public.due_items as d
where d.kind = 'statutory_due';

-- ---------------------------------------------------------------------------
-- Pay, void (replace the 8b versions); edit_due_payment is unchanged (void, then pay)
-- ---------------------------------------------------------------------------

-- As 8b, plus statutory dues: the amount is an expense from the chosen account in "Taxes"
-- (income tax, other statutory) or "Fines & penalties" (fines), at most what is still due
-- (FC052); interest or a penalty on a tax due is a second expense in "Fines & penalties". A due
-- takes several payments and is paid once they cover it. Borrowing due items are closed by
-- repay_borrowing, never paid here.
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
  v_due public.statutory_dues;
  v_liability_id uuid;
  v_started date;
  v_account public.accounts;
  v_cap bigint := 0;
  v_owed bigint;
  v_left bigint;
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
  -- One payment at a time per loan, card or due (balance, capitalisation and status checks below).
  if v_item.loan_id is not null then
    select * into v_loan from public.loans as l where l.id = v_item.loan_id for update;
    if v_loan.archived_at is not null then
      raise exception 'Loan is archived' using errcode = 'FC033';
    end if;
    v_liability_id := v_loan.account_id;
    v_started := v_loan.tracking_started_on;
  elsif v_item.statutory_due_id is not null then
    select * into v_due from public.statutory_dues as s where s.id = v_item.statutory_due_id for update;
    if v_due.archived_at is not null then
      raise exception 'This due is archived' using errcode = 'FC053';
    end if;
    if coalesce(p_fees_minor, 0) <> 0 then
      raise exception 'A due is paid as an amount and, for a tax, interest or a penalty' using errcode = '22023';
    end if;
    if coalesce(p_interest_minor, 0) <> 0 and v_due.due_type = 'fine' then
      raise exception 'A fine is paid as one amount' using errcode = '22023';
    end if;
    -- Payments made before the due was added may be recorded (they are plain expenses).
    v_started := date '1970-01-01';
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
  -- An edit of a card bill or statutory payment may find the item already covered by other
  -- payments (synced after the void); the one-active-payment index and FC052 still apply.
  if v_item.status <> 'pending' and not (p_replaces_id is not null and v_item.kind in ('card_bill', 'statutory_due')) then
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

  if v_due.id is not null then
    v_left := greatest(v_item.amount_due_minor - public.statutory_paid(v_item.id), 0);
    if coalesce(p_principal_minor, 0) > v_left then
      raise exception 'More than is still due' using errcode = 'FC052', detail = v_left::text;
    end if;
  else
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

  if v_due.id is not null then
    v_note := case v_due.due_type when 'income_tax' then 'Income tax' when 'fine' then 'Fine' else 'Statutory due' end
              || coalesce(' · ' || v_due.description, '');
    if v_pay.principal_minor > 0 then
      insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, note, idempotency_key, due_payment_id)
      values ('expense', v_pay.principal_minor, v_item.currency, v_account.id,
              public.loan_category_id(case when v_due.due_type = 'fine' then 'fines_penalties' else 'taxes' end),
              p_paid_on, v_note, pg_catalog.gen_random_uuid(), v_pay.id);
    end if;
    if v_pay.interest_minor > 0 then
      insert into public.transactions (type, amount_minor, currency, account_id, category_id, occurred_on, note, idempotency_key, due_payment_id)
      values ('expense', v_pay.interest_minor, v_item.currency, v_account.id, public.loan_category_id('fines_penalties'),
              p_paid_on, v_note || ' · interest or penalty', pg_catalog.gen_random_uuid(), v_pay.id);
    end if;
    perform public.statutory_sync_due(v_due.id);
    perform pg_catalog.set_config('fin_creador.loan_write', '', true);
    return v_pay;
  end if;

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

-- As 8b, plus statutory dues: voids a payment and its entries; a statutory due is pending
-- again unless its other payments still cover it.
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
  v_due public.statutory_dues;
begin
  select * into v_pay from public.due_payments as p where p.id = p_payment_id;
  if v_pay.id is null then
    raise exception 'Payment not found' using errcode = 'FC008';
  end if;
  select * into v_item from public.due_items as d where d.id = v_pay.due_item_id;
  if v_item.loan_id is not null then
    select * into v_loan from public.loans as l where l.id = v_item.loan_id for update;
  elsif v_item.statutory_due_id is not null then
    select * into v_due from public.statutory_dues as s where s.id = v_item.statutory_due_id for update;
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
  if v_due.archived_at is not null then
    raise exception 'This due is archived' using errcode = 'FC053';
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
  if v_due.id is not null then
    perform public.statutory_sync_due(v_due.id);
  else
    update public.due_items as d set status = 'pending' where d.id = v_pay.due_item_id;
  end if;
  if v_card.id is not null then
    perform public.card_sync_due(v_card.id);
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_pay;
end;
$$;

-- ---------------------------------------------------------------------------
-- Statutory dues: create, update, archive, delete
-- ---------------------------------------------------------------------------

-- The account a due will be paid from: the caller's own bank, cash or other account in the
-- profile currency, not archived. Looked up by owner (update_statutory_due runs as the definer).
create function public.statutory_check_pay_from(p_user_id uuid, p_currency text, p_account_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_account public.accounts;
begin
  if p_account_id is null then
    return;
  end if;
  select * into v_account from public.accounts as a where a.id = p_account_id and a.user_id = p_user_id;
  if v_account.id is null then
    raise exception 'Account not found' using errcode = 'FC010';
  end if;
  if public.is_liability_kind(v_account.kind) then
    raise exception 'Choose a bank, cash or other account' using errcode = 'FC038';
  end if;
  if v_account.archived_at is not null then
    raise exception 'Account is archived' using errcode = 'FC001';
  end if;
  if v_account.currency <> p_currency then
    raise exception 'Currency must match the account (%)', v_account.currency using errcode = 'FC002';
  end if;
end;
$$;

-- Adds a due once per request key, with its due item. Nothing is posted.
create function public.create_statutory_due(
  p_idempotency_key uuid,
  p_due_type text,
  p_amount_minor bigint,
  p_due_date date,
  p_description text default null,
  p_vehicle_kind text default null,
  p_issued_state text default null,
  p_issued_city text default null,
  p_pay_from_account_id uuid default null
)
returns public.statutory_dues
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_description text := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_description, ''), '\s+', ' ', 'g')), '');
  v_currency text;
  v_due public.statutory_dues;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text || p_idempotency_key::text, 0));

  select * into v_due from public.statutory_dues as s where s.user_id = v_uid and s.idempotency_key = p_idempotency_key;
  if v_due.id is not null then
    if (v_due.due_type, v_due.amount_minor, v_due.due_date, v_due.description, v_due.vehicle_kind,
        v_due.issued_state, v_due.issued_city, v_due.pay_from_account_id)
       is distinct from
       (p_due_type, p_amount_minor, p_due_date, v_description, p_vehicle_kind,
        nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_issued_state, ''), '\s+', ' ', 'g')), ''),
        nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_issued_city, ''), '\s+', ' ', 'g')), ''),
        p_pay_from_account_id) then
      raise exception 'This request key was already used for a different due' using errcode = 'FC007';
    end if;
    return v_due;
  end if;

  if p_due_date is null then
    raise exception 'Enter the due date' using errcode = '22023';
  end if;
  select p.currency into v_currency from public.profiles as p where p.id = v_uid;
  if v_currency is null then
    raise exception 'Profile not found' using errcode = 'FC010';
  end if;
  perform public.statutory_check_pay_from(v_uid, v_currency, p_pay_from_account_id);

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  insert into public.statutory_dues (
    due_type, description, vehicle_kind, issued_state, issued_city, currency, amount_minor, due_date,
    pay_from_account_id, idempotency_key
  ) values (
    p_due_type, v_description, p_vehicle_kind, p_issued_state, p_issued_city, v_currency, p_amount_minor, p_due_date,
    p_pay_from_account_id, p_idempotency_key
  )
  returning * into v_due;
  insert into public.due_items (kind, statutory_due_id, seq, due_date, amount_due_minor, currency, pay_from_account_id)
  values ('statutory_due', v_due.id, 0, v_due.due_date, v_due.amount_minor, v_due.currency, v_due.pay_from_account_id);
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_due;
end;
$$;

-- Changes the amount (never below what is paid: FC054), due date, description, fine details
-- and paying account; the item's status follows. SECURITY DEFINER because it moves the due
-- item's date and paying account (not client-writable); acts only on the caller's own due.
create function public.update_statutory_due(
  p_statutory_due_id uuid,
  p_amount_minor bigint,
  p_due_date date,
  p_description text default null,
  p_vehicle_kind text default null,
  p_issued_state text default null,
  p_issued_city text default null,
  p_pay_from_account_id uuid default null
)
returns public.statutory_dues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_due public.statutory_dues;
  v_item public.due_items;
  v_paid bigint;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into v_due from public.statutory_dues as s
  where s.id = p_statutory_due_id and s.user_id = v_uid
  for update;
  if v_due.id is null then
    raise exception 'Due not found' using errcode = 'FC008';
  end if;
  if v_due.archived_at is not null then
    raise exception 'This due is archived' using errcode = 'FC053';
  end if;
  if p_due_date is null then
    raise exception 'Enter the due date' using errcode = '22023';
  end if;
  select * into v_item from public.due_items as d where d.statutory_due_id = v_due.id for update;
  v_paid := public.statutory_paid(v_item.id);
  if p_amount_minor < v_paid then
    raise exception 'The amount can''t be less than what is already paid' using errcode = 'FC054', detail = v_paid::text;
  end if;
  -- An unchanged paying account may stay even if archived since; a new one must be usable.
  if p_pay_from_account_id is distinct from v_due.pay_from_account_id then
    perform public.statutory_check_pay_from(v_uid, v_due.currency, p_pay_from_account_id);
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.statutory_dues as s
  set amount_minor = p_amount_minor, due_date = p_due_date, description = p_description,
      vehicle_kind = p_vehicle_kind, issued_state = p_issued_state, issued_city = p_issued_city,
      pay_from_account_id = p_pay_from_account_id
  where s.id = v_due.id
  returning * into v_due;
  update public.due_items as d
  set amount_due_minor = v_due.amount_minor, due_date = v_due.due_date, pay_from_account_id = v_due.pay_from_account_id
  where d.id = v_item.id;
  perform public.statutory_sync_due(v_due.id);
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_due;
end;
$$;

-- Archive (only once fully paid: FC045, detail = what is still due) or restore.
create function public.set_statutory_due_archived(p_statutory_due_id uuid, p_archived boolean)
returns public.statutory_dues
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_due public.statutory_dues;
  v_item public.due_items;
  v_at timestamptz := case when p_archived then pg_catalog.now() end;
begin
  select * into v_due from public.statutory_dues as s where s.id = p_statutory_due_id for update;
  if v_due.id is null then
    raise exception 'Due not found' using errcode = 'FC008';
  end if;
  if p_archived then
    select * into v_item from public.due_items as d where d.statutory_due_id = v_due.id;
    if v_item.status <> 'paid' then
      raise exception 'A due can be archived only once it is fully paid' using errcode = 'FC045',
        detail = greatest(v_item.amount_due_minor - public.statutory_paid(v_item.id), 0)::text;
    end if;
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.statutory_dues as s set archived_at = v_at where s.id = v_due.id returning * into v_due;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_due;
end;
$$;

-- Deletes a due that was never paid (voided payments count: they are history), with its due
-- item. SECURITY DEFINER because clients can't delete due items; caller's own due only.
create function public.delete_statutory_due(p_statutory_due_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due public.statutory_dues;
begin
  select * into v_due from public.statutory_dues as s
  where s.id = p_statutory_due_id and s.user_id = (select auth.uid())
  for update;
  if v_due.id is null then
    raise exception 'Due not found' using errcode = 'FC008';
  end if;
  if exists (
    select 1 from public.due_payments as p join public.due_items as d on d.id = p.due_item_id
    where d.statutory_due_id = v_due.id
  ) then
    raise exception 'A due with payments can''t be deleted' using errcode = 'FC050';
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  delete from public.statutory_dues as s where s.id = v_due.id; -- the due item cascades
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row level security
-- ---------------------------------------------------------------------------

revoke execute on function public.statutory_dues_validate() from public, anon, authenticated;

revoke execute on function public.statutory_paid(uuid) from public, anon;
revoke execute on function public.statutory_sync_due(uuid) from public, anon;
revoke execute on function public.statutory_check_pay_from(uuid, text, uuid) from public, anon;
revoke execute on function public.create_statutory_due(uuid, text, bigint, date, text, text, text, text, uuid) from public, anon;
revoke execute on function public.update_statutory_due(uuid, bigint, date, text, text, text, text, uuid) from public, anon;
revoke execute on function public.set_statutory_due_archived(uuid, boolean) from public, anon;
revoke execute on function public.delete_statutory_due(uuid) from public, anon;

-- Helpers called from the invoker functions and the progress view, so the caller needs
-- EXECUTE. statutory_sync_due changes a status only under the write mark (due_items_guard).
grant execute on function public.statutory_paid(uuid) to authenticated;
grant execute on function public.statutory_sync_due(uuid) to authenticated;
grant execute on function public.statutory_check_pay_from(uuid, text, uuid) to authenticated;
grant execute on function public.create_statutory_due(uuid, text, bigint, date, text, text, text, text, uuid) to authenticated;
grant execute on function public.update_statutory_due(uuid, bigint, date, text, text, text, text, uuid) to authenticated;
grant execute on function public.set_statutory_due_archived(uuid, boolean) to authenticated;
grant execute on function public.delete_statutory_due(uuid) to authenticated;

revoke all on table public.statutory_dues, public.statutory_due_progress from anon, authenticated;
grant select on table public.statutory_due_progress to authenticated;

-- The invoker functions write with the caller's grants; the guards refuse the same writes
-- made directly.
grant select on table public.statutory_dues to authenticated;
grant insert (due_type, description, vehicle_kind, issued_state, issued_city, currency, amount_minor, due_date,
              pay_from_account_id, idempotency_key)
  on table public.statutory_dues to authenticated;
grant update (archived_at) on table public.statutory_dues to authenticated;
grant insert (statutory_due_id) on table public.due_items to authenticated;

alter table public.statutory_dues enable row level security;

create policy statutory_dues_select_own on public.statutory_dues
  for select to authenticated using ((select auth.uid()) = user_id);
create policy statutory_dues_insert_own on public.statutory_dues
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy statutory_dues_update_own on public.statutory_dues
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
