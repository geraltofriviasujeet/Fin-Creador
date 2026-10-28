-- Sprint 8b follow-up: borrowing details and return plans, card products, digits in any script.
--
-- Model (docs/sprint-plan.md, Sprint 8b follow-up):
--   * has_digit(text, min_run) is the one digit test for names: every Unicode decimal digit
--     (\p{Nd}, Unicode 17) plus superscript and subscript digits. A run may mix scripts.
--     Parity: packages/schemas. Card issuer, card nickname and who you owe refuse any digit;
--     a card product refuses a run of 3; a borrowing reason, loan lender and loan nickname a
--     run of 4 (loan rows added before this migration are not re-checked).
--   * A card names its product (from the list in packages/schemas or typed under "Other"). The
--     card account is named after the nickname, else the product ("<issuer> <typed name>" for
--     Other), else the issuer.
--   * A borrowing records who it is from (relationship), what for (reason, optional), how much
--     to return (at least the amount borrowed; the extra is interest, posted as "Loan interest"
--     when repaid) and, once a return date is set, how it will be returned: once on that date
--     (one due item, seq 0) or in 2–60 monthly instalments (seq 1…n, instalment i on the
--     return day clamped to the end of month i). Amounts: floor(T / n), the last takes the
--     remainder. Interest is spread pro rata on the cumulative amount, rounded down once per
--     instalment boundary, so it adds up to the extra and never exceeds an instalment.
--     Schedule: borrowing_schedule (parity: packages/domain).
--   * Each borrowing due item names the account it will be paid from (pay_from_account_id).
--     Nothing moves by itself: the Pay form is prefilled from it and money moves only through
--     repay_borrowing. "Will pay later" (planned_on / planned_account_id) works as before.
--   * Status: repayments (principal + interest, active ones) cover the due items in seq order;
--     an item is paid once they reach its cumulative amount, or when nothing is owed. A part-
--     covered item stays pending; what is left is in borrowing_due_progress.
--   * The paying account is required by create_borrowing and set_borrowing_return_plan only
--     (it is set null if that account is deleted; the Pay form then asks for another).
--
-- Writes are marked with fin_creador.loan_write (8a's transaction-local setting).
-- No new error codes. Reused: FC001, FC002, FC007, FC008, FC009, FC010, FC032, FC038, FC041,
-- FC048, FC051, 22023.

-- ---------------------------------------------------------------------------
-- Digits in any script (parity: packages/schemas)
-- ---------------------------------------------------------------------------

create function public.has_digit(p_text text, p_min_run integer default 1)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select p_text ~ (
    '[' ||
      '\u0030-\u0039\u00B2-\u00B3\u00B9\u0660-\u0669\u06F0-\u06F9\u07C0-\u07C9\u0966-\u096F' ||
      '\u09E6-\u09EF\u0A66-\u0A6F\u0AE6-\u0AEF\u0B66-\u0B6F\u0BE6-\u0BEF\u0C66-\u0C6F' ||
      '\u0CE6-\u0CEF\u0D66-\u0D6F\u0DE6-\u0DEF\u0E50-\u0E59\u0ED0-\u0ED9\u0F20-\u0F29' ||
      '\u1040-\u1049\u1090-\u1099\u17E0-\u17E9\u1810-\u1819\u1946-\u194F\u19D0-\u19D9' ||
      '\u1A80-\u1A89\u1A90-\u1A99\u1B50-\u1B59\u1BB0-\u1BB9\u1C40-\u1C49\u1C50-\u1C59\u2070' ||
      '\u2074-\u2079\u2080-\u2089\uA620-\uA629\uA8D0-\uA8D9\uA900-\uA909\uA9D0-\uA9D9' ||
      '\uA9F0-\uA9F9\uAA50-\uAA59\uABF0-\uABF9\uFF10-\uFF19\U000104A0-\U000104A9' ||
      '\U00010D30-\U00010D39\U00010D40-\U00010D49\U00011066-\U0001106F\U000110F0-\U000110F9' ||
      '\U00011136-\U0001113F\U000111D0-\U000111D9\U000112F0-\U000112F9\U00011450-\U00011459' ||
      '\U000114D0-\U000114D9\U00011650-\U00011659\U000116C0-\U000116C9\U000116D0-\U000116E3' ||
      '\U00011730-\U00011739\U000118E0-\U000118E9\U00011950-\U00011959\U00011BF0-\U00011BF9' ||
      '\U00011C50-\U00011C59\U00011D50-\U00011D59\U00011DA0-\U00011DA9\U00011DE0-\U00011DE9' ||
      '\U00011F50-\U00011F59\U00016130-\U00016139\U00016A60-\U00016A69\U00016AC0-\U00016AC9' ||
      '\U00016B50-\U00016B59\U00016D70-\U00016D79\U0001CCF0-\U0001CCF9\U0001D7CE-\U0001D7FF' ||
      '\U0001E140-\U0001E149\U0001E2F0-\U0001E2F9\U0001E4F0-\U0001E4F9\U0001E5F1-\U0001E5FA' ||
      '\U0001E950-\U0001E959\U0001FBF0-\U0001FBF9' ||
    ']{' || greatest(p_min_run, 1) || ',}'
  );
$$;

comment on function public.has_digit(text, integer) is
  'True when the text has a run of at least p_min_run digits in any script (Unicode Nd, superscripts, subscripts). Parity: packages/schemas.';

-- ---------------------------------------------------------------------------
-- Loans: lender and nickname (new and edited rows only)
-- ---------------------------------------------------------------------------

alter table public.loans drop constraint loans_lender;
alter table public.loans add constraint loans_lender
  check (char_length(btrim(lender)) between 1 and 80 and not public.has_digit(lender, 4)) not valid;
alter table public.loans drop constraint loans_nickname;
alter table public.loans add constraint loans_nickname check (
  nickname is null or (char_length(btrim(nickname)) between 1 and 40 and not public.has_digit(nickname, 4))
) not valid;

-- ---------------------------------------------------------------------------
-- Cards: product, digits
-- ---------------------------------------------------------------------------

alter table public.credit_cards add column product text;
alter table public.credit_cards add column product_other boolean not null default false;

alter table public.credit_cards drop constraint credit_cards_issuer;
alter table public.credit_cards add constraint credit_cards_issuer
  check (char_length(btrim(issuer)) between 1 and 80 and not public.has_digit(issuer));
alter table public.credit_cards drop constraint credit_cards_nickname;
alter table public.credit_cards add constraint credit_cards_nickname check (
  nickname is null or (char_length(btrim(nickname)) between 1 and 40 and not public.has_digit(nickname))
);
-- Product names may have a digit or two (e.g. a "6E" card); a run of 3 or more is refused.
alter table public.credit_cards add constraint credit_cards_product check (
  product is null or (char_length(btrim(product)) between 1 and 80 and not public.has_digit(product, 3))
);
alter table public.credit_cards add constraint credit_cards_product_other check (not product_other or product is not null);

-- The card account's name: nickname, else product ("<issuer> <typed name>" for Other), else issuer.
create function public.card_account_name(p_issuer text, p_product text, p_product_other boolean, p_nickname text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.left(coalesce(
    p_nickname,
    case when p_product_other then p_issuer || ' ' || p_product else p_product end,
    p_issuer
  ), 80);
$$;

-- Replaces the 8b version: product and product_other are normalised and frozen when archived.
create or replace function public.credit_cards_validate()
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
       and (new.issuer, new.product, new.product_other, new.nickname, new.limit_minor, new.statement_day, new.due_day)
           is distinct from
           (old.issuer, old.product, old.product_other, old.nickname, old.limit_minor, old.statement_day, old.due_day)
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
  new.product := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(new.product, ''), '\s+', ' ', 'g')), '');
  new.product_other := coalesce(new.product_other, false) and new.product is not null;
  new.nickname := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(new.nickname, ''), '\s+', ' ', 'g')), '');
  return new;
