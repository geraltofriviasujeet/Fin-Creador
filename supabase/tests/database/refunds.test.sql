-- pgTAP tests for refunds (migration 20261104120000). Run with `supabase test db` (CI).
-- Everything is rolled back. Fictional users and amounts only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(67);

-- Users A and B (Asia/Kolkata, the default), fictional.
insert into auth.users (id, email) values
  ('a9c00000-0000-4000-8000-00000000000a', 'riya@example.test'),
  ('b9c00000-0000-4000-8000-00000000000b', 'dev@example.test');

-- Helpers (SECURITY INVOKER: RLS applies to whoever calls them).
create function public.t_today() returns date language sql stable set search_path = ''
  as $$ select public.user_local_today((select auth.uid())) $$;
create function public.t_acct(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select a.id from public.accounts as a where a.name = p_name and a.kind in ('bank', 'cash', 'other') $$;
create function public.t_cat(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select c.id from public.categories as c where c.kind = 'expense' and c.name = p_name $$;
create function public.t_inc(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select c.id from public.categories as c where c.kind = 'income' and c.name = p_name $$;
create function public.t_tx(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select t.id from public.transactions as t where t.idempotency_key = p_key $$;
create function public.t_card(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select c.id from public.credit_cards as c where c.idempotency_key = p_key $$;
create function public.t_card_acct(p_key uuid) returns uuid language sql stable set search_path = ''
  as $$ select c.account_id from public.credit_cards as c where c.idempotency_key = p_key $$;
create function public.t_bal(p_account uuid) returns bigint language sql stable set search_path = ''
  as $$ select a.opening_balance_minor + b.inflow_minor - b.outflow_minor
        from public.accounts as a join public.account_balances as b on b.account_id = a.id where a.id = p_account $$;
-- The SQLSTATE and detail of the error p_sql raises ('none' if it raises nothing).
create function public.t_err(p_sql text) returns text language plpgsql set search_path = ''
  as $$
declare
  v_state text;
  v_detail text;
begin
  execute p_sql;
  return 'none';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
  return v_state || ':' || coalesce(v_detail, '');
end;
$$;
grant execute on function public.t_today(), public.t_acct(text), public.t_cat(text), public.t_inc(text), public.t_tx(uuid),
  public.t_card(uuid), public.t_card_acct(uuid), public.t_bal(uuid), public.t_err(text) to authenticated;

-- ------------------------------------------------------------ privileges (1-3)
select ok(not has_function_privilege('anon', 'public.record_transaction(text, uuid, bigint, date, uuid, uuid, uuid, text, text, uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.record_transaction(text, uuid, bigint, date, uuid, uuid, uuid, text, text, uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.transaction_summary(date, date, uuid, uuid, text, bigint)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.transaction_summary(date, date, uuid, uuid, text, bigint)', 'EXECUTE'),
  'record_transaction and transaction_summary: signed-in users only');
select ok(not has_function_privilege('authenticated', 'public.transactions_refund_links_clear()', 'EXECUTE'),
  'clients cannot call the link-clearing trigger function');
select ok(has_column_privilege('authenticated', 'public.transactions', 'refund_of_id', 'INSERT')
          and has_column_privilege('authenticated', 'public.transactions', 'refund_of_id', 'UPDATE'),
  'the link column is granted (changes still pass the update guard)');

-- ------------------------------------------------------------ as A: accounts
select set_config('request.jwt.claims', '{"sub": "a9c00000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('bank', 'savings', 'R Bank', 'INR', 1000000, public.t_today() - 30);
insert into public.accounts (kind, name, currency, opening_balance_minor, opening_balance_date) values
  ('cash', 'R Cash', 'INR', 5000, public.t_today() - 30);

-- ------------------------------------------------------------ unlinked refunds and their shape (4-9)
select lives_ok(
  $$ select public.record_transaction('refund', 'e1000000-0000-4000-8000-000000000001', 20000, public.t_today() - 2,
       public.t_acct('R Bank'), public.t_cat('Shopping')) $$,
  'a refund into a bank account, in an expense category');
select is(public.t_bal(public.t_acct('R Bank')), 1020000::bigint, '... is an inflow: the balance goes up');
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 100, public.t_today(), public.t_acct('R Bank'), public.t_inc('Salary')) $$,
  'FC006', null, 'a refund cannot take an income category');
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 100, public.t_today(), public.t_acct('R Bank')) $$,
  '23514', null, 'a refund needs a category');
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 100, public.t_today(), public.t_acct('R Bank'), public.t_cat('Shopping'),
       p_payment_mode => 'upi') $$,
  '23514', null, 'a refund has no payment mode');

