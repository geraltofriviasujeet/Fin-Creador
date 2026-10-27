-- E2E only: fictional instruments for the throwaway local Supabase in CI (never a hosted
-- project). Loaded by .github/workflows/ci.yml after `supabase start`. Prices are dated from
-- today in India so the tests see a fresh price, an old one (10 days) and one too old to
-- count (45 days, not offered in search). Names, codes and ISINs are made up.
\set ON_ERROR_STOP on

with base as (select (now() at time zone 'Asia/Kolkata')::date as today)
insert into public.instruments (source, source_code, kind, isin, symbol, name, last_price_scaled, price_date)
select v.source, v.code, v.kind, v.isin, v.symbol, v.name, v.price, base.today - v.age
from base, (values
  ('bse',  '990001', 'share', 'INE990T01011', 'LOTUSTEST', 'Lotus Test Industries Ltd',                     12505000, 1),
  ('bse',  '990002', 'share', 'INE990T01029', 'HARBORTEST', 'Harbor Test Bank Ltd',                          4800000, 1),
  ('bse',  '990003', 'etf',   'INF990T01015', 'TESTBEES',  'Test Nifty Bees ETF',                            2594800, 1),
  ('amfi', '990101', 'fund',  'INF990T01023', null,        'Test Flexi Cap Fund - Direct Plan - Growth',      287924, 1),
  ('amfi', '990102', 'fund',  'INF990T01031', null,        'Test Gilt Fund - Regular Plan - Growth',          359468, 10),
  ('amfi', '990103', 'fund',  'INF990T01049', null,        'Test Closed Ended Fund - Direct Plan - Growth',   123456, 45)
) as v(source, code, kind, isin, symbol, name, price, age)
on conflict (source, source_code) do nothing;
