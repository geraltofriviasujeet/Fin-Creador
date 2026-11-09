-- Sprint 10.9: detailed plans ("plan my trip to X", "can I buy a car"). A plan runs about 8
-- web lookups (one per web cost line, plus route carriers and hotels), so it gets its own
-- per-question credit cap; the checked plan is kept on its turn so it reopens from history.
--
-- Rules (docs/sprint-plan.md, 10.9 and decisions 2026-11-07):
--   * Caps stay in the one roma_settings row, changed by the owner in the SQL editor:
--       search_reserve_credits       ordinary question, unchanged (default 3, 1 to 3)
--       search_plan_reserve_credits  a plan (new, default 8, 1 to 10)
--       search_user_daily_credits    raised from 5 to 16 (two plans a day); only a row still
--                                    at the old default is raised, an owner's own value stays
--       search_monthly_credits       unchanged (900)
--   * roma_search_begin takes p_plan (default false, so a caller that doesn't send it gets the
--     ordinary cap). Accepted limitation: a person calling it directly can ask for the plan
--     cap on any question; the daily and monthly caps still bound what they can spend.
--   * ai_messages.plan: the checked plan as jsonb, null for an ordinary answer. Written only by
--     roma_record_turn. At most 32 KB. Its top-level keys are a fixed list, and no key anywhere
--     may name an account, IBAN, IFSC, card number or balance: the plan carries no account numbers
--     and no balances beyond the amount already saved toward the goal (key "saved"). The
--     date it was made is the turn's created_at / as_of.
--   * No change to 20261107120000_roma_search.sql (applied in prod): functions are replaced
--     here. roma_search_begin and roma_record_turn gain a parameter with a default, so the old
--     signatures are dropped and the deployed app's calls (named arguments) keep working.

-- ---------------------------------------------------------------------------
-- Caps
-- ---------------------------------------------------------------------------

alter table public.roma_settings
  -- Credits reserved for one plan (searches run in parallel).
  add column search_plan_reserve_credits integer not null default 8,
  add constraint roma_settings_search_plan_reserve check (search_plan_reserve_credits between 1 and 10);

alter table public.roma_settings
  alter column search_user_daily_credits set default 16;

update public.roma_settings
   set search_user_daily_credits = 16
 where search_user_daily_credits = 5;

alter table public.roma_search_usage
  drop constraint roma_search_usage_reserved_range,
  add constraint roma_search_usage_reserved_range check (reserved_credits between 1 and 10);

-- ---------------------------------------------------------------------------
-- Begin: same checks as 10.8, with the plan cap when p_plan
-- ---------------------------------------------------------------------------

drop function public.roma_search_begin(uuid, text);

