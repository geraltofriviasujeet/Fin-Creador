-- Sprint 9e: move an account's opening date back to take a statement's earlier payments.
-- Owner plan and additions 2026-11-16.
--
-- A statement can hold payments dated before an account's opening balance date. The import
-- skips them today ("before the account's opening balance date"). move_account_opening adds
-- them and moves the opening back, in one transaction, so the balance today and on every date
-- on or after the old opening date is unchanged:
--   new opening date   = the earliest payment added
--   new opening amount = old opening amount - the net of every live entry on the account dated
--                        from the new opening date to the day before the old one (the payments
--                        added, and any entry saved earlier that the old date left out)
-- Earlier days get a balance they didn't have; it is approximate, since only the statement's
-- payments are known for them (the review says so before the person agrees).
--
--   * One call per account, SECURITY INVOKER (RLS applies), with a request key: a retry of a
--     saved move returns it and adds nothing (the account row is locked first, so a
--     simultaneous retry waits, then finds it).
--   * Entries go through record_transaction (each with its own request key) and must each
--     touch the account and be dated before its opening date.
--   * Only an active bank, cash or other account (FC001 archived, FC063 any other kind).
--   * A cash or other account can't open below zero (accounts_opening_balance_sign, FC064); a
--     bank account can (an overdraft). Kept as it is, one rule for every opening amount.
--   * A transfer whose other account opens after the transfer's date is refused (FC065); the
--     app leaves those payments out and counts them.
--   * accounts_validate (replaced) lets this one change through its as-of date lock (FC011),
--     marked by a transaction-local setting that the API can't reach, as set_cash_on_hand does.
--   * A self-check: the balance on the old opening date and today, read through
--     account_balances_at before and after the change, must be identical, or the call raises
--     (FC067) and nothing is saved. It guards against this function's sign rule and
--     account_balances_at's drifting apart.
--   * account_opening_moves keeps a trace of every move (old and new date and amount, entries
--     added and counted, when), written only by the function in the same transaction, never
--     changed, readable by its owner only.
--
-- New error codes:
--   FC063 the opening date of this kind of account can't move   FC064 cash or other below zero
--   FC065 a transfer's other account opens after its date       FC066 written only by move_account_opening
--   FC067 the balance self-check failed

-- ---------------------------------------------------------------------------
-- accounts_validate: + the move_account_opening exception to the as-of date lock.
-- Everything else is unchanged from 20261022190000.
-- ---------------------------------------------------------------------------

create or replace function public.accounts_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_has_entries boolean;
  v_cash_on_hand boolean;
  v_opening_move boolean;
begin
  -- Only a new or changed date is checked, so edits and archiving keep working after the
  -- user's time zone changes.
  if (tg_op = 'INSERT' or new.opening_balance_date is distinct from old.opening_balance_date)
     and new.opening_balance_date > public.user_local_today(new.user_id) then
    raise exception 'Opening balance date cannot be in the future' using errcode = 'FC003';
  end if;

  -- One active cash account per user: on create, and when an archived one is restored.
  -- The per-user advisory lock makes two simultaneous creations safe.
  if new.kind = 'cash' and new.archived_at is null
     and (tg_op = 'INSERT' or old.archived_at is not null) then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));
    if exists (
      select 1 from public.accounts as a
      where a.user_id = new.user_id and a.kind = 'cash' and a.archived_at is null and a.id <> new.id
    ) then
      raise exception 'You already have a cash account' using errcode = 'FC012';
    end if;
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
    -- entries exist. The exceptions mark their own update (transaction-local settings, not
    -- reachable through the API): set_cash_on_hand() may move a cash account's as-of date to
    -- today; move_account_opening() may move an account's as-of date earlier.
    v_cash_on_hand := pg_catalog.current_setting('fin_creador.cash_on_hand', true) = old.id::text
      and new.kind = 'cash'
      and new.opening_balance_date = public.user_local_today(new.user_id);
    v_opening_move := pg_catalog.current_setting('fin_creador.opening_move', true) = old.id::text
      and new.opening_balance_date < old.opening_balance_date;
    if new.opening_balance_date <> old.opening_balance_date and v_has_entries and not v_cash_on_hand and not v_opening_move then
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

-- ---------------------------------------------------------------------------
-- account_opening_moves: the trace of every move
-- ---------------------------------------------------------------------------

create table public.account_opening_moves (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id         uuid not null,
  request_key        uuid not null,
  old_opening_date   date not null,
  new_opening_date   date not null,
  old_opening_minor  bigint not null,
  new_opening_minor  bigint not null,
  -- Entries this move saved, and every live entry now counted between the two dates (those
  -- added plus any saved earlier that the old date left out).
  entries_added      integer not null,
  entries_counted    integer not null,
  created_at         timestamptz not null default now(),

  constraint account_opening_moves_request_unique unique (user_id, request_key),
  constraint account_opening_moves_account_owned
    foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  constraint account_opening_moves_dates check (new_opening_date < old_opening_date and new_opening_date >= date '1970-01-01'),
  constraint account_opening_moves_amounts check (
    old_opening_minor between -10000000000000 and 10000000000000
    and new_opening_minor between -10000000000000 and 10000000000000
  ),
  constraint account_opening_moves_counts check (entries_added between 0 and 3000 and entries_counted between entries_added and 100000)
);

