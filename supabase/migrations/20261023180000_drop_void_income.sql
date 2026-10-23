-- Sprint 3 Phase 2: web and mobile now void every entry through void_transaction (with a
-- request key), so Sprint 2's void_income wrapper is removed (owner decision B, 2026-10-23).
-- record_income stays: the Income page still records income through it.

drop function public.void_income(uuid, text);
