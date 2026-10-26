-- Sprint 6 (owner, 2026-10-26): the 'car' planned expense becomes 'vehicle' (shown as
-- "Wheeler": a bike, a car or a heavy motor vehicle). The kind and the make are part of the
-- goal's answers (details.vehicle, details.make), checked in packages/schemas like every
-- other answer.
--
-- Existing 'car' goals become 'vehicle' goals with details.vehicle = 'car' and no make
-- (details.make = null; the form asks for it on the next edit). Nothing else changes: the
-- target, saved amount, dates and the rest of the answers stay as they are.
--
-- goals_validate refuses any change of type (FC009), as it should for clients. This
-- one-time rename runs as the migration owner with that trigger switched off for the
-- update only, inside this migration's transaction.

alter table public.goals drop constraint goals_type;

alter table public.goals disable trigger goals_validate;

update public.goals
set type = 'vehicle',
    details = details || '{"vehicle": "car", "make": null}'::jsonb
where type = 'car';

alter table public.goals enable trigger goals_validate;

alter table public.goals add constraint goals_type
  check (type in ('trip', 'vehicle', 'house', 'furniture', 'electronics', 'mobile', 'other'));
