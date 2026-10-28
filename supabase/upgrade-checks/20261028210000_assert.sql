-- Upgrade check for migration 20261028210000, step 2: run after the migration on the database
-- seeded by 20261028210000_seed.sql. Fails (ON_ERROR_STOP) on the first wrong row.
\set ON_ERROR_STOP on
do $$
declare
  v_mismatches integer;
begin
  select count(*) into v_mismatches
  from public.upgrade_check_before as o
  join public.borrowings as b on b.id = o.id
  left join public.due_items as d on d.borrowing_id = b.id
  where b.amount_to_return_minor <> b.borrowed_minor
     or b.relationship is not null or b.reason is not null or b.repay_from_account_id is not null
     or b.instalment_count is not null
     or b.archived_at is distinct from o.archived_at
     or b.return_on is distinct from o.due_date
     or b.return_plan is distinct from case when o.due_date is not null then 'once' end
     or (o.due_date is not null and (d.seq <> 0 or d.interest_minor <> 0 or d.pay_from_account_id is not null
                                     or d.status <> o.status or d.due_date <> o.due_date))
     or (o.due_date is null and d.id is not null);
  if v_mismatches <> 0 then
    raise exception 'upgrade check: % borrowing(s) not backfilled as expected', v_mismatches;
  end if;
  if (select count(*) from public.upgrade_check_before) <> 3
     or (select count(*) from public.borrowings where archived_at is not null) <> 1
     or (select count(*) from public.due_items where kind = 'borrowing_due') <> 2 then
    raise exception 'upgrade check: the seeded rows are not all there';
  end if;
  if exists (select 1 from pg_constraint where conname in ('due_items_interest', 'borrowings_return_plan', 'borrowings_return_amount') and not convalidated)
     or (select attnotnull from pg_attribute where attrelid = 'public.borrowings'::regclass and attname = 'amount_to_return_minor') is not true then
    raise exception 'upgrade check: the new constraints are not in force';
  end if;
  raise notice 'upgrade check passed: 3 borrowings backfilled (one archived), 2 due items';
end
$$;