create index account_opening_moves_account_idx on public.account_opening_moves (account_id, created_at);

comment on table public.account_opening_moves is
  'Every move of an account''s opening date back (move_account_opening): old and new date and amount, entries added and counted. Written in the same transaction; never changed.';

-- Written only by move_account_opening; never changed.
create function public.account_opening_moves_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'An opening move can''t change' using errcode = 'FC009';
  end if;
  if pg_catalog.current_setting('fin_creador.opening_move', true) is distinct from new.account_id::text then
    raise exception 'Opening dates move only through move_account_opening' using errcode = 'FC066';
  end if;
  new.created_at := pg_catalog.now();
  return new;
end;
$$;

create trigger account_opening_moves_guard
  before insert or update on public.account_opening_moves
  for each row execute function public.account_opening_moves_guard();

revoke all on table public.account_opening_moves from anon, authenticated;
grant select on table public.account_opening_moves to authenticated;
grant insert (account_id, request_key, old_opening_date, new_opening_date, old_opening_minor, new_opening_minor, entries_added, entries_counted)
  on table public.account_opening_moves to authenticated;

alter table public.account_opening_moves enable row level security;

create policy account_opening_moves_select_own on public.account_opening_moves
  for select to authenticated using ((select auth.uid()) = user_id);
create policy account_opening_moves_insert_own on public.account_opening_moves
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- move_account_opening
-- ---------------------------------------------------------------------------

-- The account's balance on p_day and today, as account_balances_at gives them (null for a day
-- it doesn't count). For move_account_opening's self-check.
create function public.account_balance_check(p_account_id uuid, p_day date)
returns bigint[]
language sql
stable
security invoker
set search_path = ''
as $$
  select array[
    (select b.balance_minor from public.account_balances_at(array[p_day]) as b where b.account_id = p_account_id),
    (select b.balance_minor from public.account_balances_at(array[public.user_local_today((select auth.uid()))]) as b where b.account_id = p_account_id)
  ];
$$;

