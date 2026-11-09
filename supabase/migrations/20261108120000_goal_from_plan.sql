-- Sprint 10.9 follow-up: "Add to my goals" from a plan. The person adds a goal from the normal
-- goal form, prefilled from the plan; the goal remembers the plan it came from, so the plan
-- can show its goal. The goal is an ordinary goal in every other way (Roma reads it as any other).
--
-- Rules:
--   * goals.plan_message_id: the ai_messages turn whose plan the goal was added from; null for
--     any other goal. Set once, on insert (no update grant); cleared when the conversation is
--     deleted (on delete set null), and the goal stays.
--   * Only the person's own turn, and only one that holds a plan (checked by a trigger: a
--     foreign key alone would accept another person's message id).
--   * One goal per plan (partial unique index); an archived goal keeps its plan.
--   * No change to earlier migrations.

alter table public.goals
  add column plan_message_id uuid references public.ai_messages (id) on delete set null;

create unique index goals_plan_message_unique on public.goals (plan_message_id) where plan_message_id is not null;

comment on column public.goals.plan_message_id is
  'Roma 10.9: the turn (ai_messages) whose plan this goal was added from; null otherwise. Set on insert only; cleared when the conversation is deleted.';

create function public.goals_plan_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Only the foreign key's own "set null" may change it.
    if new.plan_message_id is distinct from old.plan_message_id and new.plan_message_id is not null then
      raise exception 'A goal''s plan can''t change' using errcode = 'FC058';
    end if;
    return new;
  end if;
  if new.plan_message_id is not null and not exists (
    select 1
      from public.ai_messages as m
     where m.id = new.plan_message_id
       and m.user_id = new.user_id
       and m.plan is not null
  ) then
    raise exception 'Plan not found' using errcode = 'FC058';
  end if;
  return new;
end;
$$;

create trigger goals_plan_link
  before insert or update of plan_message_id on public.goals
  for each row execute function public.goals_plan_link();

revoke execute on function public.goals_plan_link() from public, anon, authenticated;

grant insert (plan_message_id) on table public.goals to authenticated;
