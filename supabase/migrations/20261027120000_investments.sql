-- Sprint 7: investments, a holdings tracker (not trading, no ledger).
--
-- Rules (docs/sprint-plan.md, Sprint 7 decisions 2026-10-27):
--   * instruments: shared list of BSE shares / ETFs and AMFI mutual funds with the latest
--     price only (no history). Keyed by (source, source_code); the ISIN is a non-unique
--     attribute, null when the file has none. Clients can only read it; the refresh Edge
--     Function writes it with the service role. Rows are never deleted. An update with an
--     older price date keeps the stored price, a null ISIN keeps the stored one, and
--     source, code and kind never change.
--   * Prices and units are scaled integers with 4 decimals (123.4567 = 1234567). A price is
--     always above 0, so a missing or 0 NAV can never overwrite one.
--   * Search offers instruments whose price is at most 30 days old (in the person's time
--     zone); holdings stay visible whatever their instrument's price date.
--   * investments: one row per holding record (instrument, units, buy price per unit, buy
--     date); several per instrument. Not linked to accounts, not part of Total available,
--     INR only. Valuation and profit / loss are computed in packages/domain only, not here.
--   * The instrument, the ISIN saved at entry (isin_at_entry, set here) and the request key
--     never change. Records are edited in place, archived ("I no longer hold this") and
--     restored; an archived record changes only by being restored and can then be deleted
--     permanently. Nothing references a record, so deleting one changes no other data.
--
-- Errors: FC009 (field can't change), FC027 (holding archived), FC028 (buy date in the
-- future), FC029 (instrument not found).

-- ---------------------------------------------------------------------------
-- instruments
-- ---------------------------------------------------------------------------

create table public.instruments (
  id                uuid primary key default gen_random_uuid(),
  source            text not null,
  source_code       text not null,
  isin              text,
  symbol            text,
  name              text not null,
  kind              text not null,
  last_price_scaled bigint not null,
  price_date        date not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint instruments_source check (source in ('amfi', 'bse')),
  -- AMFI scheme code or BSE scrip code.
  constraint instruments_source_code_format check (source_code ~ '^[0-9]{1,12}$'),
  constraint instruments_source_unique unique (source, source_code),
  constraint instruments_isin_format check (isin is null or isin ~ '^IN[A-Z0-9]{9}[0-9]$'),
  -- BSE ticker; AMFI has none.
  constraint instruments_symbol_length check (symbol is null or char_length(symbol) between 1 and 40),
  constraint instruments_name_length check (char_length(btrim(name)) between 1 and 200),
  constraint instruments_kind check (
    (source = 'amfi' and kind = 'fund') or (source = 'bse' and kind in ('share', 'etf'))
  ),
  constraint instruments_price_range check (last_price_scaled > 0 and last_price_scaled <= 10000000000000),
  constraint instruments_price_date_range check (price_date between date '1990-01-01' and date '2199-12-31')
);

comment on table public.instruments is
  'Shared BSE shares / ETFs and AMFI funds with the latest close or NAV only. Read-only for clients; written by the refresh Edge Function (service role).';

-- Guards the refresh: an older file never replaces a newer price (other fields may still
-- update), a missing ISIN never erases a known one, and an instrument's identity is fixed.
create function public.instruments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.source, new.source_code, new.kind) is distinct from (old.source, old.source_code, old.kind) then
    raise exception 'An instrument''s source, code and kind can''t change' using errcode = 'FC009';
  end if;
  if new.price_date < old.price_date then
    new.last_price_scaled := old.last_price_scaled;
    new.price_date := old.price_date;
  end if;
  if new.isin is null then
    new.isin := old.isin;
  end if;
  return new;
end;
$$;

create trigger instruments_guard
  before update on public.instruments
  for each row execute function public.instruments_guard();

create trigger instruments_set_updated_at
  before update on public.instruments
  for each row execute function public.set_updated_at();

-- Instruments matching every word of the query (case-insensitive, literal: strpos, so % and
-- _ have no special meaning) in the name, or exactly a code, ISIN or ticker (ticker also by
-- prefix). Only prices at most 30 days old. Exact identifier matches first, then names that
-- start with the query. 2 to 100 characters; at most 50 rows.
create function public.search_instruments(p_query text, p_limit integer default 20)
returns setof public.instruments
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query text := pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')));
  v_words text[];
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_since date := public.user_local_today((select auth.uid())) - 30;
begin
  if pg_catalog.char_length(v_query) not between 2 and 100 then
    return;
  end if;
  v_words := pg_catalog.string_to_array(v_query, ' ');

  return query
    select i.*
    from public.instruments as i
    where i.price_date >= v_since
      and (
        i.source_code = v_query
        or pg_catalog.lower(coalesce(i.isin, '')) = v_query
        or pg_catalog.strpos(pg_catalog.lower(coalesce(i.symbol, '')), v_query) = 1
        or not exists (
          select 1 from pg_catalog.unnest(v_words) as w(word)
          where pg_catalog.strpos(pg_catalog.lower(i.name), w.word) = 0
        )
      )
    order by
      (i.source_code = v_query
        or pg_catalog.lower(coalesce(i.isin, '')) = v_query
        or pg_catalog.lower(coalesce(i.symbol, '')) = v_query) desc,
      pg_catalog.strpos(pg_catalog.lower(i.name), v_query) = 1 desc,
      i.name,
      i.source,
      i.source_code
    limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- investments
