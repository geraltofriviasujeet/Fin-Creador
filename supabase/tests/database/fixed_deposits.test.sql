-- pgTAP tests for fixed deposits (migration 20261027200000). Run with `supabase test db`
-- (CI). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(48);

-- Users A and B (fictional). A lives far east of UTC (UTC+14), B far west (UTC-11): A's local
-- date is always 1 or 2 days after B's.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bala@example.test');
update public.profiles set time_zone = 'Pacific/Kiritimati' where id = '11111111-1111-4111-8111-111111111111';
update public.profiles set time_zone = 'Pacific/Pago_Pago' where id = '22222222-2222-4222-8222-222222222222';

create function public.t_today_a() returns date language sql stable security definer set search_path = ''
  as $$ select public.user_local_today('11111111-1111-4111-8111-111111111111') $$;
create function public.t_today_b() returns date language sql stable security definer set search_path = ''
  as $$ select public.user_local_today('22222222-2222-4222-8222-222222222222') $$;
grant execute on function public.t_today_a() to authenticated;
grant execute on function public.t_today_b() to authenticated;

-- ------------------------------------------------------------ privileges
select ok(not has_table_privilege('anon', 'public.fixed_deposits', 'SELECT')
          and not has_table_privilege('anon', 'public.fixed_deposits', 'INSERT'),
  'anon has no access');
select ok(not has_column_privilege('authenticated', 'public.fixed_deposits', 'user_id', 'INSERT')
          and not has_column_privilege('authenticated', 'public.fixed_deposits', 'archived_at', 'INSERT')
          and not has_column_privilege('authenticated', 'public.fixed_deposits', 'created_at', 'INSERT'),
  'clients cannot choose the owner, an archive time or created_at on insert');
select ok(not has_column_privilege('authenticated', 'public.fixed_deposits', 'user_id', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.fixed_deposits', 'idempotency_key', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.fixed_deposits', 'created_at', 'UPDATE'),
  'clients cannot change the owner, the request key or created_at');
select ok(has_column_privilege('authenticated', 'public.fixed_deposits', 'label', 'INSERT')
          and has_column_privilege('authenticated', 'public.fixed_deposits', 'label', 'UPDATE'),
  'clients can set and edit the label');
select ok(not has_function_privilege('authenticated', 'public.fixed_deposits_validate()', 'EXECUTE'), 'clients cannot call the trigger function');

-- ------------------------------------------------------------ as A
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$ insert into public.fixed_deposits (bank, label, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('  State   Bank of  India ', '  Emergency   fund ', 10000000, 725, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-000000000001') $$,
  'A adds a fixed deposit'
);
select results_eq(
  $$ select bank, label, compounding, archived_at is null from public.fixed_deposits where idempotency_key = 'fd000000-0000-4000-8000-000000000001' $$,
  $$ values ('State Bank of India'::text, 'Emergency fund'::text, 'quarterly'::text, true) $$,
  'bank and label spaces are normalised; quarterly is the default'
);
insert into public.fixed_deposits (bank, label, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
  values ('HDFC Bank', '   ', 1, 0, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-000000000002');
select is((select label from public.fixed_deposits where idempotency_key = 'fd000000-0000-4000-8000-000000000002'), null,
  'a blank label is stored as no label (and rate 0 is allowed)');
select throws_ok(
  $$ insert into public.fixed_deposits (bank, label, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('HDFC Bank', repeat('x', 41), 1, 0, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-000000000003') $$,
  '23514', null, 'a label over 40 characters is refused'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('   ', 1, 0, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-000000000004') $$,
  '23514', null, 'a blank bank is refused'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values (repeat('x', 81), 1, 0, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-000000000005') $$,
  '23514', null, 'a bank over 80 characters is refused'
);

-- principal
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 0, 700, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-000000000006') $$,
  '23514', null, 'a principal of 0 is refused'
);
select lives_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 10000000000000, 700, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-000000000007') $$,
  'the principal cap (10^13 paise) is allowed'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 10000000000001, 700, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-000000000008') $$,
  '23514', null, 'a principal over the cap is refused'
);

-- rate
select lives_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 2500, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-000000000009') $$,
  'a rate of 25% (2500 bp) is allowed'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 2501, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-00000000000a') $$,
  '23514', null, 'a rate over 25% is refused'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, -1, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-00000000000b') $$,
  '23514', null, 'a negative rate is refused'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, compounding, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, 'daily', '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-00000000000c') $$,
  '23514', null, 'only monthly, quarterly, half-yearly and yearly compounding'
);

-- dates and tenure
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, '2025-01-15', '2025-01-15', 'fd000000-0000-4000-8000-00000000000d') $$,
  '23514', null, 'maturity on the start date is refused'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, '2025-01-15', '2025-01-14', 'fd000000-0000-4000-8000-00000000000e') $$,
  '23514', null, 'maturity before the start is refused'
);
select lives_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, '2016-02-29', '2026-02-28', 'fd000000-0000-4000-8000-00000000000f') $$,
  'a 29 February start may mature on 28 February ten years later'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, '2016-02-29', '2026-03-01', 'fd000000-0000-4000-8000-000000000010') $$,
  '23514', null, '... but not on 1 March'
);
select lives_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, '2015-06-15', '2025-06-15', 'fd000000-0000-4000-8000-000000000011') $$,
  'exactly 10 years is allowed'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, '2015-06-15', '2025-06-16', 'fd000000-0000-4000-8000-000000000012') $$,
  '23514', null, '10 years and one day is refused'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, public.t_today_a() + 1, public.t_today_a() + 400, 'fd000000-0000-4000-8000-000000000013') $$,
  'FC031', null, 'a start after A''s today is refused'
);
select lives_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, public.t_today_a(), public.t_today_a() + 400, 'fd000000-0000-4000-8000-000000000014') $$,
  'a start on A''s today is allowed'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'a repeated request key is refused (the writer answers with the first deposit)'
);

