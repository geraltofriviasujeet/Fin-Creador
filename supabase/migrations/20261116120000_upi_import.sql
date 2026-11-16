-- Sprint 9e: UPI app statement import (Paytm, PhonePe, BHIM, Google Pay). Owner plan and
-- answers 2026-11-16. The statement is read in the browser; nothing here sees the file.
--
-- 1. Default expense categories.
--    * Renamed for people who have not renamed them: "Other expenses" → "Miscellaneous",
--      "Health" → "Medical", "Transport" → "Transport & Cabs". Only a default row (is_default,
--      no key, no system_key) still carrying the seeded name and icon exactly. An active row is
--      left as it is when the person already has another active category of the new name (the
--      one-active-name index would refuse it; the app then finds the category by its icon).
--      Icons don't change, so code that finds a default by icon (trip check: icon travel;
--      statement review: icon other from this sprint) is unaffected. New users get the new names.
--    * "Services" and "Money sent to people": two more keyed defaults (services, money_sent),
--      added exactly as Gift and Fuel were (20261115180000): adopted by name, else created,
--      backfilled for everyone; renamable and archivable. Idempotent.
--
-- 2. upi_account_matches: which FinCreador account a statement's bank account is, remembered
--    per person and app. Only the bank name as printed (normalised) and the last 2 to 4 digits,
--    as the readers already mask; never a full number. One row per person also records the
--    Google Pay UPI Lite choice: an account (payments from Lite post from it; top-ups are
--    transfers into it), or none (declined: Lite payments post from the linked bank, top-ups
--    are skipped).
--
-- 3. Payee categories from the person's own history: payee_last_categories returns, for each
--    payee name asked, the category of the person's latest live expense whose description is
--    that name (normalised). Invoker, so RLS applies. No new table.
--
-- 4. Consent for sending payee names to the model: profiles.import_payees_ok_at, separate from
--    Roma's roma_descriptions_ok_at, and Roma need not be on. Written only through
--    set_import_payees_consent (true → now() from the database, false → null). Settings
--    withdraws it.
--
-- 5. Spend for import categories goes through Roma's kill switch and caps without reusing
--    roma_usage. Its rows live in import_category_usage, so an import reservation is never a
--    Roma question: roma_search_begin, roma_knowledge_embed and roma_record_turn look only in
--    roma_usage and keep refusing anything else, unchanged.
--      * import_categories_begin: the same lock, kill switch (roma_settings.enabled, plus
--        import_enabled for imports alone) and monthly caps (global and per person, counting
--        both ledgers) as roma_begin_request; consent (import_payees_ok_at) in place of the Roma
--        opt-in; its own daily limit (import_user_daily_calls, one call per batch of payees).
--        Reserves roma_settings.reserve_usd per call; a refusal writes nothing.
--      * roma_begin_request is replaced only to count import spend in the two monthly caps.
--        Roma's opt-in, kill switch and daily question limit are unchanged, and import calls
--        don't use up Roma's daily questions.
--      * import_categories_settle / import_categories_release end a reservation exactly once,
--        as roma_settle_request / roma_release_request do.
--
-- Nothing here stores a statement's header (the person's name, phone or email), an amount
-- from the file before it is saved, a UPI reference or an account number.
--
-- New error codes: none (signed out is 42501; bad arguments are 22023).

-- ---------------------------------------------------------------------------
-- 1. Categories: renamed defaults, the services and money_sent keys
-- ---------------------------------------------------------------------------

alter table public.categories drop constraint categories_key;
alter table public.categories add constraint categories_key check (
  key is null
  or (kind = 'expense' and key in ('membership', 'subscription', 'gift', 'fuel', 'services', 'money_sent'))
);

comment on column public.categories.key is
  'Stable internal key of a default category (membership, subscription, gift, fuel, services, money_sent), whatever the name. Not client-writable.';

alter table public.categories drop constraint categories_icon;
alter table public.categories add constraint categories_icon check (
  icon is null
  or (kind = 'expense' and icon in (
    'food', 'groceries', 'transport', 'home', 'bills', 'shopping', 'health', 'fun',
    'education', 'travel', 'care', 'membership', 'subscription', 'gift', 'fuel',
    'services', 'money_sent', 'other'
  ))
);

