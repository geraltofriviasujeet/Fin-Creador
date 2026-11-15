-- pgTAP tests for revise_loan and loan_revisions (migration 20261115180000): the owner's case
-- (a starts-later education loan with amount taken and sanctioned amount reduced), an ongoing
-- loan with payments, every refusal, a no-change call, a repeated request key, another user,
-- direct writes, the write marks after each loan function in one transaction, an instalment
-- settled without a payment counting as history, and net worth at a past month-end before
-- and after. Users are fictional. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(54);

insert into auth.users (id, email) values
  ('5a000000-0000-4000-8000-000000000001', 'lr-asha@example.test'),
  ('5a000000-0000-4000-8000-000000000002', 'lr-bala@example.test');

-- Helpers (SECURITY INVOKER: RLS applies to whoever calls them).
create function public.tr_today() returns date language sql stable set search_path = ''
  as $$ select public.user_local_today((select auth.uid())) $$;
create function public.tr_month_start() returns date language sql stable set search_path = ''
  as $$ select pg_catalog.make_date(extract(year from public.tr_today())::integer, extract(month from public.tr_today())::integer, 1) $$;
create function public.tr_loan(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select l.id from public.loans as l where l.idempotency_key = p_key $$;
create function public.tr_bank() returns uuid language sql stable set search_path = ''
  as $$ select a.id from public.accounts as a where a.kind = 'bank' and a.name = 'Example Bank' $$;
create function public.tr_account(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select l.account_id from public.loans as l where l.idempotency_key = p_key $$;
create function public.tr_due(p_key uuid, p_seq integer) returns uuid language sql stable set search_path = ''
  as $$ select d.id from public.due_items as d where d.loan_id = public.tr_loan(p_key) and d.kind = 'loan_emi' and d.seq = p_seq $$;
create function public.tr_items(p_key uuid) returns integer language sql stable set search_path = ''
  as $$ select count(*)::integer from public.due_items as d where d.loan_id = public.tr_loan(p_key) $$;
create function public.tr_revisions(p_key uuid) returns integer language sql stable set search_path = ''
  as $$ select count(*)::integer from public.loan_revisions as r where r.loan_id = public.tr_loan(p_key) $$;
create function public.tr_balance_at(p_key uuid, p_day date) returns bigint language sql stable set search_path = ''
  as $$ select b.balance_minor from public.account_balances_at(array[p_day]) as b where b.account_id = public.tr_account(p_key) $$;
-- revise_loan with the loan's current terms, changed by p_changes (keys as in loan_terms).
create function public.tr_revise(p_key uuid, p_request uuid, p_changes jsonb default '{}')
returns public.loan_revisions language plpgsql set search_path = ''
as $$
declare
  t jsonb := public.loan_terms(public.tr_loan(p_key)) || p_changes;
  r public.loan_revisions;
begin
  select * into r from public.revise_loan(
    coalesce(public.tr_loan(p_key), '5f000000-0000-4000-8000-0000000000ff'), p_request,
    t->>'loan_type', t->>'lender', (t->>'sanctioned_minor')::bigint, (t->>'disbursed_minor')::bigint,
    (t->>'rate_bps')::integer, t->>'rate_kind', (t->>'tenure_months')::integer, t->>'start_mode',
    (t->>'opening_outstanding_minor')::bigint, (t->>'instalment_months')::integer, (t->>'first_due_date')::date,
    (t->>'emi_estimate_minor')::bigint, (t->>'emi_minor')::bigint,
    p_type_other => t->>'type_other', p_nickname => t->>'nickname',
    p_before_tracking_on => (t->>'before_tracking_on')::date, p_moratorium_months => (t->>'moratorium_months')::integer,
    p_moratorium_interest => t->>'moratorium_interest', p_capitalised_minor => (t->>'capitalised_minor')::bigint,
    p_moratorium_interest_minor => (t->>'moratorium_interest_minor')::bigint
  );
  return r;
end;
$$;
grant execute on function public.tr_bank(), public.tr_today(), public.tr_month_start(), public.tr_loan(uuid), public.tr_account(uuid),
  public.tr_due(uuid, integer), public.tr_items(uuid), public.tr_revisions(uuid), public.tr_balance_at(uuid, date),
  public.tr_revise(uuid, uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ privileges (1-4)
select ok(not has_function_privilege('anon', 'public.revise_loan(uuid, uuid, text, text, bigint, bigint, integer, text, integer, text, bigint, integer, date, bigint, bigint, text, text, date, integer, text, bigint, bigint)', 'EXECUTE'),
  'anon cannot call revise_loan');
select ok(not has_function_privilege('authenticated', 'public.loan_revisions_guard()', 'EXECUTE'),
  'clients cannot call the revisions guard');
select ok(not has_table_privilege('authenticated', 'public.loan_revisions', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.loan_revisions', 'DELETE'),
  'clients cannot update or delete revisions');
select ok((select relrowsecurity from pg_class where oid = 'public.loan_revisions'::regclass), 'loan_revisions has RLS');

-- ------------------------------------------------------------ as A: an account and four loans
select set_config('request.jwt.claims', '{"sub": "5a000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date)
values ('bank', 'savings', 'Example Bank', 'INR', 100000000, public.tr_today() - 120);

-- L1: education, starts later, ₹8,000 of ₹10,000 taken. L2: home, ongoing, ₹12,000 owed.
-- L3: personal, starts later (no payments). L4: vehicle, starts later (no payments).
select public.create_loan('5b000000-0000-4000-8000-000000000001', 'education', 'Example Bank', 1000000, 800000, 1000, 'fixed', 60,
  'starts_later', 800000, 60, public.tr_today() + 45, 17000, 17000);
select public.create_loan('5b000000-0000-4000-8000-000000000002', 'home', 'Example Bank', 2000000, 1500000, 900, 'floating', 24,
  'ongoing', 1200000, 24, public.tr_month_start() + 9, 56000, 56000);
select public.create_loan('5b000000-0000-4000-8000-000000000003', 'personal', 'Example Bank', 500000, 500000, 1200, 'fixed', 12,
  'starts_later', 500000, 12, public.tr_today() + 30, 44424, 44424);
select public.create_loan('5b000000-0000-4000-8000-000000000004', 'vehicle', 'Example Bank', 500000, 500000, 1200, 'fixed', 12,
  'starts_later', 500000, 12, public.tr_today() + 30, 44424, 44424);

-- L2: EMIs 1 and 2 paid today (₹440 principal, ₹120 interest each).
select public.pay_due_item(public.tr_due('5b000000-0000-4000-8000-000000000002', 1), '5d000000-0000-4000-8000-000000000001',
  public.tr_bank(), public.tr_today(), 44000, 12000, 0, true);
select public.pay_due_item(public.tr_due('5b000000-0000-4000-8000-000000000002', 2), '5d000000-0000-4000-8000-000000000002',
  public.tr_bank(), public.tr_today(), 44000, 12000, 0, true);

-- L1 was added 40 days ago (so a past month-end falls inside its life).
reset role;
set local session_replication_role = replica;
update public.loans set tracking_started_on = public.tr_today() - 40 where idempotency_key = '5b000000-0000-4000-8000-000000000001';
update public.accounts set opening_balance_date = public.tr_today() - 40 where id = public.tr_account('5b000000-0000-4000-8000-000000000001');
set local session_replication_role = origin;
set local role authenticated;

-- ------------------------------------------------------------ owner's case: L1 (5-18)
select is(public.tr_balance_at('5b000000-0000-4000-8000-000000000001', public.tr_month_start() - 1), -800000::bigint,
  'before: net worth at last month-end carries ₹8,000 owed on L1');
select isnt(
  (public.tr_revise('5b000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001',
    '{"sanctioned_minor": 900000, "disbursed_minor": 600000, "opening_outstanding_minor": 600000, "emi_estimate_minor": 12748, "emi_minor": 12748}')).id,
  null, 'amount taken and sanctioned amount both reduced'
);
select results_eq(
  $$ select sanctioned_minor, disbursed_minor, opening_outstanding_minor, emi_minor from public.loans
     where idempotency_key = '5b000000-0000-4000-8000-000000000001' $$,
  $$ values (900000::bigint, 600000::bigint, 600000::bigint, 12748::bigint) $$,
  'the loan has the new terms'
);
select is((select opening_balance_minor from public.accounts where id = public.tr_account('5b000000-0000-4000-8000-000000000001')),
  -600000::bigint, 'its account opens at −₹6,000');
select results_eq(
  $$ select owed_before_minor, owed_after_minor, pending_before, pending_after, rebuilt,
            old_terms->>'disbursed_minor', new_terms->>'disbursed_minor', new_terms->>'sanctioned_minor'
     from public.loan_revisions where idempotency_key = '5e000000-0000-4000-8000-000000000001' $$,
  $$ values (800000::bigint, 600000::bigint, 60, 60, 60, '800000'::text, '600000'::text, '900000'::text) $$,
  'the revision records old and new terms, owed and instalments'
);
select is(
  (select count(*)::int from public.due_items where loan_id = public.tr_loan('5b000000-0000-4000-8000-000000000001')
     and status = 'pending' and amount_due_minor = 12748),
  60, 'all 60 EMIs rebuilt at the new EMI'
);
select is(public.tr_items('5b000000-0000-4000-8000-000000000001'), 60, 'and no other instalment remains');
select is(public.liability_owed(public.tr_account('5b000000-0000-4000-8000-000000000001')), 600000::bigint, 'owed now ₹6,000');
select is(public.tr_balance_at('5b000000-0000-4000-8000-000000000001', public.tr_month_start() - 1), -600000::bigint,
  'after: net worth at last month-end is restated to ₹6,000 owed');
select is(
  (public.tr_revise('5b000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001',
    '{"sanctioned_minor": 900000, "disbursed_minor": 600000, "opening_outstanding_minor": 600000, "emi_estimate_minor": 12748, "emi_minor": 12748}')).id,
  (select id from public.loan_revisions where idempotency_key = '5e000000-0000-4000-8000-000000000001'),
  'the same request key returns the first revision'
);
select is(public.tr_revisions('5b000000-0000-4000-8000-000000000001'), 1, 'and writes no second one');
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001', '{"nickname": "Studies"}') $$,
  'FC007', null, 'the same key with other terms is refused'
);
select ok(
  public.tr_revise('5b000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000002') is null,
  'a revision that changes nothing returns null'
);
select is(public.tr_revisions('5b000000-0000-4000-8000-000000000001'), 1, 'and writes nothing');

-- ------------------------------------------------------------ ongoing loan with payments: L2 (19-24)
select isnt(
  (public.tr_revise('5b000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000003',
    '{"opening_outstanding_minor": 1100000, "emi_estimate_minor": 52000, "emi_minor": 52000, "instalment_months": 22}')).id,
  null, 'an ongoing loan with two EMIs paid is revised'
);
select results_eq(
  $$ select owed_before_minor, owed_after_minor, pending_before, pending_after, rebuilt
     from public.loan_revisions where idempotency_key = '5e000000-0000-4000-8000-000000000003' $$,
  $$ values (1112000::bigint, 1012000::bigint, 22, 20, 22) $$,
  'owed moves by the difference; 20 EMIs take the new amount, 2 past the new count go'
);
select results_eq(
  $$ select seq, status, amount_due_minor from public.due_items
     where loan_id = public.tr_loan('5b000000-0000-4000-8000-000000000002') and status <> 'pending' order by seq $$,
  $$ values (1, 'paid'::text, 56000::bigint), (2, 'paid', 56000) $$,
  'paid EMIs are untouched'
);
select is(
  (select count(*)::int from public.transactions as t join public.due_payments as p on p.id = t.due_payment_id
     join public.due_items as d on d.id = p.due_item_id
   where d.loan_id = public.tr_loan('5b000000-0000-4000-8000-000000000002') and t.voided_at is null and p.voided_at is null),
  4, 'and so are their payments and ledger entries'
);
select results_eq(
  $$ select count(*)::int, min(seq), max(seq), min(amount_due_minor), max(amount_due_minor) from public.due_items
     where loan_id = public.tr_loan('5b000000-0000-4000-8000-000000000002') and status = 'pending' $$,
  $$ values (20, 3, 22, 52000::bigint, 52000::bigint) $$,
  'pending EMIs 3 to 22 at the new EMI'
);
select is(public.liability_owed(public.tr_account('5b000000-0000-4000-8000-000000000002')), 1012000::bigint, 'owed now ₹10,120');

-- ------------------------------------------------------------ refusals with payments: L2 (25-33)
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000002', gen_random_uuid(), '{"sanctioned_minor": 1000000}') $$,
  'FC059', null, 'amount taken above the sanctioned amount'
);
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000002', gen_random_uuid(),
       jsonb_build_object('first_due_date', public.tr_month_start() + 10)) $$,
  'FC060', null, 'the first EMI date can''t move once a payment is recorded'
);
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000002', gen_random_uuid(), '{"start_mode": "starts_later"}') $$,
  'FC060', null, 'nor the repayment mode'
);
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000002', gen_random_uuid(), '{"opening_outstanding_minor": 80000}') $$,
  'FC061', null, 'owed below the principal already repaid'
);
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000002', gen_random_uuid(), '{"instalment_months": 1}') $$,
  'FC062', null, 'fewer EMIs than one already paid'
);
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000002', gen_random_uuid(), '{"opening_outstanding_minor": 1600000}') $$,
  '23514', null, 'ongoing: owed when added above the amount taken (loans_opening_outstanding)'
);
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000002', gen_random_uuid(), '{"tenure_months": 481}') $$,
  '23514', null, 'tenure out of range (loans_tenure_range)'
);
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000002', gen_random_uuid(), '{"rate_bps": 10001}') $$,
  '23514', null, 'rate out of range (loans_rate_range)'
);
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000002', gen_random_uuid(), '{"sanctioned_minor": 10000000000001}') $$,
  '23514', null, 'sanctioned amount out of range (loans_sanctioned_range)'
);