end;
$$;

drop function public.create_card(uuid, text, bigint, integer, integer, bigint, text);
drop function public.update_card(uuid, text, bigint, integer, integer, text);

create function public.create_card(
  p_idempotency_key uuid,
  p_issuer text,
  p_limit_minor bigint,
  p_statement_day integer,
  p_due_day integer,
  p_opening_owed_minor bigint default 0,
  p_nickname text default null,
  p_product text default null,
  p_product_other boolean default false
)
returns public.credit_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_issuer text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_issuer, ''), '\s+', ' ', 'g'));
  v_product text := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_product, ''), '\s+', ' ', 'g')), '');
  v_product_other boolean := coalesce(p_product_other, false) and v_product is not null;
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
    if (v_card.issuer, v_card.product, v_card.product_other, v_card.limit_minor, v_card.statement_day,
        v_card.due_day, v_card.opening_owed_minor)
       is distinct from
       (v_issuer, v_product, v_product_other, p_limit_minor, p_statement_day, p_due_day, coalesce(p_opening_owed_minor, 0)) then
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
  values ('card', public.card_account_name(v_issuer, v_product, v_product_other, v_nickname), nullif(v_issuer, ''),
          v_currency, -coalesce(p_opening_owed_minor, 0), public.user_local_today(v_uid))
  returning * into v_account;

  insert into public.credit_cards (
    account_id, issuer, product, product_other, nickname, currency, limit_minor, statement_day, due_day,
    opening_owed_minor, tracking_started_on, idempotency_key
  ) values (
    v_account.id, v_issuer, v_product, v_product_other, v_nickname, v_currency, p_limit_minor, p_statement_day,
    p_due_day, coalesce(p_opening_owed_minor, 0), v_account.opening_balance_date, p_idempotency_key
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
  p_nickname text default null,
  p_product text default null,
  p_product_other boolean default false
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
  set issuer = p_issuer, product = p_product, product_other = coalesce(p_product_other, false), nickname = p_nickname,
      limit_minor = p_limit_minor, statement_day = p_statement_day, due_day = p_due_day
  where c.id = v_card.id
  returning * into v_card;
  update public.accounts as a
  set name = public.card_account_name(v_card.issuer, v_card.product, v_card.product_other, v_card.nickname),
      institution = v_card.issuer
  where a.id = v_card.account_id;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_card;
end;
$$;

-- ---------------------------------------------------------------------------
-- Borrowings: relationship, reason, how much to return, return plan
-- ---------------------------------------------------------------------------

alter table public.borrowings add column relationship text;
alter table public.borrowings add column reason text;
alter table public.borrowings add column amount_to_return_minor bigint;
alter table public.borrowings add column return_on date;
alter table public.borrowings add column return_plan text;
alter table public.borrowings add column instalment_count integer;
-- The account the money will be returned from (copied to each due item). Required only by the
-- functions: rows from 8b have none, and it is set null if the account is deleted.
alter table public.borrowings add column repay_from_account_id uuid;

-- The interest within a borrowing due item (the rest is principal); borrowing_due only.
alter table public.due_items add column interest_minor bigint;
-- The account a borrowing due item will be paid from (prefills the Pay form; nothing moves by
-- itself). Set null if that account is deleted.
alter table public.due_items add column pay_from_account_id uuid;

-- Backfill rows from 8b, before the guards below are replaced (the 8b guards allow these
-- writes under the write mark): amount to return = amount borrowed; an existing due date
-- becomes a one-time return plan with no paying account; its interest part is 0.
do $$
begin
  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.borrowings as b
  set amount_to_return_minor = b.borrowed_minor,
      return_on = d.due_date,
      return_plan = case when d.id is not null then 'once' end
  from public.borrowings as b2
  left join public.due_items as d on d.borrowing_id = b2.id and d.seq = 0
  where b2.id = b.id;
  update public.due_items as d set interest_minor = 0 where d.kind = 'borrowing_due';
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
end;
$$;

alter table public.borrowings alter column amount_to_return_minor set not null;
alter table public.due_items add constraint due_items_interest check (
  (kind = 'borrowing_due') = (interest_minor is not null)
  and (interest_minor is null or interest_minor between 0 and amount_due_minor)
);

alter table public.borrowings drop constraint borrowings_lender;
alter table public.borrowings add constraint borrowings_lender
  check (char_length(btrim(lender)) between 1 and 80 and not public.has_digit(lender));
-- Null only on rows from 8b; create_borrowing requires it.
alter table public.borrowings add constraint borrowings_relationship
  check (relationship is null or relationship in ('family', 'friends', 'others'));
alter table public.borrowings add constraint borrowings_reason check (
  reason is null or (char_length(btrim(reason)) between 1 and 80 and not public.has_digit(reason, 4))
);
alter table public.borrowings add constraint borrowings_return_amount
  check (amount_to_return_minor >= borrowed_minor and amount_to_return_minor <= 10000000000000);
alter table public.borrowings add constraint borrowings_return_plan check (
  (return_on is null) = (return_plan is null)
  and (return_plan is null or return_plan in ('once', 'instalments'))
  and (return_plan is not distinct from 'instalments') = (instalment_count is not null)
  and (instalment_count is null or instalment_count between 2 and 60)
  and (return_on is null or return_on >= date '1970-01-01')
);
alter table public.borrowings add constraint borrowings_repay_from_owned
  foreign key (repay_from_account_id, user_id) references public.accounts (id, user_id)
  on delete set null (repay_from_account_id);

create index borrowings_repay_from_idx on public.borrowings (repay_from_account_id) where repay_from_account_id is not null;

comment on table public.borrowings is
  'Money borrowed from friends, family or others. Owed = −(balance of account_id, a borrowing account); amount_to_return_minor − borrowed_minor is interest. A return plan is due items of kind borrowing_due (borrowing_schedule).';

-- Replaces the 8b version: the new columns are frozen when archived; the paying account may be
-- cleared without the write mark only by ON DELETE SET NULL (nothing else changes).
create or replace function public.borrowings_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row public.borrowings;
begin
  if pg_catalog.current_setting('fin_creador.loan_write', true) is distinct from 'on' then
    if tg_op = 'UPDATE' and old.repay_from_account_id is not null and new.repay_from_account_id is null then
      v_row := new;
      v_row.repay_from_account_id := old.repay_from_account_id;
      v_row.updated_at := old.updated_at;
      if v_row is not distinct from old then
        return new;
      end if;
    end if;
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
    if old.archived_at is not null and new.archived_at is not null
       and (new.lender, new.relationship, new.reason, new.amount_to_return_minor, new.return_on, new.return_plan,
            new.instalment_count, new.repay_from_account_id)
           is distinct from
           (old.lender, old.relationship, old.reason, old.amount_to_return_minor, old.return_on, old.return_plan,
            old.instalment_count, old.repay_from_account_id)
    then
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
  new.reason := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(new.reason, ''), '\s+', ' ', 'g')), '');
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Due items: instalments, interest part, paying account
-- ---------------------------------------------------------------------------

