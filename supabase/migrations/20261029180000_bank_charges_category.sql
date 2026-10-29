-- Sprint 9a: the system expense category "Bank charges & interest" (system_key bank_charges).
-- Card statement import posts fee, interest and GST lines to it, and Enter statement's
-- difference picker will default to it. Every user gets it: new users with the defaults (the
-- sign-up hook and the lazy fallback both run ensure_default_expense_categories), existing users
-- through the backfill at the end. A user's own expense category of that name takes the key
-- instead of getting a duplicate (an active one first, else the latest archived one, restored).
-- Idempotent: running the backfill again creates and changes nothing. Like the loan categories
-- it can be renamed, not archived (categories_system_guard, FC042, whose message is now generic).
--
-- The adopt-or-create step of loan_category_id moves into system_category_id(user, key), so the
-- defaults can run it for any user; loan_category_id keeps its signature and behaviour.
-- No new error codes. Nothing else changes.

-- ---------------------------------------------------------------------------
-- Categories: the bank_charges key
-- ---------------------------------------------------------------------------

alter table public.categories drop constraint categories_system_key;
alter table public.categories add constraint categories_system_key check (
  system_key is null or (kind = 'expense' and system_key in (
    'loan_interest', 'loan_fees', 'taxes', 'fines_penalties', 'bank_charges'
  ))
);

comment on column public.categories.system_key is
  'Set on the categories the app posts to itself (loan_interest, loan_fees, taxes, fines_penalties, bank_charges). They can be renamed, not archived.';

-- Replaces the 8a version: unchanged, except the FC042 message now fits every system category.
create or replace function public.categories_system_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.system_key is distinct from old.system_key and old.system_key is not null then
    raise exception 'A category''s identity can''t change' using errcode = 'FC009';
  end if;
  if old.system_key is not null and new.archived_at is not null and old.archived_at is null then
    raise exception 'This category is used by the app and can''t be archived' using errcode = 'FC042';
  end if;
  return new;
end;
$$;

-- A user's category for a system key, never null: an existing one; else an expense category
-- with the same name (an active one, or else the latest archived one, which is restored),
-- adopted; else a new one. SECURITY DEFINER because system_key is not client-writable; callable
-- only from other functions (no grant), which pass the user id.
create function public.system_category_id(p_user_id uuid, p_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_id uuid;
begin
  if p_user_id is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  v_name := case p_key
              when 'loan_interest' then 'Loan interest'
              when 'loan_fees' then 'Loan fees & charges'
              when 'taxes' then 'Taxes'
              when 'fines_penalties' then 'Fines & penalties'
              when 'bank_charges' then 'Bank charges & interest'
            end;
  if v_name is null then
    raise exception 'Unknown category key' using errcode = '22023';
  end if;
  -- One caller at a time per user here (same lock as before), so adoption and creation can't race.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('loan_category:' || p_user_id::text, 0));

  select c.id into v_id from public.categories as c where c.user_id = p_user_id and c.system_key = p_key;
  if v_id is not null then
    return v_id;
  end if;

  -- Adopt a same-name expense category: an active one first, else the latest archived one
  -- (restored; no active one has the name, so the unique active-name index allows it).
  select c.id into v_id from public.categories as c
  where c.user_id = p_user_id and c.kind = 'expense' and c.system_key is null
    and pg_catalog.lower(pg_catalog.btrim(c.name)) = pg_catalog.lower(v_name)
  order by (c.archived_at is null) desc, c.archived_at desc nulls first, c.created_at desc
  limit 1;
  if v_id is not null then
    update public.categories as c set system_key = p_key, archived_at = null where c.id = v_id;
    return v_id;
  end if;

  insert into public.categories (user_id, kind, name, icon, is_default, system_key)
  values (p_user_id, 'expense', v_name, 'bills', true, p_key)
  returning id into v_id;
  return v_id;
end;
$$;

-- Replaces the 8d version: the same, for the caller, through system_category_id.
create or replace function public.loan_category_id(p_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return public.system_category_id(v_uid, p_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- Default expense categories: Bank charges & interest for everyone
-- ---------------------------------------------------------------------------

-- Replaces the Sprint 4 version (migration 20261024120000): unchanged, plus the bank_charges
-- system category for every user who doesn't have it yet (adopted by name, as above).
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

  for d in
    select * from (values ('membership', 'Membership'), ('subscription', 'Subscription')) as v (key, name)
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
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.system_category_id(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill existing users (idempotent: running it again creates nothing)
-- ---------------------------------------------------------------------------

select public.backfill_default_expense_categories();
