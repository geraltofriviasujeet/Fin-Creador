-- Sprint 10.3: Roma's conversation memory. Conversations and their turns, owner-only.
--
-- Rules (docs/sprint-plan.md, Sprint 10, step 10.3):
--   * One ai_conversations row per conversation; one ai_messages row per turn (the question
--     and the answer Roma gave to it). Both belong to the person (user_id) and are deleted
--     with the account (on delete cascade). RLS: a person reads only their own rows.
--   * What a turn stores: the question as typed, the answer text as shown, the person's today
--     the question was answered against (as_of), the periods the tools used, and the names of
--     the tools that ran. No tool payloads: no figures, no account or category lists, no
--     transaction descriptions. sent_descriptions records that search sent descriptions in that
--     turn (the answer may quote one), so the app can leave such answers out of what it sends
--     later if the person has since withdrawn consent.
--   * History is never a source of figures. The app sends the last few turns as text plus a
--     summary it builds itself (questions, tools and periods only), and every figure in a new
--     answer must still come from a tool call made for that question (the figure check).
--   * No client inserts or updates. Turns are written only by roma_record_turn, which takes
--     the id of the caller's own settled roma_usage row: one turn per question that passed
--     roma_begin_request (kill switch, opt-in, caps, daily limit) and reached the provider. A
--     request id records one turn: calling again with it returns that turn (a retry after a
--     dropped connection is not an error). A person calling it directly can store text of their own
--     choosing in their own history, as they could by typing it; it never becomes a figure.
--   * Deleting: a person deletes one conversation, or all of theirs, directly (RLS); its turns
--     go with it. There is no deleting a single turn.
--   * Retention: a conversation is deleted automatically 180 days after its last turn
--     (roma_prune_conversations, daily by pg_cron at 20:30 UTC, 02:00 IST).
--   * Limits: at most 100 turns in a conversation (then the app starts a new one).
--
-- New error codes: none (bad arguments are 22023; not found or not allowed is 42501).

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

create table public.ai_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The first question, cut to 80 characters: the label in the history list.
  title           text not null,
  turn_count      integer not null default 0,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),

  constraint ai_conversations_id_user unique (id, user_id),
  constraint ai_conversations_title check (char_length(title) between 1 and 80),
  constraint ai_conversations_turns check (turn_count between 0 and 100)
);

create index ai_conversations_user_recent_idx on public.ai_conversations (user_id, last_message_at desc);
create index ai_conversations_last_message_idx on public.ai_conversations (last_message_at);

comment on table public.ai_conversations is
  'Roma conversations (owner-only). Rows are created by roma_record_turn; the owner may read and delete. Deleted 180 days after the last turn.';

-- ---------------------------------------------------------------------------
-- Turns
-- ---------------------------------------------------------------------------

create table public.ai_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null,
  user_id           uuid not null references auth.users (id) on delete cascade,
  seq               integer not null,
  -- The roma_usage row of the question (one turn per paid question).
  request_id        uuid references public.roma_usage (id) on delete set null,
  question          text not null,
  answer            text not null,
  -- The person's today the question was answered against (tools resolve "last month" from it).
  as_of             date not null,
  -- Inclusive date ranges the tools used, in the order they ran.
  periods           daterange[] not null default '{}',
  -- Tool names, in the order they ran (repeats kept).
  tools             text[] not null default '{}',
  sent_descriptions boolean not null default false,
  created_at        timestamptz not null default now(),

  constraint ai_messages_conversation foreign key (conversation_id, user_id)
    references public.ai_conversations (id, user_id) on delete cascade,
  constraint ai_messages_seq unique (conversation_id, seq),
  constraint ai_messages_request unique (request_id),
  constraint ai_messages_seq_range check (seq between 1 and 100),
  -- Same bound as the question box (MAX_QUESTION_CHARS).
  constraint ai_messages_question check (char_length(question) between 1 and 500),
  -- An answer is at most 1,200 output tokens; 6,000 characters is above that.
  constraint ai_messages_answer check (char_length(answer) between 1 and 6000),
  constraint ai_messages_periods check (
    coalesce(array_length(periods, 1), 0) <= 16
    and array_position(periods, null) is null
  ),
  constraint ai_messages_tools check (
    coalesce(array_length(tools, 1), 0) <= 16
    and array_to_string(tools, ',', '*') ~ '^([a-z_]{1,40}(,[a-z_]{1,40})*)?$'
  )
);

create index ai_messages_user_idx on public.ai_messages (user_id);

comment on table public.ai_messages is
  'Roma turns (owner-only): question, answer, as-of date, periods and tool names; no tool payloads. Written only by roma_record_turn; deleted with the conversation.';

-- Every period is a closed range of real dates (written as [from, to] inclusive by the app).
create function public.ai_messages_periods_bounded()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from pg_catalog.unnest(new.periods) as p
     where pg_catalog.isempty(p) or pg_catalog.lower_inf(p) or pg_catalog.upper_inf(p)
  ) then
    raise exception 'Invalid Roma period' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger ai_messages_periods_bounded
  before insert on public.ai_messages
  for each row execute function public.ai_messages_periods_bounded();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on table public.ai_conversations, public.ai_messages from anon, authenticated, service_role;

grant select, delete on table public.ai_conversations to authenticated;
grant select on table public.ai_messages to authenticated;

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

create policy ai_conversations_select_own on public.ai_conversations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy ai_conversations_delete_own on public.ai_conversations
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy ai_messages_select_own on public.ai_messages
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Record a turn
-- ---------------------------------------------------------------------------

-- Called by the API route after an answer passed every check and its reservation was settled.
-- p_conversation_id null starts a new conversation. Returns the conversation and the turn's
-- number. Refuses (42501) a request id that isn't the caller's own settled one, a conversation
-- that isn't theirs, or a caller who has turned Roma off; refuses (22023) bad arguments and a
-- full conversation. A request id already recorded returns that turn, whatever else is sent.
create function public.roma_record_turn(
  p_request_id uuid,
  p_conversation_id uuid,
  p_question text,
  p_answer text,
  p_as_of date,
  p_periods daterange[],
  p_tools text[],
  p_sent_descriptions boolean
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

  insert into public.ai_messages (
    conversation_id, user_id, seq, request_id, question, answer, as_of, periods, tools, sent_descriptions
  )
  values (
    v_conversation, v_user, v_seq, p_request_id, v_question, p_answer, p_as_of, p_periods, p_tools, p_sent_descriptions
  );

  return query select v_conversation, v_seq;
end;
$$;

comment on function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean) is
  'Roma: stores one answered turn against the caller''s own settled roma_usage row; starts a conversation when none is given.';

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- Deletes conversations whose last turn is more than 180 days old (their turns go with them).
-- Returns how many were deleted. Run by pg_cron only; no client can call it.
create function public.roma_prune_conversations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.ai_conversations as c
   where c.last_message_at < pg_catalog.now() - interval '180 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.roma_prune_conversations() is
  'Roma retention: deletes conversations 180 days after their last turn. Daily via pg_cron.';

-- pg_cron is created by 20261027180000_price_refresh.sql. A named job replaces one of the
-- same name, so this is safe to run again.
select cron.schedule(
  'roma-conversations-retention',
  '30 20 * * *',
  $job$ select public.roma_prune_conversations(); $job$
);

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.ai_messages_periods_bounded() from public, anon, authenticated;
revoke execute on function public.roma_prune_conversations() from public, anon, authenticated, service_role;

revoke execute on function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean) from public, anon;
grant execute on function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean) to authenticated;
