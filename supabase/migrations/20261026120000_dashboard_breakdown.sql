-- Sprint 5: dashboard breakdowns in one read-only call.
--
-- Rules (docs/sprint-plan.md, Sprint 5 decisions 2026-10-26):
--   * Built on transactions_matching, so it sees exactly the entries the Transactions page
--     and transaction_summary see: the caller's own, current versions only (an edited entry
--     counts once, as its latest version), dated by the person's local date.
--   * Voided entries never count. Transfers are never income or expenses and are left out.
--   * Per currency; the client shows the profile currency and never adds currencies up.
--   * Buckets: a range of up to 62 days (both ends included) is split by day, a longer one
--     by calendar month. packages/domain/src/dashboard.ts (bucketSizeFor) applies the same
--     rule to fill empty buckets; keep the two in step.
--   * Category rows give expenses per category, archived categories included, so history
--     is kept.
--
-- Rows (kind):
--   'day' / 'month'  bucket_start, income_minor, expense_minor, entry_count
--   'category'       category_id, expense_minor, entry_count (income_minor is 0)
--
-- No new tables, policies or grants beyond execute for signed-in users; security invoker,
-- so row level security on transactions applies as well.

create function public.dashboard_breakdown(
  p_from date,
  p_to date
)
returns table (
  kind text,
  currency text,
  bucket_start date,
  category_id uuid,
  income_minor bigint,
  expense_minor bigint,
  entry_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_by_month boolean;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'A valid date range is required' using errcode = '22023';
  end if;
  -- p_to - p_from is the number of days minus one: 61 or less means 62 days or fewer.
  v_by_month := (p_to - p_from) > 61;

  return query
    with posted as (
      select t.type, t.currency, t.category_id, t.amount_minor,
             case when v_by_month
                  then pg_catalog.date_trunc('month', t.occurred_on::timestamp)::date
                  else t.occurred_on
             end as bucket
      from public.transactions_matching(p_from, p_to, null, null, null, null) as t
      where t.voided_at is null
        and t.type in ('income', 'expense')
    )
    select
      case when v_by_month then 'month' else 'day' end,
      p.currency,
      p.bucket,
      null::uuid,
      coalesce(sum(p.amount_minor) filter (where p.type = 'income'), 0)::bigint,
      coalesce(sum(p.amount_minor) filter (where p.type = 'expense'), 0)::bigint,
      count(*)::integer
    from posted as p
    group by p.currency, p.bucket
    union all
    select
      'category',
      p.currency,
      null::date,
      p.category_id,
      0::bigint,
      sum(p.amount_minor)::bigint,
      count(*)::integer
    from posted as p
    where p.type = 'expense'
    group by p.currency, p.category_id
    order by 1, 2, 3, 4;
end;
$$;

revoke execute on function public.dashboard_breakdown(date, date) from public, anon;
grant execute on function public.dashboard_breakdown(date, date) to authenticated;
