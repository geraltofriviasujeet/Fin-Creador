-- pgTAP tests for instruments and investments (migration 20261027120000). Run with
-- `supabase test db` (CI). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(71);

-- Users A and B (fictional). A lives far east of UTC (UTC+14), B far west (UTC-11), so their
-- local dates differ from each other (by 1 or 2 days) and often from the server's.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bala@example.test');
update public.profiles set time_zone = 'Pacific/Kiritimati' where id = '11111111-1111-4111-8111-111111111111';
update public.profiles set time_zone = 'Pacific/Pago_Pago' where id = '22222222-2222-4222-8222-222222222222';

-- A's local date.
create function public.t_today_a() returns date language sql stable security definer set search_path = ''
  as $$ select public.user_local_today('11111111-1111-4111-8111-111111111111') $$;
grant execute on function public.t_today_a() to authenticated, service_role;

-- Instruments (made up), dated relative to A's local date.
insert into public.instruments (id, source, source_code, isin, symbol, name, kind, last_price_scaled, price_date) values
  ('a7000000-0000-4000-8000-000000000001', 'bse', '500001', 'INE000X01011', 'EXMPL', 'Example Industries Ltd', 'share', 1005500, public.t_today_a()),
  ('a7000000-0000-4000-8000-000000000002', 'bse', '500002', null, 'SAMPLE', 'Sample 100% Growth_Co', 'share', 100500, public.t_today_a() - 30),
  ('a7000000-0000-4000-8000-000000000003', 'amfi', '100001', 'INF000A01AA1', null, 'Axis Example Flexi Cap Fund - Direct Plan - Growth', 'fund', 287924, public.t_today_a() - 31),
  ('a7000000-0000-4000-8000-000000000004', 'amfi', '100002', 'INF000A01AB9', null, 'Axis Example ELSS Tax Saver - Direct - Growth', 'fund', 512345, public.t_today_a());
insert into public.instruments (source, source_code, name, kind, last_price_scaled, price_date)
  select 'amfi', (200000 + g)::text, 'Filler fund ' || g, 'fund', 100000, public.t_today_a() from generate_series(1, 60) as g;

-- ------------------------------------------------------------ privileges
select ok(not has_table_privilege('anon', 'public.instruments', 'SELECT') and not has_table_privilege('anon', 'public.investments', 'SELECT'),
  'anon has no access to either table');
select ok(not has_function_privilege('anon', 'public.search_instruments(text, integer)', 'EXECUTE'), 'anon cannot search instruments');
select ok(not has_table_privilege('authenticated', 'public.instruments', 'INSERT')
          and not has_table_privilege('authenticated', 'public.instruments', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.instruments', 'DELETE'),
  'clients cannot write instruments');
select ok(not has_table_privilege('service_role', 'public.instruments', 'DELETE'), 'nobody deletes instruments, not even the service role');
select ok(not has_column_privilege('authenticated', 'public.investments', 'isin_at_entry', 'INSERT')
          and not has_column_privilege('authenticated', 'public.investments', 'isin_at_entry', 'UPDATE'),
  'clients cannot set isin_at_entry');
select ok(not has_column_privilege('authenticated', 'public.investments', 'user_id', 'INSERT'), 'clients cannot choose a record''s owner');
select ok(not has_function_privilege('authenticated', 'public.investments_validate()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.instruments_guard()', 'EXECUTE'),
  'clients cannot call the trigger functions');

-- ------------------------------------------------------------ as A
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.instruments), 64, 'clients can read all instruments');
select throws_ok(
  $$ insert into public.instruments (source, source_code, name, kind, last_price_scaled, price_date) values ('bse', '599999', 'X', 'share', 1, current_date) $$,
  '42501', null, 'a client cannot add an instrument'
);
select throws_ok($$ update public.instruments set last_price_scaled = 1 $$, '42501', null, 'a client cannot change a price');
select throws_ok($$ delete from public.instruments $$, '42501', null, 'a client cannot delete instruments');

