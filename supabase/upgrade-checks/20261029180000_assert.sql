-- Upgrade check for migration 20261029180000, step 2: run after the migration on the database
-- seeded by 20261029180000_seed.sql. Fails (ON_ERROR_STOP) on the first wrong row.
\set ON_ERROR_STOP on
do $$
begin
  if (select count(*) from public.upgrade_check_before) <> 3 then
    raise exception 'upgrade check: the seeded users are not all there';
  end if;
  if exists (
    select 1 from public.upgrade_check_before as o
    where (select count(*) from public.categories as c where c.user_id = o.user_id and c.system_key = 'bank_charges') <> 1
       or (select count(*) from public.categories as c
           where c.user_id = o.user_id and c.kind = 'expense' and lower(btrim(c.name)) = 'bank charges & interest') <> 1
  ) then
    raise exception 'upgrade check: a user does not have exactly one Bank charges & interest';
  end if;
  -- The plain user gains one category; the two with their own keep the same count (adopted).
  if exists (
    select 1 from public.upgrade_check_before as o
    where (select count(*) from public.categories as c where c.user_id = o.user_id and c.kind = 'expense')
          <> o.expense_categories + case when o.user_id = '5b000000-0000-4000-8000-000000000001' then 1 else 0 end
  ) then
    raise exception 'upgrade check: the backfill created a duplicate or missed a user';
  end if;
  if (select system_key from public.categories where id = '5c000000-0000-4000-8000-000000000002') is distinct from 'bank_charges'
     or (select system_key is distinct from 'bank_charges' or archived_at is not null
         from public.categories where id = '5c000000-0000-4000-8000-000000000003')
     or (select category_id from public.transactions where idempotency_key = 'a0000000-0000-4000-8000-0000000000c1')
        is distinct from '5c000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'upgrade check: an existing category was not adopted as expected';
  end if;
  if public.backfill_default_expense_categories() <> 0 then
    raise exception 'upgrade check: running the backfill again created categories';
  end if;
end;
$$;