do $$ begin
  perform public.record_transaction('expense', 'e1000000-0000-4000-8000-000000000002', 5000, public.t_today() - 2,
    public.t_acct('R Bank'), public.t_cat('Shopping'));
end $$;
select throws_ok(
  $$ select public.record_transaction('expense', gen_random_uuid(), 100, public.t_today() - 2, public.t_acct('R Bank'), public.t_cat('Shopping'),
       p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000002')) $$,
  '23514', null, 'only a refund can carry a link');

-- ------------------------------------------------------------ spending nets refunds (10-14)
select results_eq(
  $$ select expense_minor, entry_count from public.dashboard_breakdown(public.t_today() - 2, public.t_today() - 2)
     where kind = 'category' and category_id = public.t_cat('Shopping') $$,
  $$ values (-15000::bigint, 2) $$,
  'a category''s net can be below zero (5,000 spent, 20,000 refunded)');
select results_eq(
  $$ select currency, income_minor, expense_minor, refund_minor, income_count, expense_count, refund_count, transfer_count
     from public.transaction_summary(public.t_today() - 2, public.t_today() - 2) $$,
  $$ values ('INR'::text, 0::bigint, -15000::bigint, 20000::bigint, 0, 1, 1, 0) $$,
  'transaction_summary: expenses net of refunds, refunds counted on their own');
select results_eq(
  $$ select expense_minor from public.dashboard_breakdown(public.t_today() - 2, public.t_today() - 2) where kind = 'day' $$,
  $$ values (-15000::bigint) $$,
  'the day bucket nets the refund too');
select is((select count(*)::int from public.list_transactions(public.t_today() - 2, public.t_today() - 2, p_type => 'refund')), 1,
  'list_transactions has a refund tab');
select is(
  (select sum(case when b.as_of = public.t_today() - 2 then b.balance_minor else -b.balance_minor end)::bigint
   from public.account_balances_at(array[public.t_today() - 3, public.t_today() - 2]) as b
   where b.account_id = public.t_acct('R Bank')),
  15000::bigint, 'account_balances_at counts the refund as an inflow on its date');

-- ------------------------------------------------------------ linked refunds: the cap (15-20)
do $$ begin
  perform public.record_transaction('expense', 'e1000000-0000-4000-8000-000000000010', 10000, public.t_today() - 10,
    public.t_acct('R Bank'), public.t_cat('Groceries'));
end $$;
select lives_ok(
  $$ select public.record_transaction('refund', 'e1000000-0000-4000-8000-000000000011', 6000, public.t_today() - 9,
       public.t_acct('R Bank'), public.t_cat('Groceries'), p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000010')) $$,
  'a partial refund linked to a purchase');
select lives_ok(
  $$ select public.record_transaction('refund', 'e1000000-0000-4000-8000-000000000012', 4000, public.t_today() - 5,
       public.t_acct('R Bank'), public.t_cat('Groceries'), p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000010')) $$,
  'a second partial refund, in a later week, up to the purchase amount');
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 1, public.t_today(),
       public.t_acct('R Bank'), public.t_cat('Groceries'), p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000010')) $$,
  'FC055', null, 'linked refunds cannot add up to more than the purchase');
select is(public.t_err(
  $$ select public.record_transaction('refund', gen_random_uuid(), 1, public.t_today(),
       public.t_acct('R Bank'), public.t_cat('Groceries'), p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000010')) $$),
  'FC055:0', '... and the detail says what is left to refund');
select lives_ok(
  $$ select public.record_transaction('refund', 'e1000000-0000-4000-8000-000000000013', 50000, public.t_today() - 1,
       public.t_acct('R Bank'), public.t_cat('Groceries')) $$,
  'an unlinked refund is not capped (larger than any purchase)');
select lives_ok(
  $$ select public.record_transaction('refund', 'e1000000-0000-4000-8000-000000000014', 50000, public.t_today() - 1,
       public.t_acct('R Bank'), public.t_cat('Groceries')) $$,
  '... nor is a second one in the same category');

-- ------------------------------------------------------------ the cap counts live rows only: editing a refund (21-24)
select lives_ok(
  $$ select public.edit_transaction(public.t_tx('e1000000-0000-4000-8000-000000000011'), 'e1000000-0000-4000-8000-000000000015', 5000,
       public.t_today() - 9, public.t_acct('R Bank'), public.t_cat('Groceries')) $$,
  'a linked refund at the cap can be edited down');
select lives_ok(
  $$ select public.edit_transaction(public.t_tx('e1000000-0000-4000-8000-000000000015'), 'e1000000-0000-4000-8000-000000000016', 6000,
       public.t_today() - 9, public.t_acct('R Bank'), public.t_cat('Groceries')) $$,
  '... and back up to the cap (its voided versions are not counted)');
select is(public.t_err(
  $$ select public.edit_transaction(public.t_tx('e1000000-0000-4000-8000-000000000016'), 'e1000000-0000-4000-8000-000000000017', 6001,
       public.t_today() - 9, public.t_acct('R Bank'), public.t_cat('Groceries')) $$),
  'FC055:6000', 'but not past it (6,000 left beside the other refund)');
select results_eq(
  $$ select refund_of_id, voided_at is null from public.transactions where id = public.t_tx('e1000000-0000-4000-8000-000000000016') $$,
  $$ values (public.t_tx('e1000000-0000-4000-8000-000000000010'), true) $$,
  'the edited refund keeps its link and is the live version');

-- ------------------------------------------------------------ replays (25-26)
select is(
  (public.record_transaction('refund', 'e1000000-0000-4000-8000-000000000012', 4000, public.t_today() - 5,
     public.t_acct('R Bank'), public.t_cat('Groceries'), p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000010'))).id,
  public.t_tx('e1000000-0000-4000-8000-000000000012'), 'a retry of a linked refund returns the saved one');
select throws_ok(
  $$ select public.record_transaction('refund', 'e1000000-0000-4000-8000-000000000012', 4000, public.t_today() - 5,
       public.t_acct('R Bank'), public.t_cat('Groceries'), p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000002')) $$,
  'FC007', null, 'the same key with another link is refused');

-- ------------------------------------------------------------ what a link may point at (27-33)
do $$ begin
  perform public.record_transaction('income', 'e1000000-0000-4000-8000-000000000020', 300000, public.t_today() - 12,
    public.t_acct('R Bank'), public.t_inc('Salary'));
  perform public.record_transaction('expense', 'e1000000-0000-4000-8000-000000000021', 700, public.t_today() - 12,
    public.t_acct('R Bank'), public.t_cat('Shopping'));
  perform public.void_transaction(public.t_tx('e1000000-0000-4000-8000-000000000021'), 'e1000000-0000-4000-8000-000000000023');
  perform public.record_transaction('transfer', 'e1000000-0000-4000-8000-000000000022', 1000, public.t_today() - 12,
    public.t_acct('R Bank'), p_counter_account_id => public.t_acct('R Cash'));
end $$;
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 100, public.t_today(), public.t_acct('R Bank'), public.t_cat('Shopping'),
       p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000020')) $$,
  'FC056', null, 'a refund cannot be linked to income');
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 100, public.t_today(), public.t_acct('R Bank'), public.t_cat('Shopping'),
       p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000022')) $$,
  'FC056', null, 'nor to a transfer');
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 100, public.t_today(), public.t_acct('R Bank'), public.t_cat('Shopping'),
       p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000001')) $$,
  'FC056', null, 'nor to another refund');
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 100, public.t_today() - 3, public.t_acct('R Bank'), public.t_cat('Shopping'),
       p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000002')) $$,
  'FC057', null, 'a refund cannot be dated before its purchase');
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 100, public.t_today(), public.t_acct('R Bank'), public.t_cat('Shopping'),
       p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000021')) $$,
  'FC014', null, 'nor linked to a voided purchase');
select throws_ok(
  $$ update public.transactions set refund_of_id = null where id = public.t_tx('e1000000-0000-4000-8000-000000000012') $$,
  'FC009', null, 'a client cannot clear a link');
select throws_ok(
  $$ update public.transactions set refund_of_id = public.t_tx('e1000000-0000-4000-8000-000000000002')
     where id = public.t_tx('e1000000-0000-4000-8000-000000000013') $$,
  'FC009', null, 'nor set one after the refund is saved');

-- ------------------------------------------------------------ a voided purchase: the refund survives, its link clears (34-39)
do $$ begin
  perform public.record_transaction('expense', 'e1000000-0000-4000-8000-000000000030', 8000, public.t_today() - 6,
    public.t_acct('R Bank'), public.t_cat('Shopping'));
  perform public.record_transaction('refund', 'e1000000-0000-4000-8000-000000000031', 3000, public.t_today() - 4,
    public.t_acct('R Bank'), public.t_cat('Shopping'), p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000030'));
  perform public.record_transaction('refund', 'e1000000-0000-4000-8000-000000000032', 2000, public.t_today() - 4,
    public.t_acct('R Bank'), public.t_cat('Shopping'), p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000030'));
  perform public.void_transaction(public.t_tx('e1000000-0000-4000-8000-000000000032'), 'e1000000-0000-4000-8000-000000000033');
end $$;
select lives_ok(
  $$ select public.void_transaction(public.t_tx('e1000000-0000-4000-8000-000000000030'), 'e1000000-0000-4000-8000-000000000034') $$,
  'a purchase with a linked refund can be voided');
select results_eq(
  $$ select voided_at is null, refund_of_id from public.transactions where id = public.t_tx('e1000000-0000-4000-8000-000000000031') $$,
  $$ values (true, null::uuid) $$,
  '... its refund stays posted and the link clears');
select results_eq(
  $$ select refund_minor, refund_count from public.transaction_summary(public.t_today() - 4, public.t_today() - 4) $$,
  $$ values (3000::bigint, 1) $$,
  '... and still counts (the voided refund does not)');
select is((select refund_of_id from public.transactions where id = public.t_tx('e1000000-0000-4000-8000-000000000032')),
  public.t_tx('e1000000-0000-4000-8000-000000000030'), 'a voided refund is left as it was');

do $$ begin
  perform public.record_transaction('expense', 'e1000000-0000-4000-8000-000000000040', 1000, public.t_today() - 7,
    public.t_acct('R Bank'), public.t_cat('Shopping'));
  perform public.record_transaction('refund', 'e1000000-0000-4000-8000-000000000041', 500, public.t_today() - 7,
    public.t_acct('R Bank'), public.t_cat('Shopping'), p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000040'));
end $$;
select lives_ok(
  $$ update public.transactions set voided_at = now(), void_idempotency_key = 'e1000000-0000-4000-8000-000000000042'
     where id = public.t_tx('e1000000-0000-4000-8000-000000000040') $$,
  'a purchase voided by a direct update');
select results_eq(
  $$ select voided_at is null, refund_of_id from public.transactions where id = public.t_tx('e1000000-0000-4000-8000-000000000041') $$,
  $$ values (true, null::uuid) $$,
  '... clears its refund''s link too');

-- ------------------------------------------------------------ an edited purchase: the links follow (40-45)
do $$ begin
  perform public.record_transaction('expense', 'e1000000-0000-4000-8000-000000000050', 10000, public.t_today() - 6,
    public.t_acct('R Bank'), public.t_cat('Groceries'));
  perform public.record_transaction('refund', 'e1000000-0000-4000-8000-000000000051', 4000, public.t_today() - 3,
    public.t_acct('R Bank'), public.t_cat('Groceries'), p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000050'));
end $$;
select lives_ok(
  $$ select public.edit_transaction(public.t_tx('e1000000-0000-4000-8000-000000000050'), 'e1000000-0000-4000-8000-000000000052', 9000,
       public.t_today() - 6, public.t_acct('R Bank'), public.t_cat('Groceries')) $$,
  'a purchase with a linked refund can be edited');
select is((select refund_of_id from public.transactions where id = public.t_tx('e1000000-0000-4000-8000-000000000051')),
  public.t_tx('e1000000-0000-4000-8000-000000000052'), '... and the refund now points at the new version');
select throws_ok(
  $$ select public.edit_transaction(public.t_tx('e1000000-0000-4000-8000-000000000052'), 'e1000000-0000-4000-8000-000000000053', 3999,
       public.t_today() - 6, public.t_acct('R Bank'), public.t_cat('Groceries')) $$,
  'FC055', null, 'an edit below its linked refunds is refused');
select results_eq(
  $$ select (select voided_at is null from public.transactions where id = public.t_tx('e1000000-0000-4000-8000-000000000052')),
            (select refund_of_id from public.transactions where id = public.t_tx('e1000000-0000-4000-8000-000000000051')) $$,
  $$ values (true, public.t_tx('e1000000-0000-4000-8000-000000000052')) $$,
  '... as a whole: the purchase is still live and the link unchanged');
select throws_ok(
  $$ select public.edit_transaction(public.t_tx('e1000000-0000-4000-8000-000000000052'), 'e1000000-0000-4000-8000-000000000054', 9000,
       public.t_today() - 2, public.t_acct('R Bank'), public.t_cat('Groceries')) $$,
  'FC057', null, 'an edit that dates the purchase after its refund is refused');
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 100, public.t_today(), public.t_acct('R Bank'), public.t_cat('Groceries'),
       p_refund_of_id => public.t_tx('e1000000-0000-4000-8000-000000000050')) $$,
  'FC014', null, 'a refund cannot be linked to a replaced version');

-- ------------------------------------------------------------ cards: refunds, credit, statements (46-62)
do $$ begin
  perform public.create_card('e2000000-0000-4000-8000-000000000001', 'R Issuer', 10000000, 20, 8, 100000, 'R one');
  perform public.create_card('e2000000-0000-4000-8000-000000000002', 'R Issuer', 10000000, 20, 8, 0, 'R two');
  perform public.create_card('e2000000-0000-4000-8000-000000000003', 'R Issuer', 10000000, 20, 8, 0, 'R three');
  perform public.create_card('e2000000-0000-4000-8000-000000000004', 'R Issuer', 10000000, 20, 8, 0, 'R four');
end $$;

select lives_ok(
  $$ select public.record_transaction('expense', 'e2000000-0000-4000-8000-000000000011', 200000, public.t_today(),
       public.t_card_acct('e2000000-0000-4000-8000-000000000001'), public.t_cat('Travel')) $$,
  'a card purchase');
select lives_ok(
  $$ select public.record_transaction('refund', 'e2000000-0000-4000-8000-000000000012', 50000, public.t_today(),
       public.t_card_acct('e2000000-0000-4000-8000-000000000001'), public.t_cat('Travel'),
       p_refund_of_id => public.t_tx('e2000000-0000-4000-8000-000000000011')) $$,
  'a card refund (a credit on the card), linked to it');
select is(public.liability_owed(public.t_card_acct('e2000000-0000-4000-8000-000000000001')), 250000::bigint,
  '... lowers what is owed (1,000 + 2,000 − 500)');
select results_eq(
  $$ select s.owed_at_statement_minor, s.difference_minor
     from public.enter_card_statement(public.t_card('e2000000-0000-4000-8000-000000000001'), 'e2000000-0000-4000-8000-000000000021',
       public.t_today(), 250000, 0, null, 0, public.t_cat('Other expenses')) as s $$,
  $$ values (250000::bigint, 0::bigint) $$,
  'a statement net of the refund matches what is owed: no difference');

-- Card two: 1,000 bought, 400 refunded, the statement says 800: the difference is 200 (it was 0
-- before refunds counted, when 1,000 looked owed).
do $$ begin
  perform public.record_transaction('expense', 'e2000000-0000-4000-8000-000000000031', 100000, public.t_today(),
    public.t_card_acct('e2000000-0000-4000-8000-000000000002'), public.t_cat('Travel'));
  perform public.record_transaction('refund', 'e2000000-0000-4000-8000-000000000032', 40000, public.t_today(),
    public.t_card_acct('e2000000-0000-4000-8000-000000000002'), public.t_cat('Travel'));
end $$;
select results_eq(
  $$ select s.owed_at_statement_minor, s.difference_minor
     from public.enter_card_statement(public.t_card('e2000000-0000-4000-8000-000000000002'), 'e2000000-0000-4000-8000-000000000022',
       public.t_today(), 80000, 0, null, 0, public.t_cat('Other expenses')) as s $$,
  $$ values (60000::bigint, 20000::bigint) $$,
  'enter_card_statement measures owed net of refunds, so the difference is bill − (purchases − refunds)');
select is(public.liability_owed(public.t_card_acct('e2000000-0000-4000-8000-000000000002')), 80000::bigint,
  '... and after the difference the card owes the bill');
select lives_ok(
  $$ select public.record_transaction('refund', 'e2000000-0000-4000-8000-000000000033', 80000, public.t_today(),
       public.t_card_acct('e2000000-0000-4000-8000-000000000002'), public.t_cat('Travel')) $$,
  'a refund after the statement');
select results_eq(
  $$ select public.card_bill_paid(d.id), d.status from public.due_items as d
     join public.card_statements as s on s.id = d.card_statement_id where s.idempotency_key = 'e2000000-0000-4000-8000-000000000022' $$,
  $$ values (0::bigint, 'pending'::text) $$,
  '... never pays the bill');
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 100, public.t_today(), public.t_card_acct('e2000000-0000-4000-8000-000000000002'),
       public.t_cat('Travel'),
       p_refund_of_id => (select difference_transaction_id from public.card_statements where idempotency_key = 'e2000000-0000-4000-8000-000000000022')) $$,
  'FC056', null, 'a statement difference cannot take a linked refund');

-- Card three: 100 bought, 300 refunded: in credit.
do $$ begin
  perform public.record_transaction('expense', 'e2000000-0000-4000-8000-000000000041', 10000, public.t_today(),
    public.t_card_acct('e2000000-0000-4000-8000-000000000003'), public.t_cat('Travel'));
  perform public.record_transaction('refund', 'e2000000-0000-4000-8000-000000000042', 30000, public.t_today(),
    public.t_card_acct('e2000000-0000-4000-8000-000000000003'), public.t_cat('Travel'));
end $$;
select is(public.liability_owed(public.t_card_acct('e2000000-0000-4000-8000-000000000003')), -20000::bigint,
  'a card can go into credit (owed below zero)');
select is(public.t_bal(public.t_card_acct('e2000000-0000-4000-8000-000000000003')), 20000::bigint,
  '... its balance is above zero (net worth counts it as an asset, not in Total available)');
select results_eq(
  $$ select s.owed_at_statement_minor, s.difference_minor, s.difference_transaction_id is null
     from public.enter_card_statement(public.t_card('e2000000-0000-4000-8000-000000000003'), 'e2000000-0000-4000-8000-000000000023',
       public.t_today(), 0, 0, null, 0, public.t_cat('Other expenses')) as s $$,
  $$ values (-20000::bigint, 0::bigint, true) $$,
  'a zero statement for a card in credit posts no difference');
select is((select count(*)::int from public.due_items as d join public.card_statements as s on s.id = d.card_statement_id
           where s.idempotency_key = 'e2000000-0000-4000-8000-000000000023'), 0, '... and has no bill');

-- Card four: 50 refunded with nothing bought (in credit 50), the statement says 300 owed.
do $$ begin
  perform public.record_transaction('refund', 'e2000000-0000-4000-8000-000000000051', 5000, public.t_today(),
    public.t_card_acct('e2000000-0000-4000-8000-000000000004'), public.t_cat('Travel'));
end $$;
select results_eq(
  $$ select s.owed_at_statement_minor, s.difference_minor
     from public.enter_card_statement(public.t_card('e2000000-0000-4000-8000-000000000004'), 'e2000000-0000-4000-8000-000000000024',
       public.t_today(), 30000, 0, null, 0, public.t_cat('Other expenses')) as s $$,
  $$ values (-5000::bigint, 35000::bigint) $$,
  'a bill above zero for a card in credit: the difference is bill − owed (300 + 50)');
select throws_ok(
  $$ select public.record_transaction('income', gen_random_uuid(), 100, public.t_today(), public.t_card_acct('e2000000-0000-4000-8000-000000000001'),
       public.t_inc('Salary')) $$,
  'FC049', null, 'income still cannot be recorded on a card');
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 100, public.t_today() - 1, public.t_card_acct('e2000000-0000-4000-8000-000000000001'),
       public.t_cat('Travel')) $$,
  'FC036', null, 'nor a card refund dated before the card was added');
