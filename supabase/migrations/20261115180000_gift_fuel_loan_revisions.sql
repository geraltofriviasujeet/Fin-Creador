-- Fixes from the owner's own use (2026-11-15), before Sprint 12.
--
-- 1. Gift and Fuel: two more default expense categories, for every user. New users get them
--    with the defaults (the sign-up hook and the lazy fallback both run
--    ensure_default_expense_categories); existing users through the backfill at the end. They
--    take a stable key (gift, fuel), as membership and subscription do, and no system_key, so
--    they can be renamed and archived. A person's own expense category of the same name
--    (trimmed, any case) takes the key instead of getting a duplicate: an active one first,
--    else the oldest archived one, which stays archived (the person archived it). Idempotent:
--    running the backfill again creates and changes nothing.
--
-- 2. revise_loan: every term of a loan can be corrected after it is added (until now only the
--    names, sanctioned amount, rate and EMI could, through update_loan). The figures still come
--    from packages/domain; SQL stores and checks them.
--    * Payments already recorded never change: paid and before-tracking instalments, their
--      payments and the ledger entries they posted are left as they are.
--    * No payment ever recorded (voided ones count, as for delete_loan) and no instalment
--      other than pending or before_tracking: the schedule is
--      rebuilt as if the loan had been added with the new terms on the day it was added
--      (tracking_started_on), so the date rules of create_loan apply against that day.
--      Every instalment is replaced ("Will pay later" plans on them go with them).
--    * Once a payment exists: the repayment mode, the first EMI date, EMI 0 (paid before
--      tracking), the moratorium and capitalised interest can't change (FC060). The amounts,
--      rate, tenure and EMI can: pending EMIs take the new EMI, pending moratorium months the
--      new interest (kept as it was once every month is settled), EMIs past the new count are
--      removed and new ones added on the same dates rule. The count can't drop below an EMI
--      that has a payment, even a voided one (FC062).
--    * What is owed: the loan account's opening balance becomes −(new opening outstanding):
--      the amount taken for a loan that starts later, "Owed today" (as of the day it was added)
--      for an ongoing one. Owed now moves by the difference. Refused when it would go below
--      zero, i.e. the new opening amount plus capitalised interest posted is less than the
--      principal already repaid (FC061, detail = the least allowed).
--    * The opening balance keeps its date (the day the loan was added), so past net worth is
--      restated from that day: account_balances_at and liability_owed(p_as_of) give every
--      month-end since then the corrected amount ("as corrected", as for an edited entry).
--      Income, spending and cash-flow reports don't change (an opening balance is not an
--      entry); principal transfers, interest and fees already posted stay as posted.
--    * Every revision is kept in loan_revisions (old and new terms, owed before and after,
--      instalments before, after and rebuilt), written in the same transaction. A revision
--      that changes nothing writes nothing and returns null. Once per request key: a repeat
--      returns the first revision; the same key with other terms is refused (FC007).
--    * update_loan stays for older clients and now records its change in loan_revisions too.
--
-- New error codes (mapped in packages/api):
--   FC059 amount taken more than the sanctioned amount
--   FC060 repayment start, EMI dates or moratorium can't change once a payment is recorded
--   FC061 opening amount less than the principal already repaid
--   FC062 fewer EMIs than one already paid
-- Reused: FC007 request key reused, FC008 not found, FC009 identity, FC032 loan functions only,
-- FC033 archived, FC043 EMI dates don't fit the loan.

-- ---------------------------------------------------------------------------
-- 1. Categories: the gift and fuel keys and icons
-- ---------------------------------------------------------------------------

alter table public.categories drop constraint categories_key;
alter table public.categories add constraint categories_key check (
  key is null or (kind = 'expense' and key in ('membership', 'subscription', 'gift', 'fuel'))
);

comment on column public.categories.key is
  'Stable internal key of a default category (membership, subscription, gift, fuel), whatever the name. Not client-writable.';

