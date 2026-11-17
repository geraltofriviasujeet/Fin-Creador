-- pgTAP tests for UPI app statement import (migration 20261116120000): consent for payee names,
-- the import ledger under Roma's kill switch and caps, Roma's functions refusing import requests,
-- settle / release, account matches, renamed and added default categories, and payee history.
-- Fictional users and data only. Run with `supabase test db` (CI). Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(72);

-- A: consent, Roma off at first. B: another person. C: Roma calls first. D, E: caps.
-- R, S, T: renames. X, Y: Services and Money sent to people.
insert into auth.users (id, email) values
  ('9e000000-0000-4000-8000-00000000000a', 'upi-asha@example.test'),
  ('9e000000-0000-4000-8000-00000000000b', 'upi-bala@example.test'),
  ('9e000000-0000-4000-8000-00000000000c', 'upi-chetan@example.test'),
  ('9e000000-0000-4000-8000-00000000000d', 'upi-devi@example.test'),
  ('9e000000-0000-4000-8000-00000000000e', 'upi-eshan@example.test'),
  ('9e000000-0000-4000-8000-000000000001', 'upi-ravi@example.test'),
  ('9e000000-0000-4000-8000-000000000002', 'upi-sana@example.test'),
  ('9e000000-0000-4000-8000-000000000003', 'upi-tara@example.test'),
  ('9e000000-0000-4000-8000-000000000004', 'upi-xavier@example.test'),
  ('9e000000-0000-4000-8000-000000000005', 'upi-yash@example.test');

update public.roma_settings
   set enabled = true, import_enabled = true, monthly_budget_usd = 1, user_monthly_budget_usd = 1,
       user_daily_requests = 2, import_user_daily_calls = 2, reserve_usd = 0.01;

-- Test-only log of each begin's outcome and request id.
create table public.t_log (name text primary key, outcome text, request_id uuid);
grant select, insert on table public.t_log to authenticated;
create function public.t_import(p_name text) returns text language sql set search_path = ''
  as $$ insert into public.t_log select p_name, b.outcome, b.request_id from public.import_categories_begin('anthropic', 'claude-haiku-5-5') as b
        returning outcome $$;
create function public.t_roma(p_name text) returns text language sql set search_path = ''
  as $$ insert into public.t_log select p_name, b.outcome, b.request_id from public.roma_begin_request('anthropic', 'claude-haiku-5-5') as b
        returning outcome $$;
create function public.t_id(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select l.request_id from public.t_log as l where l.name = p_name $$;
grant execute on function public.t_import(text), public.t_roma(text), public.t_id(text) to authenticated;
create function pg_temp.imports() returns integer language sql stable as $$ select count(*)::int from public.import_category_usage $$;
create function pg_temp.romas() returns integer language sql stable as $$ select count(*)::int from public.roma_usage $$;
create function pg_temp.as_user(p_user uuid) returns void language sql
  as $$ select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true) $$;

-- ------------------------------------------------------------ consent
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000a');
set local role authenticated;
select throws_ok(
  $$ update public.profiles set import_payees_ok_at = now() where id = '9e000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'the signed-in person cannot write import_payees_ok_at directly'
);
select is(public.set_import_payees_consent(true), now(), 'set_import_payees_consent(true): the database''s now()');
reset role;
update public.profiles set import_payees_ok_at = '2026-01-01T00:00:00Z' where id = '9e000000-0000-4000-8000-00000000000a';
set local role authenticated;
select is(public.set_import_payees_consent(true), '2026-01-01T00:00:00Z'::timestamptz, 'allowing again keeps the first time');
select is(public.set_import_payees_consent(false), null, 'false withdraws it');
select is((select import_payees_ok_at from public.profiles where id = '9e000000-0000-4000-8000-00000000000a'), null, '... and the column is cleared');
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000b');
select isnt(public.set_import_payees_consent(true), null, 'B allows for B');
reset role;
select is((select import_payees_ok_at from public.profiles where id = '9e000000-0000-4000-8000-00000000000a'), null, 'B''s consent leaves A''s untouched');