-- ---------------------------------------------------------------------------

create table public.investments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Instruments are never deleted; RESTRICT keeps it that way for held ones.
  instrument_id    uuid not null references public.instruments (id) on delete restrict,
  units_scaled     bigint not null,
  buy_price_scaled bigint not null,
  buy_date         date not null,
  isin_at_entry    text,
  archived_at      timestamptz,
  idempotency_key  uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint investments_units_range check (units_scaled > 0 and units_scaled <= 10000000000000),
  -- 0 allowed (bonus or gifted units).
  constraint investments_buy_price_range check (buy_price_scaled >= 0 and buy_price_scaled <= 10000000000000),
  -- Invested (units × buy price) at most 10^13 paise: scaled product / 10^6 = paise.
  constraint investments_invested_cap check (units_scaled::numeric * buy_price_scaled <= 10000000000000000000),
  constraint investments_buy_date_range check (buy_date >= date '1900-01-01'),
  constraint investments_isin_format check (isin_at_entry is null or isin_at_entry ~ '^IN[A-Z0-9]{9}[0-9]$'),
  constraint investments_idempotency_unique unique (user_id, idempotency_key)
);

create index investments_user_idx on public.investments (user_id, instrument_id) where archived_at is null;
create index investments_instrument_idx on public.investments (instrument_id);

comment on table public.investments is
  'Holding records (instrument, units, buy price, buy date), not linked to accounts. Valued in packages/domain.';

create function public.investments_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_isin text;
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.user_id, new.instrument_id, new.isin_at_entry, new.idempotency_key, new.created_at)
       is distinct from
       (old.id, old.user_id, old.instrument_id, old.isin_at_entry, old.idempotency_key, old.created_at)
    then
      raise exception 'A holding''s instrument can''t change' using errcode = 'FC009';
    end if;
    -- An archived record changes only by being restored (and not edited in the same step).
    if old.archived_at is not null
       and (new.units_scaled, new.buy_price_scaled, new.buy_date)
           is distinct from
           (old.units_scaled, old.buy_price_scaled, old.buy_date)
    then
      raise exception 'Holding is archived' using errcode = 'FC027';
    end if;
    -- Archive stamps server time once; restore clears it.
    if old.archived_at is null and new.archived_at is not null then
      new.archived_at := pg_catalog.now();
    elsif old.archived_at is not null and new.archived_at is not null then
      new.archived_at := old.archived_at;
    end if;
    if new.buy_date is distinct from old.buy_date
       and new.buy_date > public.user_local_today(new.user_id) then
      raise exception 'The buy date can''t be in the future' using errcode = 'FC028';
    end if;
  else
    select i.isin into v_isin from public.instruments as i where i.id = new.instrument_id;
    if not found then
      raise exception 'Instrument not found' using errcode = 'FC029';
    end if;
    if new.buy_date > public.user_local_today(new.user_id) then
      raise exception 'The buy date can''t be in the future' using errcode = 'FC028';
    end if;
    new.isin_at_entry := v_isin;
    new.archived_at := null;
    new.created_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

create trigger investments_validate
  before insert or update on public.investments
  for each row execute function public.investments_validate();

create trigger investments_set_updated_at
  before update on public.investments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------

-- instruments: clients read; only the service role writes, and nobody deletes.
revoke all on table public.instruments from anon, authenticated, service_role;
grant select on table public.instruments to authenticated;
grant select, insert, update on table public.instruments to service_role;

revoke all on table public.investments from anon, authenticated;
grant select on table public.investments to authenticated;
grant insert (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
  on table public.investments to authenticated;
grant update (units_scaled, buy_price_scaled, buy_date, archived_at)
  on table public.investments to authenticated;
grant delete on table public.investments to authenticated;

alter table public.instruments enable row level security;
alter table public.investments enable row level security;

create policy instruments_select_authenticated on public.instruments
  for select to authenticated using (true);

create policy investments_select_own on public.investments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy investments_insert_own on public.investments
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy investments_update_own on public.investments
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Only the owner's archived records; an active or another person's record matches no row.
create policy investments_delete_own_archived on public.investments
  for delete to authenticated
  using ((select auth.uid()) = user_id and archived_at is not null);

revoke execute on function public.instruments_guard() from public, anon, authenticated;
revoke execute on function public.investments_validate() from public, anon, authenticated;
revoke execute on function public.search_instruments(text, integer) from public, anon;
grant execute on function public.search_instruments(text, integer) to authenticated;