alter table public.due_items drop constraint due_items_borrowing_unique;
alter table public.due_items add constraint due_items_borrowing_seq_unique unique (borrowing_id, seq);

alter table public.due_items drop constraint due_items_source;
alter table public.due_items add constraint due_items_source check (
  (kind in ('loan_emi', 'loan_interest')) = (loan_id is not null)
  and (kind = 'card_bill') = (card_statement_id is not null)
  and (kind = 'borrowing_due') = (borrowing_id is not null)
  and (kind in ('loan_emi', 'loan_interest', 'borrowing_due') or seq = 0)
  and (kind <> 'borrowing_due' or seq between 0 and 60)
);

alter table public.due_items add constraint due_items_pay_from_owned
  foreign key (pay_from_account_id, user_id) references public.accounts (id, user_id)
  on delete set null (pay_from_account_id);
alter table public.due_items add constraint due_items_pay_from_kind
  check (pay_from_account_id is null or kind = 'borrowing_due');

create index due_items_pay_from_idx on public.due_items (pay_from_account_id) where pay_from_account_id is not null;

comment on table public.due_items is
  'Anything due on a date and paid from an account: loan EMIs and moratorium interest (8a), card bills and borrowing return dates or instalments (8b). Reminders are derived from these dates in packages/domain/src/due-items.ts.';