-- People who have not renamed them. The seeded name and icon must both still match. A function
-- (no client can run it) so the rule is tested in pgTAP; run once below. Idempotent.
create function public.rename_default_expense_categories()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.categories as c
  set name = r.new_name
  from (values
    ('Other expenses', 'Miscellaneous', 'other'),
    ('Health', 'Medical', 'health'),
    ('Transport', 'Transport & Cabs', 'transport')
  ) as r (old_name, new_name, icon)
  where c.kind = 'expense' and c.is_default and c.key is null and c.system_key is null
    and c.name = r.old_name and c.icon = r.icon
    and (
      c.archived_at is not null
      or not exists (
        select 1 from public.categories as o
        where o.user_id = c.user_id and o.kind = 'expense' and o.archived_at is null and o.id <> c.id
          and pg_catalog.lower(pg_catalog.btrim(o.name)) = pg_catalog.lower(r.new_name)
      )
    );
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.rename_default_expense_categories() from public, anon, authenticated;

select public.rename_default_expense_categories();

-- Replaces the 20261115180000 version: the new default names, and Services and Money sent to
-- people in the keyed defaults. Otherwise unchanged.
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
      ('Transport & Cabs', 'transport'),
      ('Rent & housing', 'home'),
      ('Utilities & bills', 'bills'),
      ('Shopping', 'shopping'),
      ('Medical', 'health'),
      ('Entertainment', 'fun'),
      ('Education', 'education'),
      ('Travel', 'travel'),
      ('Personal care', 'care'),
      ('Miscellaneous', 'other')
    ) as v (name, icon)
    on conflict do nothing;
    get diagnostics n = row_count;
    created := n;
  end if;

  -- An existing same-name category takes the key: an active one first, else the oldest
  -- archived one, which stays archived.
  for d in
    select * from (values
      ('membership', 'Membership'), ('subscription', 'Subscription'), ('gift', 'Gift'), ('fuel', 'Fuel'),
      ('services', 'Services'), ('money_sent', 'Money sent to people')
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
-- 2. upi_account_matches
-- ---------------------------------------------------------------------------

create table public.upi_account_matches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  app         text not null,
  -- bank: a bank account named on the statement. upi_lite: the Google Pay UPI Lite choice.
  kind        text not null default 'bank',
  -- The bank name as printed, lower case, spaces collapsed ('' when the app prints none, as
  -- PhonePe's "Debited from XX1234").
  bank_label  text not null default '',
  last_digits text,
  -- bank: the account it is. upi_lite: the UPI Lite account, or null when declined.
  account_id  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint upi_account_matches_app check (app in ('paytm', 'phonepe', 'bhim', 'google_pay')),
  constraint upi_account_matches_shape check (
    (kind = 'bank' and last_digits ~ '^[0-9]{2,4}$' and account_id is not null)
    or (kind = 'upi_lite' and app = 'google_pay' and last_digits is null and bank_label = '')
  ),
  constraint upi_account_matches_label check (char_length(bank_label) <= 80 and bank_label !~ '[0-9]'),
  constraint upi_account_matches_account_owned
    foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  constraint upi_account_matches_once unique nulls not distinct (user_id, app, kind, bank_label, last_digits)
);

create index upi_account_matches_account_idx on public.upi_account_matches (account_id) where account_id is not null;

comment on table public.upi_account_matches is
  'Which account a UPI app statement''s bank account is (bank name and last 2 to 4 digits only), and the Google Pay UPI Lite choice. Per person and app.';

-- Normalises the label and accepts only the person's own active asset accounts (bank, cash,
-- other): a payment never posts from a card, loan or other liability through this import.
create function public.upi_account_matches_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.id, new.user_id, new.app, new.kind, new.created_at)
                          is distinct from (old.id, old.user_id, old.app, old.kind, old.created_at) then
    raise exception 'A match''s identity can''t change' using errcode = 'FC009';
  end if;
  new.bank_label := pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(new.bank_label, '\s+', ' ', 'g')));
  if new.account_id is not null and not exists (
    select 1 from public.accounts as a
    where a.id = new.account_id and a.user_id = new.user_id and a.archived_at is null
      and a.kind in ('bank', 'cash', 'other')
  ) then
    raise exception 'Pick one of your active bank, cash or other accounts' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := pg_catalog.now();
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger upi_account_matches_validate
  before insert or update on public.upi_account_matches
  for each row execute function public.upi_account_matches_validate();