-- search
select results_eq($$ select source_code from public.search_instruments('100%') $$, $$ values ('500002'::text) $$,
  '% is literal (strpos, not LIKE)');
select results_eq($$ select source_code from public.search_instruments('h_co') $$, $$ values ('500002'::text) $$,
  '_ is literal');
select is((select count(*)::int from public.search_instruments('%%')), 0, 'a query of only % matches nothing');
select results_eq($$ select source_code from public.search_instruments('  AXIS   direct growth ') $$, $$ values ('100002'::text) $$,
  'every word must appear in the name, in any case and spacing');
select results_eq($$ select source_code from public.search_instruments('growth example') $$, $$ values ('100002'::text) $$,
  'word order does not matter');
select results_eq($$ select source_code from public.search_instruments('500001') $$, $$ values ('500001'::text) $$,
  'an exact scrip code matches');
select results_eq($$ select source_code from public.search_instruments('ine000x01011') $$, $$ values ('500001'::text) $$,
  'an exact ISIN matches, in any case');
select results_eq($$ select source_code from public.search_instruments('exmpl') $$, $$ values ('500001'::text) $$,
  'an exact ticker matches');
select results_eq($$ select source_code from public.search_instruments('exm') $$, $$ values ('500001'::text) $$,
  'a ticker prefix matches');
select results_eq($$ select source_code from public.search_instruments('example') $$, $$ values ('500001'::text), ('100002'::text) $$,
  'names starting with the query come first');
select is((select count(*)::int from public.search_instruments('sample')), 1, 'a price exactly 30 days old (A''s date) is searchable');
select is((select count(*)::int from public.search_instruments('flexi cap')), 0, 'a price 31 days old (A''s date) is not searchable');
select is((select count(*)::int from public.search_instruments('filler')), 20, 'the default limit is 20');
select is((select count(*)::int from public.search_instruments('filler', 0)), 1, 'a limit below 1 becomes 1');
select is((select count(*)::int from public.search_instruments('filler', 1000)), 50, 'a limit above 50 becomes 50');
select is((select count(*)::int from public.search_instruments('filler', null)), 20, 'a null limit becomes 20');
select is((select count(*)::int from public.search_instruments('f')), 0, 'a 1-character query returns nothing');
select is((select count(*)::int from public.search_instruments(repeat('f', 101))), 0, 'a 101-character query returns nothing');
select is((select count(*)::int from public.search_instruments(null)), 0, 'a null query returns nothing');

-- investments
select lives_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000001', 105000, 1002500, public.t_today_a(), 'e7000000-0000-4000-8000-000000000001') $$,
  'A adds a record dated A''s today (UTC+14)'
);
select results_eq(
  $$ select isin_at_entry, user_id::text, archived_at is null from public.investments where idempotency_key = 'e7000000-0000-4000-8000-000000000001' $$,
  $$ values ('INE000X01011'::text, '11111111-1111-4111-8111-111111111111'::text, true) $$,
  'isin_at_entry is copied from the instrument and the owner is A'
);
select lives_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000002', 10000, 0, '1999-01-04', 'e7000000-0000-4000-8000-000000000002') $$,
  'a buy price of 0 is allowed'
);
select is((select isin_at_entry from public.investments where idempotency_key = 'e7000000-0000-4000-8000-000000000002'), null,
  'an instrument without an ISIN gives a null isin_at_entry');