select is(
  (select balance_minor from public.account_balances_at(array[public.t_today()]) as b
   where b.account_id = public.t_card_acct('e2000000-0000-4000-8000-000000000003')),
  20000::bigint, 'account_balances_at (the net worth trend) shows the card in credit');

-- ------------------------------------------------------------ cash on hand counts today's refunds (63)
do $$ begin
  perform public.record_transaction('refund', 'e3000000-0000-4000-8000-000000000001', 1000, public.t_today(),
    public.t_acct('R Cash'), public.t_cat('Food & dining'));
  perform public.set_cash_on_hand(public.t_acct('R Cash'), 7000);
end $$;
select is(public.t_bal(public.t_acct('R Cash')), 7000::bigint, 'set_cash_on_hand treats a refund today as cash already held');

-- ------------------------------------------------------------ as B: isolation (64-66)
-- A's purchase and refund ids, kept for the B tests (B cannot read them).
select set_config('t.a_purchase', public.t_tx('e1000000-0000-4000-8000-000000000002')::text, true);
select set_config('t.a_refund', public.t_tx('e1000000-0000-4000-8000-000000000013')::text, true);
select set_config('request.jwt.claims', '{"sub": "b9c00000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
insert into public.accounts (kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('bank', 'savings', 'B Bank', 'INR', 100000, public.t_today() - 30);

select is((select count(*)::int from public.transactions where type = 'refund'), 0, 'B sees none of A''s refunds');
select throws_ok(
  $$ select public.record_transaction('refund', gen_random_uuid(), 100, public.t_today(), public.t_acct('B Bank'), public.t_cat('Shopping'),
       p_refund_of_id => current_setting('t.a_purchase')::uuid) $$,
  'FC008', null, 'B cannot link a refund to A''s purchase');
select is(public.t_err(
  $$ update public.transactions set refund_of_id = null where id = current_setting('t.a_refund')::uuid $$),
  'none', 'B''s update of A''s refund touches nothing (RLS)');
reset role;
select is((select count(*)::int from public.transactions where type = 'refund' and user_id = 'b9c00000-0000-4000-8000-00000000000b'), 0,
  'B has no refunds after the attempts');

select * from finish();
rollback;