-- ------------------------------------------------------------ import_categories_begin
select ok(
  not has_function_privilege('anon', 'public.import_categories_begin(text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_import_payees_consent(boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.model_spend_since(timestamptz, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.rename_default_expense_categories()', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.import_category_usage', 'SELECT'),
  'signed-in users only; internal functions and the ledger are not reachable'
);
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000a');
set local role authenticated;
select is(public.t_import('a-no-consent'), 'no_consent', 'no consent: refused');
reset role;
select is(pg_temp.imports(), 0, '... and writes nothing');
set local role authenticated;
select public.set_import_payees_consent(true);
select is(public.t_import('a1'), 'ok', 'Roma off but consent given: ok');
reset role;
update public.roma_settings set enabled = false;
set local role authenticated;
select is(public.t_import('a-off'), 'disabled', 'Roma''s kill switch off: refused');
reset role;
update public.roma_settings set enabled = true, import_enabled = false;
set local role authenticated;
select is(public.t_import('a-import-off'), 'disabled', 'the import switch off: refused');
reset role;
select is(pg_temp.imports(), 1, '... both refusals write nothing');
update public.roma_settings set import_enabled = true;
set local role authenticated;
select is(public.t_import('a2'), 'ok', 'a second import call today: ok');
select is(public.t_import('a3'), 'daily_limit', 'a third: the import daily limit');
reset role;
select is(pg_temp.imports(), 2, '... which writes nothing');
update public.profiles set roma_enabled = true where id = '9e000000-0000-4000-8000-00000000000a';
set local role authenticated;
select is(public.t_roma('a-r1') || ',' || public.t_roma('a-r2'), 'ok,ok', 'two import calls don''t use up Roma''s daily questions');

-- C: Roma's questions don't use up the import calls.
reset role;
update public.profiles set roma_enabled = true where id = '9e000000-0000-4000-8000-00000000000c';
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000c');
set local role authenticated;
select public.set_import_payees_consent(true);
select is(public.t_roma('c-r1') || ',' || public.t_roma('c-r2') || ',' || public.t_roma('c-r3'), 'ok,ok,daily_limit', 'C asks Roma up to the daily limit');
select is(public.t_import('c1'), 'ok', '... and can still make import calls');

-- D: import spend counts toward Roma's monthly cap. E: Roma's spend toward the import's.
reset role;
update public.profiles set roma_enabled = true, import_payees_ok_at = now()
 where id in ('9e000000-0000-4000-8000-00000000000d', '9e000000-0000-4000-8000-00000000000e');
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000d');
set local role authenticated;
select is(public.t_import('d1') || ',' || public.t_import('d2'), 'ok,ok', 'D makes two import calls ($0.02 reserved)');
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000e');
select is(public.t_roma('e-r1') || ',' || public.t_roma('e-r2'), 'ok,ok', 'E asks Roma twice ($0.02 reserved)');
reset role;
update public.roma_settings set user_monthly_budget_usd = 0.025;
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000d');
set local role authenticated;
select is(public.t_roma('d-r1'), 'user_budget', 'D''s import spend counts toward D''s cap for Roma');
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000e');
select is(public.t_import('e1'), 'user_budget', 'E''s Roma spend counts toward E''s cap for imports');
reset role;
select is(pg_temp.imports() || ',' || pg_temp.romas(), '5,6', 'the cap refusals write nothing');
update public.roma_settings set user_monthly_budget_usd = 1,
  monthly_budget_usd = public.model_spend_since(date_trunc('month', now() at time zone 'UTC') at time zone 'UTC', null) + 0.005;
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000b');
set local role authenticated;
select is(public.t_import('b-global'), 'global_budget', 'everyone''s spend (both ledgers) at the global cap: imports refused');
reset role;
update public.profiles set roma_enabled = true where id = '9e000000-0000-4000-8000-00000000000b';
set local role authenticated;
select is(public.t_roma('b-global-r'), 'global_budget', '... and Roma refused');
reset role;
select is(pg_temp.imports() || ',' || pg_temp.romas(), '5,6', '... writing nothing');
update public.roma_settings set monthly_budget_usd = 1;

-- ------------------------------------------------------------ Roma refuses import requests
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000a');
set local role authenticated;
select is(public.import_categories_settle(public.t_id('a1'), 1200, 300, 0.000270), true, 'A settles an import call');
select throws_ok(
  $$ select * from public.roma_record_turn(public.t_id('a1'), null, 'q', 'a', current_date, array[]::daterange[], array[]::text[], false) $$,
  '42501', null, 'roma_record_turn refuses a settled import request'
);
select is((select outcome from public.roma_search_begin(public.t_id('a2'), 'tavily')), 'no_request', 'roma_search_begin refuses an open import request');
select is(public.roma_knowledge_embed(public.t_id('a2')), false, 'roma_knowledge_embed refuses it too');

-- ------------------------------------------------------------ settle and release
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000b');
select is(public.import_categories_settle(public.t_id('a2'), 1, 1, 0), false, 'B cannot settle A''s reservation');
select is(public.import_categories_release(public.t_id('a2')), false, 'B cannot release it');
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000a');
select is(public.import_categories_settle(public.t_id('a1'), 1, 1, 0), false, 'a settled reservation cannot be settled again');
select is(public.import_categories_release(public.t_id('a1')), false, '... or released');
select is(public.roma_settle_request(public.t_id('a2'), 1, 1, 0), false, 'Roma''s settle does not act on an import reservation');
select is(public.import_categories_release(public.t_id('a2')), true, 'A releases an open reservation');
select is(public.import_categories_release(public.t_id('a2')), false, 'once only');
select throws_ok($$ select public.import_categories_settle(public.t_id('c1'), -1, 0, 0) $$, '22023', null, 'negative usage is refused');

-- ------------------------------------------------------------ upi_account_matches
reset role;
insert into public.accounts (id, user_id, kind, bank_type, name, currency, opening_balance_minor, opening_balance_date) values
  ('9a000000-0000-4000-8000-0000000000a1', '9e000000-0000-4000-8000-00000000000a', 'bank', 'savings', 'Example Bank', 'INR', 0, current_date - 60),
  ('9a000000-0000-4000-8000-0000000000a2', '9e000000-0000-4000-8000-00000000000a', 'bank', 'savings', 'Old Bank', 'INR', 0, current_date - 60),
  ('9a000000-0000-4000-8000-0000000000b1', '9e000000-0000-4000-8000-00000000000b', 'bank', 'savings', 'Bala Bank', 'INR', 0, current_date - 60);
update public.accounts set archived_at = now() where id = '9a000000-0000-4000-8000-0000000000a2';
select set_config('fin_creador.loan_write', 'on', true);
insert into public.accounts (id, user_id, kind, name, currency, opening_balance_minor, opening_balance_date) values
  ('9a000000-0000-4000-8000-0000000000a3', '9e000000-0000-4000-8000-00000000000a', 'card', 'Example Card', 'INR', 0, current_date - 60),
  ('9a000000-0000-4000-8000-0000000000a4', '9e000000-0000-4000-8000-00000000000a', 'loan', 'Example Loan', 'INR', -100000, current_date - 60);
select set_config('fin_creador.loan_write', '', true);

select pg_temp.as_user('9e000000-0000-4000-8000-00000000000a');
set local role authenticated;
select lives_ok(
  $$ insert into public.upi_account_matches (app, bank_label, last_digits, account_id) values ('paytm', ' Example  Bank ', '12', '9a000000-0000-4000-8000-0000000000a1') $$,
  'A matches a statement account to their own active bank account'
);
select is((select bank_label from public.upi_account_matches where last_digits = '12'), 'example bank', 'the bank name is stored normalised, digits apart');
select throws_ok(
  $$ insert into public.upi_account_matches (app, bank_label, last_digits, account_id) values ('paytm', 'example bank', '34', '9a000000-0000-4000-8000-0000000000b1') $$,
  '22023', null, 'another person''s account is refused'
);
select throws_ok(
  $$ insert into public.upi_account_matches (app, bank_label, last_digits, account_id) values ('paytm', 'old bank', '56', '9a000000-0000-4000-8000-0000000000a2') $$,
  '22023', null, 'an archived account is refused'
);
select throws_ok(
  $$ insert into public.upi_account_matches (app, bank_label, last_digits, account_id) values ('paytm', 'card', '78', '9a000000-0000-4000-8000-0000000000a3') $$,
  '22023', null, 'a card account is refused'
);
select throws_ok(
  $$ insert into public.upi_account_matches (app, bank_label, last_digits, account_id) values ('paytm', 'loan', '90', '9a000000-0000-4000-8000-0000000000a4') $$,
  '22023', null, 'a loan account is refused'
);
select throws_ok(
  $$ insert into public.upi_account_matches (app, bank_label, last_digits, account_id) values ('paytm', 'Example Bank 1234', '12', '9a000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'digits in the bank name are refused'
);
select throws_ok(
  $$ insert into public.upi_account_matches (app, bank_label, last_digits, account_id) values ('paytm', 'EXAMPLE BANK', '12', '9a000000-0000-4000-8000-0000000000a1') $$,
  '23505', null, 'a second row for the same app, bank and digits is refused'
);
select throws_ok(
  $$ insert into public.upi_account_matches (app, bank_label, last_digits, account_id) values ('paytm', 'example bank', '123456', '9a000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'more than 4 digits are refused'
);
select throws_ok(
  $$ update public.upi_account_matches set account_id = '9a000000-0000-4000-8000-0000000000b1' where last_digits = '12' $$,
  '22023', null, 'a match cannot be moved to another person''s account'
);
select lives_ok(
  $$ insert into public.upi_account_matches (app, kind, account_id) values ('google_pay', 'upi_lite', null) $$,
  'the Google Pay UPI Lite choice can be "declined" (no account)'
);
select throws_ok(
  $$ insert into public.upi_account_matches (app, kind, account_id) values ('paytm', 'upi_lite', null) $$,
  '23514', null, 'UPI Lite is a Google Pay choice only'
);
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.upi_account_matches), 0, 'B cannot read A''s matches');
delete from public.upi_account_matches;
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.upi_account_matches), 2, 'B cannot delete them either');