revoke all on table public.upi_account_matches from anon, authenticated;
grant select, delete on table public.upi_account_matches to authenticated;
grant insert (app, kind, bank_label, last_digits, account_id) on table public.upi_account_matches to authenticated;
grant update (account_id) on table public.upi_account_matches to authenticated;

alter table public.upi_account_matches enable row level security;

create policy upi_account_matches_select_own on public.upi_account_matches
  for select to authenticated using ((select auth.uid()) = user_id);
create policy upi_account_matches_insert_own on public.upi_account_matches
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy upi_account_matches_update_own on public.upi_account_matches
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy upi_account_matches_delete_own on public.upi_account_matches
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 3. Payee categories from the person's own history
-- ---------------------------------------------------------------------------

-- How a payee name compares: lower case, spaces collapsed and trimmed.
create function public.payee_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
$$;

-- For each name asked (at most 2,000), the category of the person's latest live expense
-- whose whole description is that name, when that category is still active. Names with no
-- such expense are left out.
create function public.payee_last_categories(p_names text[])
returns table (payee text, category_id uuid)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_names is null or pg_catalog.cardinality(p_names) > 2000 then
    raise exception 'Up to 2,000 payee names' using errcode = '22023';
  end if;

  return query
  select distinct on (k.key) k.key, t.category_id
  from (select distinct public.payee_key(n) as key from pg_catalog.unnest(p_names) as n) as k
  join public.transactions as t
    on t.type = 'expense' and t.voided_at is null and t.note is not null
   and public.payee_key(t.note) = k.key
  join public.categories as c on c.id = t.category_id and c.archived_at is null
  where k.key <> ''
  order by k.key, t.occurred_on desc, t.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Consent for sending payee names
-- ---------------------------------------------------------------------------

alter table public.profiles add column import_payees_ok_at timestamptz;

comment on column public.profiles.import_payees_ok_at is
  'When the person allowed payee names from an imported statement to be sent to Anthropic to suggest categories. Set only by set_import_payees_consent (database time); null when never given or withdrawn. Independent of Roma.';

-- true: consent now (database time; an earlier consent keeps its time). false: withdrawn.
-- Returns the stored value.
create function public.set_import_payees_consent(p_allow boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_at timestamptz;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_allow is null then
    raise exception 'Allow or withdraw' using errcode = '22023';
  end if;

  update public.profiles as p
     set import_payees_ok_at = case when p_allow then coalesce(p.import_payees_ok_at, pg_catalog.now()) end
   where p.id = v_user
  returning p.import_payees_ok_at into v_at;
  return v_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Import categories spend: settings, ledger, begin / settle / release
-- ---------------------------------------------------------------------------

alter table public.roma_settings
  -- Import categories alone (roma_settings.enabled stops both).
  add column import_enabled boolean not null default true,
  -- Model calls (one per batch of up to 100 payees) one person may make in their own day.
  add column import_user_daily_calls integer not null default 30,
  add constraint roma_settings_import_daily check (import_user_daily_calls between 0 and 1000);

create table public.import_category_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users (id) on delete set null,
  provider      text not null,
  model         text not null,
  status        text not null default 'reserved',
  reserved_usd  numeric(12, 6) not null,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(12, 6),
  created_at    timestamptz not null default now(),
  ended_at      timestamptz,

  constraint import_category_usage_provider check (provider ~ '^[a-z0-9_-]{1,32}$'),
  constraint import_category_usage_model check (model ~ '^[a-z0-9._-]{1,64}$'),
  constraint import_category_usage_status check (status in ('reserved', 'settled', 'released')),
  constraint import_category_usage_reserved_range check (reserved_usd > 0 and reserved_usd <= 0.05),
  constraint import_category_usage_tokens_range check (
    (input_tokens is null or input_tokens between 0 and 10000000)
    and (output_tokens is null or output_tokens between 0 and 10000000)
  ),
  constraint import_category_usage_cost_range check (cost_usd is null or (cost_usd >= 0 and cost_usd <= 1)),
  constraint import_category_usage_shape check (
    (status = 'reserved' and ended_at is null and cost_usd is null and input_tokens is null and output_tokens is null)
    or (status = 'settled' and ended_at is not null and cost_usd is not null and input_tokens is not null and output_tokens is not null)
    or (status = 'released' and ended_at is not null and cost_usd is null and input_tokens is null and output_tokens is null)
  )
);