alter table public.categories drop constraint categories_icon;
alter table public.categories add constraint categories_icon check (
  icon is null
  or (kind = 'expense' and icon in (
    'food', 'groceries', 'transport', 'home', 'bills', 'shopping', 'health', 'fun',
    'education', 'travel', 'care', 'membership', 'subscription', 'gift', 'fuel', 'other'
  ))
);

-- Replaces the 9a version (migration 20261029180000): unchanged, plus Gift and Fuel in the
-- keyed defaults (adopted by name, as Membership and Subscription are).
create or replace function public.ensure_default_expense_categories(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  created integer := 0;
  n integer;
  v_before integer;
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

  -- An existing same-name category takes the key: an active one first, else the oldest
  -- archived one, which stays archived.
  for d in
    select * from (values
      ('membership', 'Membership'), ('subscription', 'Subscription'), ('gift', 'Gift'), ('fuel', 'Fuel')
    ) as v (key, name)
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

  if not exists (select 1 from public.categories as c where c.user_id = p_user_id and c.system_key = 'bank_charges') then
    select count(*) into v_before from public.categories as c where c.user_id = p_user_id;
    perform public.system_category_id(p_user_id, 'bank_charges');
    created := created + ((select count(*) from public.categories as c where c.user_id = p_user_id) - v_before);
  end if;
  return created;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Loans: terms that shape the schedule change only through revise_loan
-- ---------------------------------------------------------------------------

-- Replaces the 8a version: unchanged, except the schedule-shaping columns may change while
-- revise_loan marks its write (fin_creador.loan_revise, transaction-local, as loan_write).
create or replace function public.loans_validate()
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
    -- What shaped the schedule changes only through revise_loan, which rebuilds it.
    if pg_catalog.current_setting('fin_creador.loan_revise', true) is distinct from 'on'
       and (new.disbursed_minor, new.tenure_months, new.start_mode, new.opening_outstanding_minor,
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

-- A loan's terms as one object: what the add form sets, with EMI 0's date (paid before
-- tracking) and the monthly moratorium interest (the latest pending month's, else the latest
-- month's), which live on its instalments. Names are
-- normalised as loans_validate does, so terms built from a request compare equal to the
-- stored loan's.
create function public.loan_terms(p_loan public.loans, p_before_tracking_on date, p_moratorium_interest_minor bigint)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'loan_type', p_loan.loan_type,
    'type_other', nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_loan.type_other, ''), '\s+', ' ', 'g')), ''),
    'lender', pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_loan.lender, ''), '\s+', ' ', 'g')),
    'nickname', nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_loan.nickname, ''), '\s+', ' ', 'g')), ''),
    'sanctioned_minor', p_loan.sanctioned_minor,
    'disbursed_minor', p_loan.disbursed_minor,
    'rate_bps', p_loan.rate_bps,
    'rate_kind', p_loan.rate_kind,
    'tenure_months', p_loan.tenure_months,
    'start_mode', p_loan.start_mode,
    'opening_outstanding_minor', p_loan.opening_outstanding_minor,
    'instalment_months', p_loan.instalment_months,
    'first_due_date', p_loan.first_due_date,
    'moratorium_months', p_loan.moratorium_months,
    'moratorium_interest', p_loan.moratorium_interest,
    'capitalised_minor', p_loan.capitalised_minor,
    'emi_estimate_minor', p_loan.emi_estimate_minor,
    'emi_minor', p_loan.emi_minor,
    'before_tracking_on', p_before_tracking_on,
    'moratorium_interest_minor', case when p_loan.moratorium_interest = 'pay_monthly' then coalesce(p_moratorium_interest_minor, 0) else 0 end
  );
$$;