-- Replaces the 8b guard: interest_minor and pay_from_account_id change only under the write
-- mark, except that ON DELETE SET NULL may clear pay_from_account_id.
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
  if (new.amount_due_minor, new.minimum_due_minor, new.status, new.interest_minor)
     is distinct from (old.amount_due_minor, old.minimum_due_minor, old.status, old.interest_minor)
     and not v_marked then
    raise exception 'Due items change only through their loan, card or borrowing' using errcode = 'FC032';
  end if;
  if new.pay_from_account_id is distinct from old.pay_from_account_id
     and new.pay_from_account_id is not null and not v_marked then
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
-- Return schedule, status and progress
-- ---------------------------------------------------------------------------

-- The due items of a return plan (parity: packages/domain). p_total = how much to return,
-- p_extra = the part above the amount borrowed. Once: seq 0 on the return date. Instalments:
-- seq 1…n, instalment i on the return day clamped to the end of month i (31 Jan, 28 Feb,
-- 31 Mar); amount floor(T / n), the last takes the remainder; interest through instalment i =
-- floor(extra × amount through i / T), so each instalment's interest is the difference.
create function public.borrowing_schedule(
  p_total_minor bigint,
  p_extra_minor bigint,
  p_return_on date,
  p_return_plan text,
  p_instalment_count integer
)
returns table (seq integer, due_date date, amount_minor bigint, interest_minor bigint)
language sql
immutable
set search_path = ''
as $$
  select 0, p_return_on, p_total_minor, p_extra_minor
  where p_return_plan = 'once'
  union all
  select s.i,
         (p_return_on + pg_catalog.make_interval(months => s.i - 1))::date,
         s.through - s.before,
         (pg_catalog.div(p_extra_minor::numeric * s.through, p_total_minor)
          - pg_catalog.div(p_extra_minor::numeric * s.before, p_total_minor))::bigint
  from (
    select g.i,
           case when g.i = p_instalment_count then p_total_minor else g.i * (p_total_minor / p_instalment_count) end as through,
           (g.i - 1) * (p_total_minor / p_instalment_count) as before
    from pg_catalog.generate_series(1, p_instalment_count) as g (i)
  ) as s
  where p_return_plan = 'instalments'
  order by 1;