-- ------------------------------------------------------------ refusals without payments: L3 (34-38)
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000003', gen_random_uuid(),
       jsonb_build_object('first_due_date', public.tr_today())) $$,
  'FC043', null, 'starts later: the first EMI is after the day it was added'
);
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000003', gen_random_uuid(),
       jsonb_build_object('start_mode', 'ongoing', 'first_due_date', public.tr_month_start() + 40)) $$,
  'FC043', null, 'ongoing: a still-due first EMI is in the month it was added'
);
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000003', gen_random_uuid(), '{"opening_outstanding_minor": 400000}') $$,
  '23514', null, 'starts later: opening amount must equal the amount taken (loans_opening_outstanding)'
);
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000003', gen_random_uuid(),
       '{"disbursed_minor": 0, "opening_outstanding_minor": 0}') $$,
  '23514', null, 'amount taken must be above zero (loans_disbursed_range)'
);
select public.set_loan_archived(public.tr_loan('5b000000-0000-4000-8000-000000000003'), true);
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000003', gen_random_uuid(), '{"nickname": "Old"}') $$,
  'FC033', null, 'an archived loan can''t be revised'
);

-- ------------------------------------------------------------ settled without a payment: L4 (39-41)
reset role;
set local session_replication_role = replica;
update public.due_items set status = 'paid' where id = public.tr_due('5b000000-0000-4000-8000-000000000004', 1);
set local session_replication_role = origin;
set local role authenticated;
select throws_ok(
  $$ select public.tr_revise('5b000000-0000-4000-8000-000000000004', gen_random_uuid(),
       jsonb_build_object('first_due_date', public.tr_today() + 31)) $$,
  'FC060', null, 'an instalment settled without a payment counts as history'
);
select isnt(
  (public.tr_revise('5b000000-0000-4000-8000-000000000004', '5e000000-0000-4000-8000-000000000004',
    '{"emi_estimate_minor": 40000, "emi_minor": 40000}')).id,
  null, 'its amounts can still be revised'
);
select results_eq(
  $$ select count(*)::int, count(*) filter (where status = 'paid' and amount_due_minor = 44424)::int
     from public.due_items where loan_id = public.tr_loan('5b000000-0000-4000-8000-000000000004') $$,
  $$ values (12, 1) $$,
  'the settled instalment is kept as it was'
);