create index import_category_usage_created_idx on public.import_category_usage (created_at);
create index import_category_usage_user_created_idx on public.import_category_usage (user_id, created_at);

comment on table public.import_category_usage is
  'Spend ledger for statement-import category suggestions: one row per model call that passed the checks (model, tokens, cost; no names). Counts toward Roma''s monthly caps. Written only by the import_categories_* functions. No client access.';

revoke all on table public.import_category_usage from anon, authenticated, service_role;
alter table public.import_category_usage enable row level security;

-- What a row counts toward the caps, as roma_counted_usd.
create function public.import_counted_usd(p_row public.import_category_usage)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_row.status
    when 'reserved' then p_row.reserved_usd
    when 'settled' then p_row.cost_usd
    else 0::numeric
  end;
$$;

-- Spend counted toward the monthly caps since p_since, in both ledgers; one person's when
-- p_user is given, everyone's when null.
create function public.model_spend_since(p_since timestamptz, p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select coalesce(sum(public.roma_counted_usd(u)), 0) from public.roma_usage as u
      where u.created_at >= p_since and (p_user is null or u.user_id = p_user))
    + (select coalesce(sum(public.import_counted_usd(i)), 0) from public.import_category_usage as i
      where i.created_at >= p_since and (p_user is null or i.user_id = p_user));
$$;

-- Replaces the 20261105180000 version: unchanged, except the two monthly caps count import
-- spend too (model_spend_since). The daily limit still counts Roma questions only.
create or replace function public.roma_begin_request(p_provider text, p_model text)
returns table (outcome text, request_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_settings public.roma_settings;
  v_month_start timestamptz := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC') at time zone 'UTC';
  v_time_zone text;
  v_today date;
  v_today_count integer;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Sign in to ask Roma' using errcode = '42501';
  end if;

  -- One check at a time for everyone, so two questions can't both fit under a cap.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.roma_usage', 0));

  select * into v_settings from public.roma_settings as s where s.id;
  if not found or not v_settings.enabled then
    return query select 'disabled'::text, null::uuid;
    return;
  end if;

  -- Same fallback as user_local_today, so a missing time zone can never switch the daily
  -- limit off (a null date comparison would count nothing).
  select coalesce(p.time_zone, 'UTC') into v_time_zone
    from public.profiles as p
   where p.id = v_user and p.roma_enabled;
  if not found then
    return query select 'not_enabled'::text, null::uuid;
    return;
  end if;

  if public.model_spend_since(v_month_start, null) + v_settings.reserve_usd > v_settings.monthly_budget_usd then
    return query select 'global_budget'::text, null::uuid;
    return;
  end if;

  if public.model_spend_since(v_month_start, v_user) + v_settings.reserve_usd > v_settings.user_monthly_budget_usd then
    return query select 'user_budget'::text, null::uuid;
    return;
  end if;

  -- Released rows (no provider call) don't use up the day's questions. The 2-day bound only
  -- narrows the index scan; the local-date test decides.
  v_today := public.user_local_today(v_user);
  select count(*)::integer into v_today_count
    from public.roma_usage as u
   where u.user_id = v_user
     and u.status <> 'released'
     and u.created_at >= pg_catalog.now() - interval '2 days'
     and (u.created_at at time zone v_time_zone)::date = v_today;
  if v_today_count >= v_settings.user_daily_requests then
    return query select 'daily_limit'::text, null::uuid;
    return;
  end if;

  insert into public.roma_usage (user_id, provider, model, reserved_usd)
  values (v_user, p_provider, p_model, v_settings.reserve_usd)
  returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$$;

comment on function public.roma_begin_request(text, text) is
  'Roma: kill switch, opt-in, global and personal monthly caps (counting both ledgers: roma_usage and import_category_usage), daily question limit (Roma questions only), all from roma_settings; on success reserves roma_settings.reserve_usd. A refusal writes nothing.';