-- The stored loan's terms (reads its instalments; invoker, so RLS applies).
create function public.loan_terms(p_loan_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select public.loan_terms(
    l,
    (select d.due_date from public.due_items as d where d.loan_id = l.id and d.kind = 'loan_emi' and d.seq = 0),
    (select d.amount_due_minor from public.due_items as d where d.loan_id = l.id and d.kind = 'loan_interest'
     order by d.status = 'pending' desc, d.seq desc limit 1)
  )
  from public.loans as l
  where l.id = p_loan_id;
$$;

-- ---------------------------------------------------------------------------
-- loan_revisions: the trace of every change to a loan's terms
-- ---------------------------------------------------------------------------

create table public.loan_revisions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  loan_id           uuid not null,
  idempotency_key   uuid not null,
  old_terms         jsonb not null,
  new_terms         jsonb not null,
  -- What is owed now, before and after (liability_owed of the loan account).
  owed_before_minor bigint not null,
  owed_after_minor  bigint not null,
  -- Pending instalments (EMIs and moratorium interest) before and after, and how many were
  -- replaced, removed, added or given a new amount.
  pending_before    integer not null,
  pending_after     integer not null,
  rebuilt           integer not null,
  created_at        timestamptz not null default now(),

  constraint loan_revisions_idempotency_unique unique (user_id, idempotency_key),
  -- Goes with the loan only when the loan is deleted (an archived loan with no payments).
  constraint loan_revisions_loan_owned
    foreign key (loan_id, user_id) references public.loans (id, user_id) on delete cascade,
  constraint loan_revisions_terms check (
    jsonb_typeof(old_terms) = 'object' and jsonb_typeof(new_terms) = 'object' and old_terms <> new_terms
  ),
  constraint loan_revisions_owed_range check (
    owed_before_minor between -10000000000000 and 10000000000000
    and owed_after_minor between -10000000000000 and 10000000000000
  ),
  constraint loan_revisions_counts check (
    pending_before between 0 and 1000 and pending_after between 0 and 1000 and rebuilt between 0 and 2000
  )
);

create index loan_revisions_loan_idx on public.loan_revisions (loan_id, created_at);

comment on table public.loan_revisions is
  'Every change to a loan''s terms (revise_loan, update_loan): old and new terms, owed before and after, instalments rebuilt. Never changed.';

-- Written only by the loan functions; never changed.
create function public.loan_revisions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'A loan revision can''t change' using errcode = 'FC009';
  end if;
  if pg_catalog.current_setting('fin_creador.loan_write', true) is distinct from 'on' then
    raise exception 'Loans change only through the loan functions' using errcode = 'FC032';
  end if;
  new.created_at := pg_catalog.now();
  return new;
end;
$$;

create trigger loan_revisions_guard
  before insert or update on public.loan_revisions
  for each row execute function public.loan_revisions_guard();

-- ---------------------------------------------------------------------------
-- revise_loan
-- ---------------------------------------------------------------------------

