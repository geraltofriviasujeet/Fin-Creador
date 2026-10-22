-- Sprint 2: one cash account per user, and "Update cash in hand".
--
-- Decision 2026-10-22 (owner, option A): each user has at most one ACTIVE cash account
-- ("Cash in hand"). Telling the app how much cash you have now is a correction, not
-- income: set_cash_on_hand() moves that account's as-of date to today and sets the opening
-- amount so the balance equals what the person holds. Income entries are never changed.
-- Cash received as income is recorded with record_income into the cash account; ATM
-- withdrawals become transfers in Sprint 3.
--
-- Enforced by a trigger, not a unique index, so existing duplicate cash accounts (created
-- before this rule) do not make the migration fail; their owners archive the extras.
--
-- New error codes:
--   FC012 a second active cash account     FC013 not an active cash account

-- ---------------------------------------------------------------------------
-- accounts_validate: + one active cash account per user, + the cash-on-hand exception
-- to the as-of date lock. Everything else is unchanged from 20261022150000.
-- ---------------------------------------------------------------------------

create or replace function public.accounts_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_has_entries boolean;
  v_cash_on_hand boolean;
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
    -- entries exist. The only exception is set_cash_on_hand(), which marks its own update
    -- (transaction-local setting, not reachable through the API) and may move a cash
    -- account's as-of date to today.
    v_cash_on_hand := pg_catalog.current_setting('fin_creador.cash_on_hand', true) = old.id::text
      and new.kind = 'cash'
      and new.opening_balance_date = public.user_local_today(new.user_id);
    if new.opening_balance_date <> old.opening_balance_date and v_has_entries and not v_cash_on_hand then
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
-- set_cash_on_hand: "I have this much cash now"
-- ---------------------------------------------------------------------------

-- Sets the caller's cash account so its balance today equals p_amount_minor: the as-of
-- date becomes today and the opening amount is p_amount_minor minus today's posted
-- entries (they are already in the cash the person holds). Earlier entries keep counting
-- as income but are now inside the opening figure. SECURITY INVOKER: RLS applies.
create function public.set_cash_on_hand(p_account_id uuid, p_amount_minor bigint)
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
           when t.type = 'income' or (t.type = 'transfer' and t.counter_account_id = v_account.id) then t.amount_minor
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

revoke execute on function public.set_cash_on_hand(uuid, bigint) from public, anon;
grant execute on function public.set_cash_on_hand(uuid, bigint) to authenticated;