-- outcome: 'ok' (request_id set) or a refusal, with request_id null and nothing written:
--   'disabled'      the kill switch (enabled or import_enabled) is off, or its row is missing
--   'no_consent'    the person has not allowed payee names to be sent (import_payees_ok_at)
--   'global_budget' this month's spend for everyone (Roma and imports) would pass the cap
--   'user_budget'   this month's spend for the person (Roma and imports) would pass their cap
--   'daily_limit'   the person has made import_user_daily_calls import calls today
-- The app then imports with rules only.
create function public.import_categories_begin(p_provider text, p_model text)
returns table (outcome text, request_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_settings public.roma_settings;
  v_month_start timestamptz := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC') at time zone 'UTC';
  v_time_zone text;
  v_today date;
  v_today_count integer;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  -- The same lock as roma_begin_request: the monthly caps are shared.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.roma_usage', 0));

  select * into v_settings from public.roma_settings as s where s.id;
  if not found or not v_settings.enabled or not v_settings.import_enabled then
    return query select 'disabled'::text, null::uuid;
    return;
  end if;

  select coalesce(p.time_zone, 'UTC') into v_time_zone
    from public.profiles as p
   where p.id = v_user and p.import_payees_ok_at is not null;
  if not found then
    return query select 'no_consent'::text, null::uuid;
    return;
  end if;

  if public.model_spend_since(v_month_start, null) + v_settings.reserve_usd > v_settings.monthly_budget_usd then
    return query select 'global_budget'::text, null::uuid;
    return;
  end if;

  if public.model_spend_since(v_month_start, v_user) + v_settings.reserve_usd > v_settings.user_monthly_budget_usd then
    return query select 'user_budget'::text, null::uuid;
    return;
  end if;

  v_today := public.user_local_today(v_user);
  select count(*)::integer into v_today_count
    from public.import_category_usage as i
   where i.user_id = v_user
     and i.status <> 'released'
     and i.created_at >= pg_catalog.now() - interval '2 days'
     and (i.created_at at time zone v_time_zone)::date = v_today;
  if v_today_count >= v_settings.import_user_daily_calls then
    return query select 'daily_limit'::text, null::uuid;
    return;
  end if;

  insert into public.import_category_usage (user_id, provider, model, reserved_usd)
  values (v_user, p_provider, p_model, v_settings.reserve_usd)
  returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$$;

comment on function public.import_categories_begin(text, text) is
  'Import category suggestions: kill switches, consent, Roma''s monthly caps (both ledgers), the import daily limit, all from roma_settings; on success reserves roma_settings.reserve_usd. A refusal writes nothing. Roma need not be on.';

create function public.import_categories_settle(
  p_request_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_usd numeric
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_input_tokens is null or p_input_tokens < 0
     or p_output_tokens is null or p_output_tokens < 0
     or p_cost_usd is null or p_cost_usd < 0 or p_cost_usd > 1 then
    raise exception 'Invalid usage' using errcode = '22023';
  end if;

  update public.import_category_usage as i
     set status = 'settled',
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         cost_usd = p_cost_usd,
         ended_at = pg_catalog.now()
   where i.id = p_request_id
     and i.user_id = (select auth.uid())
     and i.status = 'reserved';
  return found;
end;
$$;

create function public.import_categories_release(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.import_category_usage as i
     set status = 'released',
         ended_at = pg_catalog.now()
   where i.id = p_request_id
     and i.user_id = (select auth.uid())
     and i.status = 'reserved';
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.upi_account_matches_validate() from public, anon, authenticated;
revoke execute on function public.import_counted_usd(public.import_category_usage) from public, anon, authenticated;
revoke execute on function public.model_spend_since(timestamptz, uuid) from public, anon, authenticated;

revoke execute on function public.payee_key(text) from public, anon;
grant execute on function public.payee_key(text) to authenticated;

revoke execute on function public.payee_last_categories(text[]) from public, anon;
grant execute on function public.payee_last_categories(text[]) to authenticated;

revoke execute on function public.set_import_payees_consent(boolean) from public, anon;
grant execute on function public.set_import_payees_consent(boolean) to authenticated;

revoke execute on function public.import_categories_begin(text, text) from public, anon;
grant execute on function public.import_categories_begin(text, text) to authenticated;

revoke execute on function public.import_categories_settle(uuid, integer, integer, numeric) from public, anon;
grant execute on function public.import_categories_settle(uuid, integer, integer, numeric) to authenticated;

revoke execute on function public.import_categories_release(uuid) from public, anon;
grant execute on function public.import_categories_release(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill existing users (idempotent: running it again creates nothing)
-- ---------------------------------------------------------------------------

select public.backfill_default_expense_categories();