-- ------------------------------------------------------------ another user (42-43)
select set_config('tr.l1', public.tr_loan('5b000000-0000-4000-8000-000000000001')::text, true);
select set_config('request.jwt.claims', '{"sub": "5a000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.revise_loan(current_setting('tr.l1')::uuid, gen_random_uuid(), 'education', 'Example Bank', 900000, 100000,
       1000, 'fixed', 60, 'starts_later', 100000, 60, current_date + 45, 2000, 2000) $$,
  'FC008', null, 'B cannot revise A''s loan (not found)'
);
select is((select count(*)::int from public.loan_revisions), 0, 'B sees none of A''s revisions');
select set_config('request.jwt.claims', '{"sub": "5a000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- ------------------------------------------------------------ direct writes to loan_revisions (44-45)
select throws_ok(
  format($$ insert into public.loan_revisions (loan_id, idempotency_key, old_terms, new_terms, owed_before_minor,
              owed_after_minor, pending_before, pending_after, rebuilt)
            values (%L, gen_random_uuid(), '{"a": 1}', '{"a": 2}', 0, 0, 0, 0, 0) $$, current_setting('tr.l1')),
  'FC032', null, 'a revision can''t be inserted directly'
);
select throws_ok(
  $$ update public.loan_revisions set rebuilt = 0 $$,
  '42501', null, 'a revision can''t be updated'
);

-- ------------------------------------------------------------ the write marks end with each function (46-54)
-- In this one transaction, after each loan function: a direct delete of instalments is
-- refused (no DELETE grant), and so are a direct change of a schedule column (no write mark)
-- and a direct call of the delete helper (no revise mark).
select public.tr_revise('5b000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000005', '{"nickname": "Home"}');
select throws_ok(
  $$ delete from public.due_items where loan_id = public.tr_loan('5b000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'after revise_loan: a direct delete of instalments is refused'
);
select throws_ok(
  $$ update public.loans set disbursed_minor = 1 where idempotency_key = '5b000000-0000-4000-8000-000000000002' $$,
  'FC032', null, 'after revise_loan: a direct change of the amount taken is refused'
);

select public.update_loan(public.tr_loan('5b000000-0000-4000-8000-000000000002'), 'home', 'Example Bank', 2000000, 900,
  'floating', 52000, p_nickname => 'Home loan');
select throws_ok(
  $$ delete from public.due_items where loan_id = public.tr_loan('5b000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'after update_loan: a direct delete of instalments is refused'
);
select throws_ok(
  $$ update public.loans set disbursed_minor = 1 where idempotency_key = '5b000000-0000-4000-8000-000000000002' $$,
  'FC032', null, 'after update_loan: a direct change of the amount taken is refused'
);
select is(public.tr_revisions('5b000000-0000-4000-8000-000000000002'), 3, 'update_loan records its change too');

select public.create_loan('5b000000-0000-4000-8000-000000000005', 'gold', 'Example Bank', 300000, 300000, 900, 'fixed', 6,
  'starts_later', 300000, 6, public.tr_today() + 30, 51000, 51000);
select throws_ok(
  $$ delete from public.due_items where loan_id = public.tr_loan('5b000000-0000-4000-8000-000000000005') $$,
  '42501', null, 'after create_loan: a direct delete of instalments is refused'
);
select throws_ok(
  $$ update public.loans set disbursed_minor = 1 where idempotency_key = '5b000000-0000-4000-8000-000000000005' $$,
  'FC032', null, 'after create_loan: a direct change of the amount taken is refused'
);
select is(current_setting('fin_creador.loan_revise', true), '', 'the revise mark is clear');
select throws_ok(
  $$ select public.loan_delete_instalments(public.tr_loan('5b000000-0000-4000-8000-000000000005')) $$,
  'FC032', null, 'the delete helper works only inside revise_loan'
);
reset role;

select * from finish();
rollback;
