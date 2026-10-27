-- Sprint 7: fixed deposits, a per-user tracker like goals and holdings. INR only, not linked
-- to accounts or Total available. Values (maturity value, accrued value, interest, days left)
-- are computed in packages/domain (fixed-deposits.ts), never in SQL.
--
-- Error codes: FC030 archived fixed deposit changed; FC031 start date in the future (in the
-- owner's time zone). Identity changes reuse FC009.

create table public.fixed_deposits (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bank            text not null,
  -- Optional name the person gives it, e.g. "Emergency fund".
  label           text,
  principal_minor bigint not null,
  rate_bps        integer not null,
  compounding     text not null default 'quarterly',
  start_date      date not null,
  maturity_date   date not null,
  archived_at     timestamptz,
  idempotency_key uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint fixed_deposits_bank_length check (char_length(btrim(bank)) between 1 and 80),
  constraint fixed_deposits_label_length check (label is null or char_length(btrim(label)) between 1 and 40),
  constraint fixed_deposits_principal_range check (principal_minor > 0 and principal_minor <= 10000000000000),
  constraint fixed_deposits_rate_range check (rate_bps between 0 and 2500),
  constraint fixed_deposits_compounding check (compounding in ('monthly', 'quarterly', 'half_yearly', 'yearly')),
  constraint fixed_deposits_start_range check (start_date >= date '1900-01-01'),
  constraint fixed_deposits_maturity_after_start check (maturity_date > start_date),
  -- At most 10 years (date + interval clamps to the month end, like the domain).
  constraint fixed_deposits_tenure_max check (maturity_date <= (start_date + interval '10 years')::date),
  constraint fixed_deposits_idempotency_unique unique (user_id, idempotency_key)
);

create index fixed_deposits_user_idx on public.fixed_deposits (user_id, maturity_date) where archived_at is null;

comment on table public.fixed_deposits is
  'Fixed deposits (bank, label, principal, rate, compounding, dates), not linked to accounts. Valued in packages/domain.';

create function public.fixed_deposits_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.user_id, new.idempotency_key, new.created_at)
       is distinct from (old.id, old.user_id, old.idempotency_key, old.created_at)
    then
      raise exception 'A fixed deposit''s identity can''t change' using errcode = 'FC009';
    end if;
    -- An archived deposit changes only by being restored (and not edited in the same step).
    if old.archived_at is not null
       and (new.bank, new.label, new.principal_minor, new.rate_bps, new.compounding, new.start_date, new.maturity_date)
           is distinct from
           (old.bank, old.label, old.principal_minor, old.rate_bps, old.compounding, old.start_date, old.maturity_date)
    then
      raise exception 'Fixed deposit is archived' using errcode = 'FC030';
    end if;
    -- Archive stamps server time once; restore clears it.
    if old.archived_at is null and new.archived_at is not null then
      new.archived_at := pg_catalog.now();
    elsif old.archived_at is not null and new.archived_at is not null then
      new.archived_at := old.archived_at;
    end if;
    if new.start_date is distinct from old.start_date
       and new.start_date > public.user_local_today(new.user_id) then
      raise exception 'The start date can''t be in the future' using errcode = 'FC031';
    end if;
  else
    if new.start_date > public.user_local_today(new.user_id) then
      raise exception 'The start date can''t be in the future' using errcode = 'FC031';
    end if;
    new.archived_at := null;
    new.created_at := pg_catalog.now();
  end if;
  -- Runs after the archived check above: an archived row's stored values are already normalised.
  new.bank := pg_catalog.btrim(pg_catalog.regexp_replace(new.bank, '\s+', ' ', 'g'));
  -- A blank label is no label.
  new.label := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(new.label, '\s+', ' ', 'g')), '');
  return new;
end;
$$;

create trigger fixed_deposits_validate
  before insert or update on public.fixed_deposits
  for each row execute function public.fixed_deposits_validate();

create trigger fixed_deposits_set_updated_at
  before update on public.fixed_deposits
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------

revoke all on table public.fixed_deposits from anon, authenticated;
grant select on table public.fixed_deposits to authenticated;
grant insert (bank, label, principal_minor, rate_bps, compounding, start_date, maturity_date, idempotency_key)
  on table public.fixed_deposits to authenticated;
-- Edit in place; archive / restore through archived_at.
grant update (bank, label, principal_minor, rate_bps, compounding, start_date, maturity_date, archived_at)
  on table public.fixed_deposits to authenticated;
grant delete on table public.fixed_deposits to authenticated;

alter table public.fixed_deposits enable row level security;

create policy fixed_deposits_select_own on public.fixed_deposits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy fixed_deposits_insert_own on public.fixed_deposits
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy fixed_deposits_update_own on public.fixed_deposits
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Only the owner's archived deposits; an active or another person's deposit matches no row.
create policy fixed_deposits_delete_own_archived on public.fixed_deposits
  for delete to authenticated
  using ((select auth.uid()) = user_id and archived_at is not null);

revoke execute on function public.fixed_deposits_validate() from public, anon, authenticated;