select throws_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, isin_at_entry, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000001', 1, 1, '2020-01-01', 'INE000X01029', 'e7000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'a client cannot set isin_at_entry'
);
select throws_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-0000000000ff', 1, 1, '2020-01-01', 'e7000000-0000-4000-8000-000000000004') $$,
  'FC029', null, 'an unknown instrument is refused'
);
select throws_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000001', 1, 1, public.t_today_a() + 1, 'e7000000-0000-4000-8000-000000000005') $$,
  'FC028', null, 'a buy date after A''s today is refused'
);
select throws_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000001', 1, 1, '2020-01-01', 'e7000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'the same request key cannot add a second record (the writer returns the first)'
);
select throws_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000001', 0, 1, '2020-01-01', 'e7000000-0000-4000-8000-000000000006') $$,
  '23514', null, 'units of 0 are refused'
);
select throws_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000001', -1, 1, '2020-01-01', 'e7000000-0000-4000-8000-000000000007') $$,
  '23514', null, 'negative units are refused'
);
select throws_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000001', 10000000000001, 1, '2020-01-01', 'e7000000-0000-4000-8000-000000000008') $$,
  '23514', null, 'units over 10^9 are refused'
);
select throws_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000001', 1, -1, '2020-01-01', 'e7000000-0000-4000-8000-000000000009') $$,
  '23514', null, 'a negative buy price is refused'
);
select lives_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000001', 10000000000000, 1000000, '2020-01-01', 'e7000000-0000-4000-8000-00000000000a') $$,
  'invested exactly 10^13 paise (10^9 units at ₹100) is allowed'
);
select throws_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000001', 10000000000000, 1000001, '2020-01-01', 'e7000000-0000-4000-8000-00000000000b') $$,
  '23514', null, 'invested one step above 10^13 paise is refused'
);

-- edits
select lives_ok(
  $$ update public.investments set units_scaled = 200000, buy_price_scaled = 990000, buy_date = public.t_today_a() - 1
     where idempotency_key = 'e7000000-0000-4000-8000-000000000001' $$,
  'A edits a record in place'
);
select throws_ok(
  $$ update public.investments set buy_date = public.t_today_a() + 1 where idempotency_key = 'e7000000-0000-4000-8000-000000000001' $$,
  'FC028', null, 'an edit cannot move the buy date after A''s today'
);
select throws_ok(
  $$ update public.investments set instrument_id = 'a7000000-0000-4000-8000-000000000004' where idempotency_key = 'e7000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a client cannot change a record''s instrument'
);
select throws_ok(
  $$ update public.investments set isin_at_entry = null where idempotency_key = 'e7000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a client cannot change isin_at_entry'
);

update public.investments set archived_at = '2000-01-01' where idempotency_key = 'e7000000-0000-4000-8000-000000000001';
select ok(
  (select archived_at > now() - interval '1 minute' from public.investments where idempotency_key = 'e7000000-0000-4000-8000-000000000001'),
  'archiving stamps the server time, not the client''s'
);
select throws_ok(
  $$ update public.investments set units_scaled = 1 where idempotency_key = 'e7000000-0000-4000-8000-000000000001' $$,
  'FC027', null, 'an archived record cannot be edited'
);
select throws_ok(
  $$ update public.investments set archived_at = null, units_scaled = 1 where idempotency_key = 'e7000000-0000-4000-8000-000000000001' $$,
  'FC027', null, 'restoring and editing in one step is refused'
);
select lives_ok(
  $$ update public.investments set archived_at = null where idempotency_key = 'e7000000-0000-4000-8000-000000000001' $$,
  'an archived record can be restored'
);
select is((select units_scaled from public.investments where idempotency_key = 'e7000000-0000-4000-8000-000000000001'), 200000::bigint,
  'restoring keeps the record as it was');

-- permanent delete: only archived records
delete from public.investments where idempotency_key = 'e7000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.investments where idempotency_key = 'e7000000-0000-4000-8000-000000000001'), 1,
  'an active record cannot be deleted (the delete matches no row)');
update public.investments set archived_at = now() where idempotency_key = 'e7000000-0000-4000-8000-00000000000a';
delete from public.investments where idempotency_key = 'e7000000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.investments where idempotency_key = 'e7000000-0000-4000-8000-00000000000a'), 0,
  'an archived record can be deleted permanently');
-- Archived, for the other-user check below.
update public.investments set archived_at = now() where idempotency_key = 'e7000000-0000-4000-8000-000000000002';

-- ------------------------------------------------------------ as B (UTC-11)
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);

select is((select count(*)::int from public.investments), 0, 'B cannot see A''s records');
update public.investments set units_scaled = 1;
delete from public.investments;
select is((select count(*)::int from public.search_instruments('flexi cap')), 1,
  'the 30-day cutoff uses B''s own date (31 days for A is within 30 for B)');