create function public.roma_search_begin(p_request_id uuid, p_provider text, p_plan boolean default false)
returns table (outcome text, credits integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_settings public.roma_settings;
  v_month_start timestamptz := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC') at time zone 'UTC';
  v_time_zone text;
  v_today date;
  v_month_used integer;
  v_today_used integer;
  v_grant integer;
begin
  if v_user is null then
    raise exception 'Sign in to ask Roma' using errcode = '42501';
  end if;
  if p_plan is null then
    raise exception 'Invalid Roma search request' using errcode = '22023';
  end if;

  -- One check at a time for everyone, so two questions can't both fit under a cap.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.roma_search_usage', 0));

  select * into v_settings from public.roma_settings as s where s.id;
  if not found or not v_settings.enabled or not v_settings.search_enabled then
    return query select 'disabled'::text, 0;
    return;
  end if;

  perform 1
    from public.roma_usage as u
   where u.id = p_request_id
     and u.user_id = v_user
     and u.status = 'reserved'
     and not exists (select 1 from public.roma_search_usage as r where r.request_id = u.id);
  if not found then
    return query select 'no_request'::text, 0;
    return;
  end if;

  select coalesce(sum(public.roma_search_counted(r)), 0)::integer into v_month_used
    from public.roma_search_usage as r
   where r.created_at >= v_month_start;
  if v_month_used >= v_settings.search_monthly_credits then
    return query select 'monthly_cap'::text, 0;
    return;
  end if;

  -- Same fallback as user_local_today, so a missing time zone can never switch the daily
  -- limit off. The 2-day bound only narrows the index scan; the local-date test decides.
  select coalesce(p.time_zone, 'UTC') into v_time_zone
    from public.profiles as p
   where p.id = v_user;
  v_time_zone := coalesce(v_time_zone, 'UTC');
  v_today := public.user_local_today(v_user);
  select coalesce(sum(public.roma_search_counted(r)), 0)::integer into v_today_used
    from public.roma_search_usage as r
   where r.user_id = v_user
     and r.created_at >= pg_catalog.now() - interval '2 days'
     and (r.created_at at time zone v_time_zone)::date = v_today;
  if v_today_used >= v_settings.search_user_daily_credits then
    return query select 'daily_limit'::text, 0;
    return;
  end if;

  -- Fewer than asked when the month or the day has fewer left: the plan runs the lookups it
  -- was granted and shows the rest as "no estimate".
  v_grant := least(
    case when p_plan then v_settings.search_plan_reserve_credits else v_settings.search_reserve_credits end,
    v_settings.search_monthly_credits - v_month_used,
    v_settings.search_user_daily_credits - v_today_used
  );

  insert into public.roma_search_usage (request_id, user_id, provider, reserved_credits)
  values (p_request_id, v_user, p_provider, v_grant);

  return query select 'ok'::text, v_grant;
end;
$$;

comment on function public.roma_search_begin(uuid, text, boolean) is
  'Roma web lookups: kill switches, the caller''s own open question, monthly and daily credit caps, all from roma_settings; on success reserves up to search_reserve_credits (search_plan_reserve_credits for a plan) and returns how many searches may run. A refusal writes nothing.';

-- ---------------------------------------------------------------------------
-- Settle: up to 10 credits (still never more than were reserved)
-- ---------------------------------------------------------------------------

create or replace function public.roma_search_settle(p_request_id uuid, p_credits integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_credits is null or p_credits < 1 or p_credits > 10 then
    raise exception 'Invalid Roma search usage' using errcode = '22023';
  end if;

  update public.roma_search_usage as r
     set status = 'settled',
         credits = p_credits,
         ended_at = pg_catalog.now()
   where r.request_id = p_request_id
     and r.user_id = (select auth.uid())
     and r.status = 'reserved'
     and p_credits <= r.reserved_credits;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- The checked plan on its turn
-- ---------------------------------------------------------------------------

alter table public.ai_messages
  add column plan jsonb,
  add constraint ai_messages_plan_size check (plan is null or octet_length(plan::text) <= 32768),
  add constraint ai_messages_plan_shape check (
    plan is null
    or (
      pg_catalog.jsonb_typeof(plan) = 'object'
      and plan ->> 'v' = '1'
      and plan ->> 'kind' in ('trip', 'purchase')
      -- Top-level keys from a fixed list only.
      and plan - array['v', 'kind', 'intake', 'lines', 'saved', 'carriers', 'hotels', 'verdicts', 'changes', 'assumptions', 'sources']
          = '{}'::jsonb
      -- No key at any depth names an account, account number, IBAN, IFSC, card number or balance.
      and not pg_catalog.jsonb_path_exists(
        plan,
        'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "account|account_no|iban|ifsc|card_number|balance" flag "i")',
        '{}'::jsonb,
        true
      )
    )
  );

comment on column public.ai_messages.plan is
  'Roma 10.9: the checked plan (trip or purchase) behind this answer, for reopening from history; null for an ordinary answer. No account numbers; no balance beyond the amount saved toward the goal.';

comment on table public.ai_messages is
  'Roma turns (owner-only): question, answer, as-of date, periods, tool names and, for a plan, the checked plan; no other tool payloads. Written only by roma_record_turn; deleted with the conversation.';

-- ---------------------------------------------------------------------------
-- Record a turn: as before, plus the plan
-- ---------------------------------------------------------------------------

drop function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean);

