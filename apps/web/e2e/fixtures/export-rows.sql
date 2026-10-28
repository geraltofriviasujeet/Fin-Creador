-- E2E only: bulk expenses for the CSV export measurement (e2e/reports-export-scale.spec.ts) on
-- the throwaway local Supabase in CI, never a hosted project. Run as postgres by the test with
-- psql -v email=... -v rows=... ; adds :rows expenses to that user's bank account, spread over
-- the last 365 days in India, through the normal insert trigger. Fictional notes only.
\set ON_ERROR_STOP on

insert into public.transactions (user_id, type, amount_minor, currency, account_id, category_id, occurred_on, note, payment_mode, idempotency_key)
select a.user_id, 'expense', 100 + (g % 997) * 37, a.currency, a.id, c.id,
       (now() at time zone 'Asia/Kolkata')::date - (g % 365),
       case when g % 10 = 0 then '=SUM(A1:A9) test ' || g else 'Bulk test entry ' || g end,
       case when g % 2 = 0 then 'upi' end,
       gen_random_uuid()
from auth.users u
join public.accounts a on a.user_id = u.id and a.kind = 'bank' and a.archived_at is null
join lateral (
  select id from public.categories where user_id = u.id and kind = 'expense' and archived_at is null order by name limit 1
) c on true
cross join generate_series(1, :rows) as g
where u.email = :'email';