-- edit in place
select lives_ok(
  $$ update public.fixed_deposits set bank = 'SBI', label = 'Tax saver', principal_minor = 20000000, rate_bps = 650,
       compounding = 'monthly', maturity_date = '2027-01-15'
     where idempotency_key = 'fd000000-0000-4000-8000-000000000001' $$,
  'an active deposit is edited in place'
);
select throws_ok(
  $$ update public.fixed_deposits set start_date = public.t_today_a() + 1 where idempotency_key = 'fd000000-0000-4000-8000-000000000001' $$,
  'FC031', null, 'an edit cannot move the start after A''s today'
);
select throws_ok(
  $$ update public.fixed_deposits set idempotency_key = gen_random_uuid() where idempotency_key = 'fd000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'the request key cannot change'
);

-- archive, restore, delete
update public.fixed_deposits set archived_at = '2000-01-01' where idempotency_key = 'fd000000-0000-4000-8000-000000000001';
select ok((select archived_at > now() - interval '1 minute' from public.fixed_deposits where idempotency_key = 'fd000000-0000-4000-8000-000000000001'),
  'archive stamps the server time, not the client''s');
select throws_ok(
  $$ update public.fixed_deposits set rate_bps = 700 where idempotency_key = 'fd000000-0000-4000-8000-000000000001' $$,
  'FC030', null, 'an archived deposit cannot be edited'
);
select throws_ok(
  $$ update public.fixed_deposits set label = 'New' where idempotency_key = 'fd000000-0000-4000-8000-000000000001' $$,
  'FC030', null, 'not even its label'
);
select throws_ok(
  $$ update public.fixed_deposits set archived_at = null, principal_minor = 1 where idempotency_key = 'fd000000-0000-4000-8000-000000000001' $$,
  'FC030', null, 'restore and edit in one step is refused'
);
select lives_ok(
  $$ update public.fixed_deposits set archived_at = null where idempotency_key = 'fd000000-0000-4000-8000-000000000001' $$,
  'an archived deposit can be restored'
);
select results_eq(
  $$ select archived_at is null, principal_minor from public.fixed_deposits where idempotency_key = 'fd000000-0000-4000-8000-000000000001' $$,
  $$ values (true, 20000000::bigint) $$,
  'restored with its values unchanged'
);
delete from public.fixed_deposits where idempotency_key = 'fd000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.fixed_deposits where idempotency_key = 'fd000000-0000-4000-8000-000000000001'), 1,
  'an active deposit cannot be deleted (the delete matches no row)');
update public.fixed_deposits set archived_at = now() where idempotency_key = 'fd000000-0000-4000-8000-000000000002';
delete from public.fixed_deposits where idempotency_key = 'fd000000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.fixed_deposits where idempotency_key = 'fd000000-0000-4000-8000-000000000002'), 0,
  'an archived deposit can be deleted permanently');

-- ------------------------------------------------------------ as B (UTC-11)
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);

select is((select count(*)::int from public.fixed_deposits), 0, 'B cannot see A''s deposits');
update public.fixed_deposits set principal_minor = 1;
update public.fixed_deposits set archived_at = now();
delete from public.fixed_deposits;
select throws_ok(
  $$ insert into public.fixed_deposits (user_id, bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('11111111-1111-4111-8111-111111111111', 'Bank', 100, 700, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-0000000000b1') $$,
  '42501', null, 'B cannot add a deposit for A'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, public.t_today_a(), public.t_today_a() + 400, 'fd000000-0000-4000-8000-0000000000b2') $$,
  'FC031', null, 'A''s today is still in the future for B (time-zone boundary)'
);
select throws_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, public.t_today_b() + 1, public.t_today_b() + 400, 'fd000000-0000-4000-8000-0000000000b3') $$,
  'FC031', null, 'B cannot start after B''s today'
);
select lives_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, public.t_today_b(), public.t_today_b() + 400, 'fd000000-0000-4000-8000-0000000000b4') $$,
  'B can start on B''s today'
);
select lives_ok(
  $$ insert into public.fixed_deposits (bank, principal_minor, rate_bps, start_date, maturity_date, idempotency_key)
     values ('Bank', 100, 700, '2025-01-15', '2026-01-15', 'fd000000-0000-4000-8000-000000000011') $$,
  'request keys are per user: B may reuse one A used'
);
select is((select count(*)::int from public.fixed_deposits), 2, 'B sees only B''s own deposits');

-- ------------------------------------------------------------ anon
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select count(*) from public.fixed_deposits $$, '42501', null, 'anon cannot read fixed deposits');

-- ------------------------------------------------------------ back as the test owner
reset role;
select results_eq(
  $$ select principal_minor, archived_at is null from public.fixed_deposits where idempotency_key = 'fd000000-0000-4000-8000-000000000001' $$,
  $$ values (20000000::bigint, true) $$,
  'B''s update, archive and delete left A''s deposit unchanged'
);
select throws_ok(
  $$ update public.fixed_deposits set user_id = '22222222-2222-4222-8222-222222222222' where idempotency_key = 'fd000000-0000-4000-8000-000000000001' $$,
  'FC009', null, 'the owner can never change, even without the grants'
);

select * from finish();
rollback;
