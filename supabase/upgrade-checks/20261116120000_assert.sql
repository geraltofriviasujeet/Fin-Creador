-- Upgrade check for migration 20261116120000, step 2: run after the migration on the database
-- seeded by 20261116120000_seed.sql. Fails (ON_ERROR_STOP) on the first wrong row.
\set ON_ERROR_STOP on
do $$
declare
  p constant uuid := '5e000000-0000-4000-8000-000000000001';
  q constant uuid := '5e000000-0000-4000-8000-000000000002';
  t constant uuid := '5e000000-0000-4000-8000-000000000003';
  y constant uuid := '5e000000-0000-4000-8000-000000000004';
begin
  if (select count(*) from public.upgrade_check_before) <> 4 then
    raise exception 'upgrade check: the seeded users are not all there';
  end if;
  -- P: the three untouched defaults renamed in place (same rows, so entries keep their category).
  if (select array_agg(name order by icon) from public.categories where user_id = p and is_default and icon in ('other', 'health', 'transport'))
     is distinct from array['Medical', 'Miscellaneous', 'Transport & Cabs'] then
    raise exception 'upgrade check: an untouched default was not renamed';
  end if;
  if (select c.name from public.transactions as t join public.categories as c on c.id = t.category_id
      where t.idempotency_key = 'a0000000-0000-4000-8000-0000000000e1') is distinct from 'Miscellaneous'
     or (select category_id from public.transactions where idempotency_key = 'a0000000-0000-4000-8000-0000000000e1')
        is distinct from (select misc_id from public.upgrade_check_before where user_id = p) then
    raise exception 'upgrade check: an entry lost its category';
  end if;
  -- Q renamed Health: left alone (the other two are renamed).
  if not exists (select 1 from public.categories where user_id = q and is_default and icon = 'health' and name = 'Doctor visits')
     or exists (select 1 from public.categories where user_id = q and name = 'Medical') then
    raise exception 'upgrade check: a default the person renamed was changed';
  end if;
  -- T has an own active "Transport & Cabs": the default keeps "Transport".
  if not exists (select 1 from public.categories where user_id = t and is_default and icon = 'transport' and name = 'Transport')
     or (select count(*) from public.categories where user_id = t and archived_at is null and lower(btrim(name)) = 'transport & cabs') <> 1 then
    raise exception 'upgrade check: a rename collided with an own category';
  end if;
  -- Services and Money sent to people: once per user; Y's own adopted.
  if exists (
    select 1 from public.upgrade_check_before as o
    where (select count(*) from public.categories as c where c.user_id = o.user_id and c.key = 'services') <> 1
       or (select count(*) from public.categories as c where c.user_id = o.user_id and c.key = 'money_sent') <> 1
  ) then
    raise exception 'upgrade check: Services or Money sent to people missing or duplicated';
  end if;
  if (select key from public.categories where id = '5c000000-0000-4000-8000-000000000e04') is distinct from 'money_sent'
     or (select count(*) from public.categories where user_id = y and kind = 'expense')
        <> (select expense_categories + 1 from public.upgrade_check_before where user_id = y) then
    raise exception 'upgrade check: Y''s own "Money sent to people" was not adopted';
  end if;
  if public.backfill_default_expense_categories() <> 0 or public.rename_default_expense_categories() <> 0 then
    raise exception 'upgrade check: running the backfill or the rename again changed something';
  end if;
end;
$$;