-- p_entries: a JSON array (1 to 3,000) of
--   { "key": uuid, "type": "expense" | "income" | "refund" | "transfer", "amount_minor": n,
--     "occurred_on": "yyyy-mm-dd", "account_id": uuid, "counter_account_id": uuid | null,
--     "category_id": uuid | null, "note": text | null }
-- each dated before the account's opening date and touching it (its account, or a transfer's
-- other side). Returns the move. Everything or nothing.
create function public.move_account_opening(p_request_key uuid, p_account_id uuid, p_entries jsonb)
returns public.account_opening_moves
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_account public.accounts;
  v_move public.account_opening_moves;
  v_entry jsonb;
  v_row public.transactions;
  v_new_date date;
  v_net bigint;
  v_counted integer;
  v_added integer := 0;
  v_new_minor numeric;
  v_before bigint[];
  v_after bigint[];
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_request_key is null or p_account_id is null or p_entries is null
     or pg_catalog.jsonb_typeof(p_entries) <> 'array'
     or pg_catalog.jsonb_array_length(p_entries) not between 1 and 3000 then
    raise exception 'From 1 to 3,000 entries' using errcode = '22023';
  end if;

  -- The lock first: a simultaneous retry waits here, then finds the saved move.
  select * into v_account from public.accounts as a where a.id = p_account_id for update;
  if v_account.id is null then
    raise exception 'Account not found' using errcode = 'FC010';
  end if;

  select * into v_move from public.account_opening_moves as m where m.user_id = v_uid and m.request_key = p_request_key;
  if v_move.id is not null then
    if v_move.account_id <> p_account_id then
      raise exception 'This request key was already used for a different change' using errcode = 'FC007';
    end if;
    return v_move;
  end if;

  if v_account.archived_at is not null then
    raise exception 'This account is archived' using errcode = 'FC001';
  end if;
  if v_account.kind not in ('bank', 'cash', 'other') then
    raise exception 'Only a bank, cash or other account''s opening date can move' using errcode = 'FC063';
  end if;

  -- Every entry: well formed, before the opening date, touching this account; a transfer's
  -- other account already open on its date.
  for v_entry in select e from pg_catalog.jsonb_array_elements(p_entries) as e loop
    if pg_catalog.jsonb_typeof(v_entry) <> 'object'
       or (v_entry->>'occurred_on') is null or (v_entry->>'occurred_on') !~ '^\d{4}-\d{2}-\d{2}$'
       or (v_entry->>'account_id') is null or (v_entry->>'key') is null then
      raise exception 'Each entry needs a key, a date and an account' using errcode = '22023';
    end if;
    if (v_entry->>'occurred_on')::date >= v_account.opening_balance_date then
      raise exception 'Only entries before the opening date' using errcode = '22023';
    end if;
    if not ((v_entry->>'account_id')::uuid = p_account_id
            or (v_entry->>'type' = 'transfer' and (v_entry->>'counter_account_id')::uuid = p_account_id)) then
      raise exception 'Each entry must be on this account' using errcode = '22023';
    end if;
    if v_entry->>'type' = 'transfer' and exists (
      select 1 from public.accounts as o
      where o.id = case when (v_entry->>'account_id')::uuid = p_account_id
                        then (v_entry->>'counter_account_id')::uuid else (v_entry->>'account_id')::uuid end
        and o.opening_balance_date > (v_entry->>'occurred_on')::date
    ) then
      raise exception 'The transfer''s other account opens after its date' using errcode = 'FC065';
    end if;
  end loop;

  select min((e->>'occurred_on')::date) into v_new_date from pg_catalog.jsonb_array_elements(p_entries) as e;
  if v_new_date < date '1970-01-01' then
    raise exception 'Dates from 1970' using errcode = '22023';
  end if;

  v_before := public.account_balance_check(p_account_id, v_account.opening_balance_date);
  perform pg_catalog.set_config('fin_creador.opening_move', p_account_id::text, true);

  for v_entry in select e from pg_catalog.jsonb_array_elements(p_entries) as e loop
    -- Saved by this call unless its key was used before (record_transaction then returns that row).
    if not exists (select 1 from public.transactions as t where t.user_id = v_uid and t.idempotency_key = (v_entry->>'key')::uuid) then
      v_added := v_added + 1;
    end if;
    v_row := public.record_transaction(
      p_type => v_entry->>'type',
      p_idempotency_key => (v_entry->>'key')::uuid,
      p_amount_minor => (v_entry->>'amount_minor')::bigint,
      p_occurred_on => (v_entry->>'occurred_on')::date,
      p_account_id => (v_entry->>'account_id')::uuid,
      p_category_id => (v_entry->>'category_id')::uuid,
      p_counter_account_id => (v_entry->>'counter_account_id')::uuid,
      p_note => v_entry->>'note'
    );
  end loop;

  -- The net the new dates bring in, signed as account_balances_at counts it.
  select
    coalesce(sum(case
      when t.type in ('income', 'refund') or (t.type = 'transfer' and t.counter_account_id = p_account_id) then t.amount_minor
      else -t.amount_minor end), 0),
    count(*)::integer
  into v_net, v_counted
  from public.transactions as t
  where (t.account_id = p_account_id or t.counter_account_id = p_account_id)
    and t.voided_at is null
    and t.occurred_on >= v_new_date
    and t.occurred_on < v_account.opening_balance_date;

  v_new_minor := v_account.opening_balance_minor::numeric - v_net;
  if v_account.kind in ('cash', 'other') and v_new_minor < 0 then
    raise exception 'A cash or other account can''t open below zero' using errcode = 'FC064';
  end if;
  if v_new_minor not between -10000000000000 and 10000000000000 then
    raise exception 'Amount out of range' using errcode = '22003';
  end if;

  update public.accounts as a
     set opening_balance_date = v_new_date,
         opening_balance_minor = v_new_minor::bigint
   where a.id = p_account_id;

  v_after := public.account_balance_check(p_account_id, v_account.opening_balance_date);
  if v_after is distinct from v_before then
    raise exception 'The balance would change; nothing was saved' using errcode = 'FC067';
  end if;

  insert into public.account_opening_moves (
    account_id, request_key, old_opening_date, new_opening_date, old_opening_minor, new_opening_minor, entries_added, entries_counted
  ) values (
    p_account_id, p_request_key, v_account.opening_balance_date, v_new_date, v_account.opening_balance_minor, v_new_minor::bigint, v_added, v_counted
  )
  returning * into v_move;

  perform pg_catalog.set_config('fin_creador.opening_move', '', true);
  return v_move;
end;
$$;

comment on function public.move_account_opening(uuid, uuid, jsonb) is
  'Adds entries dated before an account''s opening date and moves the opening back to the earliest, the opening amount less their net, so the balance on and after the old date is unchanged. Once per request key; records account_opening_moves.';

revoke execute on function public.account_opening_moves_guard() from public, anon, authenticated;
revoke execute on function public.account_balance_check(uuid, date) from public, anon;
grant execute on function public.account_balance_check(uuid, date) to authenticated;
revoke execute on function public.move_account_opening(uuid, uuid, jsonb) from public, anon;
grant execute on function public.move_account_opening(uuid, uuid, jsonb) to authenticated;