$$;

-- Checks a return plan for create_borrowing and set_borrowing_return_plan. The paying account
-- is looked up by owner explicitly (set_borrowing_return_plan runs as the definer).
create function public.borrowing_check_plan(
  p_user_id uuid,
  p_currency text,
  p_borrowed_minor bigint,
  p_amount_to_return_minor bigint,
  p_return_on date,
  p_return_plan text,
  p_instalment_count integer,
  p_pay_from_account_id uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_account public.accounts;
begin
  if p_amount_to_return_minor is null or p_amount_to_return_minor < p_borrowed_minor
     or p_amount_to_return_minor > 10000000000000 then
    raise exception 'How much to return must be at least the amount borrowed' using errcode = '22023';
  end if;
  if p_return_on is null then
    if p_return_plan is not null or p_instalment_count is not null or p_pay_from_account_id is not null then
      raise exception 'Enter a return date first' using errcode = '22023';
    end if;
    return;
  end if;
  if p_return_plan is null or p_return_plan not in ('once', 'instalments') then
    raise exception 'Choose how you will return it' using errcode = '22023';
  end if;
  if p_return_plan = 'once' and p_instalment_count is not null then
    raise exception 'A one-time return has no instalments' using errcode = '22023';
  end if;
  if p_return_plan = 'instalments'
     and (p_instalment_count is null or p_instalment_count not between 2 and 60 or p_instalment_count > p_amount_to_return_minor) then
    raise exception 'Choose between 2 and 60 instalments' using errcode = '22023';
  end if;
  if p_pay_from_account_id is null then
    raise exception 'Choose the account you will return it from' using errcode = '22023';
  end if;
  select * into v_account from public.accounts as a where a.id = p_pay_from_account_id and a.user_id = p_user_id;
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

-- Replaces the 8b version. Active repayments (principal + interest) cover the due items in
-- seq order: an item is paid once they reach its cumulative amount, or when nothing is owed;
-- pending otherwise (so overdue once past). Paid items lose a "Will pay later" plan.
create or replace function public.borrowing_sync_due(p_borrowing_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_owed bigint;
  v_repaid bigint;
begin
  select b.account_id into v_account_id from public.borrowings as b where b.id = p_borrowing_id;
  v_owed := public.liability_owed(v_account_id);
  select coalesce(sum(p.principal_minor + p.interest_minor), 0) into v_repaid
  from public.liability_payments as p
  where p.liability_account_id = v_account_id and p.voided_at is null;

  update public.due_items as d
  set status = x.status,
      planned_on = case when x.status = 'paid' then null else d.planned_on end,
      planned_account_id = case when x.status = 'paid' then null else d.planned_account_id end
  from (
    select d2.id,
           case when v_owed <= 0 or sum(d2.amount_due_minor) over (order by d2.seq) <= v_repaid
                then 'paid' else 'pending' end as status
    from public.due_items as d2
    where d2.borrowing_id = p_borrowing_id
  ) as x
  where d.id = x.id and d.status <> x.status;
end;
$$;

-- Adds the due items of a borrowing's return plan (none without a return date), then syncs
-- their status. Callers set the write mark and remove old items first.
create function public.borrowing_insert_due(p_borrowing_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.due_items (kind, borrowing_id, seq, due_date, amount_due_minor, interest_minor, currency, pay_from_account_id)
  select 'borrowing_due', b.id, s.seq, s.due_date, s.amount_minor, s.interest_minor, b.currency, b.repay_from_account_id
  from public.borrowings as b
  cross join lateral public.borrowing_schedule(
    b.amount_to_return_minor, b.amount_to_return_minor - b.borrowed_minor, b.return_on, b.return_plan, b.instalment_count
  ) as s
  where b.id = p_borrowing_id and b.return_on is not null;
  perform public.borrowing_sync_due(p_borrowing_id);
end;
$$;

-- What is left of each borrowing due item, for the Pay form: repayments cover items in seq
-- order (as borrowing_sync_due); within an item they cover interest first. The principal
-- left is capped at what is owed now.
create view public.borrowing_due_progress
with (security_invoker = true)
as
with repaid as (
  select b.id as borrowing_id, b.account_id,
         coalesce((select sum(p.principal_minor + p.interest_minor) from public.liability_payments as p
                   where p.liability_account_id = b.account_id and p.voided_at is null), 0) as repaid_minor
  from public.borrowings as b
),
items as (
  select d.id, d.user_id, d.borrowing_id, d.seq, d.status, d.amount_due_minor, d.interest_minor, r.account_id,
         case when d.status = 'paid' then 0
              else least(d.amount_due_minor,
                         greatest(sum(d.amount_due_minor) over (partition by d.borrowing_id order by d.seq) - r.repaid_minor, 0))
         end as remaining_minor
  from public.due_items as d
  join repaid as r on r.borrowing_id = d.borrowing_id
)
select i.id as due_item_id, i.user_id, i.borrowing_id, i.seq, i.remaining_minor,
       i.interest_minor - least(i.interest_minor, i.amount_due_minor - i.remaining_minor) as remaining_interest_minor,
       least(i.remaining_minor - (i.interest_minor - least(i.interest_minor, i.amount_due_minor - i.remaining_minor)),
             greatest(public.liability_owed(i.account_id), 0)) as remaining_principal_minor
from items as i;

-- ---------------------------------------------------------------------------
-- Borrowing functions (replace the 8b create / update / set due date)
-- ---------------------------------------------------------------------------

drop function public.create_borrowing(uuid, text, bigint, uuid, date, date);
drop function public.update_borrowing(uuid, text);
drop function public.set_borrowing_due_date(uuid, date);

-- Adds a borrowing once per request key. Received: as 8b (into an account on a date, or
-- earlier: only what is owed is recorded). p_amount_to_return_minor null = same as borrowed.
-- With p_return_on, a return plan (once, or 2–60 monthly instalments) from p_pay_from_account_id.
create function public.create_borrowing(
  p_idempotency_key uuid,
  p_lender text,
  p_amount_minor bigint,
  p_relationship text,
  p_reason text default null,
  p_amount_to_return_minor bigint default null,
  p_received_account_id uuid default null,
  p_received_on date default null,
  p_return_on date default null,
  p_return_plan text default null,
  p_instalment_count integer default null,
  p_pay_from_account_id uuid default null
)
returns public.borrowings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_lender text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_lender, ''), '\s+', ' ', 'g'));
  v_reason text := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), '');
  v_to_return bigint := coalesce(p_amount_to_return_minor, p_amount_minor);
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
    if (v_borrowing.lender, v_borrowing.relationship, v_borrowing.reason, v_borrowing.borrowed_minor,
        v_borrowing.amount_to_return_minor, v_borrowing.received_on, v_borrowing.return_on, v_borrowing.return_plan,
        v_borrowing.instalment_count, v_borrowing.repay_from_account_id)
       is distinct from
       (v_lender, p_relationship, v_reason, p_amount_minor, v_to_return, p_received_on, p_return_on, p_return_plan,
        p_instalment_count, p_pay_from_account_id) then
      raise exception 'This request key was already used for a different borrowing' using errcode = 'FC007';
    end if;
    return v_borrowing;
  end if;

  if p_relationship is null then
    raise exception 'Choose who it is from: family, friends or others' using errcode = '22023';
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

  perform public.borrowing_check_plan(v_uid, v_currency, p_amount_minor, v_to_return, p_return_on, p_return_plan,
                                      p_instalment_count, p_pay_from_account_id);
  if p_return_on is not null and p_return_on < v_open_on then
    raise exception 'The return date is before the money was borrowed' using errcode = 'FC051';
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

  insert into public.borrowings (
    account_id, lender, relationship, reason, currency, borrowed_minor, amount_to_return_minor, received_on,
    receipt_transaction_id, return_on, return_plan, instalment_count, repay_from_account_id, idempotency_key
  ) values (
    v_account.id, v_lender, p_relationship, v_reason, v_currency, p_amount_minor, v_to_return, p_received_on,
    v_tx.id, p_return_on, p_return_plan, p_instalment_count, p_pay_from_account_id, p_idempotency_key
  )
  returning * into v_borrowing;

  perform public.borrowing_insert_due(v_borrowing.id);

  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_borrowing;