select throws_ok(
  $$ insert into public.investments (user_id, instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'a7000000-0000-4000-8000-000000000001', 1, 1, '2020-01-01', 'e7000000-0000-4000-8000-0000000000b1') $$,
  '42501', null, 'B cannot add a record for A'
);
select throws_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000001', 1, 1, public.user_local_today('22222222-2222-4222-8222-222222222222') + 1, 'e7000000-0000-4000-8000-0000000000b2') $$,
  'FC028', null, 'B cannot use a date after B''s today, even if it is today in UTC'
);
select lives_ok(
  $$ insert into public.investments (instrument_id, units_scaled, buy_price_scaled, buy_date, idempotency_key)
     values ('a7000000-0000-4000-8000-000000000001', 1, 1, public.user_local_today('22222222-2222-4222-8222-222222222222'), 'e7000000-0000-4000-8000-0000000000b3') $$,
  'B can use B''s today (UTC-11)'
);

-- ------------------------------------------------------------ anon
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select public.search_instruments('example') $$, '42501', null, 'anon cannot search');
select throws_ok($$ select count(*) from public.instruments $$, '42501', null, 'anon cannot read instruments');
select throws_ok($$ select count(*) from public.investments $$, '42501', null, 'anon cannot read investments');

-- ------------------------------------------------------------ back as the test owner
reset role;
select results_eq(
  $$ select units_scaled, archived_at is not null from public.investments
     where idempotency_key in ('e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002') order by idempotency_key $$,
  $$ values (200000::bigint, false), (10000::bigint, true) $$,
  'B''s update and delete changed none of A''s records'
);
select throws_ok(
  $$ update public.investments set instrument_id = 'a7000000-0000-4000-8000-000000000004' where idempotency_key = 'e7000000-0000-4000-8000-000000000001' $$,
  'FC009', null, 'even with full privileges a record''s instrument cannot change'
);

-- ------------------------------------------------------------ the refresh (service role)
set local role service_role;
select lives_ok(
  $$ insert into public.instruments (source, source_code, isin, symbol, name, kind, last_price_scaled, price_date)
     values ('bse', '500003', 'INE000X01037', 'NEWCO', 'Newco Ltd', 'share', 250000, public.t_today_a()),
            ('bse', '500001', null, 'EXMPL', 'Example Industries Limited', 'share', 1, public.t_today_a() - 1)
     on conflict (source, source_code) do update
       set isin = excluded.isin, symbol = excluded.symbol, name = excluded.name,
           last_price_scaled = excluded.last_price_scaled, price_date = excluded.price_date $$,
  'the service role can upsert instruments'
);
select results_eq(
  $$ select name, isin, last_price_scaled, price_date from public.instruments where source_code = '500001' $$,
  $$ select 'Example Industries Limited'::text, 'INE000X01011'::text, 1005500::bigint, public.t_today_a() $$,
  'an older price date keeps the stored price, a null ISIN keeps the stored one, the name still updates'
);
update public.instruments set last_price_scaled = 1010000, price_date = public.t_today_a() + 1, isin = 'INE000X01029'
  where source_code = '500001';
select results_eq(
  $$ select isin, last_price_scaled, price_date from public.instruments where source_code = '500001' $$,
  $$ select 'INE000X01029'::text, 1010000::bigint, public.t_today_a() + 1 $$,
  'a newer price and a new ISIN replace the stored ones'
);
select throws_ok($$ update public.instruments set kind = 'etf' where source_code = '500001' $$, 'FC009', null, 'an instrument''s kind cannot change');
select throws_ok($$ update public.instruments set source_code = '599999' where source_code = '500001' $$, 'FC009', null, 'an instrument''s code cannot change');
select throws_ok($$ update public.instruments set last_price_scaled = 0 where source_code = '500002' $$, '23514', null, 'a price of 0 is refused');
reset role;

select * from finish();
rollback;
