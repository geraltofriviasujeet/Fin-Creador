-- pgTAP tests for card statement import (Sprint 9a.5): lines saved through record_transaction as
-- expenses on the card, then enter_card_statement. No double count when the lines cover the bill;
-- exactly the difference when the bill is larger; one row per request key, a voided key stays
-- voided; another user's card or category is refused. Synthetic data only. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email) values
  ('9a000000-0000-4000-8000-000000000001', 'import-asha@example.test'),
  ('9a000000-0000-4000-8000-000000000002', 'import-bala@example.test');

create function pg_temp.card_acct(p_key uuid) returns uuid language sql stable
  as $$ select c.account_id from public.credit_cards as c where c.idempotency_key = p_key $$;
create function pg_temp.cat(p_key text) returns uuid language sql stable
  as $$ select c.id from public.categories as c where c.system_key = p_key $$;
create function pg_temp.other() returns uuid language sql stable
  as $$ select c.id from public.categories as c where c.kind = 'expense' and c.name = 'Other expenses' $$;
create function pg_temp.tx_count(p_key uuid) returns integer language sql stable
  as $$ select count(*)::int from public.transactions as t where t.idempotency_key = p_key $$;

select set_config('request.jwt.claims', '{"sub": "9a000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

-- Two cards owing nothing when added today.
select public.create_card('9c000000-0000-4000-8000-000000000001', 'Punjab National Bank', 5000000, 15, 4, 0, 'Covered');
select public.create_card('9c000000-0000-4000-8000-000000000002', 'Punjab National Bank', 5000000, 15, 4, 0, 'Short');

-- ------------------------------------------------------------ lines cover the bill (1-4)
select public.record_transaction('expense', '9d000000-0000-4000-8000-000000000001', 178400, public.user_local_today(auth.uid()),
  pg_temp.card_acct('9c000000-0000-4000-8000-000000000001'), pg_temp.other(), p_note => 'FRESH BASKET STORES');
select public.record_transaction('expense', '9d000000-0000-4000-8000-000000000002', 55000, public.user_local_today(auth.uid()),
  pg_temp.card_acct('9c000000-0000-4000-8000-000000000001'), pg_temp.cat('bank_charges'), p_note => 'LATE PAYMENT FEE');
select lives_ok(
  $$ select public.enter_card_statement((select id from public.credit_cards where nickname = 'Covered'), '9e000000-0000-4000-8000-000000000001'::uuid,
       public.user_local_today(auth.uid()), 233400::bigint, 11670::bigint, null::date, 0::bigint, pg_temp.cat('bank_charges')) $$,
  'the statement is entered after its lines'
);
select results_eq(
  $$ select difference_minor, difference_transaction_id is null from public.card_statements where idempotency_key = '9e000000-0000-4000-8000-000000000001' $$,
  $$ values (0::bigint, true) $$,
  'lines that cover the bill: no difference and no difference expense'
);
select is(public.liability_owed(pg_temp.card_acct('9c000000-0000-4000-8000-000000000001')), 233400::bigint, 'what is owed equals the lines, counted once');
select is(
  (select count(*)::int from public.transactions where account_id = pg_temp.card_acct('9c000000-0000-4000-8000-000000000001') and voided_at is null),
  2, 'only the two imported lines are on the card'
);

-- ------------------------------------------------------------ bill larger than the lines (5-7)
select public.record_transaction('expense', '9d000000-0000-4000-8000-000000000003', 200000, public.user_local_today(auth.uid()),
  pg_temp.card_acct('9c000000-0000-4000-8000-000000000002'), pg_temp.other(), p_note => 'PHONE MART');
select public.enter_card_statement((select id from public.credit_cards where nickname = 'Short'), '9e000000-0000-4000-8000-000000000002'::uuid,
  public.user_local_today(auth.uid()), 233400::bigint, 11670::bigint, null::date, 0::bigint, pg_temp.cat('bank_charges'));
select is((select difference_minor from public.card_statements where idempotency_key = '9e000000-0000-4000-8000-000000000002'), 33400::bigint,
  'a bill larger than the lines: the difference is exactly the gap');
select results_eq(
  $$ select t.amount_minor, t.category_id = pg_temp.cat('bank_charges') from public.transactions as t
     join public.card_statements as s on s.difference_transaction_id = t.id where s.idempotency_key = '9e000000-0000-4000-8000-000000000002' $$,
  $$ values (33400::bigint, true) $$,
  'posted once, as Bank charges & interest'
);
select is(public.liability_owed(pg_temp.card_acct('9c000000-0000-4000-8000-000000000002')), 233400::bigint, 'what is owed equals the bill');

-- ------------------------------------------------------------ one row per key (8-11)
select public.record_transaction('expense', '9d000000-0000-4000-8000-000000000001', 178400, public.user_local_today(auth.uid()),
  pg_temp.card_acct('9c000000-0000-4000-8000-000000000001'), pg_temp.other(), p_note => 'FRESH BASKET STORES');
select is(pg_temp.tx_count('9d000000-0000-4000-8000-000000000001'), 1, 'importing a line again posts nothing new');
select public.void_transaction((select id from public.transactions where idempotency_key = '9d000000-0000-4000-8000-000000000003'), gen_random_uuid());
select public.record_transaction('expense', '9d000000-0000-4000-8000-000000000003', 200000, public.user_local_today(auth.uid()),
  pg_temp.card_acct('9c000000-0000-4000-8000-000000000002'), pg_temp.other(), p_note => 'PHONE MART');
select is(pg_temp.tx_count('9d000000-0000-4000-8000-000000000003'), 1, 'a deleted (voided) line imported again posts nothing new');
select ok((select voided_at is not null from public.transactions where idempotency_key = '9d000000-0000-4000-8000-000000000003'), 'and stays voided');
select throws_ok(
  $$ select public.record_transaction('expense', '9d000000-0000-4000-8000-000000000001', 178500, public.user_local_today(auth.uid()),
       pg_temp.card_acct('9c000000-0000-4000-8000-000000000001'), pg_temp.other(), p_note => 'FRESH BASKET STORES') $$,
  'FC007', null, 'the same key with an edited amount is refused, not posted'
);

-- ------------------------------------------------------------ another user (12-14)
select set_config('test.a_card_acct', pg_temp.card_acct('9c000000-0000-4000-8000-000000000001')::text, true);
select set_config('test.a_other', pg_temp.other()::text, true);
select set_config('request.jwt.claims', '{"sub": "9a000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select public.create_card('9c000000-0000-4000-8000-000000000003', 'HDFC Bank', 5000000, 15, 4, 0, 'Bala card');
select throws_ok(
  $$ select public.record_transaction('expense', gen_random_uuid(), 1000, public.user_local_today(auth.uid()),
       current_setting('test.a_card_acct')::uuid, pg_temp.other()) $$,
  'FC010', null, 'a line cannot be posted to another user''s card'
);
select throws_ok(
  $$ select public.record_transaction('expense', gen_random_uuid(), 1000, public.user_local_today(auth.uid()),
       pg_temp.card_acct('9c000000-0000-4000-8000-000000000003'), current_setting('test.a_other')::uuid) $$,
  '23503', null, 'or with another user''s category (the ownership foreign key)'
);
select is((select count(*)::int from public.transactions where idempotency_key::text like '9d000000-%'), 0, 'and another user reads none of the imported lines');

select * from finish();
rollback;