end;
$$;

-- Who it is from, relationship and reason (the account is renamed with the lender).
create function public.update_borrowing(p_borrowing_id uuid, p_lender text, p_relationship text, p_reason text default null)
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
  if p_relationship is null then
    raise exception 'Choose who it is from: family, friends or others' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.borrowings as b
  set lender = p_lender, relationship = p_relationship, reason = p_reason
  where b.id = v_borrowing.id
  returning * into v_borrowing;
  update public.accounts as a set name = pg_catalog.left(v_borrowing.lender, 80) where a.id = v_borrowing.account_id;
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_borrowing;
end;
$$;

-- Sets how much to return and the return plan, or removes the plan (p_return_on null): the
-- due items are rebuilt (pending "Will pay later" plans are dropped) and their status comes
-- from the repayments so far. A new return date can't be in the past; an unchanged one may be.
-- SECURITY DEFINER because rebuilding deletes due items (clients can't delete them); it acts
-- only on the caller's own borrowing, locked for the rebuild.
create function public.set_borrowing_return_plan(
  p_borrowing_id uuid,
  p_amount_to_return_minor bigint,
  p_return_on date default null,
  p_return_plan text default null,
  p_instalment_count integer default null,
  p_pay_from_account_id uuid default null
)
returns public.borrowings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_borrowing public.borrowings;
  v_open_on date;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into v_borrowing from public.borrowings as b
  where b.id = p_borrowing_id and b.user_id = v_uid
  for update;
  if v_borrowing.id is null then
    raise exception 'Borrowing not found' using errcode = 'FC008';
  end if;
  if v_borrowing.archived_at is not null then
    raise exception 'Borrowing is archived' using errcode = 'FC048';
  end if;

  perform public.borrowing_check_plan(v_uid, v_borrowing.currency, v_borrowing.borrowed_minor, p_amount_to_return_minor,
                                      p_return_on, p_return_plan, p_instalment_count, p_pay_from_account_id);
  select a.opening_balance_date into v_open_on from public.accounts as a where a.id = v_borrowing.account_id;
  if p_return_on is not null and p_return_on < v_open_on then
    raise exception 'The return date is before the money was borrowed' using errcode = 'FC051';
  end if;
  if p_return_on is distinct from v_borrowing.return_on and p_return_on < public.user_local_today(v_uid) then
    raise exception 'The return date can''t be in the past' using errcode = 'FC041';
  end if;

  perform pg_catalog.set_config('fin_creador.loan_write', 'on', true);
  update public.borrowings as b
  set amount_to_return_minor = p_amount_to_return_minor, return_on = p_return_on, return_plan = p_return_plan,
      instalment_count = p_instalment_count, repay_from_account_id = p_pay_from_account_id
  where b.id = v_borrowing.id
  returning * into v_borrowing;
  delete from public.due_items as d where d.borrowing_id = v_borrowing.id;
  perform public.borrowing_insert_due(v_borrowing.id);
  perform pg_catalog.set_config('fin_creador.loan_write', '', true);
  return v_borrowing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- has_digit and card_account_name keep the default EXECUTE for everyone: CHECK constraints and
-- the card functions call them for any role, and they reveal nothing. borrowing_schedule too
-- (pure arithmetic).
revoke execute on function public.create_card(uuid, text, bigint, integer, integer, bigint, text, text, boolean) from public, anon;
revoke execute on function public.update_card(uuid, text, bigint, integer, integer, text, text, boolean) from public, anon;
revoke execute on function public.borrowing_check_plan(uuid, text, bigint, bigint, date, text, integer, uuid) from public, anon;
revoke execute on function public.borrowing_insert_due(uuid) from public, anon;
revoke execute on function public.create_borrowing(uuid, text, bigint, text, text, bigint, uuid, date, date, text, integer, uuid) from public, anon;
revoke execute on function public.update_borrowing(uuid, text, text, text) from public, anon;
revoke execute on function public.set_borrowing_return_plan(uuid, bigint, date, text, integer, uuid) from public, anon;

-- Helpers called from the invoker functions, so the caller needs EXECUTE. borrowing_insert_due
-- writes only under the write mark (due_items_guard).
grant execute on function public.borrowing_check_plan(uuid, text, bigint, bigint, date, text, integer, uuid) to authenticated;
grant execute on function public.borrowing_insert_due(uuid) to authenticated;
grant execute on function public.create_card(uuid, text, bigint, integer, integer, bigint, text, text, boolean) to authenticated;
grant execute on function public.update_card(uuid, text, bigint, integer, integer, text, text, boolean) to authenticated;
grant execute on function public.create_borrowing(uuid, text, bigint, text, text, bigint, uuid, date, date, text, integer, uuid) to authenticated;
grant execute on function public.update_borrowing(uuid, text, text, text) to authenticated;
grant execute on function public.set_borrowing_return_plan(uuid, bigint, date, text, integer, uuid) to authenticated;

revoke all on table public.borrowing_due_progress from anon, authenticated;
grant select on table public.borrowing_due_progress to authenticated;

-- The invoker functions write with the caller's grants; the guards refuse the same writes
-- made directly. (Table-level SELECT already covers the new columns.)
grant insert (product, product_other) on table public.credit_cards to authenticated;
grant update (product, product_other) on table public.credit_cards to authenticated;
grant insert (relationship, reason, amount_to_return_minor, return_on, return_plan, instalment_count, repay_from_account_id)
  on table public.borrowings to authenticated;
grant update (relationship, reason) on table public.borrowings to authenticated;
grant insert (interest_minor, pay_from_account_id) on table public.due_items to authenticated;