-- ------------------------------------------------------------ renamed and added defaults
reset role;
select results_eq(
  $$ select name from public.categories where user_id = '9e000000-0000-4000-8000-000000000001' and kind = 'expense' and icon in ('other', 'health', 'transport') order by icon $$,
  $$ values ('Medical'::text), ('Miscellaneous'), ('Transport & Cabs') $$,
  'a new user gets the new default names'
);
-- R as before the migration; S renamed theirs; T has an own active "Transport & Cabs".
update public.categories set name = case icon when 'other' then 'Other expenses' when 'health' then 'Health' else 'Transport' end
 where user_id = '9e000000-0000-4000-8000-000000000001' and is_default and icon in ('other', 'health', 'transport');
update public.categories set name = 'My doctors' where user_id = '9e000000-0000-4000-8000-000000000002' and is_default and icon = 'health';
update public.categories set name = 'Transport' where user_id = '9e000000-0000-4000-8000-000000000003' and is_default and icon = 'transport';
insert into public.categories (user_id, kind, name, icon) values ('9e000000-0000-4000-8000-000000000003', 'expense', ' transport & cabs ', 'other');
select is(public.rename_default_expense_categories(), 3, 'the rename touches only R''s three untouched defaults');
select results_eq(
  $$ select name from public.categories where user_id = '9e000000-0000-4000-8000-000000000001' and is_default and icon in ('other', 'health', 'transport') order by icon $$,
  $$ values ('Medical'::text), ('Miscellaneous'), ('Transport & Cabs') $$,
  'an untouched default is renamed'
);
select is((select name from public.categories where user_id = '9e000000-0000-4000-8000-000000000002' and is_default and icon = 'health'), 'My doctors', 'a default the person renamed is left alone');
select is((select name from public.categories where user_id = '9e000000-0000-4000-8000-000000000003' and is_default and icon = 'transport'), 'Transport', 'left alone when the person has an active category of the new name');
select is(public.rename_default_expense_categories(), 0, 'running it again changes nothing');
select is(
  (select array_agg(key order by key) from public.categories where user_id = '9e000000-0000-4000-8000-000000000004' and key in ('services', 'money_sent')),
  array['money_sent', 'services'], 'a new user gets Services and Money sent to people'
);
delete from public.categories where key in ('services', 'money_sent') and user_id = '9e000000-0000-4000-8000-000000000004';
delete from public.categories where key = 'money_sent' and user_id = '9e000000-0000-4000-8000-000000000005';
insert into public.categories (id, user_id, kind, name, icon) values ('9c000000-0000-4000-8000-000000000051', '9e000000-0000-4000-8000-000000000005', 'expense', 'money sent to people', 'other');
select is(public.backfill_default_expense_categories(), 2, 'the backfill creates both for X; Y''s own "money sent to people" takes the key');
select is((select key from public.categories where id = '9c000000-0000-4000-8000-000000000051'), 'money_sent', '... adopted, not duplicated');
select is(public.backfill_default_expense_categories(), 0, 'a second backfill creates nothing');
select is(
  (select count(*)::int from public.categories where user_id in ('9e000000-0000-4000-8000-000000000004', '9e000000-0000-4000-8000-000000000005') and key in ('services', 'money_sent')),
  4, 'each has Services and Money sent to people once'
);