-- Corrects a loan's terms once per request key (see the header). The parameters are
-- create_loan's, with the loan first; the figures come from packages/domain. Returns the
-- revision, or null when nothing changed.
create function public.revise_loan(
  p_loan_id uuid,
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
returns public.loan_revisions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_loan public.loans;
  v_req public.loans;
  v_rev public.loan_revisions;
  v_old jsonb;
  v_new jsonb;
  v_day date;
  v_month_start date;
  v_has_history boolean;
  v_interest_pending boolean;
  v_principal bigint;
  v_cap_posted bigint;
  v_owed_before bigint;
  v_pending_before integer;
  v_pending_after integer;
  v_last_with_history integer;
  v_last_seq integer;
  v_rebuilt integer := 0;
  n integer;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_loan_id is null or p_idempotency_key is null then
    raise exception 'Loan and request key are required' using errcode = '22023';
  end if;

  select * into v_loan from public.loans as l where l.id = p_loan_id for update;
  if v_loan.id is null then
    raise exception 'Loan not found' using errcode = 'FC008';
  end if;

  -- The request as a loan row, so its terms are built the same way as the stored ones.
  v_req := v_loan;
  v_req.loan_type := p_loan_type;
  v_req.type_other := p_type_other;
  v_req.lender := p_lender;
  v_req.nickname := p_nickname;
  v_req.sanctioned_minor := p_sanctioned_minor;
  v_req.disbursed_minor := p_disbursed_minor;
  v_req.rate_bps := p_rate_bps;
  v_req.rate_kind := coalesce(p_rate_kind, 'fixed');
  v_req.tenure_months := p_tenure_months;
  v_req.start_mode := p_start_mode;
  v_req.opening_outstanding_minor := p_outstanding_minor;
  v_req.instalment_months := p_instalment_months;
  v_req.first_due_date := p_first_due_date;
  v_req.moratorium_months := coalesce(p_moratorium_months, 0);
  v_req.moratorium_interest := p_moratorium_interest;
  v_req.capitalised_minor := coalesce(p_capitalised_minor, 0);
  v_req.emi_estimate_minor := p_emi_estimate_minor;
  v_req.emi_minor := p_emi_minor;
  v_new := public.loan_terms(v_req, p_before_tracking_on, p_moratorium_interest_minor);
  v_old := public.loan_terms(v_loan.id);

  -- History: any payment (voided ones count), or any instalment settled some other way.
  -- Today a loan instalment is only pending, paid (by pay_due_item, with a payment) or
  -- before_tracking (built from the terms); a status other than those two is history too,
  -- so a rebuild can never delete a recorded decision.
  v_has_history := exists (
    select 1 from public.due_payments as p join public.due_items as d on d.id = p.due_item_id
    where d.loan_id = v_loan.id
  ) or exists (
    select 1 from public.due_items as d
    where d.loan_id = v_loan.id and d.status not in ('pending', 'before_tracking')
  );
  v_interest_pending := exists (
    select 1 from public.due_items as d where d.loan_id = v_loan.id and d.kind = 'loan_interest' and d.status = 'pending'
  );
  -- With payments recorded and every moratorium month settled, the monthly interest has
  -- nothing left to apply to: it stays as it was.
  if v_has_history and not v_interest_pending then
    v_new := pg_catalog.jsonb_set(v_new, '{moratorium_interest_minor}', v_old->'moratorium_interest_minor');
  end if;

  -- A repeat of a saved revision returns it (checked under the loan lock, so a simultaneous
  -- retry waits for the first and then finds it).
  select * into v_rev from public.loan_revisions as r where r.user_id = v_uid and r.idempotency_key = p_idempotency_key;
  if v_rev.id is not null then
    if v_rev.loan_id <> v_loan.id or v_rev.new_terms <> v_new then
      raise exception 'This request key was already used for a different change' using errcode = 'FC007';
    end if;
    return v_rev;
  end if;

  if v_loan.archived_at is not null then
    raise exception 'Loan is archived' using errcode = 'FC033';
  end if;

  if v_old = v_new then
    return null;
  end if;

  -- Limits (the table constraints check the rest when the row is written).
  if p_disbursed_minor > p_sanctioned_minor then
    raise exception 'The amount taken can''t be more than the sanctioned amount' using errcode = 'FC059';
  end if;

  -- Principal repaid and capitalised interest posted, by the payments in force.
  select coalesce(sum(p.principal_minor), 0), coalesce(sum(p.capitalised_minor), 0)
  into v_principal, v_cap_posted
  from public.due_payments as p join public.due_items as d on d.id = p.due_item_id
  where d.loan_id = v_loan.id and p.voided_at is null;
  if p_outstanding_minor + v_cap_posted < v_principal then
    raise exception 'This is less than the principal already repaid' using errcode = 'FC061',
      detail = (v_principal - v_cap_posted)::text;
  end if;

  if v_has_history then
    if (v_new->'start_mode', v_new->'first_due_date', v_new->'before_tracking_on', v_new->'moratorium_months',
        v_new->'moratorium_interest', v_new->'capitalised_minor')
       is distinct from
       (v_old->'start_mode', v_old->'first_due_date', v_old->'before_tracking_on', v_old->'moratorium_months',
        v_old->'moratorium_interest', v_old->'capitalised_minor')
    then
      raise exception 'Once a payment is recorded, the repayment start, EMI dates and moratorium can''t change'
        using errcode = 'FC060';
    end if;
    -- Pending moratorium months take the new interest; it can't drop to nothing for them.
    if v_interest_pending and (v_new->>'moratorium_interest_minor')::bigint <= 0 then
      raise exception 'Once a payment is recorded, the repayment start, EMI dates and moratorium can''t change'
        using errcode = 'FC060';
    end if;
    select max(d.seq) into v_last_with_history
    from public.due_items as d
    where d.loan_id = v_loan.id and d.kind = 'loan_emi'
      and (d.status not in ('pending', 'before_tracking')
           or exists (select 1 from public.due_payments as p where p.due_item_id = d.id));
    if p_instalment_months < coalesce(v_last_with_history, 0) then
      raise exception 'There are fewer EMIs than one already paid' using errcode = 'FC062',
        detail = v_last_with_history::text;
    end if;
  else
    -- The date rules of create_loan, against the day the loan was added.
    v_day := v_loan.tracking_started_on;
    v_month_start := pg_catalog.make_date(extract(year from v_day)::integer, extract(month from v_day)::integer, 1);
    if p_start_mode = 'starts_later' and (p_first_due_date <= v_day or p_before_tracking_on is not null) then
      raise exception 'The first EMI of a loan that starts later is after the day it was added' using errcode = 'FC043';
    end if;
    if p_start_mode = 'ongoing' then
      if p_before_tracking_on is null
         and p_first_due_date not between v_month_start and (v_month_start + interval '1 month')::date - 1 then
        raise exception 'A still-due EMI is in the month the loan was added' using errcode = 'FC043';
      end if;
      if p_before_tracking_on is not null
         and (p_first_due_date <= v_day
              or p_before_tracking_on <> public.loan_due_date(p_first_due_date, 0)) then
        raise exception 'With that month''s EMI paid, the next one is after the day the loan was added' using errcode = 'FC043';
      end if;
    end if;
  end if;
  if p_moratorium_interest = 'pay_monthly' and p_rate_bps > 0 and coalesce(p_moratorium_interest_minor, 0) <= 0 then
    raise exception 'Moratorium interest is missing' using errcode = '22023';
  end if;

  v_owed_before := public.liability_owed(v_loan.account_id);
  select count(*) into v_pending_before from public.due_items as d where d.loan_id = v_loan.id and d.status = 'pending';

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  perform pg_catalog.set_config('fin_creador.loan_revise', 'on', true);

  update public.loans as l
  set loan_type = v_req.loan_type, type_other = v_req.type_other, lender = v_req.lender, nickname = v_req.nickname,
      sanctioned_minor = v_req.sanctioned_minor, disbursed_minor = v_req.disbursed_minor, rate_bps = v_req.rate_bps,
      rate_kind = v_req.rate_kind, tenure_months = v_req.tenure_months, start_mode = v_req.start_mode,
      opening_outstanding_minor = v_req.opening_outstanding_minor, instalment_months = v_req.instalment_months,
      first_due_date = v_req.first_due_date, moratorium_months = v_req.moratorium_months,
      moratorium_interest = v_req.moratorium_interest, capitalised_minor = v_req.capitalised_minor,
      emi_estimate_minor = v_req.emi_estimate_minor, emi_minor = v_req.emi_minor
  where l.id = v_loan.id
  returning * into v_loan;

  update public.accounts as a
  set name = pg_catalog.left(coalesce(v_loan.nickname, v_loan.lender), 80), institution = v_loan.lender,
      opening_balance_minor = -v_loan.opening_outstanding_minor
  where a.id = v_loan.account_id;

  if not v_has_history then
    -- No instalment has a payment: replace them all, as create_loan builds them.
    delete from public.due_items as d where d.loan_id = v_loan.id;

    if p_before_tracking_on is not null then
      insert into public.due_items (kind, loan_id, seq, due_date, amount_due_minor, currency, status)
      values ('loan_emi', v_loan.id, 0, p_before_tracking_on, v_loan.emi_minor, v_loan.currency, 'before_tracking');
    end if;

    if v_loan.moratorium_interest = 'pay_monthly' and coalesce(p_moratorium_interest_minor, 0) > 0 then
      insert into public.due_items (kind, loan_id, seq, due_date, amount_due_minor, currency, status)
      select 'loan_interest', v_loan.id, m.n, m.due, p_moratorium_interest_minor, v_loan.currency,
             case when m.due < v_day then 'before_tracking' else 'pending' end
      from (
        select s as n, public.loan_due_date(v_loan.first_due_date, s - v_loan.moratorium_months) as due
        from pg_catalog.generate_series(1, v_loan.moratorium_months) as s
      ) as m;
    end if;

    insert into public.due_items (kind, loan_id, seq, due_date, amount_due_minor, currency)
    select 'loan_emi', v_loan.id, s, public.loan_due_date(v_loan.first_due_date, s), v_loan.emi_minor, v_loan.currency
    from pg_catalog.generate_series(1, v_loan.instalment_months) as s;

    select count(*) into v_rebuilt from public.due_items as d where d.loan_id = v_loan.id and d.status = 'pending';
  else
    -- EMIs past the new count go (none has a payment: checked above).
    delete from public.due_items as d
    where d.loan_id = v_loan.id and d.kind = 'loan_emi' and d.seq > v_loan.instalment_months;
    get diagnostics n = row_count;
    v_rebuilt := v_rebuilt + n;

    -- Pending instalments take the new amounts; dates never move.
    update public.due_items as d
    set amount_due_minor = v_loan.emi_minor
    where d.loan_id = v_loan.id and d.kind = 'loan_emi' and d.status = 'pending'
      and d.amount_due_minor <> v_loan.emi_minor;
    get diagnostics n = row_count;
    v_rebuilt := v_rebuilt + n;

    if v_interest_pending then
      update public.due_items as d
      set amount_due_minor = (v_new->>'moratorium_interest_minor')::bigint
      where d.loan_id = v_loan.id and d.kind = 'loan_interest' and d.status = 'pending'
        and d.amount_due_minor <> (v_new->>'moratorium_interest_minor')::bigint;
      get diagnostics n = row_count;
      v_rebuilt := v_rebuilt + n;
    end if;

    select coalesce(max(d.seq), 0) into v_last_seq from public.due_items as d where d.loan_id = v_loan.id and d.kind = 'loan_emi';
    insert into public.due_items (kind, loan_id, seq, due_date, amount_due_minor, currency)
    select 'loan_emi', v_loan.id, s, public.loan_due_date(v_loan.first_due_date, s), v_loan.emi_minor, v_loan.currency
    from pg_catalog.generate_series(v_last_seq + 1, v_loan.instalment_months) as s;
    get diagnostics n = row_count;
    v_rebuilt := v_rebuilt + n;
  end if;

  select count(*) into v_pending_after from public.due_items as d where d.loan_id = v_loan.id and d.status = 'pending';

  -- The stored terms must be the requested ones, or the trace would not be true.
  if public.loan_terms(v_loan.id) <> v_new then
    raise exception 'The loan could not be saved as entered' using errcode = 'P0001';
  end if;

  insert into public.loan_revisions (
    loan_id, idempotency_key, old_terms, new_terms, owed_before_minor, owed_after_minor,
    pending_before, pending_after, rebuilt
  ) values (
    v_loan.id, p_idempotency_key, v_old, v_new, v_owed_before, public.liability_owed(v_loan.account_id),
    v_pending_before, v_pending_after, v_rebuilt
  )
  returning * into v_rev;

  perform pg_catalog.set_config('fin_creador.loan_revise', '', true);
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_rev;
end;
$$;

-- Replaces the 8a version: unchanged, except a change is recorded in loan_revisions (no
-- request key from this older call: a new one per change). Kept for older clients.
create or replace function public.update_loan(
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
  v_old jsonb;
  v_new jsonb;
  v_owed bigint;
  v_pending integer;
  n integer;
begin
  select * into v_loan from public.loans as l where l.id = p_loan_id for update;
  if v_loan.id is null then
    raise exception 'Loan not found' using errcode = 'FC008';
  end if;
  if v_loan.archived_at is not null then
    raise exception 'Loan is archived' using errcode = 'FC033';
  end if;
  v_old := public.loan_terms(v_loan.id);

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
  get diagnostics n = row_count;

  v_new := public.loan_terms(v_loan.id);
  if v_new <> v_old then
    v_owed := public.liability_owed(v_loan.account_id);
    select count(*) into v_pending from public.due_items as d where d.loan_id = v_loan.id and d.status = 'pending';
    insert into public.loan_revisions (
      loan_id, idempotency_key, old_terms, new_terms, owed_before_minor, owed_after_minor,
      pending_before, pending_after, rebuilt
    ) values (v_loan.id, pg_catalog.gen_random_uuid(), v_old, v_new, v_owed, v_owed, v_pending, v_pending, n);
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_loan;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row level security
-- ---------------------------------------------------------------------------

revoke execute on function public.loan_revisions_guard() from public, anon, authenticated;
revoke execute on function public.loan_terms(public.loans, date, bigint) from public, anon;
revoke execute on function public.loan_terms(uuid) from public, anon;
revoke execute on function public.revise_loan(uuid, uuid, text, text, bigint, bigint, integer, text, integer, text, bigint, integer, date, bigint, bigint, text, text, date, integer, text, bigint, bigint) from public, anon;

-- revise_loan and update_loan are invoker, so the caller needs EXECUTE on the helpers.
grant execute on function public.loan_terms(public.loans, date, bigint) to authenticated;
grant execute on function public.loan_terms(uuid) to authenticated;
grant execute on function public.revise_loan(uuid, uuid, text, text, bigint, bigint, integer, text, integer, text, bigint, integer, date, bigint, bigint, text, text, date, integer, text, bigint, bigint) to authenticated;

-- revise_loan writes the schedule columns with the caller's grants; loans_validate refuses
-- the same writes made directly (no loan_write mark) or by any other function (no
-- loan_revise mark).
grant update (disbursed_minor, tenure_months, start_mode, opening_outstanding_minor, instalment_months, first_due_date,
              moratorium_months, moratorium_interest, capitalised_minor, emi_estimate_minor)
  on table public.loans to authenticated;

-- revise_loan removes instalments that have no payment. The policy allows it only while a
-- loan function marks its write; the setting is not reachable through the API. Cascades
-- (delete_loan, account deletion) are referential actions and don't check policies.
grant delete on table public.due_items to authenticated;
create policy due_items_delete_own on public.due_items
  for delete to authenticated
  using ((select auth.uid()) = user_id and pg_catalog.current_setting('fin_creador.loan_write', true) = 'on');

revoke all on table public.loan_revisions from anon, authenticated;
grant select on table public.loan_revisions to authenticated;
grant insert (loan_id, idempotency_key, old_terms, new_terms, owed_before_minor, owed_after_minor,
              pending_before, pending_after, rebuilt)
  on table public.loan_revisions to authenticated;

alter table public.loan_revisions enable row level security;

create policy loan_revisions_select_own on public.loan_revisions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy loan_revisions_insert_own on public.loan_revisions
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Backfill existing users (idempotent: running it again creates nothing)
-- ---------------------------------------------------------------------------

select public.backfill_default_expense_categories();