create function public.roma_record_turn(
  p_request_id uuid,
  p_conversation_id uuid,
  p_question text,
  p_answer text,
  p_as_of date,
  p_periods daterange[],
  p_tools text[],
  p_sent_descriptions boolean,
  p_plan jsonb default null
)
returns table (conversation_id uuid, seq integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_today date;
  v_question text := pg_catalog.btrim(p_question);
  v_conversation uuid;
  v_seq integer;
begin
  if v_user is null then
    raise exception 'Sign in to ask Roma' using errcode = '42501';
  end if;

  -- Locked so two calls with the same request id run one after the other.
  perform 1 from public.roma_usage as u
   where u.id = p_request_id and u.user_id = v_user and u.status = 'settled'
     for update;
  if not found then
    raise exception 'Unknown Roma request' using errcode = '42501';
  end if;

  -- Idempotent: a retry (e.g. after a dropped connection) gets the turn already recorded.
  select m.conversation_id, m.seq into v_conversation, v_seq
    from public.ai_messages as m
   where m.request_id = p_request_id;
  if found then
    return query select v_conversation, v_seq;
    return;
  end if;

  if not exists (select 1 from public.profiles as p where p.id = v_user and p.roma_enabled) then
    raise exception 'Roma is off for this person' using errcode = '42501';
  end if;

  -- The person's today when the question was asked; a question answered just before their
  -- midnight is recorded just after it.
  v_today := public.user_local_today(v_user);
  if p_as_of is null or p_as_of not between v_today - 1 and v_today
     or v_question is null or v_question = '' or p_answer is null
     or p_periods is null or p_tools is null or p_sent_descriptions is null then
    raise exception 'Invalid Roma turn' using errcode = '22023';
  end if;

  if p_conversation_id is null then
    insert into public.ai_conversations (user_id, title)
    values (v_user, pg_catalog.left(pg_catalog.regexp_replace(v_question, '\s+', ' ', 'g'), 80))
    returning id into v_conversation;
  else
    -- Locked so two answers at once get distinct numbers.
    select c.id, c.turn_count into v_conversation, v_seq
      from public.ai_conversations as c
     where c.id = p_conversation_id and c.user_id = v_user
       for update;
    if not found then
      raise exception 'Unknown Roma conversation' using errcode = '42501';
    end if;
    if v_seq >= 100 then
      raise exception 'This Roma conversation is full' using errcode = '22023';
    end if;
  end if;

  update public.ai_conversations as c
     set turn_count = c.turn_count + 1,
         last_message_at = pg_catalog.now()
   where c.id = v_conversation
  returning c.turn_count into v_seq;

  -- A plan that breaks a check above fails the insert (23514); the turn is not recorded.
  insert into public.ai_messages (
    conversation_id, user_id, seq, request_id, question, answer, as_of, periods, tools, sent_descriptions, plan
  )
  values (
    v_conversation, v_user, v_seq, p_request_id, v_question, p_answer, p_as_of, p_periods, p_tools, p_sent_descriptions, p_plan
  );

  return query select v_conversation, v_seq;
end;
$$;

comment on function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb) is
  'Roma: stores one answered turn (and, for a plan, the checked plan) against the caller''s own settled roma_usage row; starts a conversation when none is given.';

-- ---------------------------------------------------------------------------
-- Function privileges (a new signature starts with the default grant to public)
-- ---------------------------------------------------------------------------

revoke execute on function public.roma_search_begin(uuid, text, boolean) from public, anon;
grant execute on function public.roma_search_begin(uuid, text, boolean) to authenticated;

revoke execute on function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb) from public, anon;
grant execute on function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb) to authenticated;