-- ------------------------------------------------------------ payee_last_categories
create function pg_temp.cat(p_user uuid, p_name text) returns uuid language sql stable
  as $$ select c.id from public.categories as c where c.user_id = p_user and c.kind = 'expense' and c.name = p_name $$;
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000a');
set local role authenticated;
select public.record_transaction('expense', '9d000000-0000-4000-8000-000000000001', 6500, current_date - 10, '9a000000-0000-4000-8000-0000000000a1',
  pg_temp.cat('9e000000-0000-4000-8000-00000000000a', 'Food & dining'), p_note => 'Green Leaf Cafe');
select public.record_transaction('expense', '9d000000-0000-4000-8000-000000000002', 6500, current_date - 5, '9a000000-0000-4000-8000-0000000000a1',
  pg_temp.cat('9e000000-0000-4000-8000-00000000000a', 'Groceries'), p_note => 'Green Leaf Cafe');
select public.record_transaction('expense', '9d000000-0000-4000-8000-000000000003', 8000, current_date - 4, '9a000000-0000-4000-8000-0000000000a1',
  pg_temp.cat('9e000000-0000-4000-8000-00000000000a', 'Shopping'), p_note => 'Voided Shop');
select public.void_transaction((select id from public.transactions where idempotency_key = '9d000000-0000-4000-8000-000000000003'), '9d000000-0000-4000-8000-000000000013', 'test');
select public.record_transaction('expense', '9d000000-0000-4000-8000-000000000004', 9000, current_date - 3, '9a000000-0000-4000-8000-0000000000a1',
  pg_temp.cat('9e000000-0000-4000-8000-00000000000a', 'Entertainment'), p_note => 'Archived Hall');
