-- Upgrade check for migration 20261104120000, step 2: run after the migration on the database
-- seeded by 20261104120000_seed.sql (no refunds). Every read must return exactly what it did
-- before: an existing user sees no change. Fails (ON_ERROR_STOP) on the first difference.
-- Rolled back at the end (the statement probe and the replay leave nothing behind).
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

do $$
declare
  v_days public.upgrade_9c_days;
  v_result text;
begin
  select * into v_days from public.upgrade_9c_days;
  if v_days.card_id is null or (select count(*) from public.upgrade_9c_balances) <> 4 then
    raise exception 'upgrade check: the seeded user is not all there';
  end if;

  if exists (select account_id, inflow_minor, outflow_minor from public.account_balances
             where user_id = '9c000000-0000-4000-8000-000000000001'
             except select * from public.upgrade_9c_balances)
     or exists (select * from public.upgrade_9c_balances
                except select account_id, inflow_minor, outflow_minor from public.account_balances
                where user_id = '9c000000-0000-4000-8000-000000000001') then
    raise exception 'upgrade check: account_balances changed';
  end if;

  if exists (select * from public.account_balances_at(array[v_days.today - 30, v_days.today - 10, v_days.today - 1, v_days.today])
             except select * from public.upgrade_9c_balances_at)
     or exists (select * from public.upgrade_9c_balances_at
                except select * from public.account_balances_at(array[v_days.today - 30, v_days.today - 10, v_days.today - 1, v_days.today])) then
    raise exception 'upgrade check: account_balances_at changed';
  end if;

  if exists ((select 'day'::text, d.* from public.dashboard_breakdown(v_days.today - 40, v_days.today) as d
              union all
              select 'month', d.* from public.dashboard_breakdown(v_days.today - 400, v_days.today) as d)
             except select * from public.upgrade_9c_dashboard)
     or exists (select * from public.upgrade_9c_dashboard
                except (select 'day'::text, d.* from public.dashboard_breakdown(v_days.today - 40, v_days.today) as d
                        union all
                        select 'month', d.* from public.dashboard_breakdown(v_days.today - 400, v_days.today) as d)) then
    raise exception 'upgrade check: dashboard_breakdown changed';
  end if;

  -- The old columns are the same; the new ones are zero with no refunds.
  if exists (select s.currency, s.income_minor, s.expense_minor, s.income_count, s.expense_count, s.transfer_count
             from public.transaction_summary(v_days.today - 40, v_days.today) as s
             except select * from public.upgrade_9c_summary)
     or exists (select * from public.upgrade_9c_summary
                except select s.currency, s.income_minor, s.expense_minor, s.income_count, s.expense_count, s.transfer_count
                from public.transaction_summary(v_days.today - 40, v_days.today) as s)
     or exists (select 1 from public.transaction_summary(v_days.today - 40, v_days.today) as s
                where s.refund_minor <> 0 or s.refund_count <> 0) then
    raise exception 'upgrade check: transaction_summary changed';
  end if;

  if (select (owed_now, owed_today) from public.upgrade_9c_owed)
     is distinct from (public.liability_owed(v_days.card_account_id), public.liability_owed(v_days.card_account_id, v_days.today)) then
    raise exception 'upgrade check: liability_owed changed';
  end if;

  begin
    select s.difference_minor || ',' || s.owed_at_statement_minor into v_result
    from public.enter_card_statement(v_days.card_id, '9c300000-0000-4000-8000-000000000002', v_days.today, 500000,
                                     0, null, 0, v_days.difference_category_id) as s;
    raise exception using errcode = 'UC901', message = v_result;
  exception when sqlstate 'UC901' then
    v_result := sqlerrm;
  end;
  if (split_part(v_result, ',', 1)::bigint, split_part(v_result, ',', 2)::bigint)
     is distinct from (select (difference_minor, owed_at_statement_minor) from public.upgrade_9c_statement) then
    raise exception 'upgrade check: the card statement difference changed (now %)', v_result;
  end if;

  -- Existing rows: no refunds, no links, all old shapes still valid.
  if exists (select 1 from public.transactions where type = 'refund' or refund_of_id is not null) then
    raise exception 'upgrade check: the migration created refunds or links';
  end if;

  -- Grants restored exactly, per role, on the new signatures.
  if exists (
    select 1 from public.upgrade_9c_grants as g
    where has_function_privilege(g.role,
            case g.name
              when 'record_transaction' then 'public.record_transaction(text, uuid, bigint, date, uuid, uuid, uuid, text, text, uuid)'
              else 'public.transaction_summary(date, date, uuid, uuid, text, bigint)'
            end, 'EXECUTE') is distinct from g.can_execute
  ) or (select count(*) from public.upgrade_9c_grants) <> 6 then
    raise exception 'upgrade check: function grants differ from before';
  end if;
  if exists (select 1 from pg_proc where proname = 'record_transaction' and pronamespace = 'public'::regnamespace and pronargs <> 10) then
    raise exception 'upgrade check: an old record_transaction signature is still there';
  end if;
end;
$$;

-- Old-style calls still work: a replay of a saved key with the 9 old arguments returns the same row,
-- and record_income (which calls record_transaction) still resolves.
set local role authenticated;
do $$
begin
  if (select (public.record_transaction('income', '9c100000-0000-4000-8000-000000000001', 500000, public.user_local_today(auth.uid()) - 35,
        (select id from public.accounts where name = 'Upg Bank'), (select id from public.categories where kind = 'income' and name = 'Salary'))).id)
     is distinct from (select id from public.transactions where idempotency_key = '9c100000-0000-4000-8000-000000000001') then
    raise exception 'upgrade check: an old-style record_transaction replay did not return the saved row';
  end if;
  perform public.record_income((select id from public.accounts where name = 'Upg Bank'),
    (select id from public.categories where kind = 'income' and name = 'Salary'), 1000, public.user_local_today(auth.uid()),
    '9c100000-0000-4000-8000-0000000000aa');
end;
$$;
rollback;
