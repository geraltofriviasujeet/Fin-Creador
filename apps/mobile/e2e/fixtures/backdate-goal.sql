-- 13c PR 3 E2E, on CI's throwaway local Supabase only (the spec checks the host first): moves a
-- demo goal's "added" time back, so the Goals screen can show a goal behind an even pace. The
-- API can't set created_at and the goals trigger keeps it fixed, so this session runs without
-- triggers. Noon in Kolkata on :started (the demo profile's time zone).
set session_replication_role = replica;
update public.goals
   set created_at = ((:'started')::date + time '12:00') at time zone 'Asia/Kolkata'
 where name = :'name'
   and user_id = (select id from auth.users where email = :'email');