update public.categories set archived_at = now() where id = pg_temp.cat('9e000000-0000-4000-8000-00000000000a', 'Entertainment');
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000b');
select public.record_transaction('expense', '9d000000-0000-4000-8000-000000000005', 6500, current_date - 1, '9a000000-0000-4000-8000-0000000000b1',
  pg_temp.cat('9e000000-0000-4000-8000-00000000000b', 'Shopping'), p_note => 'Green Leaf Cafe');

select pg_temp.as_user('9e000000-0000-4000-8000-00000000000a');
select results_eq(
  $$ select payee, category_id from public.payee_last_categories(array['  GREEN leaf   cafe ']) $$,
  $$ values ('green leaf cafe'::text, pg_temp.cat('9e000000-0000-4000-8000-00000000000a', 'Groceries')) $$,
  'the latest of the caller''s own expenses for the payee, compared ignoring case and spaces'
);
select is((select count(*)::int from public.payee_last_categories(array['Voided Shop'])), 0, 'a voided entry is ignored');
select is((select count(*)::int from public.payee_last_categories(array['Archived Hall'])), 0, 'an archived category is ignored');
select is((select count(*)::int from public.payee_last_categories(array['Nobody Known', ''])), 0, 'an unknown or empty name gives nothing');
select throws_ok($$ select * from public.payee_last_categories(array_fill('x'::text, array[2001])) $$, '22023', null, 'more than 2,000 names are refused');
select pg_temp.as_user('9e000000-0000-4000-8000-00000000000b');
select results_eq(
  $$ select category_id from public.payee_last_categories(array['Green Leaf Cafe']) $$,
  $$ values (pg_temp.cat('9e000000-0000-4000-8000-00000000000b', 'Shopping')) $$,
  'B gets only B''s own history'
);
reset role;
select ok(not has_function_privilege('anon', 'public.payee_last_categories(text[])', 'EXECUTE'), 'anon cannot read payee history');

select * from finish();
rollback;
